package app.target.assistant.util

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import app.target.assistant.MainActivity
import app.target.assistant.R
import app.target.assistant.brain.CommandRunner

/** Notification channels and the few notifications the app posts. */
object Notify {
    const val CH_GENERAL = "target_general"
    const val ID_QUEUE = 7003

    fun channels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_GENERAL, context.getString(R.string.channel_general), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun openApp(context: Context, url: String?, code: Int): PendingIntent {
        val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (url != null) i.putExtra(MainActivity.EXTRA_URL, url)
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun post(context: Context, id: Int, n: Notification) {
        channels(context)
        try {
            context.getSystemService(NotificationManager::class.java)?.notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    fun reminder(context: Context, id: Int, text: String) {
        post(
            context, id,
            Notification.Builder(context, CH_GENERAL)
                .setSmallIcon(R.drawable.ic_tile)
                .setContentTitle(context.getString(R.string.reminder_title))
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(openApp(context, null, id))
                .build(),
        )
    }

    /** An answer TARGET gave for a command queued while offline. */
    fun answer(context: Context, id: Int, question: String, answer: String, conversationId: String?) {
        val url = conversationId?.let { CommandRunner.webUrlForChat(it) }
        post(
            context, id,
            Notification.Builder(context, CH_GENERAL)
                .setSmallIcon(R.drawable.ic_tile)
                .setContentTitle(question.take(60))
                .setContentText(answer.take(120))
                .setStyle(Notification.BigTextStyle().bigText(answer.take(1500)))
                .setAutoCancel(true)
                .setContentIntent(openApp(context, url, id))
                .build(),
        )
    }

    fun simple(context: Context, id: Int, title: String, text: String, tap: PendingIntent? = null) {
        val b = Notification.Builder(context, CH_GENERAL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
        b.setContentIntent(tap ?: openApp(context, null, id))
        post(context, id, b.build())
    }

    fun cancel(context: Context, id: Int) {
        context.getSystemService(NotificationManager::class.java)?.cancel(id)
    }
}
