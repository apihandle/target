package app.target.assistant.access

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import app.target.assistant.brain.Direction
import app.target.assistant.brain.GlobalAction

/**
 * Opt-in screen helper. It does nothing on its own: it reads the screen or taps/types/scrolls only
 * when the user asks TARGET to (and WhatsApp send/call taps only after the user said "haan").
 */
class TargetAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: TargetAccessibilityService? = null
            private set

        fun isOn(): Boolean = instance != null
    }

    private val main = Handler(Looper.getMainLooper())

    /** A one-shot job waiting for a window of [pkg] (e.g. "tap Send in WhatsApp"). */
    private class Job(val pkg: String, val deadline: Long, val step: (AccessibilityNodeInfo) -> Boolean, val onDone: (Boolean) -> Unit)
    private var job: Job? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val j = job ?: return
        if (event?.packageName?.toString() == j.pkg) tryJob()
    }

    override fun onInterrupt() {}

    private fun tryJob() {
        val j = job ?: return
        if (System.currentTimeMillis() > j.deadline) {
            job = null; j.onDone(false); return
        }
        val root = rootFor(j.pkg) ?: return
        if (j.step(root)) {
            job = null; j.onDone(true)
        }
    }

    /** Runs [step] on the window of [pkg] as soon as it shows (polls too, events can be sparse). */
    fun whenWindow(pkg: String, timeoutMs: Long, step: (AccessibilityNodeInfo) -> Boolean, onDone: (Boolean) -> Unit) {
        job?.onDone?.invoke(false)
        job = Job(pkg, System.currentTimeMillis() + timeoutMs, step, onDone)
        fun poll() {
            if (job == null) return
            tryJob()
            if (job != null) main.postDelayed({ poll() }, 400)
        }
        main.postDelayed({ poll() }, 500)
    }

    private fun rootFor(pkg: String): AccessibilityNodeInfo? {
        rootInActiveWindow?.let { if (it.packageName?.toString() == pkg) return it }
        return try { windows.mapNotNull { it.root }.firstOrNull { it.packageName?.toString() == pkg } } catch (_: Exception) { null }
    }

    // ---- reading ---------------------------------------------------------------------------------

    /** Visible text of the apps on screen (our own overlay is skipped), top to bottom. */
    fun screenText(maxChars: Int = 5000, skipOwn: Boolean = true): String {
        val roots = try {
            windows.sortedByDescending { it.layer }.mapNotNull { it.root }
        } catch (_: Exception) { emptyList() }.ifEmpty { listOfNotNull(rootInActiveWindow) }
        val sb = StringBuilder()
        var last = ""
        for (r in roots) {
            if (skipOwn && r.packageName?.toString() == packageName) continue
            walk(r) { n ->
                if (!n.isVisibleToUser) return@walk
                val t = (n.text?.toString() ?: n.contentDescription?.toString())?.trim().orEmpty()
                if (t.isNotEmpty() && t != last && sb.length < maxChars) {
                    sb.append(t).append('\n'); last = t
                }
            }
        }
        return sb.toString().take(maxChars).trim()
    }

    /** Texts of nodes with the given view id (e.g. WhatsApp message bubbles), in screen order. */
    fun textsById(root: AccessibilityNodeInfo, viewId: String): List<String> =
        root.findAccessibilityNodeInfosByViewId(viewId).mapNotNull { it.text?.toString() }

    private fun walk(n: AccessibilityNodeInfo?, depth: Int = 0, f: (AccessibilityNodeInfo) -> Unit) {
        if (n == null || depth > 60) return
        f(n)
        for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1, f)
    }

    // ---- acting --------------------------------------------------------------------------------

    /** Best node whose text or description matches [label] (exact beats contains). */
    fun find(root: AccessibilityNodeInfo, labels: List<String>): AccessibilityNodeInfo? {
        val wanted = labels.map { it.lowercase().trim() }.filter { it.isNotEmpty() }
        var best: AccessibilityNodeInfo? = null
        var bestScore = 0
        walk(root) { n ->
            if (!n.isVisibleToUser) return@walk
            val t = n.text?.toString()?.lowercase()?.trim().orEmpty()
            val d = n.contentDescription?.toString()?.lowercase()?.trim().orEmpty()
            for (w in wanted) {
                val s = when {
                    t == w || d == w -> 3
                    t.startsWith(w) || d.startsWith(w) -> 2
                    w.length >= 3 && (t.contains(w) || d.contains(w)) -> 1
                    else -> 0
                }
                if (s > bestScore) { bestScore = s; best = n }
            }
        }
        return best
    }

    /** Taps the node (or its nearest clickable parent; else a tap gesture on its centre). */
    fun click(node: AccessibilityNodeInfo): Boolean {
        var n: AccessibilityNodeInfo? = node
        var depth = 0
        while (n != null && depth < 8) {
            if (n.isClickable && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            n = n.parent; depth++
        }
        val r = Rect()
        node.getBoundsInScreen(r)
        if (r.isEmpty) return false
        return tap(r.exactCenterX(), r.exactCenterY())
    }

    fun clickText(label: String, skipOwn: Boolean = true): Boolean {
        val roots = try { windows.mapNotNull { it.root }.filter { !skipOwn || it.packageName?.toString() != packageName } } catch (_: Exception) { emptyList() }
            .ifEmpty { listOfNotNull(rootInActiveWindow) }
        for (r in roots) find(r, listOf(label))?.let { return click(it) }
        return false
    }

    fun typeText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        var target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (target == null || !target.isEditable) {
            var first: AccessibilityNodeInfo? = null
            walk(root) { if (first == null && it.isEditable && it.isVisibleToUser) first = it }
            target = first
        }
        val node = target ?: return false
        val existing = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText) "" else node.text?.toString().orEmpty()
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, if (existing.isBlank()) text else "$existing $text")
        }
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun scroll(down: Boolean): Boolean {
        val root = rootInActiveWindow
        var best: AccessibilityNodeInfo? = null
        var bestArea = 0
        walk(root) { n ->
            if (n.isScrollable && n.isVisibleToUser) {
                val r = Rect(); n.getBoundsInScreen(r)
                val area = r.width() * r.height()
                if (area > bestArea) { bestArea = area; best = n }
            }
        }
        val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        if (best?.performAction(action) == true) return true
        return swipe(if (down) Direction.UP else Direction.DOWN)
    }

    private fun tap(x: Float, y: Float): Boolean {
        val p = Path().apply { moveTo(x, y) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 60)).build(), null, null)
    }

    /** Finger swipe across the screen centre. UP = finger moves up (content scrolls down). */
    fun swipe(direction: Direction): Boolean {
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat()
        val h = dm.heightPixels.toFloat()
        val (x1, y1, x2, y2) = when (direction) {
            Direction.UP -> listOf(w / 2, h * 0.75f, w / 2, h * 0.25f)
            Direction.DOWN -> listOf(w / 2, h * 0.25f, w / 2, h * 0.75f)
            Direction.LEFT -> listOf(w * 0.85f, h / 2, w * 0.15f, h / 2)
            Direction.RIGHT -> listOf(w * 0.15f, h / 2, w * 0.85f, h / 2)
        }
        val p = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 300)).build(), null, null)
    }

    fun global(action: GlobalAction): Boolean {
        val code = when (action) {
            GlobalAction.BACK -> GLOBAL_ACTION_BACK
            GlobalAction.HOME -> GLOBAL_ACTION_HOME
            GlobalAction.RECENTS -> GLOBAL_ACTION_RECENTS
            GlobalAction.NOTIFICATIONS -> GLOBAL_ACTION_NOTIFICATIONS
            GlobalAction.QUICK_SETTINGS -> GLOBAL_ACTION_QUICK_SETTINGS
            GlobalAction.LOCK -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else return false
            GlobalAction.SCREENSHOT -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
        }
        return performGlobalAction(code)
    }

    /** Screenshot as a Bitmap (Android 11+), delivered on the main thread; null if not possible. */
    fun screenshot(done: (Bitmap?) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) { done(null); return }
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    val bmp = try {
                        Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
                    } catch (_: Exception) { null } finally { result.hardwareBuffer.close() }
                    done(bmp)
                }
                override fun onFailure(errorCode: Int) = done(null)
            })
        } catch (_: Exception) {
            done(null)
        }
    }

    // ---- WhatsApp helpers ------------------------------------------------------------------------

    private val SEND_LABELS = listOf("Send", "भेजें", "भेजो")
    private val VOICE_LABELS = listOf("Voice call", "Audio call", "Call", "वॉइस कॉल", "ऑडियो कॉल")
    private val VIDEO_LABELS = listOf("Video call", "वीडियो कॉल")
    private val CONFIRM_CALL = listOf("Call", "CALL", "Start call", "कॉल करें")

    /** Taps WhatsApp's Send button once the chat (opened with the text filled in) is on screen. */
    fun whatsappSend(pkg: String, onDone: (Boolean) -> Unit) = whenWindow(pkg, 12_000, { root ->
        val byId = root.findAccessibilityNodeInfosByViewId("$pkg:id/send").firstOrNull { it.isVisibleToUser }
        val node = byId ?: find(root, SEND_LABELS)?.takeIf { (it.contentDescription ?: "").isNotEmpty() }
        node != null && click(node)
    }, onDone)

    /** Taps the voice/video call icon in an open WhatsApp chat (and the "Call" confirmation if shown). */
    fun whatsappCall(pkg: String, video: Boolean, onDone: (Boolean) -> Unit) = whenWindow(pkg, 12_000, { root ->
        val node = find(root, if (video) VIDEO_LABELS else VOICE_LABELS)
        val ok = node != null && click(node)
        if (ok) main.postDelayed({ rootFor(pkg)?.let { r -> find(r, CONFIRM_CALL)?.let { b -> if (b.isClickable) click(b) } } }, 1200)
        ok
    }, onDone)

    /** Reads the last few message bubbles of the open WhatsApp chat. */
    fun whatsappLastMessages(pkg: String, count: Int, done: (List<String>) -> Unit) {
        var out: List<String> = emptyList()
        whenWindow(pkg, 10_000, { root ->
            val msgs = textsById(root, "$pkg:id/message_text")
            if (msgs.isEmpty()) false else { out = msgs.takeLast(count); true }
        }) { ok ->
            if (ok) done(out) else done(screenText(1500).lines().filter { it.isNotBlank() }.takeLast(count))
        }
    }
}
