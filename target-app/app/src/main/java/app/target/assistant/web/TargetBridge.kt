package app.target.assistant.web

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.target.assistant.BuildConfig
import app.target.assistant.tools.DeviceTools
import app.target.assistant.voice.Listener
import app.target.assistant.voice.Tts
import org.json.JSONObject

/**
 * `window.TargetAndroid` — device tools for the TARGET web app. Every method returns a JSON string.
 * Methods refuse to run unless the page currently shown is our own origin ([BuildConfig.BASE_URL]).
 *
 * listen(callbackName?) is async: it returns {"ok":true,"started":true} and later calls
 * window[callbackName](result) (default `onTargetListen`) and dispatches a `target-listen`
 * CustomEvent on window with detail = {ok, text} or {ok:false, error}.
 */
class TargetBridge(private val activity: Activity, private val webView: WebView) {

    private val tools = DeviceTools(activity)
    @Volatile var currentUrl: String? = null
    private var listener: Listener? = null

    private fun allowed(): Boolean = isOwnOrigin(currentUrl)

    private fun denied() = JSONObject().put("ok", false).put("error", "origin not allowed").toString()

    private inline fun guarded(block: () -> String): String = if (!allowed()) denied() else try {
        block()
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
    }

    /** Intents must start from the main thread on some OEM builds. */
    private fun onUi(block: () -> String): String {
        val latch = java.util.concurrent.CountDownLatch(1)
        var out = JSONObject().put("ok", false).put("error", "timeout").toString()
        activity.runOnUiThread {
            out = try { block() } catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: "error").toString() }
            latch.countDown()
        }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        return out
    }

    @JavascriptInterface fun version(): String = guarded { JSONObject().put("ok", true).put("version", BuildConfig.VERSION_NAME).put("platform", "android").toString() }
    @JavascriptInterface fun openApp(name: String): String = guarded { onUi { tools.openApp(name) } }
    @JavascriptInterface fun dial(number: String): String = guarded { onUi { tools.dial(number) } }
    @JavascriptInterface fun composeSms(number: String, text: String): String = guarded { onUi { tools.composeSms(number, text) } }
    @JavascriptInterface fun setAlarm(hour: Int, minute: Int, label: String?): String = guarded { onUi { tools.setAlarm(hour, minute, label) } }
    @JavascriptInterface fun setTimer(seconds: Int, label: String?): String = guarded { onUi { tools.setTimer(seconds, label) } }
    @JavascriptInterface fun flashlight(on: Boolean): String = guarded { tools.flashlight(on) }
    @JavascriptInterface fun openUrl(url: String): String = guarded { onUi { tools.openUrl(url) } }
    @JavascriptInterface fun navigate(place: String): String = guarded { onUi { tools.navigate(place) } }
    @JavascriptInterface fun share(text: String): String = guarded { onUi { tools.share(text) } }
    @JavascriptInterface fun battery(): String = guarded { tools.battery() }

    @JavascriptInterface fun speak(text: String): String = guarded {
        Tts.speak(activity, text)
        JSONObject().put("ok", true).toString()
    }

    @JavascriptInterface fun listen(): String = listen("onTargetListen")

    @JavascriptInterface fun listen(callbackName: String?): String = guarded {
        val cb = callbackName?.takeIf { it.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$")) } ?: "onTargetListen"
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 42) }
            return@guarded JSONObject().put("ok", false).put("error", "mic permission needed").toString()
        }
        activity.runOnUiThread {
            listener?.destroy()
            listener = Listener(activity,
                onPartial = { p -> deliver(cb, JSONObject().put("ok", true).put("partial", true).put("text", p)) },
                onResult = { t -> deliver(cb, JSONObject().put("ok", true).put("text", t)); listener?.destroy() },
                onError = { e -> deliver(cb, JSONObject().put("ok", false).put("error", e)); listener?.destroy() },
            ).also { it.start() }
        }
        JSONObject().put("ok", true).put("started", true).toString()
    }

    private fun deliver(cb: String, payload: JSONObject) {
        if (!allowed()) return
        val json = payload.toString()
        val js = "(function(r){try{var f=$cb;if(typeof f==='function')f(r);}catch(e){}" +
            "window.dispatchEvent(new CustomEvent('target-listen',{detail:r}));})($json);"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    fun destroy() { listener?.destroy() }

    companion object {
        fun isOwnOrigin(url: String?): Boolean {
            if (url == null) return false
            val u = Uri.parse(url)
            val base = Uri.parse(BuildConfig.BASE_URL)
            return u.scheme == base.scheme && u.host.equals(base.host, ignoreCase = true) &&
                (u.port == base.port)
        }
    }
}
