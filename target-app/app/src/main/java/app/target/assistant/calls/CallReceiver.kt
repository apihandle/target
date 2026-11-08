package app.target.assistant.calls

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import app.target.assistant.R
import app.target.assistant.settings.Prefs
import app.target.assistant.tools.Contacts
import app.target.assistant.tools.granted
import app.target.assistant.voice.Tts

/**
 * Incoming call → speaks who is calling (opt-in, READ_PHONE_STATE + READ_CALL_LOG for the number,
 * READ_CONTACTS for the name). The user can then open the assistant and say "uthao" / "kaato".
 */
class CallReceiver : BroadcastReceiver() {

    companion object {
        @Volatile private var announcedAt = 0L
        @Volatile private var announcedNumber: String? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val prefs = Prefs(context)
        if (!prefs.callAnnounce || !context.granted(Manifest.permission.READ_PHONE_STATE)) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        if (state != TelephonyManager.EXTRA_STATE_RINGING) {
            if (state == TelephonyManager.EXTRA_STATE_IDLE || state == TelephonyManager.EXTRA_STATE_OFFHOOK) Tts.stop()
            return
        }
        @Suppress("DEPRECATION")
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val hasLog = context.granted(Manifest.permission.READ_CALL_LOG)
        // With READ_CALL_LOG Android sends this broadcast twice (without and with the number): speak once, with the number.
        if (hasLog && number == null) return
        val now = System.currentTimeMillis()
        if (now - announcedAt < 8_000 && announcedNumber == number) return
        announcedAt = now
        announcedNumber = number
        val name = Contacts.nameFor(context, number)
        val who = name ?: number?.let { it.chunked(1).joinToString(" ") }
        val line = if (who != null) context.getString(R.string.call_announce, who) else context.getString(R.string.call_announce_unknown)
        Tts.speak(context, line)
    }
}
