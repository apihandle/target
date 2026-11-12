package app.target.assistant

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.webkit.WebViewFeature
import app.target.assistant.web.TargetBridge
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** App launch, WebView on BASE_URL, and the window.TargetAndroid bridge (top frame + own origin + bridge paths only, fix #6). */
@RunWith(AndroidJUnit4::class)
class WebAndBridgeTest {

    private val base = BuildConfig.BASE_URL.trimEnd('/')

    private fun js(sc: ActivityScenario<MainActivity>, script: String): String? {
        val latch = CountDownLatch(1)
        var result: String? = null
        sc.onActivity { a -> a.webView.evaluateJavascript(script) { r -> result = r; latch.countDown() } }
        latch.await(10, TimeUnit.SECONDS)
        return result?.let { if (it == "null") null else org.json.JSONTokener(it).nextValue() as? String }
    }

    @Test fun appLaunches() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var hasWebView = false
            var installed = false
            sc.onActivity { hasWebView = it.webView.settings.javaScriptEnabled; installed = it.bridge.installed }
            assertTrue(hasWebView)
            assertEquals(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER), installed)
        }
    }

    /** Offline: a page served under /app/ (a bridge path, fix #6) gets answers; its iframe does not. */
    @Test fun topFrameAnsweredIframeRefused() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        val iframe = "<script>window.onload=function(){var n=0;(function g(){var c=window.TargetAndroid;" +
            "if(!c||!c.postMessage){if(n++<50)setTimeout(g,100);return;}" +
            "parent.__iframeSent=true;c.onmessage=function(){parent.__iframeGot=true;};" +
            "c.postMessage(JSON.stringify({id:9,method:'battery',args:[]}));})();};</script>"
        val html = "<html><body><script>window.__top='';(function go(){" +
            "if(!window.TargetAndroid||typeof TargetAndroid.version!=='function'){setTimeout(go,100);return;}" +
            "TargetAndroid.version().then(function(r){window.__top=JSON.stringify(r);});})();</script>" +
            "<iframe srcdoc=\"" + iframe.replace("\"", "&quot;") + "\"></iframe></body></html>"
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var bridge: TargetBridge? = null
            sc.onActivity { a ->
                bridge = a.bridge
                a.webView.stopLoading()
                a.webView.loadDataWithBaseURL("$base/app/bridge-test", html, "text/html", "utf-8", "$base/app/bridge-test")
            }
            assertTrue("top frame got a reply", Dev.waitUntil(20_000) { !js(sc, "window.__top").isNullOrEmpty() })
            val top = JSONObject(js(sc, "window.__top")!!)
            assertTrue(top.getBoolean("ok"))
            assertEquals("android", top.getString("platform"))
            Thread.sleep(3000)
            assertNull("iframe must never get a reply", js(sc, "window.__iframeGot ? 'yes' : null"))
            if (js(sc, "window.__iframeSent ? 'yes' : null") != null) assertTrue("iframe call counted as refused", bridge!!.refused.get() > 0)
        }
    }

    @Test fun webViewLoadsBaseUrl() {
        assumeTrue("network to ${BuildConfig.BASE_URL} not reachable from the emulator", Dev.internetReachable())
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var act: MainActivity? = null
            sc.onActivity { act = it }
            val ok = Dev.waitUntil(45_000) { TargetBridge.isOwnOrigin(act?.lastFinishedUrl) }
            assertTrue("last finished: ${act?.lastFinishedUrl}", ok)
            // Fix #6: the bridge is path-gated. On a bridge path the real page can call it
            // (promise API); anywhere else — a signed-out emulator lands on /login — the
            // bridge must be ABSENT. That absence is the point of the fix: no bridge next
            // to ads or the credential form. Assert whichever side this launch landed on.
            val url = act?.lastFinishedUrl ?: ""
            if (app.target.assistant.web.BridgeSecurity.isBridgeAllowedPath(url)) {
                js(sc, "window.__v='';TargetAndroid.version().then(function(r){window.__v=JSON.stringify(r)});'x'")
                assertTrue(Dev.waitUntil(15_000) { !js(sc, "window.__v").isNullOrEmpty() })
                val json = JSONObject(js(sc, "window.__v")!!)
                assertTrue(json.getBoolean("ok"))
                assertEquals("android", json.getString("platform"))
            } else {
                val absent = Dev.waitUntil(15_000) { js(sc, "typeof window.TargetAndroid") == "undefined" }
                assertTrue("bridge must be absent on $url", absent)
            }
        }
    }

    @Test fun bridgeMethodsReturnJson() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var bridge: TargetBridge? = null
            sc.onActivity { bridge = it.bridge }
            val b = bridge!!
            b.currentUrl = "$base/app"
            val calls = listOf(
                b.version(), b.battery(), b.flashlight(false), b.speak("namaste"),
                b.openApp("zz-no-such-app-zz"), b.navigate(""), b.takePendingImage(), b.listen("cb"),
            )
            calls.forEach { s -> assertTrue("no ok in $s", JSONObject(s).has("ok")) }
            assertTrue(JSONObject(b.version()).getBoolean("ok"))
            assertTrue(JSONObject(b.battery()).getInt("level") in 0..100)
            assertFalse("empty place refused", JSONObject(b.navigate("")).getBoolean("ok"))
        }
    }

    @Test fun bridgeRefusesFramesAndOtherOrigins() {
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            var bridge: TargetBridge? = null
            sc.onActivity { bridge = it.bridge }
            val b = bridge!!
            val msg = """{"id":5,"method":"battery","args":[]}"""
            b.currentUrl = "$base/app"
            val ok = b.handle(msg, base, isMainFrame = true)
            assertNotNull(ok)
            assertEquals(5L, JSONObject(ok!!).getLong("id"))
            assertTrue(JSONObject(ok).getJSONObject("result").getBoolean("ok"))
            assertNull("iframe", b.handle(msg, base, isMainFrame = false))
            assertNull("other origin", b.handle(msg, "https://evil.example.com", isMainFrame = true))
            assertNull("http downgrade", b.handle(msg, base.replace("https://", "http://"), isMainFrame = true))
            b.currentUrl = "https://evil.example.com/"
            assertNull("top page elsewhere", b.handle(msg, base, isMainFrame = true))
            val j = JSONObject(b.battery())
            assertFalse(j.getBoolean("ok"))
            assertEquals("origin not allowed", j.getString("error"))
            b.currentUrl = "$base/app"
            assertTrue(JSONObject(b.handle("""{"id":6,"method":"nope"}""", base, true)!!).getJSONObject("result").has("error"))
        }
    }
}
