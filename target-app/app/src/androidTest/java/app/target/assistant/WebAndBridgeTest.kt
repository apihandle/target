package app.target.assistant

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.target.assistant.web.TargetBridge
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** App launch, WebView on BASE_URL, and the window.TargetAndroid bridge. */
@RunWith(AndroidJUnit4::class)
class WebAndBridgeTest {

    @Test fun appLaunches() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var hasWebView = false
            sc.onActivity { hasWebView = it.webView.settings.javaScriptEnabled }
            assertTrue(hasWebView)
        }
    }

    @Test fun webViewLoadsBaseUrl() {
        assumeTrue("network to ${BuildConfig.BASE_URL} not reachable from the emulator", Dev.internetReachable())
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var act: MainActivity? = null
            sc.onActivity { act = it }
            val ok = Dev.waitUntil(45_000) { TargetBridge.isOwnOrigin(act?.lastFinishedUrl) }
            assertTrue("last finished: ${act?.lastFinishedUrl}", ok)
            // The page itself can call the bridge.
            val latch = CountDownLatch(1)
            var result: String? = null
            sc.onActivity { a -> a.webView.evaluateJavascript("TargetAndroid.version()") { r -> result = r; latch.countDown() } }
            latch.await(10, TimeUnit.SECONDS)
            // evaluateJavascript returns the JS string JSON-quoted.
            val json = JSONObject(org.json.JSONTokener(result).nextValue() as String)
            assertTrue(json.getBoolean("ok"))
            assertEquals("android", json.getString("platform"))
        }
    }

    @Test fun bridgeMethodsReturnJson() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var bridge: TargetBridge? = null
            sc.onActivity { bridge = it.bridge }
            val b = bridge!!
            b.currentUrl = BuildConfig.BASE_URL + "/app"
            val calls = listOf(
                b.version(), b.battery(), b.flashlight(false), b.speak("namaste"),
                b.openApp("zz-no-such-app-zz"), b.navigate(""), b.takePendingImage(), b.listen("cb"),
            )
            calls.forEach { s ->
                val j = JSONObject(s)
                assertTrue("no ok in $s", j.has("ok"))
            }
            assertTrue(JSONObject(b.version()).getBoolean("ok"))
            assertTrue(JSONObject(b.battery()).getInt("level") in 0..100)
            assertFalse("empty place refused", JSONObject(b.navigate("")).getBoolean("ok"))
        }
    }

    @Test fun bridgeRefusesOtherOrigins() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var bridge: TargetBridge? = null
            sc.onActivity { bridge = it.bridge }
            bridge!!.currentUrl = "https://evil.example.com/"
            val j = JSONObject(bridge!!.battery())
            assertFalse(j.getBoolean("ok"))
            assertEquals("origin not allowed", j.getString("error"))
            bridge!!.currentUrl = BuildConfig.BASE_URL + "/app"
        }
    }
}
