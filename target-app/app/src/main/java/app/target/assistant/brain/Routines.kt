package app.target.assistant.brain

import org.json.JSONArray
import org.json.JSONObject

/** A named list of commands run one after another ("subah ka routine"). */
data class Routine(val name: String, val steps: List<String>)

/** Routine parsing, matching and storage format. Pure Kotlin apart from org.json. */
object Routines {

    /** "alarm 6 baje, torch on; news phir whatsapp kholo" → ["alarm 6 baje", "torch on", "news", "whatsapp kholo"]. One per line works too. */
    fun splitSteps(text: String): List<String> =
        text.split(Regex("\\s*(?:\\n|,|;|\\||\\bphir\\b|\\bthen\\b|\\buske baad\\b|\\bfir\\b|\\band then\\b)\\s*", RegexOption.IGNORE_CASE))
            .map { it.trim().trim('.', '-', '•').trim() }
            .filter { it.isNotEmpty() }

    /** Key used to compare routine names: "Subah ka routine" == "subah wala" == "subah". */
    fun key(name: String): String =
        name.lowercase()
            .replace(Regex("[^a-z0-9\\u0900-\\u097F ]"), " ")
            .replace(Regex("\\b(ka|ki|ke|wala|wali|vala|mera|meri|my|the|routine|routin|macro)\\b"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    /** Best routine for a spoken name, or null. */
    fun find(spoken: String, routines: List<Routine>): Routine? {
        val k = key(spoken)
        if (k.isEmpty()) return null
        routines.firstOrNull { key(it.name) == k }?.let { return it }
        val scored = routines.map { it to ContactMatcher.score(k, key(it.name)) }.maxByOrNull { it.second }
        return scored?.takeIf { it.second >= ContactMatcher.THRESHOLD }?.first
    }

    /** Insert or replace by name. */
    fun upsert(list: List<Routine>, r: Routine): List<Routine> =
        list.filter { key(it.name) != key(r.name) } + r

    fun toJson(list: List<Routine>): String = JSONArray().apply {
        list.forEach { r -> put(JSONObject().put("name", r.name).put("steps", JSONArray(r.steps))) }
    }.toString()

    fun fromJson(json: String?): List<Routine> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val a = JSONArray(json)
            (0 until a.length()).mapNotNull { i ->
                val o = a.optJSONObject(i) ?: return@mapNotNull null
                val s = o.optJSONArray("steps") ?: JSONArray()
                Routine(o.optString("name"), (0 until s.length()).map { s.optString(it) }.filter { it.isNotBlank() })
            }.filter { it.name.isNotBlank() }
        } catch (_: Exception) {
            emptyList()
        }
    }
}
