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
| Vercel | `create_deployment` | when `target = production` |
| Vercel | `add_domain` | always (changes live routing) |
| GitHub | `commit_files` | when the branch is main/master/production/prod/release |
| GitHub | `put_file` | when the branch is main/master/production/prod/release or omitted (default branch) |
| GitHub | `delete_repo`, `set_repo_visibility`, `delete_branch`, `merge_pull_request`, `delete_file`, `delete_release`, `add_collaborator`, `remove_collaborator`, `trigger_workflow` | always (card shows server-looked-up details, e.g. owner/name, private/public and a permanent-delete warning) |
| GitHub | `archive_repo` | when archiving (unarchiving is direct) |
| GitHub | `create_release` | unless it is a draft (publishing notifies watchers) |
| Google | `calendar_create_event` | always (kept from the previous Calendar integration) |
| Slack | `send_message` | always |

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

- **Chosen integration: Supabase Management API (REST), `https://api.supabase.com/v1`.** Endpoints used: `GET /v1/projects`, `GET /v1/projects/{ref}`, `POST /v1/projects/{ref}/database/query` and `/database/query/read-only`, `POST /v1/projects/{ref}/database/migrations`, `POST /v1/projects/{ref}/functions/deploy?slug=` (multipart `metadata` + `file`). Verified against the official OpenAPI spec https://api.supabase.com/api/v1-json.
- **MCP checked:** `https://mcp.supabase.com/mcp` is the official hosted server. Auth is OAuth 2.1 with dynamic client registration (authorization server `https://api.supabase.com`), or a personal access token in a header for CI (https://supabase.com/docs/guides/getting-started/mcp; protected-resource metadata at https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp). It wraps the same Management API, so TARGET calls REST directly: one fewer protocol layer, per-user tokens, and approval checks before every request.
- **Default auth: personal access token** (no app registration needed). The user creates it at https://supabase.com/dashboard/account/tokens. Recommended scoped permissions (https://supabase.com/docs/guides/platform/personal-access-tokens): Projects (account-wide) Read, Project Settings Read, Database Read-write, Migrations Read-write, Edge Functions Read-write. The token is validated with `GET /v1/projects` before it is saved.
- **Optional OAuth:** register an OAuth app in your Supabase organization settings → OAuth Apps, choose its scopes there, set redirect URL `https://<your-domain>/api/connectors/supabase/callback`, then set `SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET`. Endpoints `/v1/oauth/authorize` (PKCE), `/v1/oauth/token`, `/v1/oauth/revoke`. When set, the card offers both OAuth and token.

### Vercel: works end to end

- **Chosen integration: Vercel REST API** (`https://api.vercel.com`): `GET /v2/user` (token check), `GET /v10/projects`, `POST /v13/deployments` (redeploy via `deploymentId` or `gitSource {type:"github", org, repo, ref}`), `GET /v13/deployments/{idOrUrl}`, `GET /v3/deployments/{idOrUrl}/events`, `POST /v10/projects/{idOrName}/domains`. Verified against https://openapi.vercel.sh/ (docs: https://vercel.com/docs/rest-api). Team resources take `team` (team id `team_…` → `teamId`, otherwise `slug`).
- **MCP checked:** `https://mcp.vercel.com` is OAuth-only and **accepts only AI clients Vercel has reviewed and allow-listed** (https://vercel.com/docs/agent-resources/vercel-mcp). A self-hosted app can't use it without going through Vercel's client review, so it isn't used.
- **Auth: Vercel access token.** The user creates it at https://vercel.com/account/settings/tokens (pick account or team scope and an expiry). No server variables. TODO: OAuth ("Sign in with Vercel" / integration) instead of a pasted token.

### GitHub

- Create an **OAuth App**: https://github.com/settings/developers → OAuth Apps → New. Homepage `https://<your-domain>`, Authorization callback URL `https://<your-domain>/api/connectors/github/callback`. Set `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.
- OAuth App (not a GitHub App). Scopes requested: `repo delete_repo workflow`. `repo` covers code, issues, PRs, releases, collaborators, settings and Actions runs (no narrower OAuth scope allows writing private repos); `delete_repo` is required to delete repositories (`repo` does not include it); `workflow` is required to create/edit files under `.github/workflows`. Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps. Disconnect revokes via `DELETE /applications/{client_id}/grant` (https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization). Nothing to toggle in the OAuth App settings: OAuth App scopes are requested at authorize time.
- `delete_repo` and `workflow` were added on 2026-11-04 (`addedScopes`). Connections made before that keep their old token: the Connectors page shows **Reconnect** on GitHub with the missing scopes, and a tool call GitHub refuses for a missing scope (detected from `x-oauth-scopes` / `x-accepted-oauth-scopes` or GitHub's "without `workflow` scope" message) returns `reconnect_required` with `reconnect_url: /app/connectors?connect=github`; the chat shows a Reconnect card and resumes the task after reconnecting. `delete_repo` checks the scope before creating the approval card, so the user isn't asked to approve something that would fail.
- Tools: list_repos, get_repo, create_repo (user or org), delete_repo (one or many), archive_repo / unarchive, rename_repo, set_repo_visibility, update_repo (description, homepage, topics), read_file, put_file (create/update), delete_file, commit_files (Git Data API, one commit), list_branches, create_branch, delete_branch, list_pull_requests, open_pull_request (draft), merge_pull_request, list_issues, set_issue_state (close/reopen issues and PRs), list_releases, create_release, delete_release (optionally its tag), list_collaborators, add_collaborator, remove_collaborator, list_workflows, list_workflow_runs, trigger_workflow. TODO: files > 1 MB; a GitHub App for fine-grained access.

### Google (Gmail, Calendar, Drive)

- Google Cloud Console → APIs & Services: enable Gmail API, Google Calendar API, Google Drive API. OAuth consent screen: add scopes `gmail.readonly`, `gmail.compose`, `calendar.events`, `drive.readonly` (+ `openid`, `email`). Credentials → OAuth client ID → Web application, authorized redirect URI `https://<your-domain>/api/connectors/google/callback`. Set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Changed redirect URI:** the earlier integration used `/api/integrations/google_calendar/callback` (never deployed). Use the new path.
- Existing Calendar-only connections are migrated to connector `google` and keep their Calendar tools; Gmail/Drive tools appear only after reconnecting with those scopes (tools are filtered by granted scopes).
- Docs: https://developers.google.com/identity/protocols/oauth2/web-server. TODO: `gmail.readonly`, `gmail.compose`, `drive.readonly` are sensitive/restricted; outside Testing mode Google requires app verification (and a security assessment for restricted scopes). In Testing mode only listed test users can connect.

### Figma

- **MCP checked:** `https://mcp.figma.com/mcp` is OAuth-only, does not accept personal access tokens, and only clients in the Figma MCP catalog can connect (https://developers.figma.com/docs/figma-mcp-server/mcp-clients-issues/, https://help.figma.com/hc/en-us/articles/39216419318551). Not usable from TARGET.
- **Used instead: Figma REST API** with a personal access token (Figma → Settings → Security → Personal access tokens; scopes `file_content:read`, `current_user:read`). Validated with `GET /v1/me`. Tools: `get_design_context` (`/v1/files/:key`, `/v1/files/:key/nodes`), `get_screenshot` (`/v1/images/:key`). No server variables. TODO: Figma OAuth app.

### Canva

- **MCP checked:** Canva's MCP server (`https://mcp.canva.com/mcp` for waitlist clients; `https://api.canva.com/connect/v1/mcp` for Developer Portal apps) requires a Developer Portal app with client id/secret (https://www.canva.dev/docs/mcp, https://www.canva.dev/docs/apps/mcp/access/). Since registration is needed either way, TARGET uses the documented **Connect REST API** directly.
- Create an app at https://www.canva.com/developers/apps → Outside Canva → turn on Canva REST APIs, select scopes `design:meta:read`, `design:content:read`, `design:content:write`, add redirect URL `https://<your-domain>/api/connectors/canva/callback`, generate a client secret. Set `CANVA_OAUTH_CLIENT_ID` / `CANVA_OAUTH_CLIENT_SECRET`. OAuth with PKCE (S256), token endpoint with Basic auth (https://www.canva.dev/docs/connect/authentication/).
- Tools: search designs, create design (doc/whiteboard/presentation), export (PDF/PNG/JPG, polls the export job). TODO: brand templates/autofill; account label.

### Slack

- Create an app at https://api.slack.com/apps → OAuth & Permissions: Redirect URL `https://<your-domain>/api/connectors/slack/callback`; Bot Token Scopes `chat:write`, `channels:read`. Set `SLACK_OAUTH_CLIENT_ID` / `SLACK_OAUTH_CLIENT_SECRET`. Docs: https://api.slack.com/authentication/oauth-v2.
- Tools: list public channels, send message (always approval; the bot must be invited to the channel). Disconnect calls `auth.revoke`. TODO: reading channel history; posting as the user.

### Notion

- Create a **public connection** in the Notion developer portal (https://app.notion.com/developers/connections), capabilities: read content, insert content; redirect URI `https://<your-domain>/api/connectors/notion/callback`. Set `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET`. Docs: https://developers.notion.com/docs/authorization, revoke: https://developers.notion.com/reference/revoke-token.
- Tools: search pages, read page (plain text), create page under a shared page. Uses `Notion-Version: 2022-06-28`. TODO: newer API version / data sources; database rows.

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
