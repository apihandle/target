package app.target.assistant.brain

/** Kinds of risky actions. Each needs a spoken "haan"/tap unless its "bina pooche" toggle is on. */
enum class RiskKind(val key: String) {
    CALL("call"),
    SMS("sms"),
    WHATSAPP("whatsapp"),
    NOTIFICATION_REPLY("notification_reply"),
    ANSWER_CALL("answer_call"),
    REJECT_CALL("reject_call"),
    DELETE("delete"),
}

enum class Answer { YES, NO, UNKNOWN }

/** "haan / nahi" in Hinglish + English. Pure Kotlin, unit-tested. */
object ConfirmWords {
    private val NO = Regex(
        "\\b(nahi|nahin|nai|nhi|na|naa|no|nope|nah|mat|cancel|ruko|ruk jao|rehne do|rahne do|chhodo|chodo|chhod do|band karo|stop|galat|wrong|don'?t|do not)\\b",
    )
    private val YES = Regex(
        "\\b(haan|han|haa|ha|hanji|haanji|ji|jee|yes|yeah|yep|yup|ya|ok|okay|okk|sure|confirm|confirmed|done|theek|thik|thik hai|theek hai|bilkul|zaroor|jarur|karo|kar do|kardo|bhejo|bhej do|uthao|utha lo|kaato|kaat do|chalo|go ahead|do it|send|send it|call|haan ji|sahi)\\b",
    )

    fun classify(raw: String): Answer {
        val t = raw.lowercase().replace(Regex("[^a-z' ]"), " ").replace(Regex("\\s+"), " ").trim()
        if (t.isEmpty()) return Answer.UNKNOWN
        // A "no" wins: "nahi, mat karo", "no don't send".
        if (NO.containsMatchIn(t)) return Answer.NO
        if (YES.containsMatchIn(t)) return Answer.YES
        return Answer.UNKNOWN
    }
}

/** Assistant personality: changes the reply style asked of TARGET (a short instruction before the question). */
enum class Persona(val key: String) {
    DEFAULT("default"),
    DOST("dost"),
    PROFESSIONAL("professional");

    /** Instruction put before a question sent to TARGET chat, or "" for none. */
    fun prefix(assistantName: String): String = when (this) {
        DEFAULT -> ""
        DOST -> "[Reply style: tum $assistantName ho, user ke dost. Casual Hinglish, garmjoshi, chhota aur seedha jawab — 2-3 line, bolne layak.] "
        PROFESSIONAL -> "[Reply style: you are $assistantName, a professional assistant. Polite, precise, brief — 2-3 sentences, easy to read aloud.] "
    }

    companion object {
        fun of(key: String?): Persona = entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}
