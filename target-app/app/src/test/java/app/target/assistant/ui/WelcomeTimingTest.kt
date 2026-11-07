package app.target.assistant.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The welcome artwork: a short, bounded show on cold start — never a flash, never a wait. */
class WelcomeTimingTest {

    @Test
    fun staysUntilMinShowEvenWhenPageIsReady() {
        assertFalse(WelcomeTiming.shouldDismiss(0, pageReady = true))
        assertFalse(WelcomeTiming.shouldDismiss(WelcomeTiming.MIN_SHOW_MS - 1, pageReady = true))
    }

    @Test
    fun leavesOncePageIsReadyAfterMinShow() {
        assertTrue(WelcomeTiming.shouldDismiss(WelcomeTiming.MIN_SHOW_MS, pageReady = true))
        assertTrue(WelcomeTiming.shouldDismiss(WelcomeTiming.MIN_SHOW_MS + 500, pageReady = true))
    }

    @Test
    fun waitsForThePageBetweenMinAndMax() {
        assertFalse(WelcomeTiming.shouldDismiss(WelcomeTiming.MIN_SHOW_MS, pageReady = false))
        assertFalse(WelcomeTiming.shouldDismiss(WelcomeTiming.MAX_SHOW_MS - 1, pageReady = false))
    }

    @Test
    fun alwaysLeavesByMaxShowEvenIfPageIsStuck() {
        assertTrue(WelcomeTiming.shouldDismiss(WelcomeTiming.MAX_SHOW_MS, pageReady = false))
        assertTrue(WelcomeTiming.shouldDismiss(WelcomeTiming.MAX_SHOW_MS + 10_000, pageReady = false))
    }
}
