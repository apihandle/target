package app.target.assistant.brain

/** Turns a TARGET chat reply (markdown, source blocks, status lines) into a short text that sounds right when spoken. */
object SpeechText {
    fun clean(markdown: String, maxChars: Int = 700): String {
        var s = markdown
            .replace(Regex("```[\\s\\S]*?(```|$)"), " ")           // code / sources / card fences
            .replace(Regex("\\[connection interrupted]"), " ")
            .replace(Regex("(?m)^>\\s.*$"), " ")                  // "> Signing in" status lines
            .replace(Regex("(?m)^_\\(.*\\)_\\s*$"), " ")            // italic notes
            .replace(Regex("!\\[[^]]*]\\([^)]*\\)"), " ")           // images
            .replace(Regex("\\[([^]]+)]\\((?:[^)]+)\\)"), "$1")     // links → their text
            .replace(Regex("https?://\\S+"), " ")
            .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s*"), "")         // headings
            .replace(Regex("(?m)^\\s*[-*+•]\\s+"), "")             // bullets
            .replace(Regex("(?m)^\\s*\\d+[.)]\\s+"), "")           // numbered lists
            .replace(Regex("[*_`~|]+"), "")
            .replace(Regex("\\s*\\n\\s*"), ". ")
            .replace(Regex("\\.\\s*\\.(\\s*\\.)*"), ".")
            .replace(Regex("\\s+"), " ")
            .trim()
            .trim('.', ' ')
        if (s.length > maxChars) {
            val cut = s.take(maxChars)
            val end = maxOf(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("। "))
            s = if (end > maxChars / 2) cut.substring(0, end + 1) else cut.substringBeforeLast(' ') + "…"
        }
        return s
    }

    private val OTP = Regex(
        "\\b(otp|one[- ]?time (?:password|code)|verification code|security code|passcode|login code|auth(?:entication)? code|pin)\\b|ओटीपी|सत्यापन कोड",
        RegexOption.IGNORE_CASE,
    )
    private val CODE_WITH_DIGITS = Regex("\\bcode\\b[^0-9]{0,20}\\d{4,8}|\\d{4,8}[^0-9]{0,20}\\bcode\\b", RegexOption.IGNORE_CASE)

    /** True for OTP / verification-code notifications: these are not read aloud unless the user asks. */
    fun isSensitive(title: String?, text: String?): Boolean {
        val all = (title.orEmpty() + " " + text.orEmpty())
        return OTP.containsMatchIn(all) || CODE_WITH_DIGITS.containsMatchIn(all)
    }
}
