package app.target.assistant.brain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Routine storage format (kept in DataStore as one JSON string). Uses real org.json (test dependency). */
class RoutinesJsonTest {
    @Test fun roundTrip() {
        val list = listOf(Routine("subah", listOf("alarm band", "torch on", "aaj ki news")), Routine("raat", listOf("dnd on")))
        assertEquals(list, Routines.fromJson(Routines.toJson(list)))
    }
    @Test fun hindiAndQuotesSurvive() {
        val list = listOf(Routine("सुबह", listOf("मम्मी को \"good morning\" bhejo")))
        assertEquals(list, Routines.fromJson(Routines.toJson(list)))
    }
    @Test fun badJsonIsEmpty() {
        assertTrue(Routines.fromJson("{not json").isEmpty())
        assertTrue(Routines.fromJson(null).isEmpty())
        assertTrue(Routines.fromJson("").isEmpty())
    }
    @Test fun blankNamesAndStepsDropped() {
        val r = Routines.fromJson("""[{"name":"","steps":["a"]},{"name":"x","steps":["", "b"]},{"steps":["c"]}]""")
        assertEquals(listOf(Routine("x", listOf("b"))), r)
    }
    @Test fun upsertThenFindThroughJson() {
        var list = Routines.fromJson(null)
        list = Routines.upsert(list, Routine("Subah", Routines.splitSteps("alarm 6 baje, torch on")))
        list = Routines.fromJson(Routines.toJson(list))
        assertEquals(listOf("alarm 6 baje", "torch on"), Routines.find("subah ka routine", list)?.steps)
    }
}
