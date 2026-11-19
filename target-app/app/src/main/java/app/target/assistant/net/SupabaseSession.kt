package app.target.assistant.net

import org.json.JSONObject
import java.net.URLDecoder
import java.util.Base64

/**
 * Reads the Supabase session the TARGET web app keeps in its cookies (@supabase/ssr format):
 * `sb-<project ref>-auth-token` (or chunks `.0`, `.1`, …) holding JSON, raw/URL-encoded or "base64-" + base64url.
 * Only used on the phone to upload a camera photo the same way the web app does. Nothing is stored.
 */
object SupabaseSession {
    data class Session(val projectRef: String, val accessToken: String, val userId: String) {
        val supabaseUrl get() = "https://$projectRef.supabase.co"
    }

    private val NAME = Regex("^sb-([a-z0-9]+)-auth-token(?:\\.(\\d+))?$")

    fun parse(cookieHeader: String?): Session? {
        if (cookieHeader.isNullOrBlank()) return null
        val parts = HashMap<String, MutableMap<Int, String>>()
        cookieHeader.split(";").forEach { c ->
            val i = c.indexOf('=')
            if (i <= 0) return@forEach
            val m = NAME.matchEntire(c.substring(0, i).trim()) ?: return@forEach
            parts.getOrPut(m.groupValues[1]) { sortedMapOf() }[m.groupValues[2].toIntOrNull() ?: -1] = c.substring(i + 1).trim()
        }
        for ((ref, chunks) in parts) {
            val raw = chunks[-1] ?: chunks.filterKeys { it >= 0 }.values.joinToString("")
            val s = decode(raw) ?: continue
            return Session(ref, s.first, s.second)
        }
        return null
    }

    /** → (access token, user id) */
    internal fun decode(value: String): Pair<String, String>? = try {
        var v = value
        if (v.startsWith("\"") && v.endsWith("\"")) v = v.substring(1, v.length - 1)
        val json = if (v.startsWith("base64-")) {
            String(Base64.getUrlDecoder().decode(v.removePrefix("base64-").trimEnd('=')), Charsets.UTF_8)
        } else URLDecoder.decode(v, "UTF-8")
        val trimmed = json.trim()
        // Old format: ["access", "refresh", …]
        val token: String
        var userId: String? = null
        if (trimmed.startsWith("[")) {
            token = org.json.JSONArray(trimmed).getString(0)
        } else {
            val o = JSONObject(trimmed)
            token = o.getString("access_token")
            userId = o.optJSONObject("user")?.optString("id")?.takeIf { it.isNotBlank() }
        }
        val uid = userId ?: jwtSub(token)
        if (token.isBlank() || uid.isNullOrBlank()) null else token to uid
    } catch (_: Exception) {
        null
    }

    internal fun jwtSub(jwt: String): String? = try {
        val payload = jwt.split(".")[1]
        JSONObject(String(Base64.getUrlDecoder().decode(payload.trimEnd('=')), Charsets.UTF_8)).optString("sub").takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }

    /** Storage path the web app's /api/attachments accepts: <user id>/<uuid>/<name>. */
    fun storagePath(userId: String, uuid: String, name: String): String =
        "$userId/$uuid/" + name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120).ifBlank { "photo.jpg" }
}
