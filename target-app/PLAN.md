# TARGET Assistant — Android app plan

Folder: `target-app/` (inside the TARGET repo). Native Android, Kotlin + Jetpack Compose.

## 1. What a virtual AI assistant is
An app that sits on top of the phone, opens from anywhere (long-press power/home, corner swipe, "Hey Target", a tile), listens, understands, answers by voice and text, and **does things** on the phone and online on the user's behalf.

## 2. What we learned (research, 2026-11-06)
| Source | What it does | Lesson for us |
| --- | --- | --- |
| Gemini on Android (support.google.com/gemini 14579631, 15235441) | Overlay over any app, "Ask about screen", Gemini Live voice chat, Device assistance: alarms, timers, open apps, read/reply notifications, media, Wi‑Fi/Bluetooth/flashlight/DND, photo/screenshot, calls | Overlay + screen context + device actions are the core feature set |
| Android RoleManager / VoiceInteractionService (developer.android.com) | `ROLE_ASSISTANT` needs a VoiceInteractionService or an `ACTION_ASSIST` activity; user confirms in Default apps; holder gets the long-press power / home gesture | Implement VoiceInteractionService + SessionService + ASSIST activity fallback |
| Dicio (open source) | Wake-word foreground service, STT (Vosk or system), skills: search, weather, open app, timer, calculator, notifications, flashlight, navigation | Skill/tool model; system STT first, offline later |
| souravanand001/ai-assistant-android, jarvis-assistant, heytappy, elizaOS | Kotlin + Compose, default assistant, any OpenAI-compatible LLM, encrypted local history, screen reading via accessibility | Compose UI, back end as the brain, accessibility for screen context (opt-in) |

## 3. Architecture
- **Brain = TARGET back end** (`gettarget.vercel.app` / own domain). Chat, memory, connectors (Gmail, Calendar…), browser jobs, approvals already exist there. No Gemini key on the phone.
- **App shell**: Compose activity hosting the signed-in TARGET web app in a WebView (same login, same chats) + a native **JS bridge** (`TargetAndroid`) for things only the phone can do.
- **Assistant entry**: `TargetVoiceInteractionService` + `TargetSessionService` → floating overlay session (mic, live transcript, reply). `AssistActivity` handles `ACTION_ASSIST` / `VOICE_COMMAND`. Quick Settings tile. Home-screen shortcut.
- **Voice**: Android `SpeechRecognizer` (Hindi + English, `hi-IN`/`en-IN`), Android `TextToSpeech`. Wake word "Hey Target" later (opt-in foreground service, Sherpa-ONNX keyword spotting).
- **Device tools** (native, run on the phone, each confirmed when risky): open app, call (dialer, user taps call), SMS (prefilled composer), alarm/timer (AlarmClock intents), flashlight, volume, open URL / maps navigation, share text, read clipboard on request, battery status.
- **Screen context** (phase 3): opt-in AccessibilityService that reads visible text only when the user taps "Ask about screen".
- **Notifications** (phase 3): opt-in NotificationListenerService to read/summarise notifications.

## 4. Phases
1. **v0.1 (now)**: project skeleton, WebView shell with login, JS bridge with device tools, default-assistant role request, overlay voice session (STT → TARGET chat → TTS), Quick Settings tile, GitHub Actions builds a debug APK.
2. **v0.2**: native chat screen talking to `/api/chat` with a mobile token, offline queue, push notifications.
3. **v0.3**: screen context, notification reading, wake word.
4. **v0.4**: on-device small model for offline commands; Play Store release.

## 5. Rules
- No payments, plans or limits. No ads in the app. Never store secrets in the APK.
- Risky actions (call, SMS, delete) always need a tap from the user.
- Hindi/Hinglish first.

## 6. Android pe assistant kya control kar sakta hai
Normal (3rd-party) app ke liye, kaise hota hai:

**Seedha (intents / public APIs, koi special access nahi)**
- Alarm / timer: `AlarmClock.ACTION_SET_ALARM` / `ACTION_SET_TIMER` (`SET_ALARM` normal permission)
- Call: `ACTION_DIAL` (dialer khulta hai, user call dabata hai). Seedha call = `CALL_PHONE` runtime permission — hum use nahi karte
- SMS: `ACTION_SENDTO smsto:` prefilled composer, user send karta hai
- Apps kholna: launcher intent (`<queries>` MAIN/LAUNCHER chahiye, Android 11+)
- Maps / navigation: `geo:` ya `google.navigation:` intent; URL: `ACTION_VIEW` / Custom Tab
- Camera: `MediaStore.ACTION_IMAGE_CAPTURE` / `INTENT_ACTION_STILL_IMAGE_CAMERA`; Share: `ACTION_SEND`
- Flashlight: `CameraManager.setTorchMode` (permission nahi)
- Volume: `AudioManager.adjustStreamVolume`; media play/pause/next: `AudioManager.dispatchMediaKeyEvent`
- Bolna / sunna: `TextToSpeech`, `SpeechRecognizer` (`RECORD_AUDIO`)
- Calendar event: `CalendarContract` `ACTION_INSERT` intent (user save karta hai); seedha likhna = `WRITE_CALENDAR`
- Contacts dhoondhna (naam → number): `READ_CONTACTS` runtime permission
- Incoming call uthana/kaatna: `ANSWER_PHONE_CALLS` permission ke saath `TelecomManager` (possible)

**User ki di hui special access se**
- AccessibilityService: screen ka text padhna, doosre apps mein tap/scroll/type, global back/home/recents/notifications, screenshot (API 28+), lock screen (API 28+)
- NotificationListenerService: notifications padhna, reply (RemoteInput), dismiss; MediaSession se media control
- Device admin: screen lock (`lockNow`)
- DND badalna: Notification policy access ke baad `NotificationManager.setInterruptionFilter`
- Brightness: `WRITE_SETTINGS` (special access) ke baad `Settings.System`

**Sirf settings panel khol sakte hain (Android 10+ normal apps ko seedha toggle nahi karne deta)**
- Wi-Fi, mobile data, NFC: `Settings.Panel.ACTION_WIFI / ACTION_INTERNET_CONNECTIVITY / ACTION_NFC`
- Bluetooth: `ACTION_REQUEST_ENABLE` dialog (API 33+ mein direct `enable()` band) ya settings
- Airplane mode: sirf `Settings.ACTION_AIRPLANE_MODE_SETTINGS`

**Normal app ke liye possible nahi**
- Phone power off / restart, airplane mode toggle
- Bina user ke apps install/uninstall karna (installer dialog hamesha aata hai)
- Doosre apps ka private data padhna (sirf screen par jo dikhe, accessibility se)
- Bina tap ke call/SMS bhejna (hamari policy bhi: risky action = user ka tap)
