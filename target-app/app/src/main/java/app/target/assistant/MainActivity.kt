package app.target.assistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import app.target.assistant.brain.CommandRunner
import app.target.assistant.ui.TargetTheme
import app.target.assistant.ui.WelcomeSplash
import app.target.assistant.ui.WelcomeTiming
import app.target.assistant.web.PendingImage
import app.target.assistant.web.TargetBridge
import kotlinx.coroutines.delay

/**
 * The app shell: the signed-in TARGET web app in a WebView, plus the native `TargetAndroid` bridge.
 * Google sign-in runs entirely in a Custom Tab (Google blocks sign-in inside embedded WebViews):
 * /auth/google is intercepted before the WebView can load it, and after the callback the server
 * redirects Chrome to the /auth/app-return App Link, which reopens this activity; the one-time
 * code in that link is then claimed inside the WebView via /auth/app-handoff, so the session
 * cookies land in the WebView (a session created in Chrome would never reach it).
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val EXTRA_URL = "app.target.assistant.URL"
        private val GOOGLE_AUTH_HOSTS = setOf("accounts.google.com", "accounts.youtube.com", "oauth2.googleapis.com")
        private const val GOOGLE_PATH = "/auth/google"
    }

    internal lateinit var webView: WebView
        private set
    internal lateinit var bridge: TargetBridge
        private set
    /** Last page that finished loading (tests). */
    @Volatile internal var lastFinishedUrl: String? = null
        private set
    /** True once the first page of this activity instance has finished loading (welcome timing). */
    private val firstPageReady = mutableStateOf(false)
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
        fileCallback = null
    }

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingWebPermission?.let { req ->
            if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
        }
        pendingWebPermission = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        webView = WebView(this)
        bridge = TargetBridge(this, webView)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString TargetAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        // window.TargetAndroid: top frame on BASE_URL only (WebMessageListener with an origin rule), see TargetBridge.
        bridge.install()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                if (request.isForMainFrame) handleNavigation(request.url) else false

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                bridge.currentUrl = url
                bridge.injectShimIfNeeded(view, url)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                bridge.currentUrl = url
            }

            override fun onPageFinished(view: WebView, url: String?) {
                bridge.currentUrl = url
                bridge.injectShimIfNeeded(view, url)
                lastFinishedUrl = url
                if (!firstPageReady.value) firstPageReady.value = true
                CookieManager.getInstance().flush()
                // A camera photo / screenshot waiting to be attached ("camera se dekho", "screen dekho screenshot ke saath").
                if (PendingImage.has() && TargetBridge.isOwnOrigin(url) && url?.contains(BuildConfig.APP_PATH) == true) {
                    view.evaluateJavascript(PendingImage.INJECT_JS, null)
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                if (!wantsMic || !TargetBridge.isOwnOrigin(request.origin.toString())) {
                    request.deny(); return
                }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingWebPermission = request
                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(startUrl(intent))

        // Self-update: check now + every ~6 h (WorkManager, network required), unless turned off in Settings.
        if (savedInstanceState == null) app.target.assistant.update.UpdateScheduler.onAppLaunch(this)

        // The welcome artwork shows on a cold start only — never on a recreate (rotation,
        // process restore), where the user was already inside the app.
        val coldStart = savedInstanceState == null

        setContent {
            TargetTheme {
                Box(Modifier.fillMaxSize()) {
                    AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize().safeDrawingPadding())
                    SmallFloatingActionButton(
                        onClick = { startActivity(Intent(this@MainActivity, AssistActivity::class.java)) },
                        modifier = Modifier.align(Alignment.BottomStart).safeDrawingPadding().padding(start = 12.dp, bottom = 88.dp),
                    ) { Text("🎤") }
                    if (coldStart) {
                        var welcomeVisible by remember { mutableStateOf(true) }
                        LaunchedEffect(Unit) {
                            val shownAt = System.currentTimeMillis()
                            while (!WelcomeTiming.shouldDismiss(System.currentTimeMillis() - shownAt, firstPageReady.value)) {
                                delay(100)
                            }
                            welcomeVisible = false
                        }
                        AnimatedVisibility(visible = welcomeVisible, exit = fadeOut(tween(450))) {
                            WelcomeSplash()
                        }
                    }
                }
            }
        }
    }

    /** Which URL to open: an explicit extra, an https deep link to our host, or the app home. */
    private fun startUrl(intent: Intent?): String {
        intent?.getStringExtra(EXTRA_URL)?.takeIf { TargetBridge.isOwnOrigin(it) }?.let { return it }
        // The Google sign-in App Link carries a one-time code: claim the session in the WebView.
        intent?.data?.toString()?.let { app.target.assistant.web.AppLinks.handoffUrl(it, BuildConfig.BASE_URL) }?.let { return it }
        intent?.data?.toString()?.takeIf { TargetBridge.isOwnOrigin(it) }?.let { return it }
        intent?.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }?.let { return CommandRunner.webUrlFor(it) }
        return CommandRunner.webUrlFor(null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.hasExtra(EXTRA_URL) || intent.data != null || intent.hasExtra(Intent.EXTRA_TEXT)) webView.loadUrl(startUrl(intent))
    }

    /** true = we handled it outside the WebView. */
    private fun handleNavigation(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase().orEmpty()
        if (scheme == "http" || scheme == "https") {
            // Google sign-in must start in the Custom Tab, not the WebView: if the WebView loaded
            // /auth/google, its login cookie would live here while the callback runs in Chrome.
            if (TargetBridge.isOwnOrigin(uri.toString()) && uri.path == GOOGLE_PATH) {
                openCustomTab(Uri.parse(app.target.assistant.web.AppLinks.googleTabUrl(uri.toString()))); return true
            }
            if (TargetBridge.isOwnOrigin(uri.toString())) return false
            // Supabase auth endpoints stay inside so the session cookie lands in the WebView.
            if (host.endsWith(".supabase.co")) return false
            if (host in GOOGLE_AUTH_HOSTS || host.endsWith(".google.com") && uri.path.orEmpty().contains("oauth")) {
                openCustomTab(uri); return true
            }
            openCustomTab(uri); return true
        }
        // tel:, mailto:, intent:, whatsapp: … → hand to the system.
        return try {
            val i = if (scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
            } else Intent(Intent.ACTION_VIEW, uri)
            startActivity(i); true
        } catch (_: Exception) {
            true
        }
    }

    private fun openCustomTab(uri: Uri) {
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri)
        } catch (_: ActivityNotFoundException) {
            try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) {}
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        app.target.assistant.util.AppLockGate.onResume(this)
    }

    override fun onPause() {
        super.onPause()
        app.target.assistant.util.AppLockGate.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        bridge.destroy()
        webView.destroy()
        super.onDestroy()
    }
}

