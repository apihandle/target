package app.target.assistant.tools

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.SmsManager
import app.target.assistant.brain.ContactEntry
import app.target.assistant.brain.ContactMatcher

fun Context.granted(permission: String): Boolean = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

internal fun Context.launch(intent: Intent): Boolean = try {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
} catch (_: SecurityException) {
    false
}

/** Address book access (READ_CONTACTS, opt-in). */
object Contacts {
    fun all(context: Context): List<ContactEntry> {
        if (!context.granted(Manifest.permission.READ_CONTACTS)) return emptyList()
        val out = ArrayList<ContactEntry>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
            ContactsContract.CommonDataKinds.Phone.LABEL,
            ContactsContract.CommonDataKinds.Phone.STARRED,
        )
        try {
            context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(1) ?: continue
                    val number = c.getString(2) ?: continue
                    val type = c.getInt(3)
                    val label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(context.resources, type, c.getString(4)).toString()
                    out += ContactEntry(c.getLong(0), name, number, label, c.getInt(5) == 1)
                }
            }
        } catch (_: SecurityException) {
        }
        return out
    }

    /** Saved name for a phone number, or null. */
    fun nameFor(context: Context, number: String?): String? {
        if (number.isNullOrBlank() || !context.granted(Manifest.permission.READ_CONTACTS)) return null
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return try {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) { null }
    }
}

/** Calls and SMS. Callers ask the user first (see CommandRunner); these just do it. */
object Phone {
    /** Direct call with CALL_PHONE, otherwise the dialer with the number filled in. Returns true if it called directly. */
    fun call(context: Context, number: String): Boolean {
        val n = number.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        if (context.granted(Manifest.permission.CALL_PHONE) &&
            context.launch(Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(n))))
        ) return true
        context.launch(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(n))))
        return false
    }

    /** Sends with SmsManager when SEND_SMS is allowed; otherwise opens the SMS app with the text. Returns true if sent. */
    fun sms(context: Context, number: String, text: String): Boolean {
        val n = number.filter { it.isDigit() || it == '+' }
        if (context.granted(Manifest.permission.SEND_SMS) && text.isNotBlank()) {
            try {
                val sm: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    context.getSystemService(SmsManager::class.java)
                } else {
                    @Suppress("DEPRECATION") SmsManager.getDefault()
                }
                val parts = sm.divideMessage(text)
                if (parts.size > 1) sm.sendMultipartTextMessage(n, null, parts, null, null) else sm.sendTextMessage(n, null, text, null, null)
                return true
            } catch (_: Exception) {
            }
        }
        context.launch(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(n))).putExtra("sms_body", text))
        return false
    }
}

/** Ringing-call control (ANSWER_PHONE_CALLS, opt-in). */
object CallControl {
    fun canControl(context: Context) = context.granted(Manifest.permission.ANSWER_PHONE_CALLS)

    @Suppress("DEPRECATION", "MissingPermission")
    fun answer(context: Context): Boolean {
        if (!canControl(context)) return false
        return try {
            context.getSystemService(TelecomManager::class.java)?.acceptRingingCall(); true
        } catch (_: Exception) { false }
    }

    @Suppress("DEPRECATION", "MissingPermission")
    fun reject(context: Context): Boolean {
        if (!canControl(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return try {
            context.getSystemService(TelecomManager::class.java)?.endCall() == true
        } catch (_: Exception) { false }
    }
}

/** WhatsApp + WhatsApp Business: open a chat (optionally with text typed in). Sending/calling taps are done by the accessibility service. */
object WhatsApp {
    const val PKG = "com.whatsapp"
    const val PKG_BUSINESS = "com.whatsapp.w4b"

    fun pkg(business: Boolean) = if (business) PKG_BUSINESS else PKG

    fun installed(context: Context, business: Boolean): Boolean = try {
        context.packageManager.getPackageInfo(pkg(business), 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    /** Opens the chat with [number]; [text] is typed into the box (not sent). */
    fun openChat(context: Context, number: String, text: String, business: Boolean): Boolean {
        val phone = ContactMatcher.waNumber(number)
        val uri = Uri.parse("whatsapp://send?phone=" + phone + if (text.isNotEmpty()) "&text=" + Uri.encode(text) else "")
        if (context.launch(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg(business)))) return true
        val web = Uri.parse("https://wa.me/" + phone + if (text.isNotEmpty()) "?text=" + Uri.encode(text) else "")
        return context.launch(Intent(Intent.ACTION_VIEW, web).setPackage(pkg(business))) || context.launch(Intent(Intent.ACTION_VIEW, web))
    }
}
