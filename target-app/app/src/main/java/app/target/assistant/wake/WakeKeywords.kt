package app.target.assistant.wake

/**
 * Keywords for the sherpa-onnx keyword spotter (gigaspeech 3.3M BPE model). Each line is the BPE
 * tokens of the phrase (from the model's bpe.model) + ":boost #threshold @name". Pure Kotlin, unit-tested.
 * Higher boost / lower threshold = triggers more easily (and more false alarms).
 */
object WakeKeywords {
    const val HEY = "HEY_TARGET"
    const val OK = "OK_TARGET"
    const val HI = "HI_TARGET"
    const val BYE = "BYE_TARGET"
    const val ANSWER = "ANSWER_CALL"
    const val REJECT = "REJECT_CALL"

    /** name → BPE tokens (sentencepiece encode of the upper-case phrase). */
    val TOKENS: Map<String, String> = linkedMapOf(
        HEY to "▁HE Y ▁T AR GE T",
        OK to "▁O K ▁T AR GE T",
        HI to "▁HI ▁T AR GE T",
        BYE to "▁BY E ▁T AR GE T",
        ANSWER to "▁AN S W ER ▁CALL",
        REJECT to "▁RE J E C T ▁CALL",
    )

    const val DEFAULT_BOOST = 1.5f
    const val DEFAULT_THRESHOLD = 0.25f

    fun clampBoost(v: Float) = v.coerceIn(0.5f, 3.0f)
    fun clampThreshold(v: Float) = v.coerceIn(0.05f, 0.6f)

    /** keywords.txt content for the given boost / threshold. */
    fun build(boost: Float = DEFAULT_BOOST, threshold: Float = DEFAULT_THRESHOLD): String {
        val b = "%.2f".format(java.util.Locale.ROOT, clampBoost(boost))
        val t = "%.2f".format(java.util.Locale.ROOT, clampThreshold(threshold))
        return TOKENS.entries.joinToString("\n") { (name, tokens) -> "$tokens :$b #$t @$name" } + "\n"
    }

    enum class Hit { WAKE, SLEEP, ANSWER, REJECT, NONE }

    /** What a spotted keyword means ("HEY_TARGET" → WAKE). */
    fun meaning(keyword: String?): Hit = when (keyword?.trim()?.uppercase()?.replace(' ', '_')) {
        HEY, OK, HI -> Hit.WAKE
        BYE -> Hit.SLEEP
        ANSWER -> Hit.ANSWER
        REJECT -> Hit.REJECT
        else -> Hit.NONE
    }

    /** Parses a "<file>\t<sha256>" checksum.txt and returns the hash for [file], or null. */
    fun checksumFor(checksumTxt: String, file: String): String? =
        checksumTxt.lineSequence()
            .map { it.trim().split(Regex("\\s+")) }
            .firstOrNull { it.size >= 2 && (it[0] == file || it[1] == file) }
            ?.let { parts -> parts.firstOrNull { p -> p.matches(Regex("[0-9a-fA-F]{64}")) }?.lowercase() }
}
