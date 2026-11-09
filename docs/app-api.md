# TARGET app ↔ server API (shared contract, v1)

This is the contract between the Android app (`target-app/`) and the web server (`src/app/api/...`).
Server types: `src/lib/device/protocol.ts` (+ tool list in `src/lib/device/tools.ts`).
App types: `target-app/.../net/DeviceProtocol.kt`. Plan: `docs/maya-analysis/v5.2.56.md` §4.0.

Everything here is additive: the web app (cookie session, no `client` in the chat body) behaves exactly as before.

---

## 1. Auth

Every native request sends:

```
Authorization: Bearer <supabase access_token>
X-Target-Client: android/<versionCode>          e.g. android/27
```

- The token is the Supabase `access_token` of the user's session (today: read from the WebView session, see `SupabaseSession.kt`).
- The server resolves the user with `supabase.auth.getUser(token)` and runs every query **as that user** (row-level security applies exactly like the cookie session). A bearer header always wins over cookies; when the header is absent the cookie session is used (web, and app fallback).
- `401 {"error":"Not signed in","kind":"auth"}` → refresh the token and retry once.
- Refresh: `POST /api/app/session/refresh {"refresh_token":"…"}` → `200 {"access_token","refresh_token","expires_at"}` (`expires_at` = unix seconds), or `401 {kind:"auth"}` when the refresh token is dead (reload the WebView / sign in again). Rate limited. The server never stores either token.
- `/admin` and `/api/admin/*` never accept bearer tokens (cookie + admin check only).

## 2. Error shape (all `/api/app/*` and `/api/chat`)

Non-2xx JSON bodies are `{"error": "<human text>", "kind": "<kind>"}` with `kind` one of:

| kind | meaning | what the app says/does |
|---|---|---|
| `auth` | not signed in / token expired | refresh token, else ask user to sign in |
| `rate` | too many requests or AI quota used up | "thoda ruk ke try karo" style line |
| `busy` | AI models overloaded / timed out | "abhi busy hai" line, retry later |
| `down` | AI not configured or site in maintenance | "service abhi band hai" line |
| `version` | app too old for this server (see bootstrap `minVersionCode`) | ask to update |
| `bad_request` | validation failed (`field` may be present) | — |
| `not_found` | chat/task/call id unknown or not yours | — |
| `server` | anything else | generic line |

## 3. Chat with device tools — `POST /api/chat`

Body (existing fields unchanged) plus:

```json
{
  "message": "Mummy ko call karo",
  "conversationId": "…optional uuid…",
  "client": {
    "kind": "android",
    "version": "0.3.0",
    "versionCode": 27,
    "capabilities": ["call", "sms", "whatsapp", "alarm", "timer", "screen.read", "screen.tap"],
    "locale": "hi-IN"
  },
  "deviceResults": [ /* optional, see §3.4 */ ]
}
```

- `client.kind` must be `"android"`; `capabilities` is a list of strings from §5 (unknown strings are ignored, max 64).
- Only tools whose capability is listed are offered to the model. No `client` → no device tools (web).
- `conversationId` of the reply is in the `X-Conversation-Id` response header (as today).

### 3.1 Stream framing

The response stays `text/plain; charset=utf-8`, streamed. It is the reply text **plus event lines**:

```
<text…>\n\u001e{"type":"device_call", …}\n<more text…>
```

- An **event line** starts with the ASCII Record Separator `U+001E` (byte `0x1E`) and runs to the next `\n`. The rest of the line is one compact JSON object with a `type`.
- The server always writes `\n` before `U+001E`, so an event always starts at a line start. It strips `U+001E` from model text, so text lines never start with it.
- App parsing: split on `\n`; a line whose first char is `\u001e` is an event, everything else is reply text (speak / show it). Events are **never stored** in the chat history and the web UI never receives them.

### 3.2 `device_call` event (server → app)

```json
{"type":"device_call","id":"dc_3fJ9kQ2mX7aB1cD4eF5gH6","tool":"device.make_call","args":{"contact":"Mummy"},"risky":true,"say":"Mummy ko call karun?","timeoutMs":30000,"conversationId":"…uuid…"}
```

| field | type | notes |
|---|---|---|
| `id` | string | `dc_` + 22 chars `[A-Za-z0-9]`. Unique; echo it in the result. |
| `tool` | string | `device.<name>` from §5. (The model itself sees `device__<name>`; OpenAI tool names can't contain dots.) |
| `args` | object | already validated against the tool's schema on the server. |
| `risky` | boolean | `true` → the phone MUST confirm with the user (existing `brain/Confirm.kt` + the user's own "bina pooche" toggles) before acting. The server can never mark a risky tool as pre-confirmed. |
| `say` | string | short confirmation line in the user's language (≤ 160 chars). Use it for the confirm prompt / TTS. |
| `timeoutMs` | number | 30000. After this the server stops waiting (see `device_timeout`). |
| `conversationId` | string | the chat this call belongs to. |

At most 6 device calls per model round; the server waits for each result before the model continues (calls in one round are sent one after another, not in parallel).

### 3.3 Result (app → server) — `POST /api/app/device-results`

```json
{"conversationId":"…uuid…","id":"dc_3fJ9kQ2mX7aB1cD4eF5gH6","ok":true,"result":{"placed":true},"verified":true}
{"conversationId":"…uuid…","id":"dc_…","ok":false,"error":"User said no","code":"declined","verified":false}
```

| field | type | notes |
|---|---|---|
| `conversationId` | uuid | required, must match the call. |
| `id` | string | required, the `device_call` id. |
| `ok` | boolean | required. |
| `result` | any JSON | when `ok`; ≤ 16 KB serialized (larger → 400). |
| `error` | string | when `!ok`; ≤ 500 chars. |
| `code` | string | optional, when `!ok`: `declined` (user said no), `permission` (Android permission missing), `unsupported`, `busy`, `failed`. |
| `verified` | boolean | required. `true` only when the phone checked the outcome (call actually placed, screen changed, alarm visible…). |

Responses: `200 {"ok":true,"status":"accepted"}` · `200 {"ok":true,"status":"late"}` (the server had already timed out; the result is kept and given to the model on the next turn) · `409 {"error":…,"kind":"bad_request","status":"already_answered"}` · `404 {kind:"not_found"}` (unknown id, other user, or other chat) · `400 {kind:"bad_request","field":…}`.

Model honesty rules (server prompt): `ok && verified` → may say it's done; `ok && !verified` → "phone pe bhej diya, confirm nahi ho paaya"; `!ok` → says what failed (declined ≠ failure, it's the user's choice); timeout → "phone se jawab nahi aaya".

### 3.4 Late results — `deviceResults[]` on the next `/api/chat`

If the app couldn't post a result in time (offline, killed), it may send them with the next chat turn, same shape without `conversationId` (the body's `conversationId` is used, and is then required):

```json
"deviceResults": [{"id":"dc_…","ok":true,"result":{},"verified":true}]
```

Max 10. Each is recorded like a late POST and shown to the model as "results that arrived from the phone after the last reply".

### 3.5 Timeout

The server waits **30 s** per call. If no result arrives it writes this event and tells the model the phone didn't answer:

```json
{"type":"device_timeout","id":"dc_…"}
```

The app should drop any pending confirm UI for that id (a result posted afterwards still gets `status:"late"`).

## 4. App endpoints

All accept bearer (or cookie). All answer `401 {kind:"auth"}` when signed out.

### `GET /api/app/bootstrap`
```json
{
  "user": {"id":"…","email":"…","name":"…"},
  "assistant": {"name":"TARGET","persona":"friendly","language":"auto","voiceSpeed":1.0},
  "settings": {"memoryEnabled":true},
  "features": {"browser":true,"email_send":true,"checkout":true,"booking":true,"scheduled":true,"custom_providers":true},
  "rules": {"count":3},
  "app": {"minVersionCode":0,"latest":null},
  "announcement": {"text":"…"} ,
  "maintenance": false,
  "serverTime": "2026-11-09T05:00:00.000Z",
  "protocol": 1
}
```
`assistant.*` falls back to defaults until the user saves them (web Settings → Assistant). `app.latest` is the release info the server knows (or `null`). `protocol` is this document's version.

### `POST /api/app/heartbeat`
```json
{"deviceId":"<random per-install id, 8-64 chars [A-Za-z0-9_-]>","versionCode":27,"versionName":"0.3.0","capabilities":["call","sms"],"locale":"hi-IN","model":"Pixel 7"}
```
→ `200 {"ok":true,"nextInMs":21600000}`. Upserts the device row (one per user + deviceId; max 10 devices per user, oldest replaced) and refreshes presence. Suggested cadence: every 6 h (WorkManager) and on app open.

### `GET /api/app/notices`
→ `200 {"notices":[{"id":"announcement","kind":"announcement","text":"…"},{"id":"maintenance","kind":"maintenance","text":"…"}]}` — admin notices to show/speak once (dedupe by `id` + text).

### `GET /api/app/tools`
→ `200 {"protocol":1,"device":[{"name":"device.make_call","capability":"call","risky":true,"description":"…","parameters":{…JSON schema…}}],"server":[{"name":"target__web_search","source":"builtin","summary":"…"}]}` — the shared tool catalog (device tools + the server tools this user has). The app uses `device[]` to know which names/args to expect.

## 5. Device tools (v1)

Model name `device__<name>` ↔ event `device.<name>`. `risky` tools are confirmed on the phone.

| name | capability | risky | args |
|---|---|---|---|
| `make_call` | `call` | yes | `contact?` (name as said), `number?` — one required |
| `send_sms` | `sms` | yes | `to` (name or number), `text` |
| `send_whatsapp` | `whatsapp` | yes | `to`, `text` |
| `set_alarm` | `alarm` | no | `time` "HH:MM" 24h, `label?`, `days?` ["mon"…"sun"] |
| `set_timer` | `timer` | no | `seconds` 1–86400, `label?` |
| `set_reminder` | `reminder` | no | `text`, `at` "YYYY-MM-DDTHH:MM" (phone local time) |
| `media_control` | `media` | no | `action` play/pause/next/previous/stop, `query?` (what to play) |
| `set_volume` | `volume` | no | `stream` media/ring/alarm/notification/call, `level?` 0–100, `change?` up/down/mute/unmute |
| `set_ringer` | `ringer` | no | `mode` normal/vibrate/silent |
| `set_dnd` | `dnd` | no | `on`, `minutes?` |
| `set_brightness` | `brightness` | no | `level?` 0–100, `auto?` |
| `torch` | `torch` | no | `on` |
| `open_app` | `open_app` | no | `app` (name or package) |
| `navigate` | `navigate` | no | `destination`, `mode?` drive/walk/transit/bike |
| `read_screen` | `screen.read` | no | — → `{package, elements:[{n,text,desc,role,clickable,bounds}]}` |
| `wait_for_screen_text` | `screen.read` | no | `text`, `appear?` (default true), `timeoutSec?` ≤ 20 |
| `tap_element` | `screen.tap` | no | `element` (#N from the latest `read_screen`), `text?` (fallback match) |
| `type_text` | `screen.type` | no | `text`, `element?`, `submit?` |
| `scroll` | `screen.scroll` | no | `direction` up/down/left/right, `element?` |
| `go_back` | `screen.nav` | no | — |
| `go_home` | `screen.nav` | no | — |
| `read_notifications` | `notifications.read` | no | `app?`, `limit?` ≤ 20 → `[{key,app,title,text,time}]` |
| `reply_notification` | `notifications.reply` | yes | `key` (from `read_notifications`), `text` |
| `battery_status` | `battery` | no | — → `{level, charging}` |
| `find_files` | `files.find` | no | `query?`, `type?` image/video/audio/document/any, `days?`, `limit?` ≤ 20 → `[{id,name,mime,size,modified}]` |
| `open_file` | `files.open` | no | `file` (id from `find_files`) |
| `share_file` | `files.share` | yes | `file`, `to?` (app or contact) |

Screen tools never pay, send, post or delete by themselves: the prompt tells the model to ask the user in chat before a tap that would do that, and the phone may still confirm.

Adding a tool = add it to `src/lib/device/tools.ts` (server) **and** the app registry, then bump this table. Never rename an existing one.
