package app.target.assistant.web

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri as AUri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import androidx.core.content.ContextCompat
import app.target.assistant.BuildConfig
import app.target.assistant.tools.DeviceTools
import app.target.assistant.voice.Listener
import app.target.assistant.voice.Tts
import org.json.JSONObject

/**
 * `window.TargetAndroid` — device tools for the TARGET web app.
 *
 * Security: the bridge is NOT an addJavascriptInterface object any more (those are visible to every frame,
 * including third-party iframes). It is a WebViewCompat.addWebMessageListener channel with an allowed-origin
 * rule of exactly BASE_URL's origin, and every message is also checked here: it must come from the TOP frame,
 * from BASE_URL's origin, while the top page is on BASE_URL ([BridgeSecurity.allowed]). Anything else is
 * dropped without a reply. If the WebView is too old for WEB_MESSAGE_LISTENER, the bridge is simply absent.
 *
 * Page API (installed by a document-start shim, see [BridgeSecurity.SHIM_JS]): every method returns a
 * Promise of the JSON result, e.g. `await TargetAndroid.battery()` → {ok:true, level:82, charging:false}.
 * `TargetAndroid.listen("cb")` resolves {ok:true, started:true}; the transcript later arrives as
 * window[cb](r) and a `target-listen` CustomEvent with detail = {ok, text} or {ok:false, error}.
 */
class TargetBridge(private val activity: Activity, private val webView: WebView) {

    private val tools = DeviceTools(activity)
    @Volatile var currentUrl: String? = null
    private var listener: Listener? = null
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var listenReply: JavaScriptReplyProxy? = null
    /** Messages refused (wrong frame / origin): for tests and debugging. */
    val refused = AtomicInteger(0)

    private fun allowed(): Boolean = isOwnOrigin(currentUrl)

    private fun denied() = JSONObject().put("ok", false).put("error", "origin not allowed").toString()

    private inline fun guarded(block: () -> String): String = if (!allowed()) denied() else try {
        block()
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
    }

    /** Intents must start from the main thread on some OEM builds. */
    private fun onUi(block: () -> String): String {
        if (Looper.myLooper() == Looper.getMainLooper()) return try { block() } catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: "error").toString() }
        val latch = java.util.concurrent.CountDownLatch(1)
        var out = JSONObject().put("ok", false).put("error", "timeout").toString()
        activity.runOnUiThread {
            out = try { block() } catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: "error").toString() }
            latch.countDown()
        }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        return out
    }

    /**
     * One message from the page. Returns the reply JSON, or null when the message is refused (not the top
     * frame, wrong origin, top page elsewhere) or malformed. Blocking: call off the main thread.
     */
    fun handle(message: String?, sourceOrigin: String?, isMainFrame: Boolean, reply: JavaScriptReplyProxy? = null): String? {
        if (!BridgeSecurity.allowed(sourceOrigin, isMainFrame, currentUrl, BuildConfig.BASE_URL)) {
            refused.incrementAndGet(); return null
        }
        val m = try { JSONObject(message ?: return null) } catch (_: Exception) { return null }
        val id = m.optLong("id", -1)
        val method = m.optString("method")
        val a = m.optJSONArray("args") ?: JSONArray()
        fun str(i: Int): String = if (a.isNull(i)) "" else a.optString(i)
        fun strOrNull(i: Int): String? = if (i >= a.length() || a.isNull(i)) null else a.optString(i)
        val result = when (method) {
            "version" -> version()
            "openApp" -> openApp(str(0))
            "dial" -> dial(str(0))
            "composeSms" -> composeSms(str(0), str(1))
            "setAlarm" -> setAlarm(a.optInt(0, -1), a.optInt(1, 0), strOrNull(2))
            "setTimer" -> setTimer(a.optInt(0, 0), strOrNull(1))
            "flashlight" -> flashlight(a.optBoolean(0, false))
            "openUrl" -> openUrl(str(0))
            "navigate" -> navigate(str(0))
            "share" -> share(str(0))
            "battery" -> battery()
            "takePendingImage" -> takePendingImage()
            "speak" -> speak(str(0))
            "listen" -> { listenReply = reply; listen(strOrNull(0)) }
            else -> JSONObject().put("ok", false).put("error", "unknown method").toString()
        }
        return JSONObject().put("id", id).put("result", JSONObject(result)).toString()
    }

    /** Called by the WebMessageListener on the main thread. */
    private fun onMessage(message: WebMessageCompat, sourceOrigin: AUri, isMainFrame: Boolean, reply: JavaScriptReplyProxy) {
        val data = message.data
        val origin = sourceOrigin.toString()
        worker.execute {
            val out = handle(data, origin, isMainFrame, reply) ?: return@execute
            main.post { try { reply.postMessage(out) } catch (_: Exception) {} }
        }
    }

    /** Wires the bridge into [webView]. Returns false (bridge absent) on WebViews without WEB_MESSAGE_LISTENER. */
    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val rules = setOf(BridgeSecurity.originRule(BuildConfig.BASE_URL))
        WebViewCompat.addWebMessageListener(webView, NAME, rules) { _, message, sourceOrigin, isMainFrame, reply ->
            onMessage(message, sourceOrigin, isMainFrame, reply)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, BridgeSecurity.shimJs(), rules)
        }
        installed = true
        return true
    }

    @Volatile var installed = false
        private set

    fun version(): String = guarded { JSONObject().put("ok", true).put("version", BuildConfig.VERSION_NAME).put("platform", "android").toString() }
    fun openApp(name: String): String = guarded { onUi { tools.openApp(name) } }
    fun dial(number: String): String = guarded { onUi { tools.dial(number) } }
    fun composeSms(number: String, text: String): String = guarded { onUi { tools.composeSms(number, text) } }
    fun setAlarm(hour: Int, minute: Int, label: String?): String = guarded { onUi { tools.setAlarm(hour, minute, label) } }
    fun setTimer(seconds: Int, label: String?): String = guarded { onUi { tools.setTimer(seconds, label) } }
    fun flashlight(on: Boolean): String = guarded { tools.flashlight(on) }
    fun openUrl(url: String): String = guarded { onUi { tools.openUrl(url) } }
    fun navigate(place: String): String = guarded { onUi { tools.navigate(place) } }
    fun share(text: String): String = guarded { onUi { tools.share(text) } }
    fun battery(): String = guarded { tools.battery() }

    /** Camera photo / screenshot the native side wants attached in the composer (once). */
    fun takePendingImage(): String = guarded { PendingImage.take() }

    fun speak(text: String): String = guarded {
        Tts.speak(activity, text)
        JSONObject().put("ok", true).toString()
    }

    fun listen(callbackName: String?): String = guarded {
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
        val r = listenReply ?: return
        val msg = JSONObject().put("event", "target-listen").put("callback", cb).put("detail", payload).toString()
        main.post { try { r.postMessage(msg) } catch (_: Exception) {} }
    }

    fun destroy() { listener?.destroy(); worker.shutdown() }

    companion object {
        const val NAME = "TargetAndroid"
        fun isOwnOrigin(url: String?): Boolean = BridgeSecurity.sameOrigin(url, BuildConfig.BASE_URL)
    }
}
