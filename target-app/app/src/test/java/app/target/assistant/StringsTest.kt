package app.target.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Hinglish (default) and English strings stay in step: same keys, same format arguments, nothing empty. */
class StringsTest {
    private val re = Regex("<string name=\"([^\"]+)\"([^>]*)>(.*?)</string>", RegexOption.DOT_MATCHES_ALL)
    private fun load(dir: String): Map<String, Pair<String, Boolean>> {
        val f = listOf(File("src/main/res/$dir/strings.xml"), File("app/src/main/res/$dir/strings.xml")).first { it.exists() }
        return re.findAll(f.readText()).associate { it.groupValues[1] to (it.groupValues[3] to it.groupValues[2].contains("translatable=\"false\"")) }
    }
    private val hi = load("values")
    private val en = load("values-en")
    private fun args(s: String) = Regex("%\\d\\$[sdf]").findAll(s).map { it.value }.sorted().toList()

    @Test fun sameKeys() {
        val translatable = hi.filterValues { !it.second }.keys
        assertEquals("missing in values-en", emptySet<String>(), translatable - en.keys)
        assertEquals("only in values-en", emptySet<String>(), en.keys - hi.keys)
    }
    @Test fun sameFormatArgs() = hi.forEach { (k, v) -> en[k]?.let { assertEquals(k, args(v.first), args(it.first)) } }
    @Test fun noneEmpty() = (hi + en).forEach { (k, v) -> assertTrue(k, v.first.isNotBlank()) }
    @Test fun hinglishDefaultForUserLines() {
        // Spot checks that the default locale is Hinglish, not English.
        assertEquals("Haan", hi["yes"]?.first)
        assertEquals("Nahi", hi["no"]?.first)
        assertTrue(hi["stt_nothing_heard"]!!.first.contains("sunai"))
    }
}
