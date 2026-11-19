package app.target.assistant.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import app.target.assistant.R
import java.io.File

/**
 * Installs a verified APK through a PackageInstaller session. On Android 12+ the session asks for
 * USER_ACTION_NOT_REQUIRED, so self-updates go through silently once TARGET is the installer of record.
 * Otherwise (Android 8–11, or the first update after a manual/browser install) the system answers
 * STATUS_PENDING_USER_ACTION and [InstallResultReceiver] opens the confirm screen.
 */
object UpdateInstaller {

    private const val TAG = "TargetUpdate"
    const val ACTION_INSTALL_RESULT = "app.target.assistant.update.INSTALL_RESULT"

    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            session.openWrite("target.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, 64 * 1024) }
                session.fsync(out)
            }
            val intent = Intent(context, InstallResultReceiver::class.java).setAction(ACTION_INSTALL_RESULT)
            // The installer adds status extras to this intent, so it must be mutable on Android 12+ (explicit intent).
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val pending = PendingIntent.getBroadcast(context, sessionId, intent, flags)
            session.commit(pending.intentSender)
            session.close()
        } catch (e: Exception) {
            Log.w(TAG, "install session failed", e)
            session.abandon()
            throw e
        }
    }
}

/** Receives the PackageInstaller result: opens the confirm screen when the system needs the user. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                UpdatePrefs.setStatus(context, context.getString(R.string.update_confirm))
                UpdatePrefs.setNeedsConfirm(context, true)
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    // May be blocked while TARGET is in the background (Android 10+): then the next
                    // app launch repeats the install from the foreground and the confirm screen shows.
                    try { context.startActivity(confirm) } catch (e: Exception) { Log.w("TargetUpdate", "confirm launch blocked", e) }
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                UpdatePrefs.setNeedsConfirm(context, false)
                UpdatePrefs.setStatus(context, context.getString(R.string.update_installed))
            }
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status"
                UpdatePrefs.setNeedsConfirm(context, false)
                UpdatePrefs.setStatus(context, context.getString(R.string.update_failed, msg))
            }
        }
    }
}
