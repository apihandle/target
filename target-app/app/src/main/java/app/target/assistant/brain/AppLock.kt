package app.target.assistant.brain

/**
 * Optional app lock: when on, opening TARGET (chats, settings) needs fingerprint / face / screen lock.
 * After a successful unlock the app stays open for [GRACE_MS] even if the user switches away briefly.
 */
object AppLock {
    const val GRACE_MS = 60_000L

    @Volatile private var lastUnlockAt = 0L
    @Volatile private var lastPausedAt = 0L

    fun needsUnlock(enabled: Boolean, now: Long, unlockedAt: Long = lastUnlockAt, pausedAt: Long = lastPausedAt): Boolean {
        if (!enabled) return false
        if (unlockedAt == 0L) return true
        // Still in the foreground session, or back within the grace period.
        val lastSeen = maxOf(unlockedAt, pausedAt)
        return now - lastSeen > GRACE_MS
    }

    fun unlocked(now: Long) { lastUnlockAt = now; lastPausedAt = now }
    fun paused(now: Long) { if (lastUnlockAt != 0L) lastPausedAt = now }
    fun reset() { lastUnlockAt = 0L; lastPausedAt = 0L }
}
