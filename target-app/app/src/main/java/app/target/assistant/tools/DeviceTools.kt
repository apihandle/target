package app.target.assistant.tools

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject

/**
 * Things only the phone can do. Every call returns a small JSON string:
 * {"ok":true,...} or {"ok":false,"error":"…"}. Risky actions (call, SMS) only open the
 * system screen prefilled — the user always presses the final button.
 */
class DeviceTools(private val context: Context) {

    private fun ok(vararg extra: Pair<String, Any?>): String =
        JSONObject().apply { put("ok", true); extra.forEach { put(it.first, it.second) } }.toString()

    private fun err(msg: String): String = JSONObject().put("ok", false).put("error", msg).toString()

    private fun start(intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }

    // ---- apps -------------------------------------------------------------------------------
    private val aliases = mapOf(
        "whatsapp" to "com.whatsapp", "whats app" to "com.whatsapp", "watsapp" to "com.whatsapp",
        "youtube" to "com.google.android.youtube", "you tube" to "com.google.android.youtube",
        "instagram" to "com.instagram.android", "insta" to "com.instagram.android",
        "gmail" to "com.google.android.gm", "maps" to "com.google.android.apps.maps",
        "google maps" to "com.google.android.apps.maps", "chrome" to "com.android.chrome",
        "play store" to "com.android.vending", "playstore" to "com.android.vending",
        "phonepe" to "com.phonepe.app", "phone pe" to "com.phonepe.app", "paytm" to "net.one97.paytm",
        "gpay" to "com.google.android.apps.nbu.paisa.user", "google pay" to "com.google.android.apps.nbu.paisa.user",
        "telegram" to "org.telegram.messenger", "facebook" to "com.facebook.katana", "spotify" to "com.spotify.music",
        "photos" to "com.google.android.apps.photos", "gallery" to "com.google.android.apps.photos",
    )

    fun openApp(rawName: String): String {
        val name = rawName.trim().lowercase()
        if (name.isEmpty()) return err("app ka naam khaali hai")
        when (name) {
            "camera", "kamera" -> if (start(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))) return ok("opened" to "camera")
            "settings", "setting" -> if (start(Intent(Settings.ACTION_SETTINGS))) return ok("opened" to "settings")
            "phone", "dialer", "dialler" -> if (start(Intent(Intent.ACTION_DIAL))) return ok("opened" to "dialer")
            "target" -> return ok("opened" to "target")
        }
        val pm = context.packageManager
        aliases[name]?.let { pkg ->
            pm.getLaunchIntentForPackage(pkg)?.let { if (start(it)) return ok("opened" to pkg) }
        }
        // Fuzzy match on launcher labels.
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(launcher, 0)
        val scored = apps.mapNotNull { ri ->
            val label = ri.loadLabel(pm).toString().lowercase()
            val score = when {
                label == name -> 3
                label.startsWith(name) -> 2
                label.contains(name) || name.contains(label) && label.length > 2 -> 1
                else -> 0
            }
            if (score > 0) Triple(ri, label, score) else null
        }.sortedByDescending { it.third }
        scored.firstOrNull()?.let { (ri, label, _) ->
            val i = pm.getLaunchIntentForPackage(ri.activityInfo.packageName)
            if (i != null && start(i)) return ok("opened" to ri.activityInfo.packageName, "label" to label)
        }
        // Not installed: offer the Play Store search.
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + Uri.encode(rawName)))
        if (start(market)) return ok("opened" to "play_store_search", "notInstalled" to true)
        return err("\"$rawName\" app nahi mila")
    }

    // ---- phone / sms ------------------------------------------------------------------------
    fun dial(number: String): String {
        val n = number.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        if (n.isEmpty()) return err("number nahi mila")
        return if (start(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(n))))) ok("dialer" to n) else err("dialer nahi khula")
    }

    fun composeSms(number: String, text: String): String {
        val n = number.filter { it.isDigit() || it == '+' }
        val i = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(n))).putExtra("sms_body", text)
        return if (start(i)) ok("composer" to n) else err("SMS app nahi khula")
    }

    // ---- clock ------------------------------------------------------------------------------
    fun setAlarm(hour: Int, minute: Int, label: String?): String {
        if (hour !in 0..23 || minute !in 0..59) return err("time galat hai")
        val i = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        if (!label.isNullOrBlank()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label)
        return if (start(i)) ok("hour" to hour, "minute" to minute) else err("clock app nahi mila")
    }

    fun setTimer(seconds: Int, label: String?): String {
        if (seconds <= 0 || seconds > 24 * 3600) return err("timer 1 second se 24 ghante tak")
        val i = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        if (!label.isNullOrBlank()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label)
        return if (start(i)) ok("seconds" to seconds) else err("clock app nahi mila")
    }

    // ---- flashlight -------------------------------------------------------------------------
    fun flashlight(on: Boolean): String {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) return err("is phone mein flash nahi hai")
        return try {
            val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
                ?: return err("flash nahi mila")
            cm.setTorchMode(id, on)
            ok("on" to on)
        } catch (e: Exception) {
            err("torch: ${e.message ?: "error"}")
        }
    }

    // ---- web / maps / share -----------------------------------------------------------------
    fun openUrl(url: String): String {
        val u = Uri.parse(url.trim())
        if (u.scheme != "https" && u.scheme != "http") return err("sirf http/https links")
        return try {
            CustomTabsIntent.Builder().build().apply { intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }.launchUrl(context, u)
            ok("url" to u.toString())
        } catch (_: ActivityNotFoundException) {
            if (start(Intent(Intent.ACTION_VIEW, u))) ok("url" to u.toString()) else err("browser nahi mila")
        }
    }

    fun navigate(place: String): String {
        if (place.isBlank()) return err("jagah ka naam do")
        val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place)))
        if (start(geo)) return ok("place" to place)
        return openUrl("https://www.google.com/maps/search/?api=1&query=" + Uri.encode(place))
    }

    fun share(text: String): String {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        return if (start(Intent.createChooser(send, null))) ok() else err("share nahi hua")
    }

    fun battery(): String {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging
        return ok("level" to level, "charging" to charging)
    }

    fun batteryLevel(): Pair<Int, Boolean> {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) to bm.isCharging
    }
}
