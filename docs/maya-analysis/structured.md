# structured.md — Maya (v5.2.52) jaise features, TARGET ke liye

Source: `maya-v5.2.52.apk` (package `com.getmaya.android`, versionCode 241, minSdk 26, targetSdk 34) ko decompile karke nikala gaya (manifest, dex strings, assets). Code R8 se obfuscated hai, isliye features zyada-tar tool names, prompts aur UI strings se pehchane gaye hain.

> Ye ek **feature map** hai, copy karne ke liye code nahi. Maya ka code, prompts, voices aur models unke hain — TARGET me apna implementation likhna hai.

Legend: ✅ TARGET me hai · 🟡 thoda hai · ⬜ nahi hai

---

## 1. Core architecture

| Hissa | Maya me kaise hai | TARGET |
|---|---|---|
| Native Android app | Kotlin + Jetpack Compose, Room DB, WorkManager, DataStore, Tink/EncryptedPrefs | 🟡 (WebView shell + native bridge) |
| Default assistant | `VoiceInteractionService` + `RecognitionService` + `AssistActivity` (power button / home long-press) | 🟡 (ASSIST activity hai, VoiceInteractionService nahi) |
| Hamesha chalu service | `MayaForegroundService` (mic, camera, mediaProjection, dataSync types) + `BootReceiver` | 🟡 |
| Phone control | `AccessibilityService` (screen padhna, tap, type, scroll) | ⬜ |
| Notifications | `NotificationListenerService` (padhna, reply, WhatsApp auto-reply) | 🟡 (media ke liye) |
| Live voice brain | Gemini Live (`gemini-3.8-live`) + fallback LLMs (Groq, OpenRouter, DeepSeek, Mistral, Together, NVIDIA, DeepInfra, OpenAI, Anthropic) — user apni key bhi daal sakta hai | 🟡 (server /api/chat) |
| Tool system | 400+ tools; prompt me sirf core tools, baaki `find_tool` → `run_tool(name, args_json)` se | ⬜ |
| Mission executor | Alag agent loop: ek turn me ek tool, plan revise, `done` pe honest report | ⬜ |

## 2. Awaaz (voice stack)

- **Wake word "Hey Maya"** — hamesha on; sirf battery saver me (setting ke hisaab se) band. ✅ (TARGET: sherpa-onnx KWS)
- **Silero VAD** (650 KB tflite) — "ye insaani awaaz hai?" gate. ⬜
- **Turn detector** (native `libturndetector_jni`) — user ki baat khatam hui ya nahi. ⬜
- **Addressee model** — baat Maya se ho rahi hai ya kisi aur se. ⬜
- **On-device STT** (`libhunterstt_jni`, Hindi + Bengali models server se download) + cloud transcribe (`gemini-3.5-transcribe-live`). 🟡
- **TTS**: Gemini TTS voices (Kore, Zephyr, Leda… 30 jaisi), apna "Hunter TTS" (Pro Max), on-device **Pocket TTS Hindi** (onnxruntime). 🟡
- **Voice performance tags** — `[laughs] [whispers] [sad]` jaise tags se emotional bolna. ⬜
- **Live translation / transcription engine** mode (LANG/SAME/... wala fixed format). ⬜
- **Commentary mode** — screen dekhte hue bolti rehti hai. ⬜

## 3. Personas aur character

- 3 personas: **Maya, Friday, Venom** (`switch_persona`, Venom pe reverb effect). ⬜
- Har persona ke liye alag voices (`assets/voices/<persona>_<voice>.ogg` preview).
- **3D avatar / live wallpaper** (`MayaWallpaperService`, avatar catalog server se, low-RAM pe band). ⬜
- Relationship/intimacy level settings, user ka naam (`set_user_name`, creator ka naam reserved). ⬜
- Reel mode — camera ke liye dramatic acting. ⬜

## 4. Security — Voice Guardian, Face Lock, Touch Guard

- **Voice Guardian** (speaker recognition, ReDimNet2-B6 model ~26 MB, server se sha256-verified download): `enroll_voice`, `whose_voice`, `list_voices`, `remove_voice`, `set_voice_role`. ⬜
- **Roles**: boss (full), family (normal kaam, admin nahi), friend (sirf music/info), guest (koi phone/message/call tool nahi), blocked. ⬜
- **Guard mode**: `arm_guard` / `disarm_guard`, intruder pe siren + photo. ⬜
- **Face Lock & Watchman** (`FaceLockActivity`, `WatchmanActivity`): `enroll_face`, `whose_face`, anjaan chehra aaye to photo + Telegram alert. ⬜
- **Touch Guard + God Mode** — phone ko koi chhue to alert; God Mode sirf owner ki awaaz se band. ⬜
- **Voice unlock** — saved PIN/pattern sirf owner ki awaaz pe (`unlock_phone`, `UnlockActivity`). ⬜
- **App lock** (biometric). ✅
- **SOS** — `sos_alert`: 5 sec countdown, siren, SOS contacts ko location; sirf jab user ne emergency kaha ho. ⬜

## 5. Phone control

- Calls: `make_call`, `answer_call`, `end_call`, `call_history`, SIM choose, caller announce, `whatsapp_call`. ✅/🟡
- SMS: `send_sms`. ✅
- Contacts: `find_contact`, `save_contact`, `edit_contact`. 🟡
- Apps: `open_app`, `list_installed_apps`, `install_app` (Play Store kholta hai), `uninstall_app`. 🟡
- Settings: volume, brightness, torch, ringer mode, wifi/bluetooth/hotspot panels, `set_wallpaper`, `lock_device`, `go_to_sleep`. 🟡
- Alarm/timer/reminder: `set_alarm`, `set_timer`, `add_reminder`, `list_reminders`, `cancel_*`. 🟡
- **Driving mode** — 1 ghante tak calls auto-reject + SMS reply + announce. ⬜
- Battery status, low/full announce, charger announce. ⬜
- Media: `play_song`, `play_youtube`, `spotify_play`, `media_next/previous/play_pause`, `get_now_playing`, `sleep_timer`. ✅ (media controls)

## 6. Screen automation (Accessibility)

- `read_screen_elements` (har element ka `#N` handle), `tap_element(id)`, `tap_text`, `tap_coordinates` (last resort), `type_text`, `scroll_screen`, `swipe_screen`, `go_back`, `go_home`, `open_recents`, `press_keys`. ⬜
- `look_at_screen` (screenshot + vision sawaal), `read_screen_text`, `wait_for_screen_text` (appear/disappear). ⬜
- **Macros**: `record_macro`, `save_macro`, `play_macro`, `list_macros`; builtin: ChatGPT image, Gemini image/video, "ChatGPT/Gemini se poochho". ⬜
- **Procedures / skills** — seekhe hue tarike, skill store (`install_skill`, `create_skill`). ⬜
- Screen share / screen record (`MediaProjection`), `take_screenshot`, `record_screen`. ⬜

## 7. Messaging apps

- WhatsApp: `whatsapp_send_message`, `whatsapp_send_to_number`, `whatsapp_send_file`, `whatsapp_read_chat`, `whatsapp_read_messages`, `whatsapp_delete_message`, `whatsapp_status`, **auto-reply** (`set_whatsapp_autoreply`, "handle chat" mode jo personal messages pe kuch nahi bhejta). 🟡
- Telegram bot: `telegram_send_message`, `telegram_send_file`. ⬜
- Email: `send_email`, `find_email_address`. ⬜
- Notifications padhna / smart reply / message alerts. 🟡

## 8. Camera aur vision

- `look_through_camera` (live scanner, frames aate hi bolti hai), `take_photo`, `take_selfie`, `record_video`, QR/barcode scan (ML Kit). ✅ (camera vision) / ⬜ QR
- Photos me chehre dhoondhna ("meri photos dikhao"), `copy_photos_to_folder`. ⬜
- `generate_image`, `edit_photo` (apni service / Gemini key / Gemini-ChatGPT app ke through), `generate_quote_image`. ⬜

## 9. Web aur research

- In-app browser (`BrowserActivity`): `web_open`, `web_read`, `web_click`, `web_fill`, `web_submit`, `web_close`; Google sign-in ke liye Chrome. 🟡
- `search_web` (Brave / Tavily / SerpAPI / DuckDuckGo), `read_url`, `get_news`, `get_weather` (Open-Meteo), `navigate_to`, `search_nearby` (Places). 🟡
- Deep research (`research_status`, report "board-script" format: `#`, `##`, `-`, Sources). ⬜
- Translate (`translate_text`). ⬜

## 10. Productivity integrations (OAuth / API keys)

- **GitHub** (~40 tools: repos, issues, PRs, actions, clone/edit/push), **GitLab**, **Linear**, **Notion**, **Todoist**, **Google Drive** (docs, upload, share), Calendar (`add_calendar_event`), **Vercel** deploy, n8n workflow generate, webhook. ⬜
- Notes / documents: `create_note`, `create_document` (docx/xlsx/pptx bana leti hai), `read_document`. ⬜
- Memory: `remember_fact`, `recall_memory`, `recall_episodes`, auto-save switch, wiki pages (`read_page`, `WikiWorker`). 🟡

## 11. Coding aur websites

- `create_website`, `update_website`, `deploy_website` (getmaya.online/sites ya Vercel), coding team (writer + VIEWER jo screenshot dekh ke review karta hai). ⬜
- **Termux bridge**: `termux_run`, `termux_run_in_ubuntu`, `termux_install_package`, file read/write, recipes (OpenClaw, Hermes agent setup). ⬜
- PC relay: `call_my_pc`, `duet_call_pc`, PC se aayi command phone pe chalana. ⬜

## 12. Finance

- Stocks: `get_stock_quote`, `get_stock_history`, `get_stock_indicators`, `get_trending_stocks`, `get_market_snapshot`, `get_market_news` (Yahoo Finance). ⬜
- Watchlist, portfolio (`add_holding`), price alerts, crypto, forex. ⬜
- Market report — "ye advice nahi hai", buy/sell/target kabhi nahi. ⬜

## 13. Social / marketing

- `post_to_social`, `post_photo_to_social`, `schedule_post`, Instagram reel flow (script, cover, editor), story, `daily_story`. ⬜
- Lead generation + `lead_followup`, marketing plan, YouTube channel stats. ⬜

## 14. Smart home

- **Maya Home box** (WiFi/Bluetooth se jodna, Box ID + password): `smart_home_control`, `smart_home_list`, `smart_home_query`. Sirf plug power, IR remote nahi. ⬜

## 15. Event triggers aur proactive

- `set_event_trigger` / `list_event_triggers` (wifi gaya, battery low, call aaya…), `watch_for`, reminders, morning/daily, notices (`NoticeWorker`), greet on open. ⬜

## 16. Monetization aur ops

- Free plan + trial, licence (pura Maya), **Pro Max** add-on (Hunter TTS, apni image service, assistant ka naam badalna), daily limits (image/voice chars). ⬜
- Self-update (`check_maya_update`, `REQUEST_INSTALL_PACKAGES`). ✅ (auto-update)
- Telemetry upload (`OpsUploader`), marketing alarms. ⬜

---

## TARGET ke liye suggested order

1. Accessibility service + `read_screen_elements` / `tap_element` / `type_text` (sabse bada gap; baaki automation isi pe chalta hai).
2. Tool registry with `find_tool` + `run_tool` (prompt chhota, tools hazaar).
3. Mission executor loop (ek tool per turn, verify, honest `done`).
4. VAD + turn detection (wake word ke baad natural baat-cheet).
5. Voice Guardian (speaker ID) + roles — tab hi phone/message tools guests se safe honge.
6. WhatsApp auto-reply, driving mode, reminders/event triggers.
7. Integrations (GitHub, Notion, Drive, Todoist) — server side pe already connectors hain, unhe tools ke roop me kholna.
