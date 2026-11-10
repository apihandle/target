package app.target.assistant.settings

import android.content.Context
import android.content.SharedPreferences
import app.target.assistant.brain.Persona
import app.target.assistant.brain.RiskKind
import app.target.assistant.brain.Routine
import app.target.assistant.brain.Routines
import org.json.JSONArray
import org.json.JSONObject

/** All local settings (SharedPreferences, on this phone only). Every special feature is off until the user turns it on. */
class Prefs(context: Context) {
    private val appCtx: Context = context.applicationContext
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("target_prefs", Context.MODE_PRIVATE)

    // ---- assistant / voice ----
    var assistantName: String
        get() = sp.getString("assistant_name", null)?.takeIf { it.isNotBlank() } ?: "TARGET"
        set(v) = sp.edit().putString("assistant_name", v.trim().take(24)).apply()
    var persona: Persona
        get() = Persona.of(sp.getString("persona", null))
        set(v) = sp.edit().putString("persona", v.key).apply()
    var ttsVoice: String?
        get() = sp.getString("tts_voice", null)
        set(v) = sp.edit().putString("tts_voice", v).apply()
    var ttsRate: Float
        get() = sp.getFloat("tts_rate", 1.0f)
        set(v) = sp.edit().putFloat("tts_rate", v.coerceIn(0.5f, 2.0f)).apply()
    var ttsPitch: Float
        get() = sp.getFloat("tts_pitch", 1.0f)
        set(v) = sp.edit().putFloat("tts_pitch", v.coerceIn(0.5f, 2.0f)).apply()

    // ---- conversation ----
    var conversationMode: Boolean
        get() = sp.getBoolean("conversation_mode", false)
        set(v) = sp.edit().putBoolean("conversation_mode", v).apply()
    var bargeIn: Boolean
        get() = sp.getBoolean("barge_in", true)
        set(v) = sp.edit().putBoolean("barge_in", v).apply()
    /** Answer non-phone questions natively from /api/chat (with the WebView's login) and speak them. */
    var nativeChat: Boolean
        get() = sp.getBoolean("native_chat", true)
        set(v) = sp.edit().putBoolean("native_chat", v).apply()

    /** Last TARGET chat used from the overlay, reused for follow-ups for 15 minutes. */
    fun recentConversation(now: Long = System.currentTimeMillis()): String? {
        val at = sp.getLong("conv_at", 0)
        return if (now - at < 15 * 60_000L) sp.getString("conv_id", null) else null
    }
    fun setConversation(id: String?) = sp.edit().putString("conv_id", id).putLong("conv_at", System.currentTimeMillis()).apply()
    val lastConversation: String? get() = sp.getString("conv_id", null)

    // ---- risky actions ----
    /** "Bina pooche" per action kind. Off by default: TARGET asks "haan/nahi" first. */
    fun noAsk(kind: RiskKind): Boolean = sp.getBoolean("noask_" + kind.key, false)
    fun setNoAsk(kind: RiskKind, v: Boolean) = sp.edit().putBoolean("noask_" + kind.key, v).apply()
    /** Fingerprint / screen lock before every risky action (always asked when the phone is locked). */
    var guardAlways: Boolean
        get() = sp.getBoolean("guard_always", false)
        set(v) = sp.edit().putBoolean("guard_always", v).apply()

    /** Optional app lock: fingerprint / face / screen lock when opening TARGET's screens. Off by default. */
    var appLock: Boolean
        get() = sp.getBoolean("app_lock", false)
        set(v) = sp.edit().putBoolean("app_lock", v).apply()

    // ---- google sign-in handoff (fix #4) ----
    /**
     * PKCE verifier for an in-flight app Google sign-in: generated when the Custom Tab opens,
     * presented to /auth/app-handoff when the App Link returns, then cleared. Only this phone
     * knows it — that's what binds the parked session to this app instance. Null when cleared.
     */
    var handoffVerifier: String?
        get() = sp.getString("handoff_verifier", null)?.takeIf { it.isNotBlank() }
        set(v) = sp.edit().apply { if (v == null) remove("handoff_verifier") else putString("handoff_verifier", v) }.apply()

    // ---- wake word / calls ----
    var wakeWord: Boolean
        get() = sp.getBoolean("wake_word", false)
        set(v) = sp.edit().putBoolean("wake_word", v).apply()
    /** Keyword spotter tuning: higher boost / lower threshold = wakes more easily (more false alarms). */
    var wakeBoost: Float
        get() = sp.getFloat("wake_boost", app.target.assistant.wake.WakeKeywords.DEFAULT_BOOST)
        set(v) = sp.edit().putFloat("wake_boost", app.target.assistant.wake.WakeKeywords.clampBoost(v)).apply()
    var wakeThreshold: Float
        get() = sp.getFloat("wake_threshold", app.target.assistant.wake.WakeKeywords.DEFAULT_THRESHOLD)
        set(v) = sp.edit().putFloat("wake_threshold", app.target.assistant.wake.WakeKeywords.clampThreshold(v)).apply()
    /** Times "Hey Target" opened the assistant and nothing was said (shown in settings to tune sensitivity). */
    var falseWakes: Int
        get() = sp.getInt("false_wakes", 0)
        set(v) = sp.edit().putInt("false_wakes", v).apply()
    var callAnnounce: Boolean
        get() = sp.getBoolean("call_announce", false)
        set(v) = sp.edit().putBoolean("call_announce", v).apply()

    // ---- auto-reply ----
    var autoReply: Boolean
        get() = sp.getBoolean("auto_reply", false)
        set(v) = sp.edit().putBoolean("auto_reply", v).apply()
    var autoReplyMessage: String
        get() = sp.getString("auto_reply_msg", null) ?: ""
        set(v) = sp.edit().putString("auto_reply_msg", v.take(300)).apply()
    var autoReplyApps: Set<String>
        get() = sp.getStringSet("auto_reply_apps", emptySet())?.toSet() ?: emptySet()
        set(v) = sp.edit().putStringSet("auto_reply_apps", v).apply()

    data class SentLog(val at: Long, val app: String, val to: String, val text: String)

    fun autoReplyLog(): List<SentLog> = try {
        val a = JSONArray(sp.getString("auto_reply_log", "[]"))
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            SentLog(o.optLong("at"), o.optString("app"), o.optString("to"), o.optString("text"))
        }
    } catch (_: Exception) { emptyList() }

    fun addAutoReplyLog(e: SentLog) {
        val list = (listOf(e) + autoReplyLog()).take(50)
        val a = JSONArray()
        list.forEach { a.put(JSONObject().put("at", it.at).put("app", it.app).put("to", it.to).put("text", it.text)) }
        sp.edit().putString("auto_reply_log", a.toString()).apply()
    }

    fun clearAutoReplyLog() = sp.edit().remove("auto_reply_log").apply()

    // ---- routines (Preferences DataStore, see RoutineStore) ----
    var routines: List<Routine>
        get() = app.target.assistant.store.RoutineStore.get(appCtx)
        set(v) = app.target.assistant.store.RoutineStore.set(appCtx, v)

    // ---- reminders (kept so they can be set again after a reboot) ----
    data class ReminderItem(val id: Int, val at: Long, val text: String)

    var reminders: List<ReminderItem>
        get() = try {
            val a = JSONArray(sp.getString("reminders", "[]"))
            (0 until a.length()).map { i -> a.getJSONObject(i).let { ReminderItem(it.optInt("id"), it.optLong("at"), it.optString("text")) } }
        } catch (_: Exception) { emptyList() }
        set(v) {
            val a = JSONArray()
            v.forEach { a.put(JSONObject().put("id", it.id).put("at", it.at).put("text", it.text)) }
            sp.edit().putString("reminders", a.toString()).apply()
        }

    fun nextId(): Int {
        val n = sp.getInt("next_id", 1000) + 1
        sp.edit().putInt("next_id", n).apply()
        return n
    }
}
