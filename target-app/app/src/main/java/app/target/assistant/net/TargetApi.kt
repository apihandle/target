package app.target.assistant.net

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import app.target.assistant.BuildConfig
import app.target.assistant.R
import app.target.assistant.brain.SpeechText
import app.target.assistant.settings.Prefs
import app.target.assistant.util.Notify
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to TARGET's own chat API with the login the WebView already has (the Supabase session
 * cookies for BASE_URL). POST /api/chat {message, conversationId?} streams the reply as plain text and
 * returns the chat id in X-Conversation-Id. No token is stored in the app.
 */
object TargetApi {

    sealed class Result {
        data class Ok(val text: String, val conversationId: String?) : Result()
        object NotSignedIn : Result()
        object Offline : Result()
        data class Failed(val status: Int, val message: String) : Result()
    }

    fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** Cookie header for BASE_URL. Call on the main thread. */
    fun cookie(): String? = try {
        CookieManager.getInstance().getCookie(BuildConfig.BASE_URL)
    } catch (_: Exception) { null }

    /** True when the WebView holds a Supabase session cookie (the user signed in once). */
    fun looksSignedIn(cookie: String?): Boolean = cookie?.contains(Regex("sb-[^=;]*-auth-token")) == true

    /** Blocking: run on a background thread. [onCookies] gets Set-Cookie lines to store back (refreshed session). */
    fun ask(cookie: String?, message: String, conversationId: String?, onCookies: (List<String>) -> Unit): Result {
        if (!looksSignedIn(cookie)) return Result.NotSignedIn
        val url = URL(BuildConfig.BASE_URL.trimEnd('/') + "/api/chat")
        val conn = url.openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 120_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "text/plain")
            conn.setRequestProperty("Cookie", cookie)
            conn.setRequestProperty("Origin", BuildConfig.BASE_URL.trimEnd('/'))
            conn.setRequestProperty("User-Agent", "TargetAndroid/" + BuildConfig.VERSION_NAME)
            val body = JSONObject().put("message", message.take(7900))
            if (conversationId != null) body.put("conversationId", conversationId)
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = conn.responseCode
            conn.headerFields["Set-Cookie"]?.let { if (it.isNotEmpty()) onCookies(it) }
            when {
                status == 401 -> Result.NotSignedIn
                status !in 200..299 -> {
                    val err = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                    Result.Failed(status, runCatching { JSONObject(err).optString("error") }.getOrDefault("").ifBlank { "HTTP $status" })
                }
                else -> {
                    val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    Result.Ok(text, conn.getHeaderField("X-Conversation-Id"))
                }
            }
        } catch (_: IOException) {
            Result.Offline
        } catch (e: Exception) {
            Result.Failed(0, e.message ?: "error")
        } finally {
            conn.disconnect()
        }
    }

    /** Store refreshed session cookies back into the WebView jar. Call on the main thread. */
    fun storeCookies(lines: List<String>) {
        val cm = CookieManager.getInstance()
        lines.forEach { cm.setCookie(BuildConfig.BASE_URL, it) }
        cm.flush()
    }

    /**
     * Ask on a background thread and get the result on the main thread. Persona prefix and the
     * recent chat id are applied here.
     */
    fun askAsync(context: Context, question: String, done: (Result) -> Unit) {
        val app = context.applicationContext
        val prefs = Prefs(app)
        val main = Handler(Looper.getMainLooper())
        val cookie = cookie()
        val message = prefs.persona.prefix(prefs.assistantName) + question
        val conv = prefs.recentConversation()
        Thread {
            val r = ask(cookie, message, conv) { lines -> main.post { storeCookies(lines) } }
            if (r is Result.Ok) prefs.setConversation(r.conversationId ?: conv)
            main.post { done(r) }
        }.start()
    }

    fun spoken(r: Result.Ok): String = SpeechText.clean(r.text)
}

/** Commands that need TARGET, said while offline. Sent when the network is back (JobScheduler, network constraint). */
object OfflineQueue {
    private const val JOB_ID = 4242

    fun add(context: Context, text: String) {
        val p = Prefs(context)
        p.offlineQueue = p.offlineQueue + text
        schedule(context)
    }

    fun schedule(context: Context) {
        val js = context.getSystemService(JobScheduler::class.java) ?: return
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, QueueJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(false)
            .build()
        js.schedule(job)
    }
}

class QueueJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        val prefs = Prefs(this)
        val items = prefs.offlineQueue
        if (items.isEmpty()) return false
        val cookie = TargetApi.cookie()
        val main = Handler(Looper.getMainLooper())
        val persona = prefs.persona.prefix(prefs.assistantName)
        Thread {
            var retry = false
            val left = ArrayList<String>()
            items.forEachIndexed { i, q ->
                if (retry) { left += q; return@forEachIndexed }
                when (val r = TargetApi.ask(cookie, persona + q, null) { lines -> main.post { TargetApi.storeCookies(lines) } }) {
                    is TargetApi.Result.Ok -> Notify.answer(this, Notify.ID_QUEUE + i + 1, q, TargetApi.spoken(r), r.conversationId)
                    TargetApi.Result.Offline -> { retry = true; left += q }
                    TargetApi.Result.NotSignedIn -> Notify.simple(this, Notify.ID_QUEUE + i + 1, q.take(60), getString(R.string.queue_sign_in))
                    is TargetApi.Result.Failed -> Notify.simple(this, Notify.ID_QUEUE + i + 1, q.take(60), getString(R.string.queue_failed, r.message))
                }
            }
            prefs.offlineQueue = left
            jobFinished(params, retry)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
