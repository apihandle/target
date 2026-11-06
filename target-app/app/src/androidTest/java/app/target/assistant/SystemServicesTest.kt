package app.target.assistant

import android.Manifest
import android.app.job.JobScheduler
import android.content.Intent
import android.os.Build
import android.widget.Button
import android.widget.EditText
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import app.target.assistant.access.TargetAccessibilityService
import app.target.assistant.brain.Command
import app.target.assistant.brain.CommandRunner
import app.target.assistant.net.TargetApi
import app.target.assistant.notify.TargetNotificationListener
import app.target.assistant.settings.Prefs
import app.target.assistant.wake.WakeModel
import app.target.assistant.wake.WakeWordService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Accessibility, notification listener, QS tile, offline queue and the wake-word service on a real Android system. */
@RunWith(AndroidJUnit4::class)
class SystemServicesTest {

    @Before fun setUp() { Dev.clearPrefs() }

    // ---- accessibility ----------------------------------------------------------------------------

    @Test fun accessibilityReadsScreenAndTaps() {
        val svc = "${Dev.pkg}/${TargetAccessibilityService::class.java.name}"
        Dev.shell("settings put secure enabled_accessibility_services $svc")
        Dev.shell("settings put secure accessibility_enabled 1")
        try {
            assertTrue("service connected", Dev.waitUntil(20_000) { TargetAccessibilityService.instance != null })
            ActivityScenario.launch(ScreenTestActivity::class.java).use { sc ->
                val a = TargetAccessibilityService.instance!!
                assertTrue("screen text", Dev.waitUntil(10_000) { a.screenText(skipOwn = false).contains("Hello TARGET screen test") })
                assertTrue("tap", Dev.onMain { a.clickText("Press me", skipOwn = false) })
                var label = ""
                assertTrue("button pressed", Dev.waitUntil(5_000) { sc.onActivity { label = it.findButtonText() }; label == "Pressed" })
                sc.onActivity { it.input.requestFocus() }
                Dev.onMain { a.typeText("namaste") }
                var typed = ""
                assertTrue("typed", Dev.waitUntil(5_000) { sc.onActivity { typed = it.input.text.toString() }; typed.contains("namaste") })
                // The overlay-facing command path: "screen padho" reads through the same service.
                val out = Dev.onMain { CommandRunner(Dev.ctx).run(Command.ReadScreen, "screen padho") }
                assertTrue(out.reply.isNotBlank())
            }
        } finally {
            Dev.shell("settings put secure enabled_accessibility_services null")
        }
    }

    private fun ScreenTestActivity.findButtonText(): String = (button as Button).text.toString()

    // ---- notifications ----------------------------------------------------------------------------

    @Test fun notificationListenerReadsPostedNotification() {
        val svc = "${Dev.pkg}/${TargetNotificationListener::class.java.name}"
        Dev.shell("cmd notification allow_listener $svc")
        try {
            assertTrue("listener connected", Dev.waitUntil(20_000) { TargetNotificationListener.instance != null })
            Dev.shell("cmd notification post -t RahulTest target_t1 kal_milte_hain")
            Dev.shell("cmd notification post -t BankTest target_t2 Your_OTP_is_482913")
            val l = TargetNotificationListener.instance!!
            assertTrue("posted notification seen", Dev.waitUntil(15_000) { l.items().map { it.title }.containsAll(listOf("RahulTest", "BankTest")) })
            val read = Dev.onMain { CommandRunner(Dev.ctx).run(Command.ReadNotifications(false), "notifications padho") }
            assertTrue(read.reply, read.reply.contains("kal_milte_hain"))
            assertFalse("OTP hidden: ${read.reply}", read.reply.contains("482913"))
            val withOtp = Dev.onMain { CommandRunner(Dev.ctx).run(Command.ReadNotifications(true), "otp padho") }
            assertTrue("OTP asked: ${withOtp.reply}", withOtp.reply.contains("482913"))
            val clear = Dev.onMain { CommandRunner(Dev.ctx).run(Command.ClearNotifications, "notifications clear karo") }
            assertNotNull("clearing asks first", clear.confirm)
        } finally {
            Dev.shell("cmd notification disallow_listener $svc")
        }
    }

    // ---- quick settings tile ----------------------------------------------------------------------

    @Test fun quickSettingsTileOpensAssistant() {
        assumeTrue("cmd statusbar click-tile needs Android 10+", Build.VERSION.SDK_INT >= 29)
        Dev.grant(Manifest.permission.RECORD_AUDIO)
        val tile = "${Dev.pkg}/${app.target.assistant.tile.TargetTileService::class.java.name}"
        Dev.shell("cmd statusbar add-tile $tile")
        Thread.sleep(1500)
        Dev.shell("cmd statusbar click-tile $tile")
        val opened = Dev.waitUntil(15_000) {
            Dev.onMain { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).any { it is AssistActivity } }
        }
        Dev.onMain { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<AssistActivity>().forEach { it.finish() } }
        Dev.shell("cmd statusbar collapse")
        Dev.shell("cmd statusbar remove-tile $tile")
        assertTrue("AssistActivity opened from the tile", opened)
    }

    // ---- offline queue ----------------------------------------------------------------------------

    @Test fun offlineQueueEnqueuesWithoutNetwork() {
        Dev.shell("cmd connectivity airplane-mode enable")
        try {
            Dev.waitUntil(20_000) { !TargetApi.isOnline(Dev.ctx) }
            if (TargetApi.isOnline(Dev.ctx)) { Dev.shell("svc wifi disable"); Dev.shell("svc data disable"); Dev.waitUntil(15_000) { !TargetApi.isOnline(Dev.ctx) } }
            assertFalse("still online", TargetApi.isOnline(Dev.ctx))
            val out = Dev.onMain { CommandRunner(Dev.ctx).handle("aaj delhi ka mausam kaisa hai") }
            assertEquals(Dev.ctx.getString(R.string.reply_queued), out.reply)
            assertTrue(Prefs(Dev.ctx).offlineQueue.contains("aaj delhi ka mausam kaisa hai"))
            val js = Dev.ctx.getSystemService(JobScheduler::class.java)
            assertTrue("job scheduled", js.allPendingJobs.any { it.id == 4242 })
            js.cancel(4242)
            Prefs(Dev.ctx).offlineQueue = emptyList()
        } finally {
            Dev.shell("cmd connectivity airplane-mode disable")
            Dev.shell("svc wifi enable")
            Dev.shell("svc data enable")
        }
    }

    // ---- wake word --------------------------------------------------------------------------------

    @Test fun wakeWordWithoutModelStopsCleanly() {
        WakeModel.delete(Dev.ctx)
        Dev.grant(Manifest.permission.RECORD_AUDIO)
        assertFalse(WakeModel.isReady(Dev.ctx))
        WakeWordService.start(Dev.ctx) // refuses quietly without a model
        assertFalse(WakeWordService.running)
        WakeWordService.statusLog.clear()
        // Start it anyway (from a foreground activity): it must go foreground, see no model and stop.
        ActivityScenario.launch(ScreenTestActivity::class.java).use {
            Dev.ctx.startForegroundService(Intent(Dev.ctx, WakeWordService::class.java))
            assertTrue("log: ${WakeWordService.statusLog}", Dev.waitUntil(10_000) { WakeWordService.statusLog.contains("no_model") })
            assertTrue(WakeWordService.statusLog.contains("foreground"))
            assertTrue("stopped", Dev.waitUntil(5_000) { !WakeWordService.running })
        }
    }

    @Test fun wakeWordModelDownloadsAndSpotterRuns() {
        assumeTrue("needs github.com from the emulator", Dev.internetReachable())
        WakeModel.delete(Dev.ctx)
        val err = WakeModel.download(Dev.ctx) {}
        assertEquals(null, err)
        assertTrue(WakeModel.isReady(Dev.ctx))
        // The native engine loads the real model and processes 2 s of silence without a false wake.
        val kws = WakeModel.createSpotter(Dev.ctx, 1.5f, 0.25f)
        val stream = kws.createStream("")
        repeat(20) {
            stream.acceptWaveform(FloatArray(1600), 16000)
            while (kws.isReady(stream)) kws.decode(stream)
        }
        assertEquals("", kws.getResult(stream).keyword)
        stream.release()
        kws.release()
        // The service loads it too.
        Dev.grant(Manifest.permission.RECORD_AUDIO)
        WakeWordService.statusLog.clear()
        ActivityScenario.launch(ScreenTestActivity::class.java).use {
            Dev.ctx.startForegroundService(Intent(Dev.ctx, WakeWordService::class.java))
            assertTrue("log: ${WakeWordService.statusLog}", Dev.waitUntil(20_000) { WakeWordService.statusLog.contains("spotter_ready") })
            WakeWordService.stop(Dev.ctx)
            assertTrue(Dev.waitUntil(5_000) { !WakeWordService.running })
        }
    }
}
