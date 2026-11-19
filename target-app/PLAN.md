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
1. **v0.1 (done)**: project skeleton, WebView shell with login, JS bridge with device tools, default-assistant role request, overlay voice session (STT → TARGET chat → TTS), Quick Settings tile.
2. **v0.2 (now)** — inspired by getmaya.online/android:
   - Contacts: fuzzy Hinglish name match (mummy/maa/mom, papa, bhaiya, didi…), "kaun sa?" pick list, direct call (CALL_PHONE) / SMS (SmsManager) after "haan".
   - WhatsApp + Business: send (chat opens with text, accessibility taps Send after "haan"), open chat, voice/video call, read last messages.
   - Music/video: YouTube / YouTube Music / Spotify search-play, media keys.
   - Accessibility helper: read screen, tap/type/scroll/swipe, back/home/recents/notifications/quick settings/lock/screenshot; "screen dekho" sends screen text (or screenshot) to TARGET.
   - Notification listener: read aloud (OTP hidden unless asked), reply via RemoteInput after "haan", clear; optional busy auto-reply with a log.
   - Calls: announce caller by name, "uthao"/"kaato" (ANSWER_PHONE_CALLS), speakerphone on answer.
   - Wake word: sherpa-onnx keyword spotting (gigaspeech 3.3M model, int8 files ~5 MB; the `-mobile` build aborts in sherpa-onnx, downloaded on enable from the official k2-fsa release, SHA-256 checked); wake "hey / hello / wake up target", sleep "bye target / so jao / go to sleep"; energy pre-gate; one-breath "Hey Target, …" (Android 13+); false-wake counter; boot restart; pauses in battery saver / when another app records.
   - Conversation mode with barge-in; answers spoken in the overlay from `/api/chat` with the WebView login; offline queue (JobScheduler) with notification.
   - Camera vision (photo → TARGET composer), system control (volume, silent/vibrate/DND, brightness, settings panels, lock, screenshot), reminders/alarms/calendar/nearby, routines, personas & TTS voice, biometric guard, Devanagari input, Hinglish + English strings.
   - CI: compile + 247 JVM tests; instrumented tests on emulators (API 30, 34). No APK artifact.
3. **v0.3**: native chat screen + push notifications; real Google sign-in into the WebView (needs a small web hand-off endpoint, see README); speaker verification ("Voice Guardian").
4. **v0.4**: on-device small model for offline commands; Play Store release.
   - **Own wake-word model (if sherpa-onnx accuracy is not good enough):** collect positive ("Hey Target" in many Indian accents, Hinglish) and negative clips (TV, traffic, family chatter, similar words) in noisy Indian environments; clean/label clips with Whisper (drop clips whose transcript does not match); train a tiny keyword model in PyTorch; export to ONNX/TFLite (< 1 MB); measure false wakes per hour and miss rate on held-out real recordings before shipping.

## 5. Rules
- No payments, plans or limits. No ads in the app. Never store secrets in the APK.
- Risky actions (call, SMS, WhatsApp, notification reply, answering/rejecting calls, clearing) wait for a spoken "haan" or a tap, unless the user turns on that action's "bina pooche" switch (off by default). Phone locked or "fingerprint" setting on → biometric / screen-lock check first.
- Every special access (contacts, accessibility, notifications, calls, DND, brightness, exact alarms, wake word) is opt-in with a Hinglish explanation first.
- Hindi/Hinglish first.

## 6. Android pe assistant kya control kar sakta hai
Normal (3rd-party) app ke liye, kaise hota hai:

**Seedha (intents / public APIs, koi special access nahi)**
- Alarm / timer: `AlarmClock.ACTION_SET_ALARM` / `ACTION_SET_TIMER` (`SET_ALARM` normal permission)
- Call: `ACTION_DIAL` (dialer). Seedha call = `CALL_PHONE` runtime permission — v0.2 mein opt-in, aur hamesha "haan" ke baad
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
- Bina user ki marzi ke call/SMS bhejna (hamari policy: risky action = "haan" ya tap; "bina pooche" sirf user khud on kar sakta hai)
