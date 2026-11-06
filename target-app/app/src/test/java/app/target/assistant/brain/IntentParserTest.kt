package app.target.assistant.brain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IntentParserTest {

    private fun p(s: String) = IntentParser.parse(s)

    // ---- alarms ----
    @Test fun alarmHinglishBaje() = assertEquals(Command.Alarm(7, 0, null), p("alarm laga 7 baje"))
    @Test fun alarmWithWakeWord() = assertEquals(Command.Alarm(7, 0, null), p("Hey Target, alarm laga do 7 baje ka"))
    @Test fun alarmSubahColon() = assertEquals(Command.Alarm(6, 30, null), p("subah 6:30 ka alarm"))
    @Test fun alarmSaade() = assertEquals(Command.Alarm(6, 30, null), p("saade 6 baje ka alarm lagao"))
    @Test fun alarmPaune() = assertEquals(Command.Alarm(6, 45, null), p("paune 7 baje alarm"))
    @Test fun alarmRaat() = assertEquals(Command.Alarm(22, 0, null), p("raat 10 baje ka alarm"))
    @Test fun alarmShaam() = assertEquals(Command.Alarm(19, 15, null), p("shaam 7:15 alarm set karo"))
    @Test fun alarmEnglishPm() = assertEquals(Command.Alarm(17, 0, null), p("set an alarm for 5 pm"))
    @Test fun alarmEnglishAm() = assertEquals(Command.Alarm(7, 30, null), p("Set alarm 7:30 am"))
    @Test fun alarmHindiNumberWord() = assertEquals(Command.Alarm(7, 0, null), p("saat baje ka alarm"))
    @Test fun alarmUthaDena() = assertEquals(Command.Alarm(5, 0, null), p("subah 5 baje utha dena"))
    @Test fun alarmWithoutTimeGoesToWeb() = assertTrue(p("alarm laga do") is Command.Ask)

    // ---- timers ----
    @Test fun timerMinute() = assertEquals(Command.Timer(300, null), p("timer 5 minute"))
    @Test fun timerKa() = assertEquals(Command.Timer(600, null), p("10 min ka timer laga do"))
    @Test fun timerSeconds() = assertEquals(Command.Timer(30, null), p("set a timer for 30 seconds"))
    @Test fun timerGhanta() = assertEquals(Command.Timer(3600, null), p("1 ghante ka timer"))
    @Test fun timerMixed() = assertEquals(Command.Timer(90, null), p("timer 1 minute 30 second"))
    @Test fun timerHindiWord() = assertEquals(Command.Timer(120, null), p("do minute ka timer"))
    @Test fun timerAadha() = assertEquals(Command.Timer(1800, null), p("aadha ghanta timer"))

    // ---- flashlight ----
    @Test fun torchOn() = assertEquals(Command.Flashlight(true), p("torch on"))
    @Test fun torchJalao() = assertEquals(Command.Flashlight(true), p("torch jalao"))
    @Test fun torchBand() = assertEquals(Command.Flashlight(false), p("torch band karo"))
    @Test fun flashlightOff() = assertEquals(Command.Flashlight(false), p("Turn off the flashlight"))

    // ---- apps ----
    @Test fun openWhatsapp() = assertEquals(Command.OpenApp("whatsapp"), p("open whatsapp"))
    @Test fun whatsappKholo() = assertEquals(Command.OpenApp("whatsapp"), p("WhatsApp kholo"))
    @Test fun youtubeKholDo() = assertEquals(Command.OpenApp("youtube"), p("youtube khol do"))
    @Test fun openCameraApp() = assertEquals(Command.OpenApp("camera"), p("open camera app"))
    @Test fun openDomain() = assertEquals(Command.OpenUrl("https://google.com"), p("open google.com"))

    // ---- calls / sms ----
    @Test fun callNumber() = assertEquals(Command.Dial("9876543210"), p("call 98765 43210"))
    @Test fun callKaro() = assertEquals(Command.Dial("+919876543210"), p("+91 98765-43210 pe call karo"))
    @Test fun callContactNameGoesToWeb() = assertTrue(p("call mummy") is Command.Ask)
    @Test fun smsWithKi() = assertEquals(Command.Sms("9876543210", "main 10 minute mein aa raha hoon"), p("sms 9876543210 ki main 10 minute mein aa raha hoon"))
    @Test fun smsEnglish() = assertEquals(Command.Sms("9876543210", "running late"), p("text 9876543210 saying running late"))
    @Test fun smsKoKi() = assertEquals(Command.Sms("9876543210", "Khana kha liya"), p("9876543210 ko message bhejo ki Khana kha liya"))

    // ---- navigation / battery ----
    @Test fun navigateTo() = assertEquals(Command.Navigate("india gate"), p("navigate to India Gate"))
    @Test fun rastaBatao() = assertEquals(Command.Navigate("connaught place"), p("Connaught Place ka rasta batao"))
    @Test fun battery() = assertEquals(Command.Battery, p("battery kitni hai?"))

    // ---- fallback ----
    @Test fun questionGoesToWeb() = assertEquals(Command.Ask("aaj delhi mein mausam kaisa hai"), p("aaj delhi mein mausam kaisa hai"))
    @Test fun emptyGoesToWeb() = assertTrue(p("   ") is Command.Ask)

    @Test fun parseTimeEdgeCases() {
        assertEquals(0 to 0, IntentParser.parseTime("raat 12 baje"))
        assertEquals(12 to 0, IntentParser.parseTime("dopahar 12 baje"))
        assertEquals(14 to 0, IntentParser.parseTime("dopahar 2 baje"))
        assertEquals(0 to 30, IntentParser.parseTime("12:30 am"))
    }
}
