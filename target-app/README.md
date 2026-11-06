# TARGET — Android assistant (v0.1)

Native Android app (Kotlin + Jetpack Compose). TARGET web app ko phone par chalata hai aur phone ke kaam (alarm, timer, torch, call/SMS kholna, app kholna, maps…) khud karta hai. Plan: [PLAN.md](PLAN.md).

## APK kaise install karein

1. GitHub par repo kholiye → **Actions** → workflow **Android** → sabse naya green run.
2. Neeche **Artifacts** mein `target-assistant-debug` download kariye (zip ke andar `app-debug.apk`).
3. Phone par APK kholiye. Pehli baar "Install unknown apps" ki permission maangega (Chrome/Files ko allow kariye).
4. Debug build hai — Play Protect warning aaye to "Install anyway".

Har push par naya debug APK banta hai (debug signing key har runner par alag ho sakti hai; agar update install na ho to purana app uninstall karke naya daliye).

## Default assistant kaise banayein

1. App kholiye → long-press app icon → **Assistant setup** (ya assistant sheet mein **Settings**).
2. **Default assistant banao** dabaiye.
   - Kai phones par dialog nahi aata; tab app aapko seedha Settings bhej deta hai: **Settings → Apps → Default apps → Digital assistant app → TARGET**.
3. Ab **power button / home button long-press** (ya corner swipe) se TARGET khulega: mic, live transcript, jawab bolkar.
4. Quick Settings mein **"TARGET bolo"** tile add kar sakte hain (notification shade → edit/pencil).

## Permissions

| Permission | Kyun |
| --- | --- |
| Microphone (`RECORD_AUDIO`) | Bolkar command; web app ke andar voice input |
| `SET_ALARM` | Alarm/timer clock app mein lagana (normal permission, dialog nahi) |
| Internet | TARGET web app |

Call aur SMS ke liye koi permission nahi li gayi: TARGET sirf dialer/SMS composer mein number aur text bhar deta hai, **call/send button hamesha aap dabate hain**. Torch ke liye permission nahi chahiye.

## Kya bol sakte hain (local, bina internet ke samjha jata hai)

- "alarm laga 7 baje", "subah saade 6 ka alarm", "raat 10 baje ka alarm", "set alarm 7:30 am"
- "timer 5 minute", "aadha ghanta timer", "timer for 30 seconds"
- "torch on", "torch band karo"
- "open whatsapp", "youtube kholo", "open google.com"
- "call 98765 43210", "sms 98765 43210 ki main aa raha hoon"
- "India Gate ka rasta", "navigate to Connaught Place"
- "battery kitni hai"

Baaki sab kuch (sawal, email, calendar, research…) TARGET web app mein `/app?q=<text>&send=1` se khulta hai aur wahin jawab milta hai.

## Web app ke liye JS bridge: `window.TargetAndroid`

Sirf apne origin (`BuildConfig.BASE_URL`, default `https://gettarget.vercel.app`) par chalta hai. Har method JSON string lautata hai (`{"ok":true,…}` / `{"ok":false,"error":"…"}`).

```js
TargetAndroid.openApp("whatsapp")
TargetAndroid.dial("9876543210")            // dialer khulta hai, auto-call nahi
TargetAndroid.composeSms("9876543210", "hi") // composer, user send karta hai
TargetAndroid.setAlarm(7, 30, "Gym")
TargetAndroid.setTimer(300, "Chai")
TargetAndroid.flashlight(true)
TargetAndroid.openUrl("https://example.com")
TargetAndroid.navigate("India Gate")
TargetAndroid.share("text")
TargetAndroid.battery()                     // {"ok":true,"level":82,"charging":false}
TargetAndroid.speak("Namaste")              // TTS
TargetAndroid.listen("onHeard")             // async: window.onHeard({ok,text}) + 'target-listen' event
TargetAndroid.version()
```

## Limitations (v0.1)

- **Google sign-in WebView ke andar nahi chalta** — Google embedded WebViews mein login block karta hai. `accounts.google.com` aur Google OAuth pages Chrome Custom Tab mein khulte hain, isliye wahan ka login WebView tak wapas nahi aata. WebView mein **email/password ya magic link** se login kariye. (v0.2: native token login.)
- Contacts se naam dhoondhna ("mummy ko call karo") abhi nahi — aisa command web app ko jata hai.
- Wake word ("Hey Target"), screen padhna, notifications padhna: v0.3.
- Jab TARGET default assistant hota hai, Android system voice-input ko bhi TARGET ki recognition service par point karta hai; ye service phone ke asli recognizer (Google) ko forward karti hai, isliye voice typing chalti rehti hai. Phone par koi recognizer na ho to voice kaam nahi karega.

## Build (developers)

JDK 17 + Android SDK (platform 36):

```bash
cd target-app
./gradlew assembleDebug testDebugUnitTest
# dusra server: ./gradlew assembleDebug -PtargetBaseUrl=https://my-target.example.com
```

Versions: AGP 9.5.1 (built-in Kotlin), Kotlin 2.4.21 Compose compiler, Gradle 9.8.2, Compose BOM 2026.06.01, minSdk 26, compile/targetSdk 36. Package `app.target.assistant`.

No ads, no payments, no secrets in the APK.
