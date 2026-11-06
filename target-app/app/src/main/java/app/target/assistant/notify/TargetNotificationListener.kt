package app.target.assistant.notify

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import app.target.assistant.settings.Prefs

/** One notification as TARGET reads it. */
data class NotifItem(
    val key: String,
    val pkg: String,
    val app: String,
    val title: String,
    val text: String,
    val postTime: Long,
    val reply: Notification.Action?,
)

/**
 * Opt-in notification access: read notifications aloud on request, reply through the app's own
 * reply box (RemoteInput) after the user confirms, dismiss, and the optional "busy" auto-reply.
 */
class TargetNotificationListener : NotificationListenerService() {

    companion object {
        @Volatile var instance: TargetNotificationListener? = null
            private set

        fun isOn() = instance != null

        /** pkg|title → last auto-reply time, so one chat gets at most one auto-reply in 30 minutes. */
        private val lastAutoReply = HashMap<String, Long>()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    private fun label(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) { pkg }

    private fun toItem(sbn: StatusBarNotification): NotifItem? {
        val n = sbn.notification ?: return null
        if (sbn.packageName == packageName) return null
        if (sbn.isOngoing || n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
        val ex = n.extras ?: return null
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return null
        val reply = n.actions?.firstOrNull { a -> a.remoteInputs?.isNotEmpty() == true }
        return NotifItem(sbn.key, sbn.packageName, label(sbn.packageName), title, text, sbn.postTime, reply)
    }

    /** Current notifications, newest first. */
    fun items(): List<NotifItem> = try {
        activeNotifications.orEmpty().mapNotNull { toItem(it) }.sortedByDescending { it.postTime }
    } catch (_: Exception) { emptyList() }

    /** Fills the app's reply box with [text] and sends it. */
    fun reply(item: NotifItem, text: String): Boolean {
        val action = item.reply ?: return false
        val inputs = action.remoteInputs ?: return false
        return try {
            val intent = Intent()
            val results = Bundle()
            inputs.forEach { results.putCharSequence(it.resultKey, text) }
            RemoteInput.addResultsToIntent(inputs, intent, results)
            action.actionIntent.send(this, 0, intent)
            true
        } catch (_: Exception) { false }
    }

    fun dismiss(key: String) = try { cancelNotification(key) } catch (_: Exception) {}

    fun dismissAll() = try { cancelAllNotifications() } catch (_: Exception) {}

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val s = sbn ?: return
        val prefs = Prefs(this)
        if (!prefs.autoReply || prefs.autoReplyMessage.isBlank()) return
        if (s.packageName !in prefs.autoReplyApps) return
        val n = s.notification ?: return
        // Only messages: a reply box, and not a "you sent" update or a group summary.
        if (n.category != null && n.category != Notification.CATEGORY_MESSAGE) return
        val item = toItem(s) ?: return
        if (item.reply == null || item.title.isBlank()) return
        val key = s.packageName + "|" + item.title
        val now = System.currentTimeMillis()
        synchronized(lastAutoReply) {
            if (now - (lastAutoReply[key] ?: 0L) < 30 * 60_000L) return
            lastAutoReply[key] = now
        }
        if (reply(item, prefs.autoReplyMessage)) {
            prefs.addAutoReplyLog(Prefs.SentLog(now, item.app, item.title, prefs.autoReplyMessage))
        }
    }
}
