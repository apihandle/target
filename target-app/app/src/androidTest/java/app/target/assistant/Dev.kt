package app.target.assistant

import android.app.Activity
import android.app.Instrumentation
import android.app.UiAutomation
import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.isInternal
import org.hamcrest.Matchers.not
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL

/** Shared helpers for the instrumented tests. */
object Dev {
    val instr: Instrumentation get() = InstrumentationRegistry.getInstrumentation()
    val ctx: Context get() = instr.targetContext
    val pkg: String get() = ctx.packageName

    /**
     * adb-shell equivalent. Uses FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES so the UiAutomation
     * connection does not switch off our own accessibility service.
     */
    fun shell(cmd: String): String {
        val ua = instr.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val pfd = ua.executeShellCommand(cmd)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    fun grant(vararg permissions: String) {
        permissions.forEach { shell("pm grant $pkg $it") }
    }

    fun waitUntil(timeoutMs: Long = 10_000, stepMs: Long = 200, cond: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (cond()) return true
            Thread.sleep(stepMs)
        }
        return cond()
    }

    fun <T> onMain(block: () -> T): T {
        var out: T? = null
        instr.runOnMainSync { out = block() }
        @Suppress("UNCHECKED_CAST") return out as T
    }

    fun clearPrefs() {
        ctx.getSharedPreferences("target_prefs", Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** Espresso-Intents on; every intent to another app is stubbed (nothing really opens), our own screens still open. */
    fun stubIntents() {
        Intents.init()
        intending(not(isInternal())).respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
    }

    fun internetReachable(): Boolean = try {
        val c = URL(BuildConfig.BASE_URL).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 8000; c.instanceFollowRedirects = false
        val code = c.responseCode
        c.disconnect()
        code in 200..499
    } catch (_: Exception) { false }
}
