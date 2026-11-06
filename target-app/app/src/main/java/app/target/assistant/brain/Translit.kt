package app.target.assistant.brain

/**
 * Devanagari → Roman (Hinglish) so commands heard by the hi-IN recognizer ("मम्मी को कॉल करो")
 * reach the same parser as typed Hinglish ("mummy ko call karo"). Word by word: the output has
 * exactly as many space-separated words as the input, so text can be mapped back to the original.
 * Common command words come from a small dictionary; the rest are transliterated letter by letter.
 */
object Translit {

    private val WORDS_RAW = mapOf(
        "मम्मी" to "mummy", "मम्मा" to "mumma", "माँ" to "maa", "मां" to "maa", "मा" to "maa", "पापा" to "papa", "पिताजी" to "pitaji",
        "भैया" to "bhaiya", "भइया" to "bhaiya", "भाई" to "bhai", "दीदी" to "didi", "बहन" to "behen", "दादी" to "dadi", "नानी" to "nani",
        "चाचा" to "chacha", "मामा" to "mama", "मौसी" to "mausi", "बुआ" to "bua", "बीवी" to "biwi", "पत्नी" to "patni", "पति" to "pati",
        "कॉल" to "call", "काल" to "call", "फोन" to "phone", "फ़ोन" to "phone", "मैसेज" to "message", "मेसेज" to "message", "संदेश" to "message",
        "एसएमएस" to "sms", "व्हाट्सएप" to "whatsapp", "व्हाट्सऐप" to "whatsapp", "वॉट्सऐप" to "whatsapp", "वॉट्सएप" to "whatsapp", "व्हाट्सअप" to "whatsapp",
        "बिजनेस" to "business", "बिज़नेस" to "business", "वीडियो" to "video", "वॉइस" to "voice",
        "करो" to "karo", "कर" to "kar", "करना" to "karna", "दो" to "do", "दे" to "de", "देना" to "dena", "भेजो" to "bhejo", "भेज" to "bhej",
        "खोलो" to "kholo", "खोल" to "khol", "बंद" to "band", "चालू" to "chalu", "लगाओ" to "lagao", "लगा" to "laga", "लगाना" to "lagana",
        "बजाओ" to "bajao", "बजा" to "baja", "चलाओ" to "chalao", "चला" to "chala", "सुनाओ" to "sunao", "पढ़ो" to "padho", "पढ़कर" to "padhkar",
        "पढ़" to "padh", "बताओ" to "batao", "बता" to "bata", "उठाओ" to "uthao", "उठा" to "utha", "काटो" to "kaato", "काट" to "kaat",
        "रोको" to "roko", "रोक" to "rok", "देखो" to "dekho", "देख" to "dekh", "लिखो" to "likho", "जलाओ" to "jalao", "बुझाओ" to "bujhao",
        "बढ़ाओ" to "badhao", "बढ़ा" to "badha", "घटाओ" to "ghatao", "कम" to "kam", "ज़्यादा" to "zyada", "ज्यादा" to "zyada", "तेज़" to "tez", "तेज" to "tez",
        "याद" to "yaad", "दिलाना" to "dilana", "दिला" to "dila", "दिलाओ" to "dilao", "कल" to "kal", "परसों" to "parson", "आज" to "aaj",
        "बजे" to "baje", "सुबह" to "subah", "शाम" to "shaam", "रात" to "raat", "दोपहर" to "dopahar", "मिनट" to "minute", "घंटे" to "ghante",
        "घंटा" to "ghanta", "सेकंड" to "second", "बाद" to "baad", "साढ़े" to "saade", "सवा" to "sawa", "पौने" to "paune", "आधा" to "aadha",
        "को" to "ko", "से" to "se", "पर" to "par", "पे" to "pe", "का" to "ka", "की" to "ki", "के" to "ke", "में" to "mein", "मे" to "me",
        "मैं" to "main", "है" to "hai", "हैं" to "hain", "हूँ" to "hoon", "हूं" to "hoon", "हो" to "ho", "और" to "aur", "फिर" to "phir",
        "नहीं" to "nahi", "ना" to "na", "मत" to "mat", "हाँ" to "haan", "हां" to "haan", "हा" to "haan", "जी" to "ji", "ठीक" to "theek", "बस" to "bas",
        "अलार्म" to "alarm", "टाइमर" to "timer", "टॉर्च" to "torch", "टार्च" to "torch", "फ्लैश" to "flash", "लाइट" to "light",
        "गाना" to "gaana", "गाने" to "gaane", "गीत" to "geet", "म्यूजिक" to "music", "म्यूज़िक" to "music", "संगीत" to "music",
        "अगला" to "agla", "पिछला" to "pichhla", "यूट्यूब" to "youtube", "स्पॉटिफाई" to "spotify", "स्पोटिफाई" to "spotify",
        "स्क्रीन" to "screen", "स्क्रीनशॉट" to "screenshot", "कैमरा" to "camera", "फोटो" to "photo", "फ़ोटो" to "photo",
        "नोटिफिकेशन" to "notification", "नोटिफिकेशंस" to "notifications", "नोटिफिकेशन्स" to "notifications", "सूचनाएं" to "notifications",
        "रिप्लाई" to "reply", "जवाब" to "jawab", "आवाज़" to "awaaz", "आवाज" to "awaaz", "वॉल्यूम" to "volume", "ब्राइटनेस" to "brightness",
        "साइलेंट" to "silent", "वाइब्रेट" to "vibrate", "वाईफाई" to "wifi", "वाई-फाई" to "wifi", "ब्लूटूथ" to "bluetooth", "हॉटस्पॉट" to "hotspot",
        "डेटा" to "data", "डाटा" to "data", "इंटरनेट" to "internet", "लॉक" to "lock", "बैटरी" to "battery", "सेटिंग्स" to "settings",
        "रास्ता" to "rasta", "पास" to "paas", "नज़दीक" to "nazdeek", "नजदीक" to "nazdeek", "कहाँ" to "kahan", "कहां" to "kahan",
        "रूटीन" to "routine", "बनाओ" to "banao", "रिमाइंडर" to "reminder", "कैलेंडर" to "calendar", "मीटिंग" to "meeting",
        "नीचे" to "neeche", "ऊपर" to "upar", "स्क्रॉल" to "scroll", "वापस" to "wapas", "पीछे" to "peeche", "होम" to "home",
        "टाइप" to "type", "क्लिक" to "click", "टैप" to "tap", "दबाओ" to "dabao", "बाय" to "bye", "टारगेट" to "target", "हे" to "hey",
        "ओके" to "ok", "प्लीज़" to "please", "प्लीज" to "please", "ज़रा" to "zara", "जरा" to "zara", "क्या" to "kya", "मेरे" to "mere",
        "मेरी" to "meri", "मेरा" to "mera", "मुझे" to "mujhe", "आ" to "aa", "रहा" to "raha", "रही" to "rahi", "गया" to "gaya",
    )

    /** Keys in NFD so precomposed and decomposed nukta letters both match. */
    private val WORDS: Map<String, String> = WORDS_RAW.mapKeys { nfd(it.key) }

    private fun nfd(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)

    private val INDEPENDENT = mapOf(
        'अ' to "a", 'आ' to "aa", 'इ' to "i", 'ई' to "ee", 'उ' to "u", 'ऊ' to "oo", 'ऋ' to "ri", 'ए' to "e", 'ऐ' to "ai",
        'ओ' to "o", 'औ' to "au", 'ऑ' to "o", 'ऍ' to "e",
    )
    private val MATRA = mapOf(
        'ा' to "aa", 'ि' to "i", 'ी' to "ee", 'ु' to "u", 'ू' to "oo", 'ृ' to "ri", 'े' to "e", 'ै' to "ai", 'ो' to "o", 'ौ' to "au",
        'ॉ' to "o", 'ॅ' to "e",
    )
    private val CONSONANT = mapOf(
        'क' to "k", 'ख' to "kh", 'ग' to "g", 'घ' to "gh", 'ङ' to "n", 'च' to "ch", 'छ' to "chh", 'ज' to "j", 'झ' to "jh", 'ञ' to "n",
        'ट' to "t", 'ठ' to "th", 'ड' to "d", 'ढ' to "dh", 'ण' to "n", 'त' to "t", 'थ' to "th", 'द' to "d", 'ध' to "dh", 'न' to "n",
        'प' to "p", 'फ' to "ph", 'ब' to "b", 'भ' to "bh", 'म' to "m", 'य' to "y", 'र' to "r", 'ल' to "l", 'व' to "v", 'श' to "sh",
        'ष' to "sh", 'स' to "s", 'ह' to "h", 'ळ' to "l",
    )
    /** Letters written with a nukta (base + U+093C after NFD). */
    private val NUKTA_FORM = mapOf('क' to "q", 'ख' to "kh", 'ग' to "g", 'ज' to "z", 'ड' to "r", 'ढ' to "rh", 'फ' to "f", 'य' to "y")
    private const val VIRAMA = '\u094D'
    private const val NUKTA = '\u093C'

    fun hasDevanagari(s: String): Boolean = s.any { it in '\u0900'..'\u097F' }

    /** Whole text, word by word. Danda (।) becomes a full stop; Devanagari digits become 0-9. */
    fun romanize(text: String): String {
        if (!hasDevanagari(text)) return text
        val clean = nfd(text).replace('\u0964', '.').replace('\u0965', '.')
        return clean.split(' ').joinToString(" ") { romanizeWord(it) }
    }

    fun romanizeWord(word: String): String {
        if (!hasDevanagari(word)) return word
        // Keep leading/trailing punctuation around the dictionary lookup.
        val core = word.trim { !(it in '\u0900'..'\u097F' || it.isLetterOrDigit()) }
        val start = word.indexOf(core)
        val pre = if (start > 0) word.substring(0, start) else ""
        val post = if (start >= 0) word.substring(start + core.length) else ""
        WORDS[core]?.let { return pre + it + post }
        return pre + letters(core) + post
    }

    private fun letters(w: String): String {
        val sb = StringBuilder()
        var i = 0
        while (i < w.length) {
            val c = w[i]
            val nukta = w.getOrNull(i + 1) == NUKTA
            when {
                c in '\u0966'..'\u096F' -> sb.append('0' + (c - '\u0966'))
                INDEPENDENT.containsKey(c) -> sb.append(INDEPENDENT[c])
                CONSONANT.containsKey(c) -> {
                    sb.append(if (nukta) NUKTA_FORM[c] ?: CONSONANT[c] else CONSONANT[c])
                    if (nukta) i++
                    val next = w.getOrNull(i + 1)
                    when {
                        next == VIRAMA -> i++ // half letter: no vowel
                        next != null && MATRA.containsKey(next) -> { sb.append(MATRA[next]); i++ }
                        next == null -> {} // schwa dropped at word end
                        CONSONANT.containsKey(next) || next == 'ं' || next == 'ँ' || next == 'ः' -> sb.append('a')
                        else -> {}
                    }
                }
                MATRA.containsKey(c) -> sb.append(MATRA[c])
                c == 'ं' || c == 'ँ' -> sb.append('n')
                c == 'ः' -> sb.append('h')
                c == VIRAMA || c == NUKTA -> {}
                else -> sb.append(c)
            }
            i++
        }
        return sb.toString()
    }
}
