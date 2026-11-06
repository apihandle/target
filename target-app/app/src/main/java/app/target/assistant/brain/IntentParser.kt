package app.target.assistant.brain

/**
 * The local "brain": a parser for Hinglish + English phone commands (Devanagari input is
 * transliterated first). Pure Kotlin (no Android types) so it is unit-tested on the JVM.
 * Anything it does not understand becomes [Command.Ask] and goes to TARGET.
 */
sealed class Command {
    data class OpenApp(val name: String) : Command()
    data class Dial(val number: String) : Command()
    data class Sms(val number: String, val text: String) : Command()
    data class Alarm(val hour: Int, val minute: Int, val label: String?) : Command()
    data class Timer(val seconds: Int, val label: String?) : Command()
    data class Flashlight(val on: Boolean) : Command()
    data class Navigate(val place: String) : Command()
    data class OpenUrl(val url: String) : Command()
    object Battery : Command()
    data class Ask(val text: String) : Command()

    // v0.2 — contacts
    data class CallContact(val name: String) : Command()
    data class SmsContact(val name: String, val text: String) : Command()

    // WhatsApp / WhatsApp Business
    data class WhatsApp(val action: WaAction, val who: String, val text: String = "", val business: Boolean = false) : Command()

    // media
    data class PlayMedia(val query: String, val app: MediaApp?) : Command()
    data class MediaKey(val action: MediaAction) : Command()

    // screen (accessibility)
    object ReadScreen : Command()
    data class AskScreen(val question: String, val screenshot: Boolean) : Command()
    data class Tap(val target: String) : Command()
    data class TypeText(val text: String) : Command()
    data class Scroll(val down: Boolean) : Command()
    data class Swipe(val direction: Direction) : Command()
    data class Global(val action: GlobalAction) : Command()

    // notifications
    data class ReadNotifications(val includeOtp: Boolean) : Command()
    data class ReplyNotification(val to: String?, val text: String) : Command()
    object ClearNotifications : Command()

    // phone calls
    object AnswerCall : Command()
    object RejectCall : Command()

    // conversation
    object Stop : Command()
    data class ConversationMode(val on: Boolean) : Command()
    data class SetPersona(val persona: Persona) : Command()

    // camera
    data class CameraAsk(val question: String) : Command()

    // system
    data class Volume(val action: VolumeAction) : Command()
    data class Ringer(val mode: RingerMode) : Command()
    data class Dnd(val on: Boolean) : Command()
    data class Brightness(val percent: Int?, val up: Boolean?) : Command()
    data class SettingsPanel(val panel: Panel, val on: Boolean?) : Command()

    // time
    /** [afterMinutes] set = "2 ghante baad"; else [dayOffset] + [hour]:[minute]. */
    data class Reminder(val dayOffset: Int, val hour: Int, val minute: Int, val afterMinutes: Int?, val text: String) : Command()
    data class CalendarEvent(val dayOffset: Int, val hour: Int?, val minute: Int, val title: String) : Command()
    data class Nearby(val what: String) : Command()

    // routines
    data class RunRoutine(val name: String) : Command()
    data class SaveRoutine(val name: String, val steps: List<String>) : Command()
}

enum class WaAction { SEND, OPEN, VOICE_CALL, VIDEO_CALL, READ }
enum class MediaApp { YOUTUBE, YOUTUBE_MUSIC, SPOTIFY }
enum class MediaAction { PLAY, PAUSE, NEXT, PREVIOUS }
enum class Direction { LEFT, RIGHT, UP, DOWN }
enum class GlobalAction { BACK, HOME, RECENTS, NOTIFICATIONS, QUICK_SETTINGS, LOCK, SCREENSHOT }
enum class VolumeAction { UP, DOWN, MUTE, UNMUTE, MAX }
enum class RingerMode { SILENT, VIBRATE, NORMAL }
enum class Panel { WIFI, BLUETOOTH, MOBILE_DATA, NFC, HOTSPOT, AIRPLANE, BATTERY_SAVER, LOCATION }

object IntentParser {

    private val WAKE = Regex("^(hey|hi|ok|okay|ae|oye|hello)?\\s*target[,!.]?\\s*", RegexOption.IGNORE_CASE)
    private val POLITE = Regex("\\b(please|plz|pls|zara|jara|jaldi|kripya|jaldi se)\\b", RegexOption.IGNORE_CASE)

    private val HINDI_NUM = mapOf(
        "ek" to 1, "do" to 2, "teen" to 3, "char" to 4, "chaar" to 4, "paanch" to 5, "panch" to 5,
        "chhe" to 6, "chhah" to 6, "che" to 6, "cheh" to 6, "saat" to 7, "aath" to 8, "nau" to 9, "das" to 10,
        "gyarah" to 11, "gyaarah" to 11, "barah" to 12, "baarah" to 12, "pandrah" to 15, "bees" to 20, "tees" to 30,
        "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7,
        "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "fifteen" to 15, "twenty" to 20, "thirty" to 30,
    )

    /** One utterance: the user's original words and the cleaned, lowercased Roman text the rules read. */
    private class U(val original: String, val t: String) {
        private val origWords = original.split(Regex("\\s+")).filter { it.isNotEmpty() }
        private val romWords = origWords.map { key(Translit.romanizeWord(it)) }

        private fun key(w: String) = w.lowercase().trim { !it.isLetterOrDigit() }

        /** [piece] (lowercase Roman, from [t]) in the user's own words and casing / script when it can be found. */
        fun recase(piece: String): String {
            val p = piece.trim()
            if (p.isEmpty()) return p
            val pw = p.split(' ').map { key(it) }.filter { it.isNotEmpty() }
            if (pw.isEmpty()) return p
            for (i in 0..romWords.size - pw.size) {
                if ((pw.indices).all { romWords[i + it] == pw[it] }) {
                    val out = origWords.subList(i, i + pw.size).joinToString(" ")
                    return out.trimEnd('?', '!', '।', ',').trimStart(':', '-', ',').trim()
                }
            }
            return p
        }
    }

    fun parse(raw: String): Command {
        val original = raw.trim()
        val t = clean(original)
        if (t.isEmpty()) return Command.Ask(original)
        val u = U(original, t)

        val rules: List<(U) -> Command?> = listOf(
            ::parseStop, ::parseConversation, ::parsePersona, ::parseRoutine, ::parseCallControl,
            ::parseReminder, ::parseCalendar, ::parseFlashlightRule, ::parseTimerRule, ::parseAlarmRule,
            ::parseWhatsApp, ::parseNotifications, ::parseSmsRule, ::parseCallRule,
            ::parseMediaKey, ::parsePlay, ::parseCamera, ::parseScreen, ::parseGlobal,
            ::parseVolume, ::parseRinger, ::parseDnd, ::parseBrightness, ::parsePanel,
            ::parseBatteryRule, ::parseNearby, ::parseNavigateRule, ::parseOpenRule,
        )
        for (r in rules) r(u)?.let { return it }
        return Command.Ask(original)
    }

    /** Lowercase Roman text without the wake word, polite words and punctuation noise. */
    fun clean(raw: String): String =
        Translit.romanize(raw.trim()).lowercase()
            .replace(WAKE, "")
            .replace(POLITE, " ")
            .replace(Regex("[?!।]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .trimEnd('.', ',')
            .trim()

    private fun has(t: String, re: String) = Regex(re).containsMatchIn(t)

    // ---- stop / conversation / persona --------------------------------------------------------
    private val STOP = Regex("^(bas|bas karo|bas kar|bas ho gaya|bye|bye bye|bye target|alvida|stop|stop listening|chup|chup karo|chup ho jao|ruk jao|band karo|that'?s all|exit|goodbye|good bye|so jao|sleep|go to sleep|thank you bye|ok bye|theek hai bye)$")

    private fun parseStop(u: U): Command? = if (STOP.matches(u.t)) Command.Stop else null

    private fun parseConversation(u: U): Command? {
        val t = u.t
        val mode = has(t, "\\b(conversation|baatcheet|baat cheet|chat|continuous|lagatar)\\s+(mode|listening)\\b")
        if (mode) return Command.ConversationMode(!has(t, "\\b(off|band|bandh|stop|khatam|disable|hatao)\\b"))
        if (has(t, "^(chalo )?(baat karte hain|baatein karo|baat karo mujhse|mujhse baat karo|lagatar suno|talk to me|let'?s talk|let'?s chat)$")) return Command.ConversationMode(true)
        return null
    }

    private fun parsePersona(u: U): Command? {
        val m = Regex("^(?:switch to |use )?(dost|friend|friendly|professional|formal|default)\\s+(?:mode|persona|style|wala mode)(?:\\s+(?:on|karo|kar do|mein baat karo|chalu karo))?$").find(u.t) ?: return null
        return Command.SetPersona(
            when (m.groupValues[1]) {
                "dost", "friend", "friendly" -> Persona.DOST
                "professional", "formal" -> Persona.PROFESSIONAL
                else -> Persona.DEFAULT
            },
        )
    }

    // ---- routines ------------------------------------------------------------------------------
    private val ROUTINE = "(?:routine|routin|macro)"

    private fun parseRoutine(u: U): Command? {
        val t = u.t
        if (!has(t, "\\b$ROUTINE\\b")) return null
        val save = listOf(
            Regex("^(?:save|create|make|banao|bana do|naya)?\\s*(?:a |ek )?$ROUTINE\\s*(?:banao|bana do|save karo|save|create)?\\s*(?:named |called |naam )?(.+?)\\s*[:\\-]\\s*(.+)$"),
            Regex("^(.+?)\\s+(?:ka |ki |wala |vala )?$ROUTINE\\s+(?:banao|bana do|save karo|save kar do|save|set karo|create karo|create)\\s*[:\\-]?\\s*(?:jisme |with |ki )?(.+)$"),
            Regex("^(?:create|save|make)\\s+(?:a |my )?$ROUTINE\\s+(?:called |named )?(.+?)\\s+(?:with|that does|to)\\s+(.+)$"),
        )
        for (re in save) {
            val m = re.find(t) ?: continue
            val name = Routines.key(m.groupValues[1])
            if (name.isEmpty()) continue
            val steps = Routines.splitSteps(u.recase(m.groupValues[2]))
            if (steps.isEmpty()) continue
            return Command.SaveRoutine(name, steps)
        }
        val run = listOf(
            Regex("^(?:run|start|play|chalao|shuru karo)\\s+(?:the |my |mera )?(.+?)\\s+$ROUTINE$"),
            Regex("^(.+?)\\s+(?:ka |ki |wala |vala )?$ROUTINE(?:\\s+(?:chalao|chala do|chalu karo|shuru karo|start karo|run karo|karo|run|start|play))?$"),
            Regex("^$ROUTINE\\s+(.+?)(?:\\s+(?:chalao|chala do|run|start|shuru karo))?$"),
        )
        for (re in run) {
            val m = re.find(t) ?: continue
            val name = Routines.key(m.groupValues[1])
            if (name.isNotEmpty()) return Command.RunRoutine(name)
        }
        return null
    }

    // ---- incoming call ------------------------------------------------------------------------
    private val ANSWER = Regex("^(?:(?:call|phone|fone)\\s+)?(?:uthao|utha lo|uthalo|utha do|receive karo|receive kar lo|receive|pick up|pickup|answer|attend karo|accept|accept karo)(?:\\s+(?:the call|call|phone|karo|it))?$|^(?:answer|accept|pick up|receive)\\s+(?:the\\s+)?(?:call|phone)$")
    private val REJECT = Regex("^(?:(?:call|phone|fone)\\s+)?(?:kaato|kato|kaat do|kat do|cut karo|cut kar do|cut|reject|reject karo|decline|decline karo|mana karo)(?:\\s+(?:the call|call|phone|karo|it))?$|^(?:reject|decline|cut|end)\\s+(?:the\\s+)?(?:call|phone)$|^(?:call|phone)\\s+(?:band karo|band kar do|mat uthao)$")

    private fun parseCallControl(u: U): Command? = when {
        ANSWER.matches(u.t) -> Command.AnswerCall
        REJECT.matches(u.t) -> Command.RejectCall
        else -> null
    }

    // ---- reminders / calendar -------------------------------------------------------------------
    private val REMIND = Regex("\\b(yaad\\s*(?:dilaana|dilana|dila dena|dila do|dilao|dila|kara dena|kara do|karana|rakhna)|remind\\s*(?:me|kar dena|kar do|karo)?|reminder\\s*(?:set karo|set kar do|lagao|laga do|banao|bana do|set|for|to|ki|ka)?)")
    private val DAY = Regex("\\b(aaj|today|kal|tomorrow|parson|parso|parsoon|day after tomorrow)\\b")
    private val RELATIVE = Regex("\\b(?:in\\s+)?(\\d+|[a-z]+)\\s*(minutes?|mins?|min|minat|ghante|ghanta|ghanton|hours?|hrs?|hr)\\s*(?:mein|me|baad|ke baad|later|bad)\\b|\\bin\\s+(\\d+|[a-z]+)\\s*(minutes?|mins?|hours?|hrs?)\\b")
    private val EXPLICIT_TIME = Regex("\\b\\d{1,2}[:.]\\d{2}\\b|\\b(\\d{1,2}|[a-z]+)\\s*(baje|bje|o'?clock|am|pm|a\\.m\\.|p\\.m\\.)|\\b(subah|morning|shaam|sham|evening|raat|night|dopahar|dopehar|afternoon)\\s+(\\d{1,2})\\b|\\bat\\s+\\d{1,2}\\b")
    private val PERIOD = Regex("\\b(am|pm|a\\.m\\.|p\\.m\\.|subah|morning|savere|shaam|sham|evening|raat|night|dopahar|dopehar|afternoon)\\b")

    private fun dayOffset(t: String): Int = when (DAY.find(t)?.groupValues?.get(1)) {
        "kal", "tomorrow" -> 1
        "parson", "parso", "parsoon", "day after tomorrow" -> 2
        else -> 0
    }

    private fun number(s: String): Double? = s.toDoubleOrNull() ?: HINDI_NUM[s]?.toDouble()
        ?: if (s == "aadha" || s == "half" || s == "an" || s == "a") (if (s == "aadha" || s == "half") 0.5 else 1.0) else null

    private fun relativeMinutes(t: String): Int? {
        val m = RELATIVE.find(t) ?: return null
        val n = number(m.groupValues[1].ifEmpty { m.groupValues[3] }) ?: return null
        val unit = m.groupValues[2].ifEmpty { m.groupValues[4] }
        var minutes = if (unit.startsWith("m")) n else n * 60
        if (has(t, "\\b(saade|sadhe)\\b") && !unit.startsWith("m")) minutes += 30
        return minutes.toInt().takeIf { it > 0 }
    }

    /** Hour for a reminder/event: "5 baje" without subah/shaam means 5 pm (1-7 → afternoon/evening). */
    private fun eventTime(t: String): Pair<Int, Int>? {
        if (!EXPLICIT_TIME.containsMatchIn(t)) return null
        val withoutDay = t.replace(Regex("\\b\\d+\\s*(minutes?|mins?|ghante|hours?)\\b"), " ")
        var (h, m) = parseTime(withoutDay) ?: return null
        if (!PERIOD.containsMatchIn(t) && h in 1..7) h += 12
        return h to m
    }

    private val TIME_NOISE = listOf(
        "\\b(aaj|today|kal|tomorrow|parson|parso|parsoon|day after tomorrow)\\b",
        "\\b(?:in\\s+)?(\\d+|[a-z]+)\\s*(minutes?|mins?|min|minat|ghante|ghanta|ghanton|hours?|hrs?|hr)\\s*(mein|me|baad|ke baad|later|bad)?\\b",
        "\\b(?:at\\s+)?\\d{1,2}([:.]\\d{2})?\\s*(baje|bje|o'?clock|am|pm)?\\b",
        "\\b(saade|sadhe|sawa|paune|subah|morning|shaam|sham|evening|raat|night|dopahar|dopehar|afternoon|ko|ke|ka|ki|par|pe|on|at|in|to|that|about|mujhe|me|baje)\\b",
    )

    private fun stripTime(s: String): String {
        var x = " $s "
        for (re in TIME_NOISE) x = x.replace(Regex(re), " ")
        return x.replace(Regex("\\s+"), " ").trim()
    }

    private fun parseReminder(u: U): Command? {
        val t = u.t
        val m = REMIND.find(t) ?: return null
        val before = t.substring(0, m.range.first).trim()
        var after = t.substring(m.range.last + 1).trim()
        // "remind me tomorrow at 9 to call mom": the text is after the first to/ki/that.
        Regex("\\b(?:to|ki|that|about|ke liye)\\s+(.+)$").find(after)?.let { after = it.groupValues[1] }
        val textRoman = stripTime(after).ifEmpty { stripTime(before) }
            .replace(Regex("^(ki|ke|to|that)\\s+"), "").replace(Regex("\\s+(ke liye|hai)$"), "").trim()
        val text = u.recase(textRoman)
        relativeMinutes(t)?.let { return Command.Reminder(0, 0, 0, it, text) }
        val time = eventTime(t)
        val day = dayOffset(t)
        if (time == null && !DAY.containsMatchIn(t)) return Command.Ask(u.original)
        val (h, min) = time ?: (9 to 0)
        return Command.Reminder(day, h, min, null, text)
    }

    private val CALENDAR = Regex("\\b(calendar|calender|kalendar)\\b")

    private fun parseCalendar(u: U): Command? {
        val t = u.t
        if (!CALENDAR.containsMatchIn(t)) return null
        if (!has(t, "\\b(add|daalo|dalo|daal do|dal do|daal|mein|me|event|schedule|banao|bana do|set|lagao|save|create|rakh do|rakho)\\b")) return null
        if (has(t, "^(open|kholo|khol do)\\s+calendar$|^calendar\\s+(kholo|khol do|open karo|open)$")) return null
        val time = eventTime(t)
        var title = t.replace(CALENDAR, " ")
            .replace(Regex("\\b(add|daalo|dalo|daal do|dal do|daal|mein|me|event|schedule|banao|bana do|set|lagao|save|create|rakh do|rakho|karo|kar do|in|to|the|my|an?|ek|naya|new)\\b"), " ")
        title = stripTime(title).replace(Regex("\\s+"), " ").trim()
        return Command.CalendarEvent(dayOffset(t), time?.first, time?.second ?: 0, u.recase(title).ifEmpty { "Event" })
    }

    // ---- flashlight -------------------------------------------------------------------------
    private val TORCH = Regex("\\b(torch|flashlight|flash light|flash|tourch|taarch|torch light)\\b")
    private val OFF_WORDS = Regex("\\b(off|band|bandh|bujha|bujhao|bujha do|stop|hata|hatao|disable)\\b")

    private fun parseFlashlightRule(u: U) = parseFlashlight(u.t)

    private fun parseFlashlight(t: String): Command? {
        if (!TORCH.containsMatchIn(t)) return null
        if (t.contains("camera") && !t.contains("torch")) return null
        return Command.Flashlight(on = !OFF_WORDS.containsMatchIn(t))
    }

    // ---- timer ------------------------------------------------------------------------------
    private val TIMER_WORD = Regex("\\b(timer|countdown|taimar)\\b")
    private val DURATION = Regex(
        "(\\d+(?:\\.\\d+)?|[a-z]+)\\s*(seconds?|secs?|sec|sekand|second|s\\b|minutes?|mins?|min|minat|minute|m\\b|hours?|hrs?|hr|ghante|ghanta|ghanto|h\\b)"
    )

    private fun parseTimerRule(u: U) = parseTimer(u.t)

    private fun parseTimer(t: String): Command? {
        if (!TIMER_WORD.containsMatchIn(t)) return null
        var total = 0.0
        for (m in DURATION.findAll(t)) {
            val n = m.groupValues[1].toDoubleOrNull() ?: HINDI_NUM[m.groupValues[1]]?.toDouble()
                ?: (if (m.groupValues[1] == "aadha" || m.groupValues[1] == "half") 0.5 else null) ?: continue
            val unit = m.groupValues[2]
            total += when {
                unit.startsWith("s") -> n
                unit.startsWith("m") -> n * 60
                else -> n * 3600
            }
        }
        if (Regex("\\b(saade|sadhe)\\b").containsMatchIn(t) && t.contains("ghant")) total += 1800
        if (total <= 0) return Command.Ask(t)
        return Command.Timer(total.toInt(), null)
    }

    // ---- alarm ------------------------------------------------------------------------------
    private val ALARM_WORD = Regex("\\b(alarm|alaram|wake me|utha dena|utha do|uthana|jaga dena|jagana|jaga do)\\b")

    private fun parseAlarmRule(u: U) = parseAlarm(u.t)

    private fun parseAlarm(t: String): Command? {
        if (!ALARM_WORD.containsMatchIn(t)) return null
        val time = parseTime(t) ?: return Command.Ask(t)
        return Command.Alarm(time.first, time.second, null)
    }

    /** Returns (hour 0-23, minute) or null. */
    fun parseTime(t: String): Pair<Int, Int>? {
        var hour: Int? = null
        var minute = 0

        Regex("\\b(\\d{1,2})[:.](\\d{2})\\b").find(t)?.let {
            hour = it.groupValues[1].toInt(); minute = it.groupValues[2].toInt()
        }
        if (hour == null) {
            Regex("\\b(\\d{1,2}|[a-z]+)\\s*(baje|bje|o'?clock|am|pm|a\\.m\\.|p\\.m\\.)").findAll(t).firstNotNullOfOrNull { m ->
                m.groupValues[1].toIntOrNull() ?: HINDI_NUM[m.groupValues[1]]
            }?.let { hour = it }
        }
        if (hour == null) {
            // "alarm 7" / "7 ka alarm" / "subah 6"
            Regex("\\b(\\d{1,2})\\b").find(t)?.let { hour = it.groupValues[1].toInt() }
        }
        var h = hour ?: return null
        // saade 7 = 7:30, sawa 7 = 7:15, paune 7 = 6:45
        when {
            Regex("\\b(saade|sadhe|saadhe)\\b").containsMatchIn(t) && minute == 0 -> minute = 30
            Regex("\\b(sawa|savva|sava)\\b").containsMatchIn(t) && minute == 0 -> minute = 15
            Regex("\\b(paune|pone)\\b").containsMatchIn(t) && minute == 0 -> { minute = 45; h = (h + 11) % 12 }
        }
        val pm = Regex("\\b(pm|p\\.m\\.|shaam|sham|evening|raat|night|dopahar|dopehar|afternoon)\\b").containsMatchIn(t)
        val am = Regex("\\b(am|a\\.m\\.|subah|morning|savere|sawere)\\b").containsMatchIn(t)
        if (pm && h < 12) {
            h += 12
            if (Regex("\\b(dopahar|dopehar|afternoon)\\b").containsMatchIn(t) && h >= 12 + 6) h -= 12
        }
        if (Regex("\\b(raat|night)\\b").containsMatchIn(t) && hour == 12) h = 0
        if (am && h == 12) h = 0
        if (h !in 0..23 || minute !in 0..59) return null
        return h to minute
    }

    // ---- contacts: who ---------------------------------------------------------------------------
    private val NOT_A_NAME = setOf("", "me", "mujhe", "mujhko", "back", "later", "baad mein", "the call", "call", "phone", "it", "us", "isko", "usko", "abhi", "ye", "yeh", "number")

    private fun cleanWho(raw: String): String? {
        val w = raw.trim()
            .replace(Regex("^(mere|meri|mera|my|apne|apni|apna|to|the|on|ko|se)\\s+"), "")
            .replace(Regex("\\s+(ko|se|ke|ka|ki|ji ko|on|pe|par)$"), "")
            .replace(Regex("^(mere|meri|mera|my)\\s+"), "")
            .trim()
        return w.takeIf { it !in NOT_A_NAME && it.length <= 40 && !it.contains(Regex("\\d{5,}")) }
    }

    private fun textAfterConnector(s: String): String? =
        Regex("(?:^|\\s)(?:ki|that|saying|bolo ki|likho ki|:|-)\\s+(.+)$").find(" $s")?.groupValues?.get(1)?.trim()

    // ---- whatsapp -------------------------------------------------------------------------------
    private val WA = Regex("\\b(whatsapp|whats app|watsapp|watsap|whatsap|vatsap|watsaap|whatsaap)\\b")
    private val WA_BIZ = Regex("\\b(whatsapp business|business whatsapp|wa business|whats app business|watsapp business|business wala whatsapp|business wale whatsapp)\\b")

    private fun parseWhatsApp(u: U): Command? {
        var t = u.t
        val business = WA_BIZ.containsMatchIn(t)
        if (business) t = t.replace(Regex("\\b(business wala|business wale|business)\\b"), " ").replace(Regex("\\s+"), " ").trim()
        if (!WA.containsMatchIn(t)) {
            // "video call Rahul" without the word WhatsApp → WhatsApp video call (Android has no generic video call).
            Regex("^(?:(.+?)\\s+(?:ko|se)\\s+video call(?:\\s+(?:karo|kar do|lagao|milao))?|video call\\s+(?:karo\\s+)?(.+?))$").find(t)?.let { m ->
                val who = cleanWho(m.groupValues[1].ifEmpty { m.groupValues[2] }) ?: return null
                return Command.WhatsApp(WaAction.VIDEO_CALL, who, business = business)
            }
            return null
        }
        if (has(t, "\\breply\\b|\\bjawab\\b") || has(t, "\\bnotifications?\\b")) return null
        val rest = t.replace(WA, " WA ").replace(Regex("\\s+"), " ").trim()
        // Bare "WhatsApp kholo" / "open WhatsApp" → open the app.
        if (Regex("^(?:open|launch|start|khol|kholo|chalao)?\\s*(?:the\\s+)?WA\\s*(?:app)?\\s*(?:kholo|khol do|khol|open karo|open kar do|open|chalao|chala do|start karo)?$").matches(rest))
            return Command.OpenApp(if (business) "whatsapp business" else "whatsapp")

        val action = when {
            has(t, "\\bvideo\\s*call\\b") -> WaAction.VIDEO_CALL
            has(t, "\\b(call|phone|fone|voice call|kol)\\b") -> WaAction.VOICE_CALL
            has(t, "\\b(padho|padh ke sunao|padhkar sunao|padh do|sunao|read|last messages?|messages? batao|kya likha)\\b") -> WaAction.READ
            has(t, "\\b(message|msg|text|bhejo|bhej do|bhej|likho|send|saying|that|bolo)\\b") || has(rest, "\\bWA\\s+(?:karo|kar do)\\s+(?:ki|that)\\b") -> WaAction.SEND
            else -> WaAction.OPEN
        }

        val whoPatterns = listOf(
            Regex("^(.+?)\\s+(?:ko|ke|ka|ki|se)\\s+(?:WA|video call|call)\\b"),
            Regex("^WA\\s+(?:pe|par|par se|mein|me|on|se)\\s+(.+?)\\s+(?:ko|ke|ka|ki|se)\\b"),
            Regex("^WA\\s+(?:pe|par|mein|me|on)\\s+(.+?)\\s+(?:wala|wali)?\\s*(?:chat|message|msg)"),
            Regex("^(?:WA\\s+)?(?:video call|voice call|call)\\s+(.+?)(?:\\s+on\\s+WA)?$"),
            Regex("^(?:send\\s+(?:a\\s+)?WA(?:\\s+message)?|WA\\s+message|message|text|WA|call|voice call|video call|open\\s+(?:WA\\s+)?chat|chat)\\s+(?:to|with)?\\s*(.+?)(?:\\s+on\\s+WA)?(?:\\s+(?:saying|that|ki)\\s+.*)?$"),
            Regex("^(?:read|open)\\s+(?:my\\s+)?(?:WA\\s+)?(?:messages?|chat)\\s+(?:from|with|of)\\s+(.+?)(?:\\s+on\\s+WA)?$"),
            Regex("^(.+?)\\s+(?:ki|ka|ke)\\s+(?:WA\\s+)?(?:chat|messages?)\\b"),
        )
        var who: String? = null
        for (re in whoPatterns) {
            val m = re.find(rest) ?: continue
            who = cleanWho(m.groupValues[1].replace("WA", " ").replace(Regex("\\s+"), " "))
            if (who != null) break
        }
        if (who == null) return if (action == WaAction.OPEN) Command.OpenApp(if (business) "whatsapp business" else "whatsapp") else null

        var text = ""
        if (action == WaAction.SEND) {
            text = textAfterConnector(t.substringAfter(who, t))
                ?: Regex("\\b(?:bhejo|bhej do|send karo|send)\\s+(.+)$").find(t)?.groupValues?.get(1)
                ?: ""
            text = text.replace(Regex("\\s+(?:bhejo|bhej do|send karo|send|on whatsapp|whatsapp pe|whatsapp par)$"), "").trim()
            text = u.recase(text)
        }
        return Command.WhatsApp(action, who, text, business)
    }

    // ---- notifications ------------------------------------------------------------------------
    private val NOTIF = "(?:notifications?|notification|notifs?|notifiction|notifikeshan)"

    private fun parseNotifications(u: U): Command? {
        val t = u.t
        val otp = has(t, "\\b(otp|verification code|code)\\b")
        if (has(t, "\\b$NOTIF\\b") && has(t, "\\b(clear|hatao|hata do|saaf|dismiss|delete|mita|mitao|remove|band karo)\\b")) return Command.ClearNotifications
        if (has(t, "\\b$NOTIF\\b") && has(t, "\\b(padho|padh|padhkar|sunao|batao|read|kya hai|kya hain|check|bolo)\\b")) return Command.ReadNotifications(otp)
        if (has(t, "^(?:koi\\s+)?(?:naya|naye|new)\\s+(?:message|messages|msg|msgs)\\s*(?:aaya|aaye|hai|hain|aaya hai|aaye hain)?(?:\\s+kya)?$|^(?:any|read)\\s+(?:my\\s+)?new\\s+messages$|^what are my notifications$|^read my notifications$"))
            return Command.ReadNotifications(otp)
        if (has(t, "^(?:otp|code)\\s+(?:kya hai|padho|batao|bolo|sunao)$|^(?:read|what'?s|what is)\\s+(?:the|my)\\s+otp$|^otp\\s+(?:bhi\\s+)?(?:padho|sunao)$"))
            return Command.ReadNotifications(true)
        if (!has(t, "\\b(reply|jawab)\\b")) return null
        val patterns = listOf(
            Regex("^reply\\s+to\\s+(.+?)\\s+(?:saying|that|with|:)\\s*(.*)$"),
            Regex("^(?:(.+?)\\s+(?:ko|ke message ka|ke msg ka|ka|ke))?\\s*(?:reply|jawab)(?:\\s+(?:karo|kar do|bhejo|do|de do|send karo|bhej do))?(?:\\s+(?:ki|that|saying|:))?\\s*(.*)$"),
        )
        for (re in patterns) {
            val m = re.find(t) ?: continue
            val to = m.groupValues[1].takeIf { it.isNotBlank() }?.let { cleanWho(it) }
            val body = m.groupValues[2].replace(Regex("^(?:karo|kar do|bhejo|do)\\s+"), "").replace(Regex("^(?:ki|that|saying)\\s+"), "").trim()
            return Command.ReplyNotification(to, u.recase(body))
        }
        return null
    }

    // ---- call / sms -------------------------------------------------------------------------
    private val NUMBER = Regex("(\\+?\\d[\\d\\s-]{2,}\\d)")
    private val CALL_WORD = Regex("\\b(call|dial|phone|fone|ring|kol)\\b")

    private fun cleanNumber(s: String) = s.replace(Regex("[\\s-]"), "")

    private fun parseCallRule(u: U): Command? {
        val t = u.t
        if (!CALL_WORD.containsMatchIn(t)) return null
        if (has(t, "\\b(lock|unlock|silent|vibrate|mute|restart|switch off|charge|battery|settings|kholo|open|uthao|kaato)\\b")) return null
        NUMBER.find(t)?.let { return Command.Dial(cleanNumber(it.groupValues[1])) }
        val patterns = listOf(
            Regex("^(.+?)\\s+(?:ko|se|ke paas|pe|par)\\s+(?:call|phone|fone|ring|kol|dial)(?:\\s+(?:karo|kar do|kardo|lagao|laga do|milao|mila do|kar|lagana|karna|karo na|kar dena|lagaao))?$"),
            Regex("^(?:call|phone|ring|dial|kol)(?:\\s+(?:karo|kar do|lagao|milao|kar))?\\s+(.+?)(?:\\s+ko)?(?:\\s+(?:on|pe|par)\\s+(?:mobile|phone|speaker))?$"),
            Regex("^(?:make a call to|give a call to|give)\\s+(.+?)(?:\\s+a call)?$"),
        )
        for (re in patterns) {
            val m = re.find(t) ?: continue
            val who = cleanWho(m.groupValues[1]) ?: continue
            return Command.CallContact(who)
        }
        return null
    }

    private val SMS_WORD = Regex("\\b(sms|message|msg|text|massage)\\b")

    private fun parseSmsRule(u: U): Command? {
        val t = u.t
        if (!SMS_WORD.containsMatchIn(t)) return null
        if (t.contains("whatsapp")) return null
        if (NUMBER.containsMatchIn(t)) return parseSms(t, u.original)
        val patterns = listOf(
            Regex("^(.+?)\\s+(?:ko|ke liye|ke paas)\\s+(?:sms|message|msg|text|massage)(?:\\s+(?:bhejo|bhej do|karo|kar do|send karo|send kar do|likho|bhejna|karna))?(?:\\s+(?:ki|that|saying|:))?\\s*(.*)$"),
            Regex("^(?:send\\s+(?:an?\\s+)?(?:sms|message|text)\\s+to|sms|message|msg|text)\\s+(.+?)\\s+(?:ki|that|saying|:)\\s+(.+)$"),
            Regex("^(?:send\\s+(?:an?\\s+)?(?:sms|message|text)\\s+to|sms|message|msg|text)\\s+(\\S+)\\s*(.*)$"),
        )
        for (re in patterns) {
            val m = re.find(t) ?: continue
            val who = cleanWho(m.groupValues[1]) ?: continue
            if (who.startsWith("send") || who == "a" || who == "an") continue
            val body = m.groupValues[2].replace(Regex("^(?:ki|that|saying|:)\\s+"), "")
                .replace(Regex("\\s+(?:bhejo|bhej do|send karo|send)$"), "").trim()
            return Command.SmsContact(who, u.recase(body))
        }
        return null
    }

    private fun parseSms(t: String, original: String): Command? {
        val n = NUMBER.find(t) ?: return null
        val number = cleanNumber(n.groupValues[1])
        // Text after the number, keeping the user's original casing.
        val idx = original.lowercase().indexOf(n.groupValues[1].trim())
        var body = if (idx >= 0) original.substring(idx + n.groupValues[1].trim().length) else t.substring(n.range.last + 1)
        body = body.trim()
            .replace(Regex("^(ko|pe|par|to|on)\\b\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^(sms|message|msg|text)\\s*(bhejo|bhej do|karo|kar do|send karo|send)?\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("^(ki|ke|that|saying|bolo|likho|:|-)\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*(bhejo|bhej do|send karo|send|bhej)$", RegexOption.IGNORE_CASE), "")
            .trim()
        if (body.isEmpty()) {
            Regex("\\b(ki|that|saying)\\s+(.+)$", RegexOption.IGNORE_CASE).find(original)?.let { body = it.groupValues[2].trim() }
        }
        return Command.Sms(number, body)
    }

    // ---- media ----------------------------------------------------------------------------------
    private val MEDIA_WORD = "(?:gaana|gana|gaane|gane|song|songs|music|track|video|geet|audio)"

    private fun parseMediaKey(u: U): Command? {
        val t = u.t
        val media = has(t, "\\b$MEDIA_WORD\\b")
        return when {
            has(t, "^(pause|pause karo|pause kar do|resume|skip|next|previous|prev)$") -> when (t.substringBefore(' ')) {
                "pause" -> Command.MediaKey(MediaAction.PAUSE)
                "resume" -> Command.MediaKey(MediaAction.PLAY)
                "previous", "prev" -> Command.MediaKey(MediaAction.PREVIOUS)
                else -> Command.MediaKey(MediaAction.NEXT)
            }
            !media && !has(t, "\\b(pause|resume|skip)\\b") -> null
            has(t, "\\b(agla|agle|next|skip|aage wala|aage)\\b") -> Command.MediaKey(MediaAction.NEXT)
            has(t, "\\b(pichhla|pichla|pichle|pichhle|previous|prev|peeche wala|pehle wala|last wala)\\b") -> Command.MediaKey(MediaAction.PREVIOUS)
            has(t, "\\b(roko|rok do|rok|pause|band karo|band kar do|band|stop|ruko|thamo)\\b") -> Command.MediaKey(MediaAction.PAUSE)
            has(t, "\\b(resume|chalu karo|chalu kar do|phir se chalao|wapas chalao|continue|unpause)\\b") -> Command.MediaKey(MediaAction.PLAY)
            else -> null
        }
    }

    private val PLAY_END = Regex("^(.+?)\\s+(?:bajao|baja do|bajaao|bajado|bajana|sunao|suna do|chalao|chala do|laga do|lagao|play karo|play kar do|play)$")
    private val PLAY_START = Regex("^(?:play|bajao|suno|listen to|put on)\\s+(.+)$")
    private val APP_ON = Regex("\\s*\\b(?:on|pe|par|mein|me|in|se)\\s+(youtube music|yt music|youtube|you tube|yt|spotify)\\b\\s*|^\\s*(youtube music|yt music|youtube|you tube|spotify)\\s+(?:pe|par|mein|me|on|se)\\s+")

    private fun parsePlay(u: U): Command? {
        var t = u.t
        if (t.startsWith("play store") || t.contains("playstore")) return null
        var app: MediaApp? = null
        APP_ON.find(t)?.let { m ->
            val name = m.groupValues[1].ifEmpty { m.groupValues[2] }
            app = when {
                name.contains("music") -> MediaApp.YOUTUBE_MUSIC
                name.contains("spotify") -> MediaApp.SPOTIFY
                else -> MediaApp.YOUTUBE
            }
            t = t.replaceRange(m.range, " ").replace(Regex("\\s+"), " ").trim()
        }
        val q = PLAY_END.find(t)?.groupValues?.get(1) ?: PLAY_START.find(t)?.groupValues?.get(1) ?: return null
        val weak = Regex("\\s(chalao|chala do|lagao|laga do|sunao|suna do)$").containsMatchIn(t)
        if (weak && app == null && !has(t, "\\b$MEDIA_WORD\\b")) return null // "youtube chalao" = open app, "news sunao" = ask TARGET
        var query = q.trim()
            .replace(Regex("\\s+(?:ke|ka|ki)\\s+(?:gaane|gane|gaana|gana|songs|song)$"), "")
            .replace(Regex("\\s+(?:gaane|gane|gaana|gana|songs|song|wala gaana|wale gaane)$"), "")
            .replace(Regex("^(?:koi|ek|kuch|a|some|the|mera|meri|my)\\s+"), "")
            .trim()
        if (query.isEmpty() || query in setOf("gaana", "gana", "gaane", "music", "song", "songs", "koi gaana", "kuch", "something", "geet", "video")) {
            return if (app == null) Command.MediaKey(MediaAction.PLAY) else Command.PlayMedia("", app)
        }
        query = u.recase(query)
        return Command.PlayMedia(query, app)
    }

    // ---- camera ---------------------------------------------------------------------------------
    private val CAMERA_ASK = Regex("^(?:camera\\s+(?:se|kholke|khol ke|khol kar|kholkar)\\s+(?:dekho|dekh ke batao|dekhkar batao|dekh kar batao|batao|dekh)|camera\\s+(?:dekho|vision)|photo\\s+(?:kheench|khinch|khich|le|lekar|leke)\\s*(?:ke|kar)?\\s+batao|look\\s+(?:through|with|using)\\s+(?:the\\s+|my\\s+)?camera|use\\s+(?:the\\s+)?camera\\s+(?:to|and)\\s+(?:see|look|tell)|scan\\s+(?:this|karo|kar do))\\b\\s*(?:aur|and|ki|ke|:)?\\s*(.*)$")

    private fun parseCamera(u: U): Command? {
        val m = CAMERA_ASK.find(u.t) ?: return null
        val q = m.groupValues[1].trim()
        return Command.CameraAsk(if (q.isEmpty()) "" else u.recase(q))
    }

    // ---- screen (accessibility) -----------------------------------------------------------------
    private fun parseScreen(u: U): Command? {
        val t = u.t
        val shot = has(t, "\\b(screenshot ke saath|screenshot bhi|with (?:a )?screenshot|photo ke saath|photo bhi)\\b")
        if (has(t, "^(?:screen|page|ye page|yeh page|is page)\\s+(?:padho|padh do|padhkar sunao|padh ke sunao|sunao)$|^read\\s+(?:the|this|my)?\\s*(?:screen|page)(?:\\s+(?:aloud|to me))?$|^screen\\s+(?:pe|par)\\s+kya\\s+likha\\s+hai$"))
            return Command.ReadScreen
        Regex("^(?:screen|is screen|ye screen|yeh screen|meri screen)\\s+(?:dekho|dekh ke batao|dekhkar batao|dekh kar batao|samjhao|explain karo|ke baare mein batao|ke bare mein batao|ko dekho)(?:\\s+(?:screenshot ke saath|screenshot bhi))?\\s*(?:aur|and|ki|:)?\\s*(.*)$").find(t)?.let {
            return Command.AskScreen(u.recase(it.groupValues[1].replace(Regex("\\b(screenshot ke saath|screenshot bhi)\\b"), "").trim()), shot)
        }
        Regex("^(?:ask about (?:this |the |my )?screen|what'?s on (?:my |the |this )?screen|what is on (?:my |the |this )?screen|explain (?:this|the) screen|look at (?:my|the|this) screen)\\s*(?:with (?:a )?screenshot)?\\s*(?:and|:)?\\s*(.*)$").find(t)?.let {
            return Command.AskScreen(u.recase(it.groupValues[1]), shot)
        }
        // tap / click
        Regex("^(.+?)\\s+(?:pe|par|per)\\s+(?:tap|click|touch)\\s*(?:karo|kar do|kardo)?$").find(t)?.let { return Command.Tap(u.recase(it.groupValues[1])) }
        Regex("^(?:tap|click|press|touch)\\s+(?:on\\s+)?(?:the\\s+)?(.+?)(?:\\s+button)?$").find(t)?.let { return Command.Tap(u.recase(it.groupValues[1])) }
        Regex("^(.+?)\\s+(?:button\\s+)?(?:dabao|daba do|dabaiye)$").find(t)?.let { return Command.Tap(u.recase(it.groupValues[1].removeSuffix(" button"))) }
        // type
        Regex("^(?:type|likho|likh do|type karo)\\s*:?\\s+(.+)$").find(t)?.let { return Command.TypeText(u.recase(it.groupValues[1])) }
        Regex("^(.+?)\\s+(?:type karo|type kar do|likh do|likho)$").find(t)?.let { m ->
            if (!has(t, "\\b(sms|message|msg|whatsapp)\\b")) return Command.TypeText(u.recase(m.groupValues[1]))
        }
        // scroll / swipe
        if (has(t, "\\bscroll\\b")) return Command.Scroll(down = !has(t, "\\b(up|upar|oopar|top)\\b"))
        if (has(t, "^(?:neeche|niche|neeche jao|page down)$")) return Command.Scroll(true)
        if (has(t, "\\bswipe\\b")) {
            val d = when {
                has(t, "\\b(left|baayein|bayen|baaye|left side)\\b") -> Direction.LEFT
                has(t, "\\b(right|daayein|dayen|daaye)\\b") -> Direction.RIGHT
                has(t, "\\b(down|neeche|niche)\\b") -> Direction.DOWN
                else -> Direction.UP
            }
            return Command.Swipe(d)
        }
        return null
    }

    private fun parseGlobal(u: U): Command? {
        val t = u.t
        return when {
            has(t, "^(?:back|go back|wapas|wapas jao|peeche jao|piche jao|pichhe jao|back jao|back karo|back dabao)$") -> Command.Global(GlobalAction.BACK)
            has(t, "^(?:home|go home|go to home screen|home jao|home pe jao|home par jao|home screen(?: pe jao| par jao| kholo| dikhao)?)$") -> Command.Global(GlobalAction.HOME)
            has(t, "\\b(recent apps|recents|app switcher|overview)\\b|^recent\\s+(?:kholo|dikhao)$") -> Command.Global(GlobalAction.RECENTS)
            has(t, "\\bquick settings\\b") -> Command.Global(GlobalAction.QUICK_SETTINGS)
            has(t, "\\b(notifications?|notification)\\s+(?:panel|shade|bar)\\b|^(?:notifications?|notification)\\s+(?:kholo|khol do|dikhao|open karo)$|^(?:open|show|pull down)\\s+(?:the\\s+)?notifications?$") -> Command.Global(GlobalAction.NOTIFICATIONS)
            has(t, "\\bunlock\\b") -> null
            has(t, "^(?:(?:phone|screen|mobile)\\s+)?lock(?:\\s+(?:karo|kar do|kardo|kar))?$|^lock\\s+(?:the\\s+|my\\s+)?(?:phone|screen)$") -> Command.Global(GlobalAction.LOCK)
            has(t, "^(?:screenshot|screen shot)(?:\\s+(?:lo|le lo|lelo|le|khicho|khincho|kheencho|khich lo|karo|kar do|lena))?$|^take\\s+(?:a\\s+)?screenshot$|^screen\\s+ki\\s+photo\\s+(?:lo|le lo)$") -> Command.Global(GlobalAction.SCREENSHOT)
            else -> null
        }
    }

    // ---- system ---------------------------------------------------------------------------------
    private fun parseVolume(u: U): Command? {
        val t = u.t
        if (has(t, "^(?:mute|mute karo|mute kar do|phone mute karo)$")) return Command.Volume(VolumeAction.MUTE)
        if (has(t, "^(?:unmute|unmute karo|unmute kar do)$")) return Command.Volume(VolumeAction.UNMUTE)
        if (!has(t, "\\b(volume|awaaz|awaz|aawaz|aavaaz|sound|aawaj|awaj)\\b")) return null
        return when {
            has(t, "\\b(unmute|wapas|chalu|on)\\b") && !has(t, "\\b(up|badhao)\\b") -> Command.Volume(VolumeAction.UNMUTE)
            has(t, "\\b(full|max|maximum|poora|pura|sabse tez|poori|puri)\\b") -> Command.Volume(VolumeAction.MAX)
            has(t, "\\b(mute|band|off|zero|bilkul band|khatam)\\b") -> Command.Volume(VolumeAction.MUTE)
            has(t, "\\b(kam|dheere|dheema|dheemi|down|decrease|lower|reduce|quieter|neeche|halka|halki|ghatao|ghata do|low)\\b") -> Command.Volume(VolumeAction.DOWN)
            has(t, "\\b(badhao|badha do|badhaao|tez|zyada|jyada|up|increase|louder|high|upar|bada|raise|badha)\\b") -> Command.Volume(VolumeAction.UP)
            else -> null
        }
    }

    private fun parseRinger(u: U): Command? {
        val t = u.t
        return when {
            has(t, "\\bsilent\\b") -> if (has(t, "\\b(hatao|hata do|off|band|remove|normal|nikalo|disable)\\b")) Command.Ringer(RingerMode.NORMAL) else Command.Ringer(RingerMode.SILENT)
            has(t, "\\b(vibrate|vibration|vibrat|vibrator)\\b") -> if (has(t, "\\b(off|band|hatao)\\b")) Command.Ringer(RingerMode.NORMAL) else Command.Ringer(RingerMode.VIBRATE)
            has(t, "^(?:ringer|ring)\\s+(?:on|normal|chalu)|\\b(normal|general|ring|ringing)\\s+mode\\b") -> Command.Ringer(RingerMode.NORMAL)
            else -> null
        }
    }

    private fun parseDnd(u: U): Command? {
        val t = u.t
        if (!has(t, "\\b(dnd|do not disturb|don'?t disturb|disturb mat karo|disturb mat karna|focus mode)\\b")) return null
        return Command.Dnd(!has(t, "\\b(off|band|bandh|hatao|hata do|disable|nikalo|khatam|turn off)\\b"))
    }

    private fun parseBrightness(u: U): Command? {
        val t = u.t
        if (!has(t, "\\b(brightness|roshni|chamak|screen light|display light|brighter|dimmer)\\b")) return null
        Regex("\\b(\\d{1,3})\\s*(%|percent|pratishat|pratisat)").find(t)?.let { return Command.Brightness(it.groupValues[1].toInt().coerceIn(0, 100), null) }
        Regex("\\b(?:brightness|roshni)\\s+(\\d{1,3})\\b").find(t)?.let { return Command.Brightness(it.groupValues[1].toInt().coerceIn(0, 100), null) }
        return when {
            has(t, "\\b(full|max|maximum|poori|puri|sabse zyada)\\b") -> Command.Brightness(100, null)
            has(t, "\\b(kam|low|down|dim|dimmer|decrease|reduce|ghatao|halki|minimum|min)\\b") -> Command.Brightness(null, false)
            else -> Command.Brightness(null, true)
        }
    }

    private fun parsePanel(u: U): Command? {
        val t = u.t
        val panel = when {
            has(t, "\\b(wifi|wi-fi|wi fi|vaifai|wai fai)\\b") -> Panel.WIFI
            has(t, "\\b(bluetooth|blutooth|bluetoot|bt)\\b") -> Panel.BLUETOOTH
            has(t, "\\b(hotspot|hot spot|tethering)\\b") -> Panel.HOTSPOT
            has(t, "\\b(airplane|aeroplane|aeroplan|flight|hawai jahaz)\\s*mode\\b|\\bflight mod\\b") -> Panel.AIRPLANE
            has(t, "\\b(battery|power)\\s+(saver|save|saving)\\b") -> Panel.BATTERY_SAVER
            has(t, "\\bnfc\\b") -> Panel.NFC
            has(t, "\\b(mobile data|cellular data|cellular|mobile internet)\\b|^(?:data|internet)\\s+(?:on|off|band|chalu|kholo)|\\b(?:data|internet)\\s+(?:on|off|band|chalu)\\s+(?:karo|kar do)\\b") -> Panel.MOBILE_DATA
            has(t, "\\b(location|gps|lokeshan)\\b") && has(t, "\\b(on|off|band|chalu|kholo|settings|turn)\\b") -> Panel.LOCATION
            else -> return null
        }
        val on = when {
            has(t, "\\b(off|band|bandh|disable|hatao|turn off)\\b") -> false
            has(t, "\\b(on|chalu|enable|turn on|start)\\b") -> true
            else -> null
        }
        return Command.SettingsPanel(panel, on)
    }

    // ---- battery ----------------------------------------------------------------------------
    private fun parseBatteryRule(u: U): Command? {
        val t = u.t
        return if (Regex("\\b(battery|charge|charging|betri)\\b").containsMatchIn(t) && !t.startsWith("open ")) Command.Battery else null
    }

    // ---- places -----------------------------------------------------------------------------
    private fun parseNearby(u: U): Command? {
        val t = u.t
        if (!has(t, "\\b(paas|pass|nazdeek|najdeek|nazdik|aas paas|aaspaas|near me|nearby|nearest|closest|kareeb|qareeb|around me)\\b")) return null
        if (has(t, "\\b(rasta|raasta|route|navigate|directions?)\\b")) return null
        val what = t.replace(Regex("\\b(paas|pass|nazdeek|najdeek|nazdik|aas paas|aaspaas|near me|nearby|nearest|closest|kareeb|qareeb|around me|mein|me|mere|mujhe|sabse|kahan|kaha|kidhar|hai|hain|dhoondo|dhundo|dikhao|batao|find|show|where is|where'?s|the|a|an|koi|any|ka|ki|ke|wala|wali|search|karo)\\b"), " ")
            .replace(Regex("\\s+"), " ").trim()
        if (what.isEmpty()) return null
        return Command.Nearby(what)
    }

    private fun parseNavigateRule(u: U) = parseNavigate(u.t)

    private fun parseNavigate(t: String): Command? {
        Regex("^(?:navigate|navigation|directions?|route|rasta|raasta|le chalo|take me)\\s+(?:to\\s+|for\\s+)?(.+)$").find(t)?.let {
            return Command.Navigate(it.groupValues[1].trim())
        }
        Regex("^(.+?)\\s+(?:ka|ki|ke)\\s+(?:rasta|raasta|route|direction|directions)(?:\\s+.*)?$").find(t)?.let {
            return Command.Navigate(it.groupValues[1].trim())
        }
        Regex("^(.+?)\\s+(?:kaise jaye|kaise jaayein|kaise jau|kaise pahunche|kaise pahuche|le chalo)$").find(t)?.let {
            return Command.Navigate(it.groupValues[1].trim())
        }
        return null
    }

    // ---- open app / url ---------------------------------------------------------------------
    private val DOMAIN = Regex("^([a-z0-9-]+\\.)+[a-z]{2,}(/\\S*)?$")

    private fun parseOpenRule(u: U) = parseOpen(u.t)

    private fun parseOpen(t: String): Command? {
        val name = Regex("^(?:open|launch|start|khol|kholo|chalao)\\s+(?:the\\s+)?(.+?)(?:\\s+(?:app|application))?$").find(t)?.groupValues?.get(1)
            ?: Regex("^(.+?)\\s+(?:app\\s+)?(?:kholo|khol do|khol|open karo|open kar do|open kar|open|chalao|chala do|start karo|launch karo)$").find(t)?.groupValues?.get(1)
            ?: return null
        val clean = name.trim().removeSuffix(" app").trim()
        if (clean.isEmpty()) return null
        if (clean.startsWith("http://") || clean.startsWith("https://")) return Command.OpenUrl(clean)
        if (DOMAIN.matches(clean)) return Command.OpenUrl("https://$clean")
        return Command.OpenApp(clean)
    }
}
