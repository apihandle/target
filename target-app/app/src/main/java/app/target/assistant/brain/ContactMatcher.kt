package app.target.assistant.brain

import java.text.Normalizer

/** One phone number of one contact, as read from the address book. */
data class ContactEntry(
    val id: Long,
    val name: String,
    val number: String,
    val label: String? = null,
    val starred: Boolean = false,
    val timesContacted: Int = 0,
)

/** A contact with how well it matched the spoken name (0..1). */
data class ContactMatch(val contact: ContactEntry, val score: Double)

/**
 * Fuzzy "spoken name → contact" matching. Pure Kotlin so it is unit-tested on the JVM.
 * Handles Hinglish spelling drift (Rahul/Raahul, Sharma/Sarma, Pooja/Puja), relation words
 * (mummy/maa/mom, papa/dad, bhaiya/bhai, didi/di …) and honorifics (ji, sir).
 */
object ContactMatcher {

    /** Relation groups: a spoken relation word matches a contact saved under any word of the same group. */
    private val RELATIONS: List<Set<String>> = listOf(
        setOf("mummy", "mumma", "mummi", "mom", "mommy", "maa", "ma", "mother", "ammi", "amma", "mata", "mataji", "mai", "aai"),
        setOf("papa", "pappa", "dad", "daddy", "father", "pitaji", "pita", "abbu", "baba", "bauji", "babuji", "pappu papa"),
        setOf("bhaiya", "bhaiyya", "bhai", "bro", "brother", "bhaijaan", "veer", "bhaisaab"),
        setOf("didi", "di", "sister", "behen", "behan", "behna", "sis", "didu", "dii"),
        setOf("wife", "biwi", "patni", "wifey", "begum", "gharwali"),
        setOf("husband", "pati", "hubby", "patidev", "gharwala"),
        setOf("dadi", "daadi", "nani", "naani", "grandma", "granny", "grandmother"),
        setOf("dadaji", "daadaji", "nanaji", "naanaji", "nana", "grandpa", "grandfather"),
        setOf("chacha", "chachu", "mama", "mamu", "mamaji", "tauji", "uncle", "fufa", "mausa"),
        setOf("chachi", "mami", "maami", "mausi", "bua", "aunty", "aunt", "tai", "taiji"),
        setOf("beta", "son", "beti", "daughter"),
    )

    private val HONORIFICS = setOf("ji", "jee", "sir", "madam", "mam", "maam", "mr", "mrs", "ms", "dr", "shri", "sri", "smt")

    private val normRelations: List<Set<String>> by lazy { RELATIONS.map { g -> g.map { normalize(it) }.toSet() } }

    /** Lowercase, strip accents/emoji/punctuation, and flatten common Hinglish spelling variants. */
    fun normalize(raw: String): String {
        val roman = Translit.romanize(raw).lowercase()
        val decomposed = Normalizer.normalize(roman, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
        val letters = decomposed.replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()
        return letters.split(' ').filter { it.isNotEmpty() }.joinToString(" ") { flatten(it) }
    }

    private fun flatten(word: String): String {
        var w = word
            .replace("ph", "f").replace("sh", "s").replace("kh", "k").replace("bh", "b").replace("th", "t")
            .replace("dh", "d").replace("gh", "g").replace("ch", "c").replace("jh", "j")
            .replace("ee", "i").replace("oo", "u").replace("w", "v").replace("z", "j").replace("q", "k")
        w = w.replace(Regex("(.)\\1+"), "$1") // double letters (aa, nn, tt) → one
        if (w.length > 2 && w.endsWith("y")) w = w.dropLast(1) + "i"
        if (w.length > 2 && w.endsWith("h")) w = w.dropLast(1)
        return w
    }

    private fun tokens(normalized: String): List<String> =
        normalized.split(' ').filter { it.isNotEmpty() && it !in HONORIFICS }

    /** The relation group a spoken word belongs to, or -1. */
    fun relationGroup(spoken: String): Int {
        val n = tokens(normalize(spoken)).joinToString(" ")
        if (n.isEmpty()) return -1
        return normRelations.indexOfFirst { n in it }
    }

    fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    private fun similarity(a: String, b: String): Double {
        val m = maxOf(a.length, b.length)
        return if (m == 0) 1.0 else 1.0 - levenshtein(a, b).toDouble() / m
    }

    /** How well the spoken [query] matches a saved contact [name], 0..1. */
    fun score(query: String, name: String): Double {
        val q = tokens(normalize(query))
        val n = tokens(normalize(name))
        if (q.isEmpty() || n.isEmpty()) return 0.0
        val qs = q.joinToString(" ")
        val ns = n.joinToString(" ")
        if (qs == ns) return 1.0

        // Relation words: "mummy" ↔ "Mom", "Maa", "Mummy ❤️".
        val rel = normRelations.indexOfFirst { qs in it }
        if (rel >= 0) {
            val group = normRelations[rel]
            if (n.any { it in group } || (n.size >= 2 && n.windowed(2).any { it.joinToString(" ") in group })) return 0.97
        }

        // All spoken tokens match name tokens (exact or prefix): "rahul" ↔ "Rahul Sharma", "rahul sh" ↔ "Rahul Sharma".
        val allPrefix = q.all { qt -> n.any { nt -> nt == qt || (qt.length >= 3 && nt.startsWith(qt)) } }
        if (allPrefix) return if (q.size == n.size) 0.95 else 0.9

        // Fuzzy per token: average of each spoken token's best match.
        val perToken = q.map { qt -> n.maxOf { nt -> similarity(qt, nt) } }
        val tokenScore = perToken.average() * 0.92
        val whole = similarity(qs, ns) * 0.9
        return maxOf(tokenScore, whole)
    }

    const val THRESHOLD = 0.72

    /**
     * Best contacts for [query], best first, one entry per distinct number.
     * Ties are broken by starred and how often the contact was used.
     */
    fun match(query: String, contacts: List<ContactEntry>, limit: Int = 5): List<ContactMatch> {
        val seen = HashSet<String>()
        return contacts.asSequence()
            .map { ContactMatch(it, score(query, it.name)) }
            .filter { it.score >= THRESHOLD }
            .sortedWith(
                compareByDescending<ContactMatch> { it.score }
                    .thenByDescending { it.contact.starred }
                    .thenByDescending { it.contact.timesContacted }
                    .thenBy { it.contact.name.length },
            )
            .filter { seen.add(it.contact.name.lowercase() + "|" + phoneKey(it.contact.number)) }
            .take(limit)
            .toList()
    }

    /** True when the first match is clearly the one meant (no need to ask "kaun sa?"). */
    fun isConfident(matches: List<ContactMatch>): Boolean {
        val first = matches.firstOrNull() ?: return false
        if (matches.size == 1) return first.score >= 0.8
        val second = matches[1]
        val sameNumber = phoneKey(first.contact.number) == phoneKey(second.contact.number)
        if (sameNumber) return first.score >= 0.8
        return first.score >= 0.94 && first.score - second.score >= 0.04
    }

    /** Last 10 digits: "+91 98765-43210" and "098765 43210" are the same phone. */
    fun phoneKey(number: String): String = number.filter { it.isDigit() }.takeLast(10)

    /**
     * Number for a wa.me link: digits only with country code. A bare 10-digit Indian mobile
     * gets 91 in front, a leading 0 trunk prefix is dropped.
     */
    fun waNumber(number: String, defaultCountryCode: String = "91"): String {
        val plus = number.trim().startsWith("+")
        var d = number.filter { it.isDigit() }
        if (plus) return d
        if (d.startsWith("00")) return d.drop(2)
        if (d.length == 11 && d.startsWith("0")) d = d.drop(1)
        return if (d.length == 10) defaultCountryCode + d else d
    }

    private val ORDINALS = listOf(
        setOf("1", "ek", "pehla", "pahla", "pehle", "pahle", "pehli", "first", "one", "pehla wala", "pehle wala", "pehli wali"),
        setOf("2", "do", "dusra", "doosra", "dusre", "doosre", "dusri", "doosri", "second", "two", "dusra wala", "dusre wala"),
        setOf("3", "teen", "tisra", "teesra", "tisre", "teesre", "tisri", "teesri", "third", "three"),
        setOf("4", "char", "chaar", "chautha", "chauthe", "fourth", "four"),
        setOf("5", "paanch", "panch", "paanchva", "panchva", "fifth", "five"),
    )

    /**
     * Which of [choices] the user picked by saying "pehla", "dusra wala", "2", "number 3" or (part of) a name.
     * Returns the index or -1.
     */
    fun pickChoice(answer: String, choices: List<String>): Int {
        val a = answer.lowercase().replace(Regex("[^a-z0-9\\u0900-\\u097F ]"), " ").replace(Regex("\\s+"), " ").trim()
            .removePrefix("number ").removePrefix("no ").removeSuffix(" wala").removeSuffix(" wali").removeSuffix(" vala").trim()
        if (a.isEmpty()) return -1
        val idx = ORDINALS.indexOfFirst { set -> a in set || a.split(' ').any { it in set && it.length > 2 } }
        if (idx >= 0 && idx < choices.size) return idx
        var best = -1
        var bestScore = 0.0
        choices.forEachIndexed { i, c ->
            val s = score(a, c)
            if (s > bestScore) { bestScore = s; best = i }
        }
        return if (bestScore >= THRESHOLD) best else -1
    }
}
