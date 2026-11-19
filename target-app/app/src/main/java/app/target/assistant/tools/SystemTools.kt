package app.target.assistant.tools

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.SearchManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import android.view.KeyEvent
import app.target.assistant.brain.MediaAction
import app.target.assistant.brain.MediaApp
import app.target.assistant.brain.Panel
import app.target.assistant.brain.RingerMode
import app.target.assistant.brain.VolumeAction
import app.target.assistant.settings.Prefs
import app.target.assistant.util.Notify
import app.target.assistant.voice.Tts

/** Music / video: search-and-play intents and media keys. */
object Media {
    private const val YT = "com.google.android.youtube"
    private const val YTM = "com.google.android.apps.youtube.music"
    private const val SPOTIFY = "com.spotify.music"

    /** Starts playback of [query]. Returns the app that got the request, or null. */
    fun play(context: Context, query: String, app: MediaApp?): String? {
        fun fromSearch(pkg: String?): Boolean {
            val i = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
                .putExtra(SearchManager.QUERY, query)
                .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
            if (pkg != null) i.setPackage(pkg)
            return context.launch(i)
        }
        fun youtubeSearch(): Boolean =
            context.launch(Intent(Intent.ACTION_SEARCH).setPackage(YT).putExtra(SearchManager.QUERY, query)) ||
                context.launch(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(query))))
        return when (app) {
            MediaApp.YOUTUBE -> if (youtubeSearch()) "YouTube" else null
            MediaApp.YOUTUBE_MUSIC -> if (fromSearch(YTM) || context.launch(Intent(Intent.ACTION_VIEW, Uri.parse("https://music.youtube.com/search?q=" + Uri.encode(query))))) "YouTube Music" else null
            MediaApp.SPOTIFY -> if (fromSearch(SPOTIFY) || context.launch(Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:" + Uri.encode(query))))) "Spotify" else null
            null -> when {
                fromSearch(YTM) -> "YouTube Music"
                fromSearch(SPOTIFY) -> "Spotify"
                fromSearch(null) -> "music app"
                youtubeSearch() -> "YouTube"
                else -> null
            }
        }
    }

    /**
     * Play / pause / next / previous. With notification access on, the active app's MediaSession is driven
     * directly (MediaSessionManager, the player that is actually playing first); otherwise a media key event
     * goes to whichever app owns the media buttons. Returns the controlled app's package, or null for the key path.
     */
    fun key(context: Context, action: MediaAction): String? {
        sessionControl(context, action)?.let { return it }
        val code = when (action) {
            MediaAction.PLAY -> KeyEvent.KEYCODE_MEDIA_PLAY
            MediaAction.PAUSE -> KeyEvent.KEYCODE_MEDIA_PAUSE
            MediaAction.NEXT -> KeyEvent.KEYCODE_MEDIA_NEXT
            MediaAction.PREVIOUS -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
        }
        val am = context.getSystemService(AudioManager::class.java) ?: return null
        val now = SystemClock.uptimeMillis()
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0))
        return null
    }

    private fun sessionControl(context: Context, action: MediaAction): String? = try {
        if (app.target.assistant.notify.TargetNotificationListener.instance == null) null else {
            val msm = context.getSystemService(android.media.session.MediaSessionManager::class.java)
            val sessions = msm?.getActiveSessions(android.content.ComponentName(context, app.target.assistant.notify.TargetNotificationListener::class.java)).orEmpty()
            val c = sessions.firstOrNull { it.playbackState?.state == android.media.session.PlaybackState.STATE_PLAYING } ?: sessions.firstOrNull()
            c?.let {
                val t = it.transportControls
                when (action) {
                    MediaAction.PLAY -> t.play()
                    MediaAction.PAUSE -> t.pause()
                    MediaAction.NEXT -> t.skipToNext()
                    MediaAction.PREVIOUS -> t.skipToPrevious()
                }
                it.packageName
            }
        }
    } catch (_: SecurityException) { null } catch (_: Exception) { null }
}

/** Volume, ringer, DND, brightness, settings panels. */
object SystemControl {

    enum class Result { DONE, NEEDS_ACCESS, PANEL_OPENED, FAILED }

    fun volume(context: Context, action: VolumeAction): Int {
        val am = context.getSystemService(AudioManager::class.java) ?: return -1
        val s = AudioManager.STREAM_MUSIC
        val flags = AudioManager.FLAG_SHOW_UI
        when (action) {
            VolumeAction.UP -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_RAISE, if (it == 1) flags else 0) }
            VolumeAction.DOWN -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_LOWER, if (it == 1) flags else 0) }
            VolumeAction.MUTE -> am.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, flags)
            VolumeAction.UNMUTE -> am.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, flags)
            VolumeAction.MAX -> am.setStreamVolume(s, am.getStreamMaxVolume(s), flags)
        }
        val max = am.getStreamMaxVolume(s).coerceAtLeast(1)
        return am.getStreamVolume(s) * 100 / max
    }

    fun hasDndAccess(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java)?.isNotificationPolicyAccessGranted == true

    fun ringer(context: Context, mode: RingerMode): Result {
        val am = context.getSystemService(AudioManager::class.java) ?: return Result.FAILED
        return try {
            am.ringerMode = when (mode) {
                RingerMode.SILENT -> AudioManager.RINGER_MODE_SILENT
                RingerMode.VIBRATE -> AudioManager.RINGER_MODE_VIBRATE
                RingerMode.NORMAL -> AudioManager.RINGER_MODE_NORMAL
            }
            Result.DONE
        } catch (_: SecurityException) {
            Result.NEEDS_ACCESS
        }
    }

    fun dnd(context: Context, on: Boolean): Result {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return Result.FAILED
        if (!nm.isNotificationPolicyAccessGranted) return Result.NEEDS_ACCESS
        nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
        return Result.DONE
    }

    fun canWriteSettings(context: Context) = Settings.System.canWrite(context)

    /** Sets brightness (percent) or moves it up/down by a quarter. Returns the new percent or -1 without access. */
    fun brightness(context: Context, percent: Int?, up: Boolean?): Int {
        if (!Settings.System.canWrite(context)) return -1
        val cr = context.contentResolver
        return try {
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            val cur = Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, 128)
            val target = when {
                percent != null -> percent * 255 / 100
                up == false -> cur - 64
                else -> cur + 64
            }.coerceIn(5, 255)
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, target)
            target * 100 / 255
        } catch (_: Exception) { -1 }
    }

    /** Android 10+ does not let normal apps flip these switches; we open the right panel/screen. */
    fun panel(context: Context, panel: Panel): Boolean {
        val q = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        val intents = when (panel) {
            Panel.WIFI -> listOfNotNull(if (q) Intent(Settings.Panel.ACTION_WIFI) else null, Intent(Settings.ACTION_WIFI_SETTINGS))
            Panel.MOBILE_DATA -> listOfNotNull(if (q) Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY) else null, Intent(Settings.ACTION_DATA_ROAMING_SETTINGS), Intent(Settings.ACTION_WIRELESS_SETTINGS))
            Panel.NFC -> listOfNotNull(if (q) Intent(Settings.Panel.ACTION_NFC) else null, Intent(Settings.ACTION_NFC_SETTINGS))
            Panel.BLUETOOTH -> listOf(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            Panel.HOTSPOT -> listOf(Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings"), Intent(Settings.ACTION_WIRELESS_SETTINGS))
            Panel.AIRPLANE -> listOf(Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS))
            Panel.BATTERY_SAVER -> listOf(Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS))
            Panel.LOCATION -> listOf(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        }
        return intents.any { context.launch(it) }
    }

    fun openDndAccess(context: Context) = context.launch(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
    fun openWriteSettings(context: Context) =
        context.launch(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + context.packageName)))
}

/** "Kal 5 baje yaad dilana" → a notification (and spoken line) at that time. Stored so a reboot does not lose them. */
object Reminders {
    const val EXTRA_ID = "id"
    const val EXTRA_TEXT = "text"

    fun schedule(context: Context, at: Long, text: String): Int {
        val p = Prefs(context)
        val id = p.nextId()
        p.reminders = p.reminders + Prefs.ReminderItem(id, at, text)
        arm(context, id, at, text)
        return id
    }

    private fun pending(context: Context, id: Int, text: String): PendingIntent {
        val i = Intent(context, ReminderReceiver::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_TEXT, text)
        return PendingIntent.getBroadcast(context, id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun canExact(context: Context): Boolean {
        val am = context.getSystemService(AlarmManager::class.java) ?: return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    }

    private fun arm(context: Context, id: Int, at: Long, text: String) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val pi = pending(context, id, text)
        try {
            if (canExact(context)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    /** After a reboot: set every future reminder again, fire the ones missed while the phone was off. */
    fun rearmAll(context: Context) {
        val now = System.currentTimeMillis()
        Prefs(context).reminders.forEach { arm(context, it.id, maxOf(it.at, now + 5_000), it.text) }
    }

    fun done(context: Context, id: Int) {
        val p = Prefs(context)
        p.reminders = p.reminders.filter { it.id != id }
    }

    /** CalendarContract insert screen, prefilled. The user presses Save. */
    fun addCalendarEvent(context: Context, title: String, begin: Long, allDay: Boolean): Boolean {
        val i = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, begin + 60 * 60_000L)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
        return context.launch(i)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra(Reminders.EXTRA_ID, 0)
        val text = intent.getStringExtra(Reminders.EXTRA_TEXT).orEmpty()
        Reminders.done(context, id)
        val line = context.getString(app.target.assistant.R.string.reminder_now, text.ifBlank { "—" })
        Notify.reminder(context, id, line)
        Tts.speak(context, line)
    }
}
