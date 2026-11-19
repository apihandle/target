package app.target.assistant.brain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** v0.2 commands: contacts, WhatsApp, media, screen, notifications, calls, system, time, routines. */
class IntentParserV2Test {

    private fun p(s: String) = IntentParser.parse(s)

    // ---- contacts: call ----
    @Test fun mummyKoCall() = assertEquals(Command.CallContact("mummy"), p("mummy ko call karo"))
    @Test fun papaKoPhoneLagao() = assertEquals(Command.CallContact("papa"), p("Papa ko phone lagao"))
    @Test fun bhaiyaKoCallKarDo() = assertEquals(Command.CallContact("bhaiya"), p("hey target bhaiya ko call kar do"))
    @Test fun callRahulSharma() = assertEquals(Command.CallContact("rahul sharma"), p("Call Rahul Sharma"))
    @Test fun callMyMom() = assertEquals(Command.CallContact("mom"), p("call my mom"))
    @Test fun meriDidiKoCall() = assertEquals(Command.CallContact("didi"), p("meri didi ko call karo"))
    @Test fun devanagariCall() = assertEquals(Command.CallContact("mummy"), p("मम्मी को कॉल करो"))
    @Test fun callNumberStillDials() = assertEquals(Command.Dial("9876543210"), p("9876543210 ko call karo"))

    // ---- contacts: sms ----
    @Test fun smsKoKi() = assertEquals(Command.SmsContact("rahul", "main aa raha hoon"), p("Rahul ko message bhejo ki main aa raha hoon"))
    @Test fun smsKeepsCase() = assertEquals(Command.SmsContact("papa", "Dinner ready hai"), p("papa ko sms karo ki Dinner ready hai"))
    @Test fun smsEnglishSaying() = assertEquals(Command.SmsContact("rahul", "running late"), p("send a message to Rahul saying running late"))
    @Test fun smsEnglishThat() = assertEquals(Command.SmsContact("didi", "I reached"), p("text didi that I reached"))
    @Test fun smsNoText() = assertEquals(Command.SmsContact("mummy", ""), p("mummy ko message bhejo"))
    @Test fun smsDevanagariBodyKeepsScript() = assertEquals(Command.SmsContact("papa", "मैं आ रहा हूँ"), p("पापा को मैसेज भेजो की मैं आ रहा हूँ"))

    // ---- whatsapp ----
    @Test fun waSendKi() = assertEquals(Command.WhatsApp(WaAction.SEND, "rahul", "main aa raha hoon"), p("Rahul ko WhatsApp karo ki main aa raha hoon"))
    @Test fun waPeMessage() = assertEquals(Command.WhatsApp(WaAction.SEND, "rahul", "Kal milte hain"), p("WhatsApp pe Rahul ko message bhejo ki Kal milte hain"))
    @Test fun waEnglish() = assertEquals(Command.WhatsApp(WaAction.SEND, "mom", "on my way"), p("send whatsapp to mom saying on my way"))
    @Test fun waBusiness() = assertEquals(Command.WhatsApp(WaAction.SEND, "sharma ji", "order ready hai", business = true), p("WhatsApp Business pe Sharma ji ko message bhejo ki order ready hai"))
    @Test fun waVoiceCall() = assertEquals(Command.WhatsApp(WaAction.VOICE_CALL, "didi"), p("didi ko WhatsApp call karo"))
    @Test fun waVideoCall() = assertEquals(Command.WhatsApp(WaAction.VIDEO_CALL, "papa"), p("papa ko whatsapp video call karo"))
    @Test fun videoCallWithoutWa() = assertEquals(Command.WhatsApp(WaAction.VIDEO_CALL, "rahul"), p("Rahul ko video call karo"))
    @Test fun waVideoCallEnglish() = assertEquals(Command.WhatsApp(WaAction.VIDEO_CALL, "rahul"), p("whatsapp video call Rahul"))
    @Test fun waRead() = assertEquals(Command.WhatsApp(WaAction.READ, "rahul"), p("Rahul ke WhatsApp messages padho"))
    @Test fun waReadEnglish() = assertEquals(Command.WhatsApp(WaAction.READ, "mom"), p("read whatsapp messages from mom"))
    @Test fun waOpenChat() = assertEquals(Command.WhatsApp(WaAction.OPEN, "rahul"), p("Rahul ki WhatsApp chat kholo"))
    @Test fun waOpenAppOnly() = assertEquals(Command.OpenApp("whatsapp"), p("WhatsApp kholo"))
    @Test fun waBusinessOpenApp() = assertEquals(Command.OpenApp("whatsapp business"), p("open whatsapp business"))
    @Test fun waDevanagari() = assertEquals(Command.WhatsApp(WaAction.SEND, "bhaiya", "जल्दी आओ"), p("भैया को व्हाट्सएप करो की जल्दी आओ"))

    // ---- media ----
    @Test fun arijitBajao() = assertEquals(Command.PlayMedia("Arijit Singh", null), p("Arijit Singh bajao"))
    @Test fun arijitKeGaane() = assertEquals(Command.PlayMedia("Arijit Singh", null), p("Arijit Singh ke gaane bajao"))
    @Test fun spotifyPe() = assertEquals(Command.PlayMedia("lofi", MediaApp.SPOTIFY), p("spotify pe lofi bajao"))
    @Test fun youtubeMusicPe() = assertEquals(Command.PlayMedia("Kesariya", MediaApp.YOUTUBE_MUSIC), p("YouTube Music pe Kesariya chalao"))
    @Test fun youtubeChalaoQuery() = assertEquals(Command.PlayMedia("Kesariya", MediaApp.YOUTUBE), p("youtube pe Kesariya chalao"))
    @Test fun playOnSpotifyEnglish() = assertEquals(Command.PlayMedia("Believer", MediaApp.SPOTIFY), p("play Believer on Spotify"))
    @Test fun youtubeChalaoOpensApp() = assertEquals(Command.OpenApp("youtube"), p("youtube chalao"))
    @Test fun gaanaBajaoPlays() = assertEquals(Command.MediaKey(MediaAction.PLAY), p("gaana bajao"))
    @Test fun gaanaRoko() = assertEquals(Command.MediaKey(MediaAction.PAUSE), p("gaana roko"))
    @Test fun pauseAlone() = assertEquals(Command.MediaKey(MediaAction.PAUSE), p("pause"))
    @Test fun aglaGaana() = assertEquals(Command.MediaKey(MediaAction.NEXT), p("agla gaana"))
    @Test fun nextSong() = assertEquals(Command.MediaKey(MediaAction.NEXT), p("next song"))
    @Test fun previousSong() = assertEquals(Command.MediaKey(MediaAction.PREVIOUS), p("pichhla gaana chalao"))
    @Test fun musicChaluKaro() = assertEquals(Command.MediaKey(MediaAction.PLAY), p("music chalu karo"))
    @Test fun playStoreIsApp() = assertEquals(Command.OpenApp("play store"), p("open play store"))

    // ---- screen ----
    @Test fun screenPadho() = assertEquals(Command.ReadScreen, p("screen padho"))
    @Test fun readScreen() = assertEquals(Command.ReadScreen, p("read the screen"))
    @Test fun screenDekhoQuestion() = assertEquals(Command.AskScreen("ye kya hai", false), p("screen dekho aur batao ye kya hai").let { if (it is Command.AskScreen) it.copy(question = it.question.removePrefix("batao ").trim()) else it })
    @Test fun screenDekhoBare() = assertEquals(Command.AskScreen("", false), p("screen dekho"))
    @Test fun askAboutScreen() = assertEquals(Command.AskScreen("", false), p("ask about screen"))
    @Test fun whatsOnScreen() = assertEquals(Command.AskScreen("", false), p("what's on my screen?"))
    @Test fun screenWithScreenshot() = assertTrue((p("screen dekho screenshot ke saath") as Command.AskScreen).screenshot)
    @Test fun tapPe() = assertEquals(Command.Tap("Login"), p("Login pe tap karo"))
    @Test fun clickEnglish() = assertEquals(Command.Tap("Next"), p("click Next"))
    @Test fun dabao() = assertEquals(Command.Tap("Send"), p("Send button dabao"))
    @Test fun typeText() = assertEquals(Command.TypeText("Hello Rahul"), p("type Hello Rahul"))
    @Test fun scrollDown() = assertEquals(Command.Scroll(true), p("neeche scroll karo"))
    @Test fun scrollUp() = assertEquals(Command.Scroll(false), p("scroll up"))
    @Test fun swipeLeft() = assertEquals(Command.Swipe(Direction.LEFT), p("left swipe karo"))
    @Test fun goBack() = assertEquals(Command.Global(GlobalAction.BACK), p("wapas jao"))
    @Test fun goHome() = assertEquals(Command.Global(GlobalAction.HOME), p("home screen pe jao"))
    @Test fun recents() = assertEquals(Command.Global(GlobalAction.RECENTS), p("recent apps dikhao"))
    @Test fun notificationPanel() = assertEquals(Command.Global(GlobalAction.NOTIFICATIONS), p("notifications kholo"))
    @Test fun quickSettings() = assertEquals(Command.Global(GlobalAction.QUICK_SETTINGS), p("quick settings kholo"))
    @Test fun lockPhone() = assertEquals(Command.Global(GlobalAction.LOCK), p("phone lock karo"))
    @Test fun lockEnglish() = assertEquals(Command.Global(GlobalAction.LOCK), p("lock the screen"))
    @Test fun screenshot() = assertEquals(Command.Global(GlobalAction.SCREENSHOT), p("screenshot le lo"))
    @Test fun takeScreenshot() = assertEquals(Command.Global(GlobalAction.SCREENSHOT), p("take a screenshot"))

    // ---- notifications ----
    @Test fun notifPadho() = assertEquals(Command.ReadNotifications(false), p("notifications padho"))
    @Test fun notifEnglish() = assertEquals(Command.ReadNotifications(false), p("read my notifications"))
    @Test fun nayaMessage() = assertEquals(Command.ReadNotifications(false), p("koi naya message aaya kya"))
    @Test fun otpPadho() = assertEquals(Command.ReadNotifications(true), p("OTP kya hai"))
    @Test fun notifWithOtp() = assertEquals(Command.ReadNotifications(true), p("notifications padho OTP bhi"))
    @Test fun notifClear() = assertEquals(Command.ClearNotifications, p("saari notifications clear karo"))
    @Test fun replyKi() = assertEquals(Command.ReplyNotification(null, "main busy hoon"), p("reply karo ki main busy hoon"))
    @Test fun replyToRahul() = assertEquals(Command.ReplyNotification("rahul", "5 minute mein aata hoon"), p("Rahul ko reply karo ki 5 minute mein aata hoon"))
    @Test fun replyEnglish() = assertEquals(Command.ReplyNotification("mom", "ok"), p("reply to mom saying ok"))

    // ---- calls ----
    @Test fun uthao() = assertEquals(Command.AnswerCall, p("uthao"))
    @Test fun callUthao() = assertEquals(Command.AnswerCall, p("call utha lo"))
    @Test fun pickUp() = assertEquals(Command.AnswerCall, p("pick up the call"))
    @Test fun kaato() = assertEquals(Command.RejectCall, p("kaato"))
    @Test fun callKaatDo() = assertEquals(Command.RejectCall, p("call kaat do"))
    @Test fun rejectCall() = assertEquals(Command.RejectCall, p("reject the call"))
    @Test fun speakerOn() = assertEquals(Command.Speaker(true), p("speaker on karo"))
    @Test fun speakerOff() = assertEquals(Command.Speaker(false), p("turn off the speaker"))
    @Test fun wakeUpTargetPrefix() = assertEquals(Command.Flashlight(true), p("wake up target, torch on"))
    @Test fun soJao() = assertEquals(Command.Stop, p("so jao"))
    @Test fun goToSleep() = assertEquals(Command.Stop, p("go to sleep"))
    @Test fun heyTargetOneBreath() = assertEquals(Command.PlayMedia("", MediaApp.YOUTUBE), p("Hey Target, YouTube pe gaana chalao"))
    @Test fun alarmUthaDenaStillAlarm() = assertEquals(Command.Alarm(5, 0, null), p("subah 5 baje utha dena"))

    // ---- conversation / persona ----
    @Test fun bas() = assertEquals(Command.Stop, p("bas"))
    @Test fun byeTarget() = assertEquals(Command.Stop, p("Bye Target"))
    @Test fun conversationOn() = assertEquals(Command.ConversationMode(true), p("conversation mode on karo"))
    @Test fun baatKarteHain() = assertEquals(Command.ConversationMode(true), p("chalo baat karte hain"))
    @Test fun conversationOff() = assertEquals(Command.ConversationMode(false), p("conversation mode band karo"))
    @Test fun dostMode() = assertEquals(Command.SetPersona(Persona.DOST), p("dost mode on"))
    @Test fun professionalMode() = assertEquals(Command.SetPersona(Persona.PROFESSIONAL), p("professional mode"))

    // ---- camera ----
    @Test fun cameraSeDekho() = assertEquals(Command.CameraAsk("ye kaunsa phool hai"), p("camera se dekho ye kaunsa phool hai"))
    @Test fun cameraBare() = assertEquals(Command.CameraAsk(""), p("camera se dekho"))
    @Test fun lookThroughCamera() = assertEquals(Command.CameraAsk("what plant is this"), p("look through the camera and what plant is this"))
    @Test fun cameraKholoStillApp() = assertEquals(Command.OpenApp("camera"), p("camera kholo"))

    // ---- system ----
    @Test fun volumeBadhao() = assertEquals(Command.Volume(VolumeAction.UP), p("volume badhao"))
    @Test fun awaazKam() = assertEquals(Command.Volume(VolumeAction.DOWN), p("awaaz kam karo"))
    @Test fun volumeUpEnglish() = assertEquals(Command.Volume(VolumeAction.UP), p("turn the volume up"))
    @Test fun volumeFull() = assertEquals(Command.Volume(VolumeAction.MAX), p("volume full kar do"))
    @Test fun mute() = assertEquals(Command.Volume(VolumeAction.MUTE), p("mute karo"))
    @Test fun silent() = assertEquals(Command.Ringer(RingerMode.SILENT), p("phone silent kar do"))
    @Test fun silentHatao() = assertEquals(Command.Ringer(RingerMode.NORMAL), p("silent hatao"))
    @Test fun vibrate() = assertEquals(Command.Ringer(RingerMode.VIBRATE), p("vibrate mode pe daalo"))
    @Test fun dndOn() = assertEquals(Command.Dnd(true), p("DND on karo"))
    @Test fun dndOff() = assertEquals(Command.Dnd(false), p("do not disturb band karo"))
    @Test fun brightnessPercent() = assertEquals(Command.Brightness(50, null), p("brightness 50% kar do"))
    @Test fun brightnessKam() = assertEquals(Command.Brightness(null, false), p("brightness kam karo"))
    @Test fun brightnessFull() = assertEquals(Command.Brightness(100, null), p("full brightness"))
    @Test fun wifiOn() = assertEquals(Command.SettingsPanel(Panel.WIFI, true), p("wifi on karo"))
    @Test fun bluetoothOff() = assertEquals(Command.SettingsPanel(Panel.BLUETOOTH, false), p("bluetooth band karo"))
    @Test fun mobileData() = assertEquals(Command.SettingsPanel(Panel.MOBILE_DATA, true), p("mobile data on karo"))
    @Test fun hotspot() = assertEquals(Command.SettingsPanel(Panel.HOTSPOT, true), p("hotspot chalu karo"))
    @Test fun airplane() = assertEquals(Command.SettingsPanel(Panel.AIRPLANE, true), p("flight mode on karo"))
    @Test fun batterySaver() = assertEquals(Command.SettingsPanel(Panel.BATTERY_SAVER, true), p("battery saver on karo"))
    @Test fun nfc() = assertEquals(Command.SettingsPanel(Panel.NFC, null), p("nfc settings kholo"))
    @Test fun batteryStillBattery() = assertEquals(Command.Battery, p("battery kitni bachi hai"))
    @Test fun torchStillTorch() = assertEquals(Command.Flashlight(true), p("torch jala do"))

    // ---- reminders / calendar / places ----
    @Test fun kalYaadDilana() = assertEquals(Command.Reminder(1, 17, 0, null, "doodh lana"), p("kal 5 baje yaad dilana ki doodh lana"))
    @Test fun remindTomorrowAm() = assertEquals(Command.Reminder(1, 9, 0, null, "call mom"), p("remind me tomorrow at 9 am to call mom"))
    @Test fun remindRelative() = assertEquals(Command.Reminder(0, 0, 0, 120, "paani peena"), p("2 ghante baad yaad dilana paani peena"))
    @Test fun remindMinutesEnglish() = assertEquals(Command.Reminder(0, 0, 0, 30, "check the oven"), p("remind me in 30 minutes to check the oven"))
    @Test fun remindSubah() = assertEquals(Command.Reminder(2, 7, 30, null, "gym jaana"), p("parso subah 7:30 baje yaad dilana gym jaana"))
    @Test fun remindNoTimeGoesToTarget() = assertTrue(p("yaad dilana") is Command.Ask)
    @Test fun calendarEvent() = assertEquals(Command.CalendarEvent(1, 15, 0, "meeting"), p("kal 3 baje meeting calendar mein daalo"))
    @Test fun calendarEnglish() = assertEquals(Command.CalendarEvent(1, 16, 0, "dentist"), p("add dentist to calendar tomorrow at 4 pm"))
    @Test fun nearbyPetrol() = assertEquals(Command.Nearby("petrol pump"), p("paas mein petrol pump kahan hai"))
    @Test fun nearestAtm() = assertEquals(Command.Nearby("atm"), p("nearest ATM"))
    @Test fun nearbyEnglish() = assertEquals(Command.Nearby("restaurants"), p("restaurants near me"))
    @Test fun weatherGoesToTarget() = assertTrue(p("aaj ka mausam kaisa hai") is Command.Ask)
    @Test fun newsGoesToTarget() = assertTrue(p("aaj ki news sunao") is Command.Ask)

    // ---- routines ----
    @Test fun runRoutine() = assertEquals(Command.RunRoutine("subah"), p("subah ka routine chalao"))
    @Test fun runRoutineEnglish() = assertEquals(Command.RunRoutine("morning"), p("run morning routine"))
    @Test fun saveRoutineColon() = assertEquals(
        Command.SaveRoutine("subah", listOf("alarm band", "torch on", "news sunao")),
        p("routine banao subah: alarm band, torch on, news sunao"),
    )
    @Test fun saveRoutineSpoken() = assertEquals(
        Command.SaveRoutine("raat", listOf("torch off", "silent kar do")),
        p("raat ka routine banao torch off phir silent kar do"),
    )
}
