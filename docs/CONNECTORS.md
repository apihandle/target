# Connectors

A user connects their own external accounts once on **Connectors** (`/app/connectors`). The chat agent can use a connector's tools **only** while that user's connection has status `connected`. If the agent needs an app that isn't connected, the task pauses as `needs_connection` and chat shows a **Connect** button; after connecting, the user returns to the chat and the task continues.

## How it fits together

| Piece | Where |
| --- | --- |
| Registry (one object per connector, `getTools(connection)`) | `src/lib/connectors/registry.ts` |
| Connectors | `src/lib/connectors/{supabase,vercel,github,google,figma,canva,slack,notion}.ts` |
| Types (`ConnectorDef`, `ToolDef` with zod `input`, `requiresApproval`) | `src/lib/connectors/types.ts` |
| AES-256-GCM credential crypto, PKCE | `src/lib/connectors/crypto.ts` |
| Encrypted storage, refresh-before-expiry, mark `expired`, revoke + delete | `src/lib/connectors/store.ts` |
| OAuth state (random, hashed, server-side, single use, 10 min) | `src/lib/connectors/state.ts` |
| Generic OAuth 2.0 code flow (+PKCE) | `src/lib/connectors/oauth.ts` |
| `loadToolsForUser`, `executeToolCall`, approval proposal, `runApprovedTool` | `src/lib/connectors/loadTools.ts` |
| Redaction, untrusted-data wrapper, destructive-SQL detection | `src/lib/connectors/safety.ts` |
| Rate limiting | `src/lib/connectors/rateLimit.ts` |
| Agent loop (OpenAI-compatible `tools`, streaming tool-call parsing) | `src/lib/agent.ts`, used by `src/app/api/chat/route.ts` |
| API routes | `src/app/api/connectors/route.ts`, `[id]/connect`, `[id]/callback`, `[id]/disconnect` |
| UI | `src/app/app/connectors/page.tsx`, `src/components/ConnectorsGrid.tsx`, `src/components/ConnectCard.tsx` |
| Migration | `supabase/migrations/0007_connectors.sql` |

**Adding a connector:** create `src/lib/connectors/<id>.ts` exporting a `defineConnector({...})`, then add one line to `CONNECTORS` in `registry.ts`.

### Agent flow

1. `loadToolsForUser(userId)` reads the user's connection rows and returns tools only for connectors with `status = 'connected'` that are configured on the server. Tools are exposed to the model as `<connector>__<tool>` with JSON Schema generated from the zod schema (`z.toJSONSchema`).
2. A meta tool `request_connector` lists every connector that isn't connected. If the model calls it, or calls a tool of an unconnected/expired connector, the result is `{ "error": "connector_not_connected", "connector": "<id>" }`. The loop stops, the task is set to `needs_connection` (`tasks.needs_connector = <id>`), and chat shows a Connect card.
3. After a successful connect (OAuth callback or validated API key), tasks waiting on that connector move to `in_progress`. The Connect card returns to `/app?c=<conversation>&resume=<task>` and the chat sends one "please continue" turn with `resume: true`, so the agent picks the task up with the new tools.
4. Tools with `requiresApproval` (always, or per call, e.g. `run_sql` only for destructive SQL) are **never executed by the loop**. They become a `pending` row in `approval_requests` (`action_type = 'connector_tool'`, immutable payload `{connector, tool, args}`), the task goes to `waiting_approval`, and chat shows the existing approval card. Only `executeApproval` (owner-approved, claimed atomically, run once) calls `runApprovedTool`, which re-checks the connection and re-validates the arguments.
5. Every tool call updates `connections.last_used_at`. Output is redacted, size-capped and wrapped in `<untrusted_data source=… tool=…>`; the system prompt tells the model to treat that content as data only.
6. Models/providers that reject the `tools` parameter (HTTP 400/404/422 with tools attached) fall back to ordinary streaming chat without tools, with a one-line note if the user has connected apps.

### What needs approval

| Connector | Tool | Approval |
| --- | --- | --- |
| Supabase | `run_sql`, `apply_migration` | when the SQL contains DROP, DELETE, TRUNCATE, UPDATE, ALTER, GRANT, REVOKE, REINDEX, VACUUM, CLUSTER, REASSIGN, MERGE, or opaque DO/EXECUTE/CALL/COPY (comments and quoted strings ignored; dollar-quoted bodies are checked) |
| Supabase | `deploy_edge_function` | always (publishes to the live endpoint) |
| Supabase | `create_project` (free tier only), `pause_project`, `restore_project`, `delete_project`, `delete_edge_function`, `delete_secrets`, `delete_bucket`, `update_auth_config` | always (card shows the project name/region/status, the SQL, old → new auth settings with secrets masked, and a warning when the project is TARGET's own database) |
| Supabase | `create_bucket` | when the bucket is public |
| Vercel | `create_deployment`, `redeploy` | when `target = production` |
| Vercel | `promote_deployment`, `rollback_deployment`, `delete_project`, `delete_env_var`, `remove_domain`, `update_project` (build settings), `link_git_repo` | always (card shows the deployment/commit and what is live now, repo + domains for a delete, old → new settings; env values are never shown) |
| Vercel | `add_domain` | always (changes live routing) |
| GitHub | `commit_files` | when the branch is main/master/production/prod/release |
| GitHub | `put_file` | when the branch is main/master/production/prod/release or omitted (default branch) |
| GitHub | `delete_repo`, `set_repo_visibility`, `delete_branch`, `merge_pull_request`, `delete_file`, `delete_release`, `add_collaborator`, `remove_collaborator`, `trigger_workflow` | always (card shows server-looked-up details, e.g. owner/name, private/public and a permanent-delete warning) |
| GitHub | `archive_repo` | when archiving (unarchiving is direct) |
| GitHub | `create_release` | unless it is a draft (publishing notifies watchers) |
| Google | `gmail_send`, `gmail_reply`, `gmail_reply_all`, `gmail_forward`, `gmail_send_draft` | always (card shows the exact recipients, subject, text and attachment names; reply/forward recipients are computed by the server from the original email) |
| Google | `gmail_delete_draft`, `gmail_delete_label`, `calendar_create_event`, `calendar_quick_add`, `calendar_rsvp`, `drive_share`, `drive_unshare`, `drive_trash`, `drive_delete_permanently` | always (card shows the draft/label/event/file names, who gets access, and warnings for link sharing and permanent deletes) |
| Google | `gmail_trash` | when more than one email (card lists their subjects; one email is trashed directly, recoverable 30 days) |
| Google | `calendar_update_event`, `calendar_delete_event` | when the event has other guests (`has_other_guests: true`; without it the server refuses to touch such an event) or guests are added/removed; solo events change directly |
| Slack | `send_message` (post / thread reply), `send_dm`, `upload_file`, `schedule_message` | always (card shows the channel's real name / the person and the text) |
| Notion | `archive_page` | always (card shows the page title; Notion trash keeps it 30 days) |
| Figma | `post_comment` | always (card shows the file name and comment) |

No connector spends money. Deleting a GitHub repository (`delete_repo`, one or several in a single card) only happens after the user approves that exact list on its approval card. Gmail can create drafts, and `gmail_send` sends an email only after the user approves that exact email on its approval card (requiresApproval: the chat path can never run it; only the approval execution gate does).

## Security model

- **Encryption:** credentials are JSON-encoded and encrypted with AES-256-GCM (`v1.<iv>.<tag>.<ciphertext>`), key `CONNECTOR_ENCRYPTION_KEY` (32 bytes, base64). Backward compatibility: if only `TOKEN_ENCRYPTION_KEY` (from the earlier Google Calendar integration) is set it is used; if both are set, new data uses `CONNECTOR_ENCRYPTION_KEY` and old rows still decrypt with `TOKEN_ENCRYPTION_KEY` (they are re-encrypted with the new key on the next refresh or reconnect). Simplest path: set `CONNECTOR_ENCRYPTION_KEY` to the same value as `TOKEN_ENCRYPTION_KEY`.
- **Browser can't read credentials:** migration 0007 revokes all table privileges on `connections` from `anon`/`authenticated`, then grants `SELECT` on every column **except** `encrypted_credentials`, plus `DELETE` (RLS limits both to the user's own rows). Inserts/updates happen only on the server with the service role. `connector_oauth_states`, `connector_rate_limits` and the legacy `connection_secrets` have RLS on, no policies and no grants.
- **Ownership:** every route resolves the user from the session and filters by that `user_id` (never from the request body). OAuth state is bound to the user and connector; another signed-in user can't complete someone else's flow.
- **OAuth state:** 32 random bytes; only its SHA-256 is stored; deleted on first use (also on provider error); expires after 10 minutes. PKCE (S256) is used where the provider supports it (Supabase, Google, Canva).
- **Refresh:** OAuth tokens are refreshed when within 2 minutes of expiry. If refresh fails the row is set to `expired`, its tools disappear, and the agent asks the user to reconnect.
- **No secrets in output:** API responses only expose non-secret columns; provider errors pass through `redact()` (pattern- and value-based); tool output is redacted with the live token as a known value; route errors are generic.
- **Rate limits:** connect/disconnect 10 per 10 min per user, tool calls 30 per minute per user, chat 20 per minute per user. With `SUPABASE_SERVICE_ROLE_KEY` set, counting uses the `connector_rate_hit()` Postgres function (atomic fixed window, shared by all serverless instances). Without it (local dev/tests) it falls back to an in-memory counter, which on Vercel is per instance only.
- **Prompt injection:** all connector output is wrapped as `<untrusted_data>`, closing tags inside the data are neutralised, and the system prompt forbids following instructions inside it. Destructive actions still need the user's click regardless of what the model is told.

## Setup

Common, required for any connector:

1. Apply `supabase/migrations/0007_connectors.sql` (after 0001–0006).
2. Set `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTOR_ENCRYPTION_KEY` (`openssl rand -base64 32`).

Redirect URL pattern for every OAuth connector: **`https://<your-domain>/api/connectors/<id>/callback`** (for local dev `http://localhost:3000/api/connectors/<id>/callback`).

### Supabase: works end to end

- **Chosen integration: Supabase Management API (REST), `https://api.supabase.com/v1`**, verified against the official OpenAPI spec https://api.supabase.com/api/v1-json (each endpoint's "OAuth scope" badge). MCP (`https://mcp.supabase.com/mcp`) wraps the same API, so TARGET calls REST directly with per-user tokens and checks approvals before every request.
- **Auth: OAuth 2.0 + PKCE** through TARGET's Supabase OAuth app (`SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET`, redirect `https://<your-domain>/api/connectors/supabase/callback`). Scopes are configured on the app (Supabase → Organization settings → OAuth Apps), not sent at authorize time. Needed: `projects:read/write`, `organizations:read`, `database:read/write`, `edge_functions:read/write`, `secrets:read/write`, `storage:read`, `auth:read/write`, `analytics:read`, `environment:read`.
- **Reconnect:** everything after the first four scopes was added on 2026-11-04 (`addedScopes`). The owner must enable those scopes on the OAuth app; connections made before show **Reconnect** on the Connectors page, and a 403 on one of the added scopes returns `reconnect_required` (`/app/connectors?connect=supabase`). A 403 on an original scope is reported as a role problem instead (no reconnect loop).
- **Tools:** list_organizations, list_org_members, list_projects, get_project_url, create_project (forces `plan: "free"`, refuses orgs on a paid plan because new projects there add compute charges; the DB password is generated server-side and never shown), pause_project, restore_project, delete_project, list_tables, run_sql, list_migrations, apply_migration, generate_typescript_types, list_branches (branching is paid, so list only), list/deploy/delete Edge Functions, list_api_keys / get_api_key (always masked: secret keys show only their last 4), list_secrets (names only), set_secrets, delete_secrets, list_buckets, create_bucket / delete_bucket (via the project's Storage API `https://<ref>.supabase.co/storage/v1/bucket`, with the project's secret key fetched server-side for that one call and never returned), get_auth_config (secret fields hidden), update_auth_config, get_logs (unified `logs` stream, last ≤24 h, by source and text; SQL built and escaped server-side).
- Endpoints: `GET /v1/organizations`, `/organizations/{slug}`, `/organizations/{slug}/members`, `GET|POST /v1/projects`, `GET|DELETE /v1/projects/{ref}`, `POST /projects/{ref}/pause`, `/restore`, `POST /database/query` + `/read-only`, `GET|POST /database/migrations`, `GET /types/typescript`, `GET /branches`, `GET /functions`, `GET|DELETE /functions/{slug}`, `POST /functions/deploy`, `GET /api-keys`, `/api-keys/{id}`, `GET|POST|DELETE /secrets`, `GET /storage/buckets`, `GET|PATCH /config/auth`, `GET /analytics/endpoints/logs`.

### Vercel: works end to end

- **Chosen integration: Vercel REST API** (`https://api.vercel.com`), verified against https://openapi.vercel.sh/. The hosted MCP (`https://mcp.vercel.com`) only accepts AI clients Vercel has allow-listed (https://vercel.com/docs/agent-resources/vercel-mcp), so it isn't used.
- **Auth: TARGET's Vercel Integration** (external installation flow, `VERCEL_OAUTH_CLIENT_ID` / `_SECRET` / `VERCEL_INTEGRATION_SLUG`). The team it was installed on is saved and added as `teamId` to every call; `team` overrides it.
- **Permissions:** the integration needs read/write on Projects, Deployments, Project Environment Variables and Domains, plus Teams read (Vercel → Integrations Console → TARGET → Permissions). When the owner adds a permission, Vercel asks each installation to review it; until then a 403 that names a missing permission returns `reconnect_required` (`/app/connectors?connect=vercel`).
- **Tools:** list_teams, list_projects, get_project (build settings, Node version, linked repo, current production), create_project (optional GitHub repo + settings), update_project, link_git_repo (`POST /v9/projects/{id}/link`, the endpoint the Vercel CLI uses for `vercel git connect`), delete_project, list_deployments, create_deployment, redeploy, promote_deployment, rollback_deployment, cancel_deployment, get_deployment, get_deployment_logs, list_env_vars / add_env_var / update_env_var / delete_env_var (values are never decrypted or returned; add/update take effect on the next deployment), list_domains, add_domain, remove_domain, check_domain (DNS config + recommended records, optional re-verify).
- Endpoints: `GET /v2/teams`, `GET /v10/projects`, `POST /v11/projects`, `GET|PATCH|DELETE /v9/projects/{idOrName}`, `POST /v9/projects/{id}/link`, `GET /v7/deployments`, `POST /v13/deployments`, `GET /v13/deployments/{id}`, `PATCH /v12/deployments/{id}/cancel`, `POST /v10/projects/{id}/promote/{dpl}`, `POST /v1/projects/{id}/rollback/{dpl}`, `GET /v3/deployments/{id}/events`, `GET|POST /v10/projects/{p}/env`, `PATCH|DELETE /v9/projects/{p}/env/{id}`, `GET /v9/projects/{p}/domains`, `GET|DELETE /v9/projects/{p}/domains/{d}`, `POST /v9/projects/{p}/domains/{d}/verify`, `POST /v10/projects/{p}/domains`, `GET /v6/domains/{d}/config`.

### GitHub

- Create an **OAuth App**: https://github.com/settings/developers → OAuth Apps → New. Homepage `https://<your-domain>`, Authorization callback URL `https://<your-domain>/api/connectors/github/callback`. Set `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.
- OAuth App (not a GitHub App). Scopes requested: `repo delete_repo workflow`. `repo` covers code, issues, PRs, releases, collaborators, settings and Actions runs (no narrower OAuth scope allows writing private repos); `delete_repo` is required to delete repositories (`repo` does not include it); `workflow` is required to create/edit files under `.github/workflows`. Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps. Disconnect revokes via `DELETE /applications/{client_id}/grant` (https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization). Nothing to toggle in the OAuth App settings: OAuth App scopes are requested at authorize time.
- `delete_repo` and `workflow` were added on 2026-11-04 (`addedScopes`). Connections made before that keep their old token: the Connectors page shows **Reconnect** on GitHub with the missing scopes, and a tool call GitHub refuses for a missing scope (detected from `x-oauth-scopes` / `x-accepted-oauth-scopes` or GitHub's "without `workflow` scope" message) returns `reconnect_required` with `reconnect_url: /app/connectors?connect=github`; the chat shows a Reconnect card and resumes the task after reconnecting. `delete_repo` checks the scope before creating the approval card, so the user isn't asked to approve something that would fail.
- Tools: list_repos, get_repo, create_repo (user or org), delete_repo (one or many), archive_repo / unarchive, rename_repo, set_repo_visibility, update_repo (description, homepage, topics), read_file, put_file (create/update), delete_file, commit_files (Git Data API, one commit), list_branches, create_branch, delete_branch, list_pull_requests, open_pull_request (draft), merge_pull_request, list_issues, set_issue_state (close/reopen issues and PRs), list_releases, create_release, delete_release (optionally its tag), list_collaborators, add_collaborator, remove_collaborator, list_workflows, list_workflow_runs, trigger_workflow. TODO: files > 1 MB; a GitHub App for fine-grained access.

### Google (Gmail, Calendar, Drive, Sheets, Docs, Contacts)
- Code: `src/lib/connectors/google.ts` (connector) + `src/lib/connectors/google/{shared,mime,gmail,calendar,drive,workspace,verify}.ts`. Login scopes: `src/lib/connectors/googleLoginScopes.ts` (keep in sync with `SCOPES` in `google/shared.ts`; a test enforces it).
- Google Cloud Console → APIs & Services: enable **Gmail API, Google Calendar API, Google Drive API, Google Sheets API, Google Docs API, People API**. OAuth consent screen scopes: `gmail.modify`, `calendar`, `drive`, `contacts.readonly`, `contacts.other.readonly` (+ `openid`, `email`). Credentials → OAuth client ID → Web application, authorized redirect URI `https://<your-domain>/api/connectors/google/callback`. Set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
- Tools (59): Gmail search/read/threads/attachments (read text, save to Drive), drafts (create with attachments or as a reply, list, send, delete), send/reply/reply-all/forward with attachments from Drive (Docs/Sheets/Slides attach as PDF) or a link (SSRF-guarded, 24 MB total), labels (list/create/delete/modify), archive, mark read/unread, star, trash/untrash; Calendar list calendars/events, get, create (all-day, guests, RRULE recurrence, Meet link), quick add, update/move (keeps duration, whole series), delete, RSVP, find free time (free/busy, working hours, other people); Drive search, list folder, get file + sharing, read (Docs/Sheets/Slides/PDF/text), create folder, upload (text or link, optional conversion), create Doc (Markdown) / Sheet (rows), move, rename, copy, share/unshare, trash/untrash, delete permanently, export (PDF/DOCX/XLSX/PPTX/CSV/TXT/…, saved next to the original); Sheets info/read range/append rows/update range/add tab; Docs read/append/replace text; Contacts search (saved contacts + people emailed before).
- Scopes changed 2026-11-04 from `gmail.readonly`, `gmail.compose`, `calendar.events`, `drive.readonly`. Older connections keep the tools those scopes cover; every other tool is still offered but answers `reconnect_required` ("Reconnect Google to allow this", Reconnect card) before any approval card or Google call. Google's own insufficient-scope 403 maps to the same pause, and a disabled API returns which API to enable.
- **Changed redirect URI:** the earlier integration used `/api/integrations/google_calendar/callback` (never deployed). Use the new path.
- Docs: https://developers.google.com/identity/protocols/oauth2/web-server. `gmail.modify` and `drive` are restricted, `calendar` and contacts are sensitive: until Google verifies the app users see an "unverified app" warning and restricted scopes are capped at 100 users. In Testing mode only listed test users can connect.

### Figma

- **MCP checked:** `https://mcp.figma.com/mcp` is OAuth-only, does not accept personal access tokens, and only clients in the Figma MCP catalog can connect (https://developers.figma.com/docs/figma-mcp-server/mcp-clients-issues/, https://help.figma.com/hc/en-us/articles/39216419318551). Not usable from TARGET.
- **Used instead: Figma REST API.** Two ways in: a personal access token (always available, sent as `X-Figma-Token`, validated with `GET /v1/me`), or an OAuth app when `FIGMA_OAUTH_CLIENT_ID` / `FIGMA_OAUTH_CLIENT_SECRET` are set (authorize `https://www.figma.com/oauth` with PKCE, token `POST /v1/oauth/token`, refresh `POST /v1/oauth/refresh`, Basic client auth; Bearer token; https://developers.figma.com/docs/rest-api/oauth-apps/). Redirect URL `https://<your-domain>/api/connectors/figma/callback`.
- Scopes: `current_user:read`, `file_content:read`, `file_metadata:read`, `file_comments:read`, `file_comments:write`, `projects:read`, `library_content:read`, `team_library_content:read`.
- Tools: `list_projects` (`/v1/teams/:id/projects`), `list_files` (`/v1/projects/:id/files`), `get_design_context` (`/v1/files/:key`, `/nodes`), `get_screenshot` (`/v1/images/:key`, PNG/JPG/SVG/PDF), `list_comments`, `post_comment` (approval; `POST /v1/files/:key/comments`, pin to a node or reply), `list_components` (file or team, plus component sets), `list_styles` (file or team).

### Canva

- **MCP checked:** Canva's MCP server (`https://mcp.canva.com/mcp` for waitlist clients; `https://api.canva.com/connect/v1/mcp` for Developer Portal apps) requires a Developer Portal app with client id/secret (https://www.canva.dev/docs/mcp, https://www.canva.dev/docs/apps/mcp/access/). Since registration is needed either way, TARGET uses the documented **Connect REST API** directly.
- Create an app at https://www.canva.com/developers/apps → Outside Canva → turn on Canva REST APIs, select scopes `profile:read`, `design:meta:read`, `design:content:read`, `design:content:write`, `asset:read`, `asset:write`, `folder:read`, `brandtemplate:meta:read`, `brandtemplate:content:read`, add redirect URL `https://<your-domain>/api/connectors/canva/callback`, generate a client secret. Set `CANVA_OAUTH_CLIENT_ID` / `CANVA_OAUTH_CLIENT_SECRET`. OAuth with PKCE (S256), token endpoint with Basic auth (https://www.canva.dev/docs/connect/authentication/).
- Tools: `list_designs` (search, ownership), `create_design` (doc/whiteboard/presentation or custom px, optional starting asset), `export_design` (PDF/PNG/JPG/GIF/PPTX/MP4, pages; polls the job), `upload_asset` (`POST /v1/url-asset-uploads`, Canva fetches a public https URL; polls), `list_folders` (`/v1/folders/:id/items`, `root` = top level), `list_brand_templates`, `get_brand_template_fields` (dataset), `autofill_brand_template` (`POST /v1/autofills`, text/image/chart fields checked against the dataset; Canva Pro/Teams/Enterprise). Nothing destructive, so no approval cards.

### Slack

- Create an app at https://api.slack.com/apps → OAuth & Permissions: Redirect URL `https://<your-domain>/api/connectors/slack/callback`; **User Token Scopes** `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `search:read`, `chat:write`, `im:write`, `reactions:write`, `files:write`, `users:read`, `users.profile:write` (no bot scopes needed). Set `SLACK_OAUTH_CLIENT_ID` / `SLACK_OAUTH_CLIENT_SECRET`. Token rotation is optional (refresh is supported).
- TARGET acts with a **user token** (`user_scope`, token from `authed_user`), because `search.messages` and `users.profile.set` require one and messages should come from the user. Docs: https://docs.slack.dev/authentication/installing-with-oauth.
- Tools: `list_channels` (`conversations.list`), `read_history`, `read_thread`, `search_messages`, `send_message` (post or thread reply, approval), `send_dm` (`conversations.open` + post, approval), `add_reaction`, `upload_file` (`files.getUploadURLExternal` → upload → `files.completeUploadExternal`, approval), `set_status`, `list_users`, `schedule_message` (`chat.scheduleMessage`, up to 120 days, approval). `missing_scope` → "Reconnect Slack". Disconnect calls `auth.revoke`.

### Notion

- Create a **public connection** in the Notion developer portal (https://app.notion.com/developers/connections), capabilities: read content, update content, insert content, read comments, insert comments; redirect URI `https://<your-domain>/api/connectors/notion/callback`. Set `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET`. Docs: https://developers.notion.com/docs/authorization, revoke: https://developers.notion.com/reference/revoke-token.
- Tools: `search` (pages/databases), `read_page` (properties + full content, Markdown-ish), `create_page`, `append_blocks` (Markdown-ish text or raw blocks, 100 per request), `update_page_properties` (simple values mapped through the database schema, or raw JSON), `query_database` (filter/sorts, simplified rows), `create_database_row`, `archive_page` (approval), `list_comments`, `add_comment`. Uses `Notion-Version: 2022-06-28`. TODO: move to 2025-09-03 data sources when needed.

## Test plan

Automated (`npm test`, file `src/__tests__/connectors.test.tsx`, test "TEST PLAN: …") runs this flow against the real route handlers with an in-memory Supabase. Manual steps on a deployed preview:

1. Apply migration 0007; set `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTOR_ENCRYPTION_KEY`; deploy.
2. Sign in, open **Connectors**. Supabase shows **Not connected**. In the SQL editor, confirm `select encrypted_credentials from connections` works there (service role) but the browser can't read it: from the browser console, `supabase.from('connections').select('encrypted_credentials')` returns a permission error.
3. In chat ask: "List the tables in my Supabase project." The agent calls `request_connector`; the reply shows **Connect Supabase** and the task appears under Tasks as **Needs a connection**.
4. Click **Connect Supabase** → the permissions panel is shown → paste a scoped PAT → **Verify & connect**. An invalid token shows an error and nothing is saved. A valid one returns to the chat, which continues and lists tables (via `/database/query/read-only`).
5. Ask "drop the table test_table". An approval card appears; nothing runs until **Approve**. Reject → nothing runs.
6. Check `connections.last_used_at` updated; `encrypted_credentials` starts with `v1.` and doesn't contain the PAT.
7. **Disconnect** Supabase on Connectors. Ask "List my Supabase tables" again: no Supabase tools are offered (only `request_connector`), and the agent asks you to connect Supabase again.
8. (Optional) Repeat 3–4 for Vercel with a Vercel token: "show the status of my latest deployment for <project>".

## Known limitations

- Live provider calls were not exercised during development (no real credentials available); provider calls are covered by unit tests with mocked HTTP only.
- Tool calling depends on the configured model. If every model rejects `tools`, chat continues without connector tools.
- The agent loop runs inside the chat request (max 5 rounds, 4 calls per round, 60 s function limit). Long tasks need "continue".
- Resume after connect requires the user to come back to the chat (the Connect card does this automatically); there's no background worker.
- Destructive-SQL detection is keyword-based and errs toward asking (e.g. any `UPDATE`, or `DROP` inside a function body).
- `connection_secrets` (0006) is left in place, unused except as a read fallback; drop it manually once you have verified the migration.
