package app.target.assistant.web

import java.net.URI

/**
 * Who may talk to `window.TargetAndroid`: only the TOP frame of a page on the exact BASE_URL origin
 * (scheme + host + port) AND on a bridge path ([isBridgeAllowedPath]: the signed-in /app workspace,
 * plus /auth/app-handoff which claims the parked login session). Origin alone is not enough: the
 * public pages on the same origin (/, /p, /share, ...) must never reach the bridge (fix #6 — that is
 * what made third-party scripts running on those pages dangerous). Iframes, other sites, http
 * downgrades and look-alike hosts are refused.
 * Pure Kotlin (java.net.URI) so it is unit-tested on the JVM.
 */
object BridgeSecurity {

    /** "https://gettarget.vercel.app/app?q=1" → "https://gettarget.vercel.app" (the WebViewCompat origin rule). */
    fun originRule(baseUrl: String): String {
        val u = URI(baseUrl.trim())
        val scheme = u.scheme?.lowercase() ?: error("BASE_URL has no scheme")
        val host = u.host?.lowercase() ?: error("BASE_URL has no host")
        val port = if (u.port == -1 || u.port == defaultPort(scheme)) "" else ":${u.port}"
        return "$scheme://$host$port"
    }

    private fun defaultPort(scheme: String) = when (scheme) { "https" -> 443; "http" -> 80; else -> -1 }

    /** Same origin as [baseUrl]? Accepts a full URL or a bare origin ("https://host[:port]"). */
    fun sameOrigin(urlOrOrigin: String?, baseUrl: String): Boolean {
        if (urlOrOrigin.isNullOrBlank()) return false
        return try {
            val u = URI(urlOrOrigin.trim())
            if (u.host == null || u.userInfo != null) return false
            originRule(urlOrOrigin) == originRule(baseUrl)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Paths where the bridge may live: exactly the /app workspace (APP_PATH) and the one login
     * hand-off page that sets the session inside the WebView. Everything else on the origin
     * (/, /p, /share, /login, other /auth pages, ...) is refused. Accepts a full URL or a bare
     * path; query and fragment are ignored. Segment-exact: "/application" and "/app-evil" do
     * NOT match, and an encoded or dot-segment path is taken literally (URI.rawPath), so
     * "/app%2f.." style tricks do not sneak in (the WebView normalises the real URL anyway,
     * and sameOrigin has already pinned scheme/host/port before this is consulted).
     */
    fun isBridgeAllowedPath(urlOrPath: String?): Boolean {
        if (urlOrPath.isNullOrBlank()) return false
        val path = try { URI(urlOrPath.trim()).rawPath } catch (_: Exception) { null } ?: return false
        return path == "/app" || path.startsWith("/app/") || path == "/auth/app-handoff"
    }

    /** The rule every bridge message must pass. */
    fun allowed(sourceOrigin: String?, isMainFrame: Boolean, currentTopUrl: String?, baseUrl: String): Boolean =
        isMainFrame && sameOrigin(sourceOrigin, baseUrl) && sameOrigin(currentTopUrl, baseUrl) &&
            isBridgeAllowedPath(currentTopUrl)

    /** One call from the page: {"id": 7, "method": "battery", "args": [..]}. */
    data class Call(val id: Long, val method: String, val args: List<Any?>)

    val METHODS = setOf(
        "version", "openApp", "dial", "composeSms", "setAlarm", "setTimer", "flashlight", "openUrl",
        "navigate", "share", "battery", "takePendingImage", "speak", "listen",
    )

    /** JS that runs at document start in allowed pages: promise wrappers over the message channel. */
    const val SHIM_JS = """
(function(){
  if (window.top !== window) return;
  if (!/^\/app(\/|$)/.test(location.pathname) && location.pathname !== '/auth/app-handoff') return;
  var ch = window.TargetAndroid;
  if (!ch || typeof ch.postMessage !== 'function' || ch.__target) return;
  var seq = 0, waiting = {};
  ch.onmessage = function(ev){
    var m; try { m = JSON.parse(ev.data); } catch(e) { return; }
    if (m && m.event) {
      if (m.event === 'target-listen') {
        try { var f = window[m.callback || 'onTargetListen']; if (typeof f === 'function') f(m.detail); } catch(e) {}
      }
      window.dispatchEvent(new CustomEvent(m.event, { detail: m.detail }));
      return;
    }
    var w = m && waiting[m.id]; if (!w) return;
    delete waiting[m.id]; w(m.result);
  };
  function call(method){
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function(resolve){
      var id = ++seq; waiting[id] = resolve;
      ch.postMessage(JSON.stringify({ id: id, method: method, args: args }));
      setTimeout(function(){ if (waiting[id]) { delete waiting[id]; resolve({ ok: false, error: 'timeout' }); } }, 15000);
    });
  }
  var names = %METHODS%;
  var api = { call: call, platform: 'android' };
  names.forEach(function(n){ api[n] = function(){ return call.apply(null, [n].concat(Array.prototype.slice.call(arguments))); }; });
  try { names.forEach(function(n){ ch[n] = api[n]; }); ch.call = call; ch.__target = true; } catch(e) {}
  window.TargetDevice = api;
  window.dispatchEvent(new Event('target-android-ready'));
})();
"""

    fun shimJs(): String = SHIM_JS.replace("%METHODS%", METHODS.sorted().joinToString(",", "[", "]") { "'$it'" })
}
