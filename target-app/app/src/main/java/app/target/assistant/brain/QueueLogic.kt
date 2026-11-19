package app.target.assistant.brain

/** One question waiting for the network. */
data class QueuedItem(val id: Long, val text: String, val createdAt: Long, val attempts: Int = 0)

/**
 * Offline queue rules (pure Kotlin, unit-tested): what gets queued, what expires, and what happens to each
 * item when the network is back. Storage (Room) and sending (JobScheduler) live in net/OfflineQueue.
 */
object QueueLogic {
    const val MAX_ITEMS = 20
    const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
    const val MAX_ATTEMPTS = 3
    /** The same question said twice within this window is queued once. */
    const val DUPLICATE_WINDOW_MS = 2 * 60 * 1000L

    enum class Send { OK, OFFLINE, NOT_SIGNED_IN, FAILED }

    fun normalize(text: String) = text.trim().replace(Regex("\\s+"), " ")

    fun shouldAdd(existing: List<QueuedItem>, text: String, now: Long): Boolean {
        val t = normalize(text)
        if (t.isEmpty()) return false
        return existing.none { normalize(it.text).equals(t, ignoreCase = true) && now - it.createdAt < DUPLICATE_WINDOW_MS }
    }

    /** Items to delete before adding more: expired ones, then the oldest beyond [MAX_ITEMS] (counting [adding] new ones). */
    fun overflow(existing: List<QueuedItem>, now: Long, adding: Int = 0): List<QueuedItem> {
        val expired = existing.filter { now - it.createdAt > MAX_AGE_MS }
        val alive = (existing - expired.toSet()).sortedBy { it.createdAt }
        val extra = (alive.size + adding - MAX_ITEMS).coerceAtLeast(0)
        return expired + alive.take(extra)
    }

    data class Plan(
        val sent: List<QueuedItem>,
        /** Still queued (attempt count updated). */
        val keep: List<QueuedItem>,
        /** Given up: expired, too many failures, or not signed in (the user is told). */
        val dropped: List<QueuedItem>,
        /** True when the job should run again later (network dropped mid-way or a retryable failure). */
        val reschedule: Boolean,
    )

    /** Sends oldest first. Stops at the first OFFLINE (the rest wait for the next network). */
    fun drain(items: List<QueuedItem>, now: Long, send: (QueuedItem) -> Send): Plan {
        val sent = ArrayList<QueuedItem>(); val keep = ArrayList<QueuedItem>(); val dropped = ArrayList<QueuedItem>()
        var offline = false
        for (item in items.sortedBy { it.createdAt }) {
            if (now - item.createdAt > MAX_AGE_MS) { dropped += item; continue }
            if (offline) { keep += item; continue }
            when (send(item)) {
                Send.OK -> sent += item
                Send.OFFLINE -> { offline = true; keep += item }
                Send.NOT_SIGNED_IN -> dropped += item
                Send.FAILED -> {
                    val next = item.copy(attempts = item.attempts + 1)
                    if (next.attempts >= MAX_ATTEMPTS) dropped += next else keep += next
                }
            }
        }
        return Plan(sent, keep, dropped, reschedule = keep.isNotEmpty())
    }
}
