# decompile.md — Maya APK ka andar ka naksha

- Package: `com.getmaya.android`  ·  version 5.2.52 (code 241)  ·  minSdk 26, targetSdk 34
- APK: 31.8 MB. Native libs sirf arm64-v8a + armeabi-v7a (x86 nahi) — isliye TARGET ke 131 MB ke muqable chhota.
- Code: Kotlin, Jetpack Compose, R8 se obfuscated (12,642 classes; sirf ~32 entry-point classes ke asli naam bache). Isliye logic strings se padha gaya.

## Native libraries (arm64)

- `libandroidx.graphics.path.so` — 9 KB
- `libbarhopper_v3.so` — 4830 KB
- `libdatastore_shared_counter.so` — 6 KB
- `libhunterstt_jni.so` — 327 KB
- `libimage_processing_util_jni.so` — 28 KB
- `libonnxruntime.so` — 17159 KB
- `libpockettts_jni.so` — 1012 KB
- `libtensorflowlite_jni.so` — 3321 KB
- `libturndetector_jni.so` — 321 KB

## Assets

- `guardian/silero_vad.tflite` (VAD), `guardian/models.json` (speaker model manifest; asli model server se download)
- `macros/builtin_macros.json` — 5 builtin macros (ChatGPT image, Gemini image/video, ChatGPT/Gemini se poochho)
- `voices/` — har persona (maya, friday, venom) ke Gemini voice previews (.ogg)
- ML Kit barcode models, licences (Pocket TTS Hindi, onnxruntime, sentencepiece)

## Components

**Activities:** `ui.UnlockActivity`, `assistant.MayaAssistActivity`, `connectors.OAuthRedirectActivity`, `MainActivity`, `ui.ScreenCapturePermissionActivity`, `ui.facelock.WatchmanActivity`, `ui.browser.BrowserActivity`, `ui.facelock.FaceLockActivity`, `termux.TermuxPermissionActivity`

**Services:** `wallpaper.MayaWallpaperService`, `automation.MayaNotificationListener`, `assistant.MayaRecognitionService`, `automation.MayaAccessibilityService`, `assistant.MayaVoiceInteractionService`, `core.MayaForegroundService`, `assistant.MayaVoiceInteractionSessionService`

**Receivers:** `core.MicCaptureReceiver`, `core.BootReceiver`, `core.ReminderReceiver`, `social.SocialAlarmReceiver`, `marketing.MarketingAlarmReceiver`, `termux.TermuxResultReceiver`, `core.PhoneStateReceiver`, `core.DrivingOffReceiver`

## Permissions

`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_NETWORK_STATE`, `ACCESS_NOTIFICATION_POLICY`, `ANSWER_PHONE_CALLS`, `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `CALL_PHONE`, `CAMERA`, `DISABLE_KEYGUARD`, `FLASHLIGHT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CAMERA`, `FOREGROUND_SERVICE_DATA_SYNC`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `FOREGROUND_SERVICE_MICROPHONE`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `READ_CALL_LOG`, `READ_CONTACTS`, `READ_EXTERNAL_STORAGE`, `READ_MEDIA_AUDIO`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_PHONE_STATE`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO`, `REQUEST_DELETE_PACKAGES`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `REQUEST_INSTALL_PACKAGES`, `SCHEDULE_EXACT_ALARM`, `SEND_SMS`, `SET_WALLPAPER`, `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_EXACT_ALARM`, `WAKE_LOCK`, `WRITE_SECURE_SETTINGS`, `WRITE_SETTINGS`, `com.android.alarm.permission.SET_ALARM`, `com.getmaya.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, `com.huntercode.mobile.permission.MAYA_BRIDGE`, `com.termux.permission.RUN_COMMAND`

Khaas: `WRITE_SECURE_SETTINGS` (adb se grant), `com.termux.permission.RUN_COMMAND` (Termux bridge), `ANSWER_PHONE_CALLS`, `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES` (self-update), `FOREGROUND_SERVICE_MEDIA_PROJECTION` (screen share).

## Backend aur external services (strings me mile)

- Apna server: `getmaya.online` (models: guardian, stt, stt-bn, turn, addressee; avatar catalog; sites hosting; checkout), `api.getmaya.cloud/tts/v1` (Hunter TTS)
- LLM: Gemini (Live, TTS, image, transcribe), Groq, OpenRouter, DeepSeek, Mistral, Together, NVIDIA, DeepInfra, OpenAI, Anthropic — user apni key bhi laga sakta hai (OpenAI-compatible base URL)
- Search: Brave, Tavily, SerpAPI, DuckDuckGo, Google suggest
- Data: Open-Meteo (weather), Yahoo Finance (stocks), Google Places, Google Cloud TTS, Pollinations (image fallback)
- Integrations: GitHub (OAuth + device flow), GitLab, Linear, Notion, Todoist, Google Drive, Vercel, Telegram Bot, webhooks

## TARGET ke liye seekh

1. `abiFilters` arm64 + armv7 se APK size kaafi kam hota hai (Maya ne x86 hata diya).
2. Bade models (speaker ID 26 MB, STT) APK me nahi — server se sha256-verify karke download.
3. Tools ka bada catalog + `find_tool`/`run_tool` = chhota prompt, zyada features.
4. Har tool result me hi user ko kya bolna hai wo likha hota hai (honest status) — model ko jhooth bolne ka mauka kam.

