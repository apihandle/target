package app.target.assistant

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The /auth/app-return App Link must be turned into /auth/app-handoff inside the WebView:
 * launching MainActivity with an app-return VIEW intent (what Android delivers for the link)
 * should end with the WebView having followed the handoff endpoint — with an unknown code the
 * server bounces it to /login?error=google, which is still proof the handoff URL was loaded
 * (had the raw app-return URL been loaded instead, the WebView would sit on /auth/app-return).
 */
@RunWith(AndroidJUnit4::class)
class AppHandoffDeepLinkTest {

    @Test fun appReturnLinkLoadsHandoffInWebView() {
        assumeTrue("network to ${BuildConfig.BASE_URL} not reachable from the emulator", Dev.internetReachable())
        val base = BuildConfig.BASE_URL.trimEnd('/')
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("$base/auth/app-return?code=instrumented-invalid-code"))
            .setClass(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use { sc ->
            var act: MainActivity? = null
            sc.onActivity { act = it }
            val ok = Dev.waitUntil(45_000) {
                val u = act?.lastFinishedUrl ?: return@waitUntil false
                u.contains("/login") && !u.contains("app-return")
            }
            assertTrue("last finished: ${act?.lastFinishedUrl}", ok)
        }
    }
}
