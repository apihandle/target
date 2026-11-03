# Custom AI provider (bring your own OpenAI-compatible API)

Each signed-in user can add their own OpenAI-compatible endpoint in **Settings → AI providers**
(`/app/settings/ai-providers`) and pick its models in the chat's model picker.

## What the user does
1. Settings → AI providers → **Add provider**.
2. Name (e.g. "My Groq"), Base URL (e.g. `https://api.groq.com/openai/v1`; a pasted `/chat/completions` or `/models` suffix is stripped), API key.
3. Models: type a model id and press **Add**, or press **Fetch models** (server calls `GET {baseURL}/models`) and tap the ones to add. 1–20 models.
4. **Test connection** sends a tiny chat completion (`"Reply with just: OK"`, `max_tokens: 8`) with the chosen model and shows the time taken (no model yet → it lists models instead).
5. **Save provider**. The key is never shown again; the list shows only a masked preview (`sk-••••1234`).
6. In chat, the picker now lists `model · Provider name` after the built-in models. Picking one is remembered like any other pick.
Edit: leave the key empty to keep the saved one. Changing the base URL to a different host requires typing the key again (a saved key is never sent to a new host). Delete removes the provider; if its model was the remembered pick, the pick goes back to Auto.

## Routing
- **Custom model picked** → `llm({ custom })` calls only that endpoint (`{baseURL}/chat/completions`), with streaming. No NVIDIA/OpenRouter race, no fallback to built-in models, no provider-specific extras (`reasoning_effort`, `reasoning`, `minTokens`). Quick turns use the same endpoint with a 900-token budget.
- **Tool calls**: connector tools are sent as OpenAI `tools`. If the endpoint refuses them (400/404/422), the chat retries once without tools and shows the existing note that connector tools aren't available with this model. Streams with `tool_calls` deltas work through the normal agent loop.
- **Errors** name the provider: rejected key (401/403), unknown model (404), rate limit (429), timeout/unreachable.
- **Default (Auto / built-in pick) is unchanged**: same race, same speed. Code path: `src/lib/llm.ts` → `llm()` returns `llmCustom()` early only when `opts.custom` is set.
- Scheduled prompts follow the remembered pick too (custom included).
- Background helpers (memory fact extraction, suggestion buttons) still use TARGET's built-in models.
- Images: attachments are sent to the custom model as-is (it's the user's choice); a non-vision model will return an error.

## Security
- **Key storage**: AES-256-GCM (`CONNECTOR_ENCRYPTION_KEY`, same as connectors and the vault), sealed together with the owner's user id so a box copied to another row won't open. Table `custom_providers` (migration `0016_custom_providers.sql`): RLS on; users can select/delete only their own rows; the browser roles have column grants that exclude `key_box` and no insert/update. Writes go through the API with the service-role client after validation. No API returns the key or `key_box`.
- **Calls run server-side only** (`src/lib/server/safeFetch.ts`):
  - https only; http is accepted only outside production (`NODE_ENV !== "production"`, or `CUSTOM_PROVIDER_ALLOW_HTTP=1` on a non-production Vercel env). Never on `VERCEL_ENV=production`.
  - No credentials, query or fragment in the base URL; ports 80, 443 or 1024–65535.
  - Hostnames like `localhost`, `*.local`, `*.internal`, `metadata.*`, single-label names and numeric tricks (`2130706433`, `0x7f000001`, `127.1`) are refused before DNS.
  - **After DNS resolution**: the socket's own `lookup` refuses loopback, RFC 1918, CGNAT, link-local (incl. `169.254.169.254`), IPv6 ULA/link-local (incl. `fd00:ec2::254`), IPv4-mapped/NAT64/6to4/Teredo forms, multicast and reserved ranges. Because the check is inside the connect, DNS rebinding can't slip past it. IP-literal hosts are checked up front. The host is also resolved and checked when saving.
  - Redirects are never followed.
  - Timeouts: 12 s for `/models`, 30 s for Test connection, 60 s to first byte for chat. Size caps: 2 MB `/models`, 1 MB test, 8 MB per chat reply.
  - Upstream error text shown to the user is trimmed and scrubbed of the key.
- Abuse limits (not usage quotas): 30 edits / 10 min and 30 fetch/test calls / 10 min per user; max 10 providers per user.

## Files
- `src/lib/customProvider.ts`: validation (zod), base-URL normalisation, blocked IPs/hostnames, key masking, picker ids (`custom:<providerId>:<model>`).
- `src/lib/server/safeFetch.ts`: SSRF-guarded fetch (DNS-checked lookup, no redirects, timeout, byte cap).
- `src/lib/server/customProviders.ts`: seal/open key, list providers, picker options, `resolvePick` / `resolveUserPick`, `fetchModelIds`, `testConnection`.
- `src/lib/server/customProviderRoutes.ts`: shared route checks.
- API: `GET/POST /api/custom-providers`, `PATCH/DELETE /api/custom-providers/[id]`, `POST /api/custom-providers/models`, `POST /api/custom-providers/test`.
- Picker: `/api/models`, `src/app/app/page.tsx`, `/api/settings` (accepts the user's own custom ids only).
- UI: `src/components/CustomProviders.tsx`, `src/app/app/settings/ai-providers/page.tsx`.
- Tests: `src/__tests__/custom-provider.test.ts`.

## Setup
1. Run `supabase/migrations/0016_custom_providers.sql` in the Supabase SQL editor.
2. `CONNECTOR_ENCRYPTION_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must be set on Vercel (they already are for connectors/vault).
3. Optional: `CUSTOM_PROVIDER_ALLOW_HTTP=1` on a Preview/Development environment to allow `http://` base URLs there. Never needed in production.

## Phone test
1. Settings → AI providers → Add provider. Example with OpenRouter: Base URL `https://openrouter.ai/api/v1`, your OpenRouter key, Fetch models → tap a `:free` model. Or Groq: `https://api.groq.com/openai/v1` + Groq key + `llama-3.3-70b-versatile`.
2. Test connection → green "Connected in x s".
3. Save → the list shows the masked key only.
4. Chat → model picker → pick `model · My provider` → send "hi" → reply streams.
5. Ask something that uses a connector (e.g. "mere GitHub repos dikhao"): works if the model supports tools; otherwise you get a plain reply with the note that connector tools aren't available.
6. Try base URL `http://localhost:11434/v1` or `https://169.254.169.254/` → refused with a clear message.
7. Switch the picker back to Auto → normal speed/race as before.

## Verified with
Live on gettarget.vercel.app, 2026-11-03, throwaway test account (deleted afterwards), OpenRouter free tier
(`https://openrouter.ai/api/v1`):
- Add provider in the UI, **Fetch models** → 200 models (14 `:free`), **Test connection** → "Connected in 1.3 s · OK"
  (`google/gemma-4-31b-it:free`); also green for `liquid/lfm-2.5-2.6b:free`, `nvidia/nemotron-3.5-lightning:free`,
  `nvidia/nemotron-3.5-super-vl:free`. Save → list shows only `sk-or-••••51cf`; `GET /api/custom-providers` returns
  no key and no `key_box`.
- Chat with `custom:<id>:nvidia/nemotron-3.5-lightning:free`: reply streamed in 15 chunks; Server-Timing shows a
  single `llm` step (no built-in race). `nvidia/nemotron-3.5-super-vl:free` answered "hi" in 2.6 s.
- Errors: wrong key → "rejected the API key (error 401)"; unknown model → OpenRouter answers **400** "not a valid model
  ID", now shown as "doesn't know the model" (`isUnknownModelError`); `http://localhost:11434/v1` → "must start with
  https://"; `https://169.254.169.254/`, `https://127.0.0.1/v1`, `https://10.0.0.1/v1` → "private or local".
- Free OpenRouter models are often rate-limited upstream (shared pool, 429), especially with `tools` in the request;
  TARGET shows "… is rate-limiting requests right now (429)". That is the provider's limit, not a TARGET bug.
- Not run: the connector tool-call check (needs GitHub connected on the test account).
- Auto after switching back: "hi" answered with `llm;dur=728`.
