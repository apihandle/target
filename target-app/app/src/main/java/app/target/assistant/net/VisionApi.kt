package app.target.assistant.net

import app.target.assistant.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * "Camera se dekho" without the WebView: upload the photo to the user's own Supabase storage folder with the
 * session the WebView already holds (same as the web app's composer), register it with /api/attachments,
 * then ask /api/chat with the question + attachment id. Needs the PUBLIC Supabase anon key at build time
 * (-PsupabaseAnonKey=…, it is the same key every visitor's browser gets); without it [configured] is false
 * and the photo goes through the WebView composer instead.
 */
object VisionApi {
    sealed class Outcome {
        data class Answer(val result: TargetApi.Result) : Outcome()
        /** Native path not possible (no key, no session, upload refused): use the WebView composer. */
        data class Fallback(val why: String) : Outcome()
    }

    val configured: Boolean get() = BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    /** Blocking: run on a background thread. */
    fun ask(cookie: String?, jpeg: ByteArray, question: String, onCookies: (List<String>) -> Unit): Outcome {
        if (!configured) return Outcome.Fallback("no anon key")
        val s = SupabaseSession.parse(cookie) ?: return Outcome.Fallback("no session")
        val supabaseUrl = BuildConfig.SUPABASE_URL.ifBlank { s.supabaseUrl }.trimEnd('/')
        val path = SupabaseSession.storagePath(s.userId, UUID.randomUUID().toString(), "camera.jpg")
        return try {
            // 1) storage upload (RLS: only the user's own folder)
            val up = URL("$supabaseUrl/storage/v1/object/chat-attachments/$path").openConnection() as HttpURLConnection
            up.requestMethod = "POST"; up.doOutput = true; up.connectTimeout = 15_000; up.readTimeout = 60_000
            up.setRequestProperty("Authorization", "Bearer ${s.accessToken}")
            up.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            up.setRequestProperty("Content-Type", "image/jpeg")
            up.setRequestProperty("x-upsert", "false")
            up.outputStream.use { it.write(jpeg) }
            val upCode = up.responseCode
            up.disconnect()
            if (upCode !in 200..299) return Outcome.Fallback("storage HTTP $upCode")
            // 2) register with TARGET
            val reg = URL(BuildConfig.BASE_URL.trimEnd('/') + "/api/attachments").openConnection() as HttpURLConnection
            reg.requestMethod = "POST"; reg.doOutput = true; reg.connectTimeout = 15_000; reg.readTimeout = 30_000
            reg.setRequestProperty("Content-Type", "application/json")
            reg.setRequestProperty("Cookie", cookie)
            reg.setRequestProperty("Origin", BuildConfig.BASE_URL.trimEnd('/'))
            reg.outputStream.use { it.write(JSONObject().put("path", path).put("name", "camera.jpg").toString().toByteArray()) }
            val regCode = reg.responseCode
            reg.headerFields["Set-Cookie"]?.let { if (it.isNotEmpty()) onCookies(it) }
            if (regCode !in 200..299) { reg.disconnect(); return Outcome.Fallback("attachments HTTP $regCode") }
            val id = JSONObject(reg.inputStream.bufferedReader().use { it.readText() }).getJSONObject("attachment").getString("id")
            reg.disconnect()
            // 3) ask
            Outcome.Answer(TargetApi.ask(cookie, question, null, listOf(id), onCookies))
        } catch (e: Exception) {
            Outcome.Fallback(e.message ?: "error")
        }
    }
}
