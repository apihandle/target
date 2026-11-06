package app.target.assistant.web

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * URL shaping for the Google sign-in handoff between the Custom Tab and the WebView.
 * Pure string functions (java.net only, no android.net.Uri) so JVM unit tests can cover them.
 *
 * Flow: the WebView's /auth/google link is rewritten by [googleTabUrl] and opened in a Custom
 * Tab; after the server callback, Chrome is redirected to /auth/app-return?code=… (an App
 * Link); [handoffUrl] turns that deep link into the /auth/app-handoff URL the WebView loads to
 * claim the parked Supabase session.
 */
object AppLinks {
    const val GOOGLE_PATH = "/auth/google"
    const val APP_RETURN_PATH = "/auth/app-return"
    const val APP_HANDOFF_PATH = "/auth/app-handoff"

    /** The /auth/app-return deep link → the WebView URL that claims the parked session. Null when not an app-return link or it carries no code. */
    fun handoffUrl(data: String?, baseUrl: String): String? {
        if (data.isNullOrBlank()) return null
        val uri = try { URI(data) } catch (_: Exception) { return null }
        if (uri.path != APP_RETURN_PATH) return null
        val code = queryParams(uri.rawQuery)["code"]?.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
        return baseUrl.trimEnd('/') + APP_HANDOFF_PATH + "?code=" + URLEncoder.encode(code, "UTF-8")
    }

    /** Force the app variant of the sign-in start URL: app=1 (the callback hands the session back to the app); next defaults to /app when the page didn't set one. */
    fun googleTabUrl(url: String): String {
        val uri = try { URI(url) } catch (_: Exception) { return url }
        val params = queryParams(uri.rawQuery)
        params.remove("app")
        if (params["next"].isNullOrEmpty()) params["next"] = listOf("/app")
        params["app"] = listOf("1")
        val q = params.entries.joinToString("&") { (k, vs) ->
            vs.joinToString("&") { v -> "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}" }
        }
        // Build the string by hand: the multi-arg URI constructor would re-encode the % in the
        // already-encoded query values (next=%2Fapp would become next=%252Fapp).
        return "${uri.scheme}://${uri.authority}${uri.path}?$q"
    }

    private fun queryParams(rawQuery: String?): LinkedHashMap<String, List<String>> {
        val out = LinkedHashMap<String, List<String>>()
        if (rawQuery.isNullOrBlank()) return out
        for (pair in rawQuery.split("&")) {
            if (pair.isEmpty()) continue
            val k = URLDecoder.decode(pair.substringBefore("="), "UTF-8")
            val v = URLDecoder.decode(pair.substringAfter("=", ""), "UTF-8")
            out[k] = (out[k] ?: emptyList()) + v
        }
        return out
    }
}
