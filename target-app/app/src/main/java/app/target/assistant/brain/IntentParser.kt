package app.target.assistant.brain

/**
 * v0.1 "brain": a small local parser for Hinglish + English phone commands.
 * Pure Kotlin (no Android types) so it is unit-tested on the JVM.
 * Anything it does not understand becomes [Command.Ask] and goes to the TARGET web app.
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
}

object IntentParser {

    private val WAKE = Regex("^(hey|hi|ok|okay|ae|oye)?\\s*target[,!.]?\\s*", RegexOption.IGNORE_CASE)
    private val POLITE = Regex("\\b(please|plz|pls|zara|jara|jaldi|kripya)\\b", RegexOption.IGNORE_CASE)

    private val HINDI_NUM = mapOf(
        "ek" to 1, "do" to 2, "teen" to 3, "char" to 4, "chaar" to 4, "paanch" to 5, "panch" to 5,
        "chhe" to 6, "chhah" to 6, "che" to 6, "cheh" to 6, "saat" to 7, "aath" to 8, "nau" to 9, "das" to 10,
        "gyarah" to 11, "gyaarah" to 11, "barah" to 12, "baarah" to 12,
        "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7,
        "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12,
    )

    fun parse(raw: String): Command {
        val original = raw.trim()
        var t = original.lowercase()
            .replace(WAKE, "")
            .replace(POLITE, " ")
            .replace(Regex("[?!]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .trimEnd('.', ',')
        if (t.isEmpty()) return Command.Ask(original)

        parseFlashlight(t)?.let { return it }
        parseTimer(t)?.let { return it }
        parseAlarm(t)?.let { return it }
        parseSms(t, original)?.let { return it }
        parseCall(t)?.let { return it }
        parseBattery(t)?.let { return it }
        parseNavigate(t)?.let { return it }
        parseOpen(t)?.let { return it }
        return Command.Ask(original)
    }

    // ---- flashlight -------------------------------------------------------------------------
    private val TORCH = Regex("\\b(torch|flashlight|flash light|flash|tourch|taarch|torch light)\\b")
    private val OFF_WORDS = Regex("\\b(off|band|bandh|bujha|bujhao|bujha do|stop|hata|hatao|disable)\\b")

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
    private val ALARM_WORD = Regex("\\b(alarm|alaram|wake me|utha dena|utha do|uthana|jaga dena|jagana|jaga do|remind me at)\\b")

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
            // "raat 12" stays midnight-ish handled below; "dopahar 12" stays 12
            h += 12
            if (Regex("\\b(dopahar|dopehar|afternoon)\\b").containsMatchIn(t) && h >= 12 + 6) h -= 12
        }
        if (Regex("\\b(raat|night)\\b").containsMatchIn(t) && hour == 12) h = 0
        if (am && h == 12) h = 0
        if (h !in 0..23 || minute !in 0..59) return null
        return h to minute
    }

    // ---- call / sms -------------------------------------------------------------------------
    private val NUMBER = Regex("(\\+?\\d[\\d\\s-]{2,}\\d)")
    private val CALL_WORD = Regex("\\b(call|dial|phone|fone|ring|kol)\\b")

    private fun cleanNumber(s: String) = s.replace(Regex("[\\s-]"), "")

    private fun parseCall(t: String): Command? {
        if (!CALL_WORD.containsMatchIn(t)) return null
        val n = NUMBER.find(t) ?: return null // "call mummy" needs contacts → web app for now
        return Command.Dial(cleanNumber(n.groupValues[1]))
    }

    private val SMS_WORD = Regex("\\b(sms|message|msg|text|massage)\\b")

    private fun parseSms(t: String, original: String): Command? {
        if (!SMS_WORD.containsMatchIn(t)) return null
        if (t.contains("whatsapp")) return null
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
            // "98… ko sms karo ki main aa raha hoon" — text after "ki"/"that"
            Regex("\\b(ki|that|saying)\\s+(.+)$", RegexOption.IGNORE_CASE).find(original)?.let { body = it.groupValues[2].trim() }
        }
        return Command.Sms(number, body)
    }

    // ---- battery ----------------------------------------------------------------------------
    private fun parseBattery(t: String): Command? =
        if (Regex("\\b(battery|charge|charging|betri)\\b").containsMatchIn(t) && !t.startsWith("open ")) Command.Battery else null

    // ---- navigation -------------------------------------------------------------------------
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
