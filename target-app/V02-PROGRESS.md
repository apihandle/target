# TARGET Android v0.2 — progress checklist

Branch: `wip/android-v02` (continues the earlier attempt's branch `wip/android-v0.2`, commits 42200a7..c199d28).
Every item is committed and pushed separately; this file is updated in each commit.

Status words: **done** (built + tested in CI where an emulator can test it), **partial** (built, something missing),
**untested** (built, needs a real phone), **todo**.

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| 1 | Bridge security (top frame + BASE_URL origin only) | done | WebViewCompat.addWebMessageListener with an exact-origin rule + per-message check (isMainFrame, source origin, top page origin); promise API via document-start shim; JVM tests (BridgeSecurityTest) + emulator tests (iframe refused, other origins refused) |
| 2 | Contacts lookup, call by name, SMS, fuzzy Hinglish match, "kaun sa?" list | done | ContactMatcher + JVM tests; real call/SMS need a phone |
| 3 | WhatsApp open chat / send (intent), read via notification listener | done / untested | real WhatsApp needs a phone |
| 4 | Music play/pause/next (media keys), "YouTube pe X chalao" | partial | media keys only; MediaSessionManager todo |
| 5 | Accessibility service (opt-in) read/tap/scroll/back/home + Hinglish explanation | done | emulator test |
| 6 | NotificationListenerService read + RemoteInput reply | done | emulator test waits for both test notifications (API 30 race fixed); real-app reply needs a phone |
| 7 | Call announce + answer/reject + speakerphone | untested | needs a real phone |
| 8 | Wake word (sherpa-onnx KWS, download + SHA-256, energy gate, one-breath, slider, false-wake counter) | done (emulator: model download + spotter load + silence) / untested on real mic | switched from the `-mobile` archive (aborts in sherpa-onnx /downsample/Reshape_1, reproduced on desktop) to the regular gigaspeech-3.3M archive, all-int8 files, SHA f170013b… from checksum.txt |
| 9 | Conversation mode | done | |
| 10 | Native chat replies via /api/chat + WebView cookies, TTS, WebView fallback | done | live server call needs a signed-in phone |
| 11 | Camera vision → chat API with the question | partial / untested | Native path: camera intent photo → Supabase storage upload with the WebView session → `/api/attachments` → `/api/chat` {attachmentIds} → spoken + notification + local history. Needs the PUBLIC anon key at build time (`-PsupabaseAnonKey`); without it (CI default) falls back to the WebView composer. Cookie parser JVM-tested; live upload needs a signed-in phone |
| 12 | System controls (torch, volume, brightness opt-in, Wi-Fi/BT panels, DND opt-in) | done | |
| 13 | Reminders + alarms (AlarmClock + AlarmManager + notification) | done | |
| 14 | Routines in DataStore | done | Preferences DataStore (`routines`), one-time SharedPreferencesMigration from the old key; JVM JSON tests (RoutinesJsonTest) + emulator routine tests |
| 15 | Personas sent with chat requests | done | |
| 16 | BiometricPrompt app lock (optional) | done (logic tested) / untested on a phone | Settings toggle "App lock" (off by default): MainActivity + SettingsActivity ask via GuardActivity (BiometricPrompt BIOMETRIC_WEAK or device credential; screen hidden meanwhile), 1-minute grace; AppLock JVM tests. Risky-action guard unchanged |
| 17 | Offline queue + local chat history (Room) | done (CI) | Room db `target-local.db`: `offline_queue` + `chat_history` (last 500 lines, on this phone only); rules in pure QueueLogic (dedupe 2 min, max 20, 24 h expiry, 3 failures, stop on offline) with JVM tests; JobScheduler sends when online, answer as notification + history |
| 18 | Settings + per-action "bina pooche" toggles + Google sign-in note | partial | settings exist; new items to add |
| 19 | Full Hinglish strings | partial | new strings to add |

## CI
- `Android` workflow: `build` (compile + JVM tests, no APK) and `device-tests` (API 30, 34). No APK artifact; only test reports.

## Needs a real phone
Real calls (answer/reject/speaker), SMS sending, WhatsApp send/read, real-mic wake word accuracy, biometric prompt, camera capture.
