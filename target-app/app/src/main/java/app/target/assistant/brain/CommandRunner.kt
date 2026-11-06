package app.target.assistant.brain

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import app.target.assistant.BuildConfig
import app.target.assistant.MainActivity
import app.target.assistant.R
import app.target.assistant.SettingsActivity
import app.target.assistant.VisionActivity
import app.target.assistant.access.TargetAccessibilityService
import app.target.assistant.net.OfflineQueue
import app.target.assistant.net.TargetApi
import app.target.assistant.notify.NotifItem
import app.target.assistant.notify.TargetNotificationListener
import app.target.assistant.settings.Prefs
import app.target.assistant.tools.CallControl
import app.target.assistant.tools.Contacts
import app.target.assistant.tools.DeviceTools
import app.target.assistant.tools.Media
import app.target.assistant.tools.Phone
import app.target.assistant.tools.Reminders
import app.target.assistant.tools.SystemControl
import app.target.assistant.tools.WhatsApp
import app.target.assistant.tools.granted
import app.target.assistant.web.PendingImage
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** A risky step waiting for the user's "haan" (or a tap). */
class Pending(val kind: RiskKind, val question: String, val run: () -> Outcome)

/**
 * Result of one utterance. The overlay shows/speaks [reply] and then, depending on the fields:
 * asks [confirm], offers [choices], waits for free text ([askText]), waits for [async], runs routine
 * [steps], closes ([close]) and runs [afterClose] once the overlay is gone.
 */
data class Outcome(
    val reply: String,
    val handledLocally: Boolean = true,
    val confirm: Pending? = null,
    val choices: List<String> = emptyList(),
    val onChoice: ((Int) -> Outcome)? = null,
    val askText: ((String) -> Outcome)? = null,
    val async: (((Outcome) -> Unit) -> Unit)? = null,
    val steps: List<String> = emptyList(),
    val close: Boolean = false,
    val afterClose: (() -> Unit)? = null,
    val conversation: Boolean? = null,
    /** Open the setup screen at this section (special access the command needs). */
    val setup: String? = null,
    val keepOpen: Boolean = false,
)

/**
 * Runs a parsed [Command]. Phone things happen here; questions go to TARGET (native /api/chat with
 * the WebView login when possible, else the web app). Risky actions come back as [Outcome.confirm].
 */
class CommandRunner(private val context: Context) {
    private val tools = DeviceTools(context)
    private val prefs = Prefs(context)
    private val main = Handler(Looper.getMainLooper())

    /** Screen text the system gave the assistant session (AssistStructure), preferred over accessibility. */
    var assistScreenText: String? = null

    fun handle(text: String): Outcome = run(IntentParser.parse(text), text)

    private fun s(id: Int, vararg args: Any): String = context.getString(id, *args)

    fun run(cmd: Command, original: String): Outcome {
        fun okOf(json: String) = runCatching { JSONObject(json).optBoolean("ok") }.getOrDefault(false)
        fun errOf(json: String) = runCatching { JSONObject(json).optString("error") }.getOrDefault("")
        return when (cmd) {
            is Command.Alarm -> tools.setAlarm(cmd.hour, cmd.minute, cmd.label).let {
                if (okOf(it)) Outcome(s(R.string.reply_alarm, "%d:%02d".format(cmd.hour, cmd.minute))) else Outcome(errOf(it))
            }
            is Command.Timer -> tools.setTimer(cmd.seconds, cmd.label).let {
                if (okOf(it)) Outcome(s(R.string.reply_timer, humanDuration(cmd.seconds))) else Outcome(errOf(it))
            }
            is Command.Flashlight -> tools.flashlight(cmd.on).let {
                if (okOf(it)) Outcome(s(if (cmd.on) R.string.reply_torch_on else R.string.reply_torch_off)) else Outcome(errOf(it))
            }
            is Command.OpenApp -> tools.openApp(cmd.name).let {
                if (okOf(it)) Outcome(s(R.string.reply_open, cmd.name), close = true) else Outcome(errOf(it))
            }
            is Command.Dial -> confirm(RiskKind.CALL, s(R.string.confirm_call, cmd.number)) {
                val direct = Phone.call(context, cmd.number)
                Outcome(s(if (direct) R.string.reply_calling else R.string.reply_dial, cmd.number), close = true)
            }
            is Command.Sms -> sendSms(cmd.number, cmd.number, cmd.text)
            is Command.Navigate -> tools.navigate(cmd.place).let {
                if (okOf(it)) Outcome(s(R.string.reply_navigate, cmd.place), close = true) else Outcome(errOf(it))
            }
            is Command.OpenUrl -> tools.openUrl(cmd.url).let { Outcome(if (okOf(it)) s(R.string.reply_open, cmd.url) else errOf(it), close = okOf(it)) }
            Command.Battery -> tools.batteryLevel().let { (level, charging) ->
                Outcome(s(if (charging) R.string.reply_battery_charging else R.string.reply_battery, level))
            }
            is Command.Ask -> askTarget(original)

            is Command.CallContact -> withContact(cmd.name) { c ->
                confirm(RiskKind.CALL, s(R.string.confirm_call, c.name)) {
                    val direct = Phone.call(context, c.number)
                    Outcome(s(if (direct) R.string.reply_calling else R.string.reply_dial, c.name), close = true)
                }
            }
            is Command.SmsContact -> withContact(cmd.name) { c -> sendSms(c.name, c.number, cmd.text) }
            is Command.WhatsApp -> whatsapp(cmd)

            is Command.PlayMedia -> {
                if (cmd.query.isBlank() && cmd.app != null) {
                    val name = when (cmd.app) { MediaApp.YOUTUBE -> "youtube"; MediaApp.YOUTUBE_MUSIC -> "youtube music"; MediaApp.SPOTIFY -> "spotify" }
                    run(Command.OpenApp(name), original)
                } else if (cmd.query.isBlank()) { Media.key(context, MediaAction.PLAY); Outcome(s(R.string.reply_media_play)) }
                else Media.play(context, cmd.query, cmd.app)?.let { app -> Outcome(s(R.string.reply_playing, cmd.query, app), close = true) }
                    ?: Outcome(s(R.string.reply_no_player))
            }
            is Command.MediaKey -> {
                Media.key(context, cmd.action)
                Outcome(s(when (cmd.action) {
                    MediaAction.PLAY -> R.string.reply_media_play
                    MediaAction.PAUSE -> R.string.reply_media_pause
                    MediaAction.NEXT -> R.string.reply_media_next
                    MediaAction.PREVIOUS -> R.string.reply_media_prev
                }))
            }

            Command.ReadScreen -> {
                val text = screenText() ?: return needAccess()
                if (text.isBlank()) Outcome(s(R.string.reply_screen_empty)) else Outcome(SpeechText.clean(text, 600), keepOpen = true)
            }
            is Command.AskScreen -> askScreen(cmd.question, cmd.screenshot)
            is Command.Tap -> accessibility { a ->
                Outcome(s(R.string.reply_tapping, cmd.target), close = true, afterClose = {
                    if (!a.clickText(cmd.target)) app.target.assistant.voice.Tts.speak(context, s(R.string.reply_tap_missing, cmd.target))
                })
            }
            is Command.TypeText -> accessibility { a ->
                Outcome(s(R.string.reply_typing), close = true, afterClose = {
                    if (!a.typeText(cmd.text)) app.target.assistant.voice.Tts.speak(context, s(R.string.reply_type_missing))
                })
            }
            is Command.Scroll -> accessibility { a -> Outcome(s(R.string.reply_ok), close = true, afterClose = { a.scroll(cmd.down) }) }
            is Command.Swipe -> accessibility { a -> Outcome(s(R.string.reply_ok), close = true, afterClose = { a.swipe(cmd.direction) }) }
            is Command.Global -> accessibility { a -> Outcome(s(R.string.reply_ok), close = true, afterClose = { a.global(cmd.action) }) }

            is Command.ReadNotifications -> readNotifications(cmd.includeOtp)
            is Command.ReplyNotification -> replyNotification(cmd.to, cmd.text)
            Command.ClearNotifications -> notifications { l ->
                confirm(RiskKind.DELETE, s(R.string.confirm_clear_notifications)) { l.dismissAll(); Outcome(s(R.string.reply_cleared)) }
            }

            Command.AnswerCall -> callControl(RiskKind.ANSWER_CALL, s(R.string.confirm_answer)) {
                if (CallControl.answer(context)) Outcome(s(R.string.reply_answered), close = true) else Outcome(s(R.string.reply_call_control_failed))
            }
            is Command.Speaker -> Outcome(s(if (CallControl.speakerphone(context, cmd.on)) (if (cmd.on) R.string.reply_speaker_on else R.string.reply_speaker_off) else R.string.reply_failed))
            Command.RejectCall -> callControl(RiskKind.REJECT_CALL, s(R.string.confirm_reject)) {
                if (CallControl.reject(context)) Outcome(s(R.string.reply_rejected), close = true) else Outcome(s(R.string.reply_call_control_failed))
            }

            Command.Stop -> Outcome(s(R.string.reply_bye), close = true, conversation = false)
            is Command.ConversationMode -> {
                prefs.conversationMode = cmd.on
                Outcome(s(if (cmd.on) R.string.reply_conversation_on else R.string.reply_conversation_off), conversation = cmd.on, close = !cmd.on)
            }
            is Command.SetPersona -> {
                prefs.persona = cmd.persona
                Outcome(s(when (cmd.persona) {
                    Persona.DOST -> R.string.reply_persona_dost
                    Persona.PROFESSIONAL -> R.string.reply_persona_professional
                    Persona.DEFAULT -> R.string.reply_persona_default
                }))
            }

            is Command.CameraAsk -> Outcome(s(R.string.reply_camera), close = true, afterClose = {
                context.startActivity(Intent(context, VisionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(VisionActivity.EXTRA_QUESTION, cmd.question.ifBlank { s(R.string.camera_default_question) }))
            })

            is Command.Volume -> {
                val pct = SystemControl.volume(context, cmd.action)
                Outcome(when (cmd.action) {
                    VolumeAction.MUTE -> s(R.string.reply_muted)
                    else -> s(R.string.reply_volume, pct.coerceAtLeast(0))
                })
            }
            is Command.Ringer -> when (SystemControl.ringer(context, cmd.mode)) {
                SystemControl.Result.DONE -> Outcome(s(when (cmd.mode) {
                    RingerMode.SILENT -> R.string.reply_silent
                    RingerMode.VIBRATE -> R.string.reply_vibrate
                    RingerMode.NORMAL -> R.string.reply_ringer_normal
                }))
                SystemControl.Result.NEEDS_ACCESS -> Outcome(s(R.string.reply_need_dnd), setup = SettingsActivity.SECTION_DND)
                else -> Outcome(s(R.string.reply_failed))
            }
            is Command.Dnd -> when (SystemControl.dnd(context, cmd.on)) {
                SystemControl.Result.DONE -> Outcome(s(if (cmd.on) R.string.reply_dnd_on else R.string.reply_dnd_off))
                SystemControl.Result.NEEDS_ACCESS -> Outcome(s(R.string.reply_need_dnd), setup = SettingsActivity.SECTION_DND)
                else -> Outcome(s(R.string.reply_failed))
            }
            is Command.Brightness -> {
                val pct = SystemControl.brightness(context, cmd.percent, cmd.up)
                if (pct < 0) Outcome(s(R.string.reply_need_write_settings), setup = SettingsActivity.SECTION_BRIGHTNESS)
                else Outcome(s(R.string.reply_brightness, pct))
            }
            is Command.SettingsPanel -> {
                val ok = SystemControl.panel(context, cmd.panel)
                Outcome(if (ok) s(R.string.reply_panel) else s(R.string.reply_failed), close = ok)
            }

            is Command.Reminder -> reminder(cmd)
            is Command.CalendarEvent -> {
                val (at, _) = whenOf(cmd.dayOffset, cmd.hour ?: 9, cmd.minute, null)
                val ok = Reminders.addCalendarEvent(context, cmd.title, at, cmd.hour == null)
                Outcome(if (ok) s(R.string.reply_calendar, cmd.title) else s(R.string.reply_failed), close = ok)
            }
            is Command.Nearby -> {
                val ok = DeviceTools(context).navigate(cmd.what + " near me").let { okOf(it) }
                Outcome(if (ok) s(R.string.reply_nearby, cmd.what) else s(R.string.reply_failed), close = ok)
            }

            is Command.RunRoutine -> {
                val r = Routines.find(cmd.name, prefs.routines)
                if (r == null) Outcome(s(R.string.reply_routine_missing, cmd.name))
                else Outcome(s(R.string.reply_routine_run, r.name, r.steps.size), steps = r.steps)
            }
            is Command.SaveRoutine -> {
                prefs.routines = Routines.upsert(prefs.routines, Routine(cmd.name, cmd.steps))
                Outcome(s(R.string.reply_routine_saved, cmd.name, cmd.steps.size))
            }
        }
    }

    // ---- helpers -----------------------------------------------------------------------------

    /** Wrap a risky action: the overlay asks "haan/nahi" unless the user turned on "bina pooche" for it. */
    private fun confirm(kind: RiskKind, question: String, action: () -> Outcome): Outcome =
        Outcome(question, confirm = Pending(kind, question, action))

    private fun withContact(name: String, then: (ContactEntry) -> Outcome): Outcome {
        if (!context.granted(Manifest.permission.READ_CONTACTS)) return Outcome(s(R.string.reply_need_contacts), setup = SettingsActivity.SECTION_CONTACTS)
        val matches = ContactMatcher.match(name, Contacts.all(context))
        if (matches.isEmpty()) return Outcome(s(R.string.reply_no_contact, name))
        if (ContactMatcher.isConfident(matches)) return then(matches.first().contact)
        val labels = matches.map { m -> m.contact.name + (m.contact.label?.let { " ($it)" } ?: "") }
        return Outcome(s(R.string.reply_which_contact), choices = labels, onChoice = { i -> then(matches[i].contact) })
    }

    private fun sendSms(name: String, number: String, text: String): Outcome {
        if (text.isBlank()) return Outcome(s(R.string.ask_message_text), askText = { t -> sendSms(name, number, t) })
        return confirm(RiskKind.SMS, s(R.string.confirm_sms, name, text)) {
            val sent = Phone.sms(context, number, text)
            Outcome(s(if (sent) R.string.reply_sms_sent else R.string.reply_sms), close = !sent)
        }
    }

    private fun whatsapp(cmd: Command.WhatsApp): Outcome {
        if (!WhatsApp.installed(context, cmd.business)) return Outcome(s(R.string.reply_no_whatsapp))
        return withContact(cmd.who) { c ->
            val pkg = WhatsApp.pkg(cmd.business)
            when (cmd.action) {
                WaAction.OPEN -> Outcome(s(R.string.reply_wa_open, c.name), close = true, afterClose = { WhatsApp.openChat(context, c.number, "", cmd.business) })
                WaAction.SEND -> {
                    if (cmd.text.isBlank()) Outcome(s(R.string.ask_message_text), askText = { t -> whatsapp(cmd.copy(text = t)) })
                    else confirm(RiskKind.WHATSAPP, s(R.string.confirm_wa, c.name, cmd.text)) {
                        val a = TargetAccessibilityService.instance
                        Outcome(s(if (a != null) R.string.reply_wa_sending else R.string.reply_wa_tap_send, c.name), close = true, afterClose = {
                            WhatsApp.openChat(context, c.number, cmd.text, cmd.business)
                            a?.whatsappSend(pkg) { ok -> if (!ok) app.target.assistant.voice.Tts.speak(context, s(R.string.reply_wa_tap_send, c.name)) }
                        })
                    }
                }
                WaAction.VOICE_CALL, WaAction.VIDEO_CALL -> {
                    val video = cmd.action == WaAction.VIDEO_CALL
                    confirm(RiskKind.CALL, s(if (video) R.string.confirm_wa_video else R.string.confirm_wa_call, c.name)) {
                        val a = TargetAccessibilityService.instance
                        Outcome(s(if (a != null) R.string.reply_wa_calling else R.string.reply_wa_tap_call, c.name), close = true, afterClose = {
                            WhatsApp.openChat(context, c.number, "", cmd.business)
                            a?.whatsappCall(pkg, video) { ok -> if (!ok) app.target.assistant.voice.Tts.speak(context, s(R.string.reply_wa_tap_call, c.name)) }
                        })
                    }
                }
                WaAction.READ -> {
                    val a = TargetAccessibilityService.instance ?: return@withContact needAccess()
                    Outcome(s(R.string.reply_wa_reading, c.name), close = true, afterClose = {
                        WhatsApp.openChat(context, c.number, "", cmd.business)
                        a.whatsappLastMessages(pkg, 5) { msgs ->
                            val line = if (msgs.isEmpty()) s(R.string.reply_wa_no_messages) else msgs.joinToString(". ")
                            app.target.assistant.voice.Tts.speak(context, SpeechText.clean(line, 600))
                        }
                    })
                }
            }
        }
    }

    private fun needAccess() = Outcome(s(R.string.reply_need_accessibility), setup = SettingsActivity.SECTION_ACCESSIBILITY)

    private fun accessibility(block: (TargetAccessibilityService) -> Outcome): Outcome =
        TargetAccessibilityService.instance?.let(block) ?: needAccess()

    private fun screenText(): String? = assistScreenText?.takeIf { it.isNotBlank() }
        ?: TargetAccessibilityService.instance?.screenText()

    private fun askScreen(question: String, screenshot: Boolean): Outcome {
        val q = question.ifBlank { s(R.string.screen_default_question) }
        if (screenshot) {
            val a = TargetAccessibilityService.instance ?: return needAccess()
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return Outcome(s(R.string.reply_screenshot_old))
            return Outcome(s(R.string.reply_screen_shot), close = true, afterClose = {
                a.screenshot { bmp ->
                    if (bmp == null) { app.target.assistant.voice.Tts.speak(context, s(R.string.reply_failed)); return@screenshot }
                    PendingImage.set(context, bmp, "screen.jpg")
                    openWebApp(context, q, send = false)
                }
            })
        }
        val text = screenText() ?: return needAccess()
        if (text.isBlank()) return Outcome(s(R.string.reply_screen_empty))
        val prompt = s(R.string.screen_prompt, text.take(5000), q)
        return askTarget(prompt, shown = q)
    }

    /** Questions for TARGET: native chat API (spoken in the overlay) → offline queue → web app. */
    private fun askTarget(text: String, shown: String = text): Outcome {
        if (!prefs.nativeChat) {
            openWebApp(context, shown)
            return Outcome(s(R.string.reply_web), handledLocally = false)
        }
        if (!TargetApi.isOnline(context)) {
            OfflineQueue.add(context, text)
            return Outcome(s(R.string.reply_queued))
        }
        if (!TargetApi.looksSignedIn(TargetApi.cookie())) {
            openWebApp(context, shown)
            return Outcome(s(R.string.reply_web), handledLocally = false)
        }
        return Outcome(s(R.string.reply_thinking), async = { done ->
            TargetApi.askAsync(context, text) { r ->
                done(
                    when (r) {
                        is TargetApi.Result.Ok -> Outcome(TargetApi.spoken(r).ifBlank { s(R.string.reply_empty_answer) }, keepOpen = true)
                        TargetApi.Result.Offline -> { OfflineQueue.add(context, text); Outcome(s(R.string.reply_queued)) }
                        else -> { openWebApp(context, shown); Outcome(s(R.string.reply_web), handledLocally = false) }
                    },
                )
            }
        })
    }

    private fun notifications(block: (TargetNotificationListener) -> Outcome): Outcome =
        TargetNotificationListener.instance?.let(block)
            ?: Outcome(s(R.string.reply_need_notifications), setup = SettingsActivity.SECTION_NOTIFICATIONS)

    private fun readNotifications(includeOtp: Boolean): Outcome = notifications { l ->
        val items = l.items().take(8)
        if (items.isEmpty()) return@notifications Outcome(s(R.string.reply_no_notifications))
        val lines = items.map { n ->
            val who = listOf(n.app, n.title).filter { it.isNotBlank() }.distinct().joinToString(", ")
            if (!includeOtp && SpeechText.isSensitive(n.title, n.text)) s(R.string.notif_otp_hidden, who)
            else "$who: ${n.text.take(160)}"
        }
        Outcome(s(R.string.reply_notifications, items.size) + " " + lines.joinToString(". "), keepOpen = true)
    }

    private fun replyNotification(to: String?, text: String): Outcome = notifications { l ->
        val withReply = l.items().filter { it.reply != null }
        val target: NotifItem = (if (to != null) withReply.maxByOrNull { ContactMatcher.score(to, it.title) }?.takeIf { ContactMatcher.score(to, it.title) >= ContactMatcher.THRESHOLD }
        else withReply.firstOrNull()) ?: return@notifications Outcome(s(R.string.reply_no_reply_target))
        if (text.isBlank()) return@notifications Outcome(s(R.string.ask_message_text), askText = { t -> replyNotification(to ?: target.title, t) })
        confirm(RiskKind.NOTIFICATION_REPLY, s(R.string.confirm_reply, target.title, target.app, text)) {
            if (l.reply(target, text)) Outcome(s(R.string.reply_replied, target.title)) else Outcome(s(R.string.reply_failed))
        }
    }

    private fun callControl(kind: RiskKind, question: String, action: () -> Outcome): Outcome {
        if (!CallControl.canControl(context)) return Outcome(s(R.string.reply_need_calls), setup = SettingsActivity.SECTION_CALLS)
        return confirm(kind, question, action)
    }

    /** (epoch millis, label) for a day offset + time; today's past times move to tomorrow. */
    private fun whenOf(dayOffset: Int, hour: Int, minute: Int, afterMinutes: Int?): Pair<Long, String> {
        val c = Calendar.getInstance()
        if (afterMinutes != null) {
            c.add(Calendar.MINUTE, afterMinutes)
        } else {
            c.add(Calendar.DAY_OF_YEAR, dayOffset)
            c.set(Calendar.HOUR_OF_DAY, hour); c.set(Calendar.MINUTE, minute); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
            if (dayOffset == 0 && c.timeInMillis < System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1)
        }
        val label = SimpleDateFormat("EEE, d MMM, h:mm a", Locale.getDefault()).format(c.time)
        return c.timeInMillis to label
    }

    private fun reminder(cmd: Command.Reminder): Outcome {
        val (at, label) = whenOf(cmd.dayOffset, cmd.hour, cmd.minute, cmd.afterMinutes)
        val text = cmd.text.ifBlank { s(R.string.reminder_default) }
        Reminders.schedule(context, at, text)
        val note = if (Reminders.canExact(context)) "" else " " + s(R.string.reply_reminder_inexact)
        return Outcome(s(R.string.reply_reminder, label, text) + note)
    }

    private fun humanDuration(sec: Int): String {
        val h = sec / 3600; val m = (sec % 3600) / 60; val ss = sec % 60
        return listOfNotNull(
            if (h > 0) "$h ghante" else null,
            if (m > 0) "$m minute" else null,
            if (ss > 0) "$ss second" else null,
        ).joinToString(" ")
    }

    /** Whether a risky action must pass the fingerprint / screen-lock check first. */
    fun needsGuard(): Boolean {
        val km = context.getSystemService(KeyguardManager::class.java)
        return prefs.guardAlways || km?.isKeyguardLocked == true
    }

    companion object {
        /** https://…/app?q=<text>&send=1 — the web app prefills and (with send) sends the message (see src/app/app/page.tsx). */
        fun webUrlFor(query: String?, send: Boolean = true): String {
            val base = BuildConfig.BASE_URL.trimEnd('/') + BuildConfig.APP_PATH
            if (query.isNullOrBlank()) return base
            return base + "?q=" + Uri.encode(query.take(2000)) + if (send) "&send=1" else ""
        }

        fun webUrlForChat(conversationId: String): String =
            BuildConfig.BASE_URL.trimEnd('/') + BuildConfig.APP_PATH + "?c=" + Uri.encode(conversationId)

        fun openWebApp(context: Context, query: String?, send: Boolean = true) {
            openUrlInApp(context, webUrlFor(query, send))
        }

        fun openUrlInApp(context: Context, url: String) {
            val i = Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(MainActivity.EXTRA_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            context.startActivity(i)
        }
    }
}
