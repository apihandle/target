package app.target.assistant.brain

import app.target.assistant.brain.QueueLogic.Send
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueLogicTest {
    private val now = 1_000_000_000L
    private fun item(id: Long, text: String, ageMs: Long = 0, attempts: Int = 0) = QueuedItem(id, text, now - ageMs, attempts)

    @Test fun blankNotQueued() = assertFalse(QueueLogic.shouldAdd(emptyList(), "   ", now))
    @Test fun firstQueued() = assertTrue(QueueLogic.shouldAdd(emptyList(), "aaj ka mausam", now))
    @Test fun duplicateWithinWindowSkipped() =
        assertFalse(QueueLogic.shouldAdd(listOf(item(1, "Aaj  ka mausam", 30_000)), "aaj ka mausam ", now))
    @Test fun duplicateAfterWindowQueued() =
        assertTrue(QueueLogic.shouldAdd(listOf(item(1, "aaj ka mausam", QueueLogic.DUPLICATE_WINDOW_MS + 1)), "aaj ka mausam", now))

    @Test fun overflowDropsExpiredThenOldest() {
        val list = (1..QueueLogic.MAX_ITEMS).map { item(it.toLong(), "q$it", ageMs = (100 - it) * 1000L) } +
            item(99, "old", ageMs = QueueLogic.MAX_AGE_MS + 1)
        val drop = QueueLogic.overflow(list, now, adding = 1)
        assertEquals(listOf(99L, 1L), drop.map { it.id })
    }
    @Test fun noOverflowWhenRoom() = assertTrue(QueueLogic.overflow(listOf(item(1, "a")), now, adding = 1).isEmpty())

    @Test fun drainAllOk() {
        val sentTexts = ArrayList<String>()
        val p = QueueLogic.drain(listOf(item(2, "b", 10), item(1, "a", 20)), now) { sentTexts += it.text; Send.OK }
        assertEquals(listOf("a", "b"), sentTexts) // oldest first
        assertEquals(2, p.sent.size); assertTrue(p.keep.isEmpty()); assertFalse(p.reschedule)
    }
    @Test fun drainStopsWhenOffline() {
        var calls = 0
        val p = QueueLogic.drain(listOf(item(1, "a", 30), item(2, "b", 20), item(3, "c", 10)), now) { calls++; if (it.text == "b") Send.OFFLINE else Send.OK }
        assertEquals(2, calls)
        assertEquals(listOf("a"), p.sent.map { it.text })
        assertEquals(listOf("b", "c"), p.keep.map { it.text })
        assertTrue(p.reschedule)
    }
    @Test fun failuresRetriedThenDropped() {
        val p1 = QueueLogic.drain(listOf(item(1, "a")), now) { Send.FAILED }
        assertEquals(1, p1.keep.single().attempts); assertTrue(p1.reschedule)
        val p2 = QueueLogic.drain(listOf(item(1, "a", attempts = QueueLogic.MAX_ATTEMPTS - 1)), now) { Send.FAILED }
        assertTrue(p2.keep.isEmpty()); assertEquals(1, p2.dropped.size); assertFalse(p2.reschedule)
    }
    @Test fun notSignedInDropped() {
        val p = QueueLogic.drain(listOf(item(1, "a")), now) { Send.NOT_SIGNED_IN }
        assertEquals(1, p.dropped.size); assertFalse(p.reschedule)
    }
    @Test fun expiredNotSent() {
        var calls = 0
        val p = QueueLogic.drain(listOf(item(1, "a", QueueLogic.MAX_AGE_MS + 5)), now) { calls++; Send.OK }
        assertEquals(0, calls); assertEquals(1, p.dropped.size)
    }
}

class AppLockTest {
    @Test fun offNeverLocks() = assertFalse(AppLock.needsUnlock(false, 1000, 0, 0))
    @Test fun firstOpenLocks() = assertTrue(AppLock.needsUnlock(true, 1000, 0, 0))
    @Test fun withinGraceOpen() = assertFalse(AppLock.needsUnlock(true, 100_000, unlockedAt = 10_000, pausedAt = 50_000))
    @Test fun afterGraceLocks() = assertTrue(AppLock.needsUnlock(true, 200_000, unlockedAt = 10_000, pausedAt = 50_000))
    @Test fun stateFunctions() {
        AppLock.reset()
        assertTrue(AppLock.needsUnlock(true, 5_000))
        AppLock.unlocked(5_000)
        assertFalse(AppLock.needsUnlock(true, 6_000))
        AppLock.paused(10_000)
        assertFalse(AppLock.needsUnlock(true, 10_000 + AppLock.GRACE_MS))
        assertTrue(AppLock.needsUnlock(true, 10_001 + AppLock.GRACE_MS))
        AppLock.reset()
    }
}
