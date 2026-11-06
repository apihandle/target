package app.target.assistant

import android.content.Intent
import android.os.Build
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasData
import androidx.test.espresso.intent.matcher.IntentMatchers.hasDataString
import androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra
import androidx.test.espresso.intent.matcher.IntentMatchers.hasPackage
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.target.assistant.brain.CommandRunner
import app.target.assistant.brain.MediaAction
import app.target.assistant.brain.MediaApp
import app.target.assistant.brain.Panel
import app.target.assistant.brain.RingerMode
import app.target.assistant.brain.VolumeAction
import app.target.assistant.tools.DeviceTools
import app.target.assistant.tools.Media
import app.target.assistant.tools.SystemControl
import app.target.assistant.tools.WhatsApp
import app.target.assistant.tools.Reminders
import org.hamcrest.Matchers.allOf
import org.hamcrest.Matchers.startsWith
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Each device tool fires the right intent (Espresso-Intents, nothing really opens), and the hardware calls do not crash. */
@RunWith(AndroidJUnit4::class)
class DeviceToolsTest {
    private val tools get() = DeviceTools(Dev.ctx)

    @Before fun setUp() { Dev.clearPrefs(); Dev.stubIntents() }
    @After fun tearDown() = Intents.release()

    @Test fun alarmIntent() {
        tools.setAlarm(7, 30, null)
        intended(allOf(hasAction(AlarmClock.ACTION_SET_ALARM), hasExtra(AlarmClock.EXTRA_HOUR, 7), hasExtra(AlarmClock.EXTRA_MINUTES, 30)))
    }

    @Test fun timerIntent() {
        tools.setTimer(300, null)
        intended(allOf(hasAction(AlarmClock.ACTION_SET_TIMER), hasExtra(AlarmClock.EXTRA_LENGTH, 300)))
    }

    @Test fun dialIntent() {
        tools.dial("9876543210")
        intended(allOf(hasAction(Intent.ACTION_DIAL), hasData("tel:9876543210")))
    }

    @Test fun smsComposerIntent() {
        tools.composeSms("9876543210", "hi")
        intended(allOf(hasAction(Intent.ACTION_SENDTO), hasData("smsto:9876543210"), hasExtra("sms_body", "hi")))
    }

    @Test fun mapsIntent() {
        tools.navigate("India Gate")
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasDataString(startsWith("geo:0,0?q=India"))))
    }

    @Test fun youtubeSearchIntent() {
        Media.play(Dev.ctx, "Arijit Singh", MediaApp.YOUTUBE)
        intended(allOf(hasAction(Intent.ACTION_SEARCH), hasPackage("com.google.android.youtube"), hasExtra("query", "Arijit Singh")))
    }

    @Test fun spotifyPlayFromSearchIntent() {
        Media.play(Dev.ctx, "Kesariya", MediaApp.SPOTIFY)
        intended(allOf(hasAction(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH), hasPackage("com.spotify.music"), hasExtra("query", "Kesariya")))
    }

    @Test fun wifiPanelIntent() {
        SystemControl.panel(Dev.ctx, Panel.WIFI)
        intended(hasAction(if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS))
    }

    @Test fun internetPanelIntent() {
        SystemControl.panel(Dev.ctx, Panel.MOBILE_DATA)
        intended(hasAction(if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_DATA_ROAMING_SETTINGS))
    }

    @Test fun bluetoothSettingsIntent() {
        SystemControl.panel(Dev.ctx, Panel.BLUETOOTH)
        intended(hasAction(Settings.ACTION_BLUETOOTH_SETTINGS))
    }

    @Test fun whatsappChatIntent() {
        WhatsApp.openChat(Dev.ctx, "98765 43210", "namaste", business = false)
        intended(allOf(hasAction(Intent.ACTION_VIEW), hasPackage("com.whatsapp"), hasDataString(startsWith("whatsapp://send?phone=919876543210"))))
    }

    @Test fun calendarInsertIntent() {
        Reminders.addCalendarEvent(Dev.ctx, "Meeting", System.currentTimeMillis() + 3_600_000, false)
        intended(allOf(hasAction(Intent.ACTION_INSERT), hasData(CalendarContract.Events.CONTENT_URI), hasExtra(CalendarContract.Events.TITLE, "Meeting")))
    }

    @Test fun parserDrivesAlarm() {
        Dev.onMain { CommandRunner(Dev.ctx).handle("subah saade 6 baje ka alarm laga do") }
        intended(allOf(hasAction(AlarmClock.ACTION_SET_ALARM), hasExtra(AlarmClock.EXTRA_HOUR, 6), hasExtra(AlarmClock.EXTRA_MINUTES, 30)))
    }

    @Test fun parserDrivesYoutube() {
        Dev.onMain { CommandRunner(Dev.ctx).handle("youtube pe Kesariya chalao") }
        intended(allOf(hasAction(Intent.ACTION_SEARCH), hasPackage("com.google.android.youtube")))
    }

    // ---- hardware calls must not crash (emulators have no flash; results are still valid JSON) ----

    @Test fun torchDoesNotCrash() {
        val on = JSONObject(tools.flashlight(true))
        val off = JSONObject(tools.flashlight(false))
        assertTrue(on.has("ok") && off.has("ok"))
    }

    @Test fun volumeDoesNotCrash() {
        VolumeAction.entries.forEach { a -> assertTrue(SystemControl.volume(Dev.ctx, a) in -1..100) }
    }

    @Test fun batteryIsValid() {
        val b = JSONObject(tools.battery())
        assertTrue(b.getBoolean("ok"))
        assertTrue(b.getInt("level") in 0..100)
    }

    @Test fun ringerMediaBrightnessDoNotCrash() {
        SystemControl.ringer(Dev.ctx, RingerMode.NORMAL)
        Media.key(Dev.ctx, MediaAction.PAUSE)
        assertTrue(SystemControl.brightness(Dev.ctx, null, true) >= -1)
    }
}
