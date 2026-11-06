# TARGET — Android assistant (v0.2)

Native Android app (Kotlin + Jetpack Compose). TARGET web app ko phone par chalata hai, aur phone ke kaam khud karta hai: call/SMS/WhatsApp contacts ko, music, screen padhna aur tap, notifications, aate call, "Hey Target" wake word, reminders, routines… Plan: [PLAN.md](PLAN.md).

> **APK:** CI ab koi APK nahi banata/upload karta (sirf compile + tests). Phone par chalane ke liye khud build kariye (neeche "Build").

## Kya bol sakte hain

Hinglish, English aur Devanagari ("मम्मी को कॉल करो") — sab local parser samajhta hai:

| Kaam | Examples |
| --- | --- |
| Contacts call / SMS | "mummy ko call karo", "Papa ko phone lagao", "Rahul ko message bhejo ki main aa raha hoon", "text didi that I reached" |
| WhatsApp / Business | "Rahul ko WhatsApp karo ki kal milte hain", "didi ko WhatsApp video call karo", "Rahul ke WhatsApp messages padho", "WhatsApp Business pe Sharma ji ko message bhejo ki order ready hai" |
| Music / video | "Arijit Singh bajao", "spotify pe lofi bajao", "YouTube pe Kesariya chalao", "agla gaana", "gaana roko" |
| Screen | "screen padho", "screen dekho ye kya hai", "screen dekho screenshot ke saath", "Login pe tap karo", "type Hello", "neeche scroll karo", "wapas jao", "home jao", "phone lock karo", "screenshot lo" |
| Notifications | "notifications padho", "OTP kya hai", "Rahul ko reply karo ki 5 minute mein aata hoon", "notifications clear karo" |
| Calls | (call aane par naam bolta hai) "uthao" / "call kaato", "speaker on karo" |
| System | "volume badhao", "mute karo", "phone silent kar do", "DND on karo", "brightness 50% kar do", "wifi on karo", "bluetooth band karo", "hotspot chalu karo", "battery kitni hai", "torch on" |
| Time / places | "alarm 7 baje", "timer 5 minute", "kal 5 baje yaad dilana ki doodh lana", "2 ghante baad yaad dilana", "kal 3 baje meeting calendar mein daalo", "paas mein petrol pump", "India Gate ka rasta" |
| Camera | "camera se dekho ye kaunsa phool hai" |
| Routines | "routine banao subah: alarm band, torch on, aaj ki news" → "subah ka routine chalao" |
| Baatcheet | "conversation mode on", "chalo baat karte hain", "bas" / "bye", "dost mode", "professional mode" |
| Baaki sab | weather, news, email, research… → TARGET se poochh kar jawab overlay mein bolta hai |

**Risky kaam** (call, SMS, WhatsApp, notification reply, call uthana/kaatna, notifications hatana) hamesha pehle poochhte hain: "haan" boliye ya **Haan** dabaiye. Settings mein har kaam ke liye "bina pooche" switch hai (default band). Phone locked ho (ya "Fingerprint/lock se confirm" on ho) to pehle fingerprint / screen lock.

## Setup (Settings screen)

App kholiye → long-press icon → **Assistant setup**. Har special access pehle Hinglish mein samjhata hai, phir system screen kholta hai:

| Access | Kis liye | Kahan on hota hai |
| --- | --- | --- |
| Default assistant | power/home long-press par TARGET | Settings → Apps → Default apps → Digital assistant app |
| Mic | bolkar command | permission dialog |
| Contacts, call, SMS (`READ_CONTACTS`, `CALL_PHONE`, `SEND_SMS`) | naam se call/SMS | permission dialog |
| Accessibility ("TARGET screen helper") | screen padhna, tap/type/scroll, WhatsApp Send, lock, screenshot | Settings → Accessibility |
| Notification access | notifications padhna/reply/clear, auto-reply | Settings → Notification access |
| Calls (`READ_PHONE_STATE`, `READ_CALL_LOG`, `ANSWER_PHONE_CALLS`) | caller ka naam bolna, uthao/kaato | permission dialog |
| Do Not Disturb access | silent, DND | Settings → DND access |
| Modify system settings | brightness | Settings → Modify system settings |
| Exact alarms | reminders bilkul time par | Settings → Alarms & reminders |
| Notifications (Android 13+) | reminders, offline jawab, wake-word notification | permission dialog |

Aur settings: assistant ka naam, personality (Normal / Dost / Professional), TTS awaaz-speed-pitch, conversation mode + barge-in, overlay mein jawab (native chat), wake word (download, sensitivity boost/threshold, false-wake counter), busy auto-reply (message, apps, log), routines.

## "Hey Target" (wake word)

- Engine: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) keyword spotting, model `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` (int8 encoder + int8 decoder + int8 joiner + tokens ≈ 5 MB on the phone, 17 MB download). `-mobile` wala build sherpa-onnx mein crash karta hai (fixed shapes, `/downsample/Reshape_1`), isliye normal build.
- Model app mein nahi hai: wake word on karne par official `kws-models` release se download hota hai; archive ka SHA-256 release ke `checksum.txt` aur app mein pinned value dono se match hona chahiye.
- Wake: "Hey Target", "Hello Target", "Wake up Target". Sleep: "Bye Target", "So jao", "Go to sleep". Call aate waqt: "Answer call" / "Reject call".
- Energy pre-gate (adaptive RMS, 4 frame) ke baad hi audio spotter tak jaata hai. Android 13+ par "Hey Target, YouTube pe gaana chalao" ek saans mein: wake ke baad ka ≤4 s audio seedha recognizer ko jaata hai.
- Foreground service (microphone) + notification; reboot ke baad wapas (Android 15+ par ek tap wali notification, kyunki Android boot par mic service shuru nahi karne deta); battery saver ya koi aur app mic use kare to ruk jaata hai.

## Web app ke liye JS bridge: `window.TargetAndroid`

**Security (v0.2):** bridge ab `addJavascriptInterface` nahi hai. `WebViewCompat.addWebMessageListener` ke saath sirf `BuildConfig.BASE_URL` ka origin (scheme + host + port) allowed hai, aur har message native side par bhi check hota hai: **sirf top frame**, sirf `BASE_URL` origin, aur top page bhi `BASE_URL` par ho. Iframe, doosri site, `http://` ya look-alike host ka message chup-chaap drop hota hai (koi jawab nahi). Purane WebView (WEB_MESSAGE_LISTENER nahi) par bridge hota hi nahi.

Har method ek **Promise** lautata hai (JSON object `{ok:true,…}` / `{ok:false,error}`):

```js
await TargetAndroid.openApp("whatsapp")
await TargetAndroid.dial("9876543210")            // dialer khulta hai, auto-call nahi
await TargetAndroid.composeSms("9876543210", "hi") // composer, user send karta hai
await TargetAndroid.setAlarm(7, 30, "Gym")
await TargetAndroid.setTimer(300, "Chai")
await TargetAndroid.flashlight(true)
await TargetAndroid.openUrl("https://example.com")
await TargetAndroid.navigate("India Gate")
await TargetAndroid.share("text")
await TargetAndroid.battery()                     // {ok:true, level:82, charging:false}
await TargetAndroid.speak("Namaste")              // TTS
await TargetAndroid.listen("onHeard")             // {started:true}; baad mein window.onHeard({ok,text}) + 'target-listen' event
await TargetAndroid.takePendingImage()            // camera photo / screenshot (app khud use karta hai)
await TargetAndroid.version()
// window.TargetDevice = same API; 'target-android-ready' event jab shim taiyaar ho
```

## Overlay ke jawab kaise aate hain

Phone ke kaam local hote hain. Baaki sawal: app WebView ki login cookie (Supabase session, `BASE_URL` ke liye) se `POST /api/chat` karta hai, streamed text jawab saaf karke bolta hai, aur 15 minute tak usi chat mein follow-up bhejta hai. Login na ho ya error aaye to TARGET web app `/app?q=…&send=1` khulta hai. Internet na ho to sawal queue hota hai (JobScheduler, network aate hi) aur jawab notification mein aata hai. Personality on ho to sawal ke aage ek chhoti style line jaati hai (woh chat history mein dikhti hai).

## Limitations

- **Google sign-in WebView ke andar abhi bhi nahi** (v0.2 mein skip). TARGET ka Google login apne OAuth (`/auth/google` → `/api/connectors/google/callback`) se cookie us browser mein set karta hai jahan login poora hota hai — Custom Tab (Chrome) ka cookie jar WebView se alag hai. Session WebView tak laane ke liye web par ek naya one-time hand-off endpoint chahiye (app ka PKCE verifier, server-side code, WebView mein redeem) — auth security ka kaam hai, isliye alag se karenge. Abhi WebView mein **email/password ya magic link** se login kariye. Koi Supabase redirect URL add nahi karna hai.
- WhatsApp Send/call buttons WhatsApp ke UI labels/ids par depend karte hain (English/Hindi); WhatsApp badle to tap fail ho sakta hai — tab chat khuli rehti hai aur TARGET bolta hai "Send aap dabaiye".
- Wi‑Fi / Bluetooth / mobile data / NFC / hotspot / airplane: Android 10+ normal apps ko seedha switch nahi karne deta — TARGET sahi panel kholta hai.
- Camera ("camera se dekho"): agar app `-PsupabaseAnonKey=<public anon key>` (aur chahe to `-PsupabaseUrl=…`) ke saath build hua hai, to photo seedha aapke Supabase folder mein upload hoti hai (WebView wali login se), `/api/attachments` + `/api/chat` se jawab aata hai, bola jaata hai aur notification mein dikhta hai. Key na ho, login expire ho ya upload fail ho to purana tareeka: TARGET web composer mein photo attach hoke send. Anon key public hai (har browser ko milti hai); service-role key kabhi nahi. Screenshot ke sawal abhi composer se hi jaate hain.
- "Voice Guardian": abhi fingerprint/screen lock; asli speaker verification baad mein.
- Jab TARGET default assistant hota hai, Android system voice-input bhi TARGET ki recognition service par point karta hai; ye phone ke asli recognizer (Google) ko forward karti hai.

## Build (developers)

JDK 17 + Android SDK (platform 36). Pehli build `app/libs/` mein sherpa-onnx AAR (v2.0.1, GitHub release) download karke SHA-256 check karti hai.

```bash
cd target-app
./gradlew compileDebugSources testDebugUnitTest      # CI: compile + 247 JVM tests, no APK
./gradlew connectedDebugAndroidTest                    # instrumented tests on a device/emulator
./gradlew assembleDebug                                # apne phone ke liye APK (sirf local)
# dusra server: -PtargetBaseUrl=https://my-target.example.com
```

CI (`.github/workflows/android.yml`): `build` job compile + unit tests; `device-tests` job emulator (API 30 aur 34, x86_64 google_apis) par instrumented tests. Koi APK artifact upload nahi hota.

Versions: AGP 9.5.1 (built-in Kotlin), Kotlin 2.4.21 Compose compiler, Gradle 9.8.2, Compose BOM 2026.06.01, minSdk 26, compile/targetSdk 36, sherpa-onnx 2.0.1, commons-compress 1.28.0. Package `app.target.assistant`.

No ads, no payments, no usage limits, no secrets in the app.
