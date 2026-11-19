package app.target.assistant.store

import android.content.Context
import java.util.concurrent.Executors

/** Local chat history (Room). Writes go to a background thread; reads are blocking (call off the main thread). */
object ChatHistory {
    private val io = Executors.newSingleThreadExecutor()

    fun add(context: Context, role: String, text: String, conversationId: String?, queued: Boolean = false) {
        val app = context.applicationContext
        val now = System.currentTimeMillis()
        io.execute {
            runCatching {
                val dao = LocalDb.get(app).chat()
                dao.insert(ChatEntry(role = role, text = text.take(8000), conversationId = conversationId, createdAt = now, queued = queued))
                dao.trim(LocalDb.HISTORY_KEEP)
            }
        }
    }

    fun recent(context: Context, limit: Int = 50): List<ChatEntry> = runCatching { LocalDb.get(context).chat().recent(limit) }.getOrDefault(emptyList())

    fun clear(context: Context, done: () -> Unit = {}) {
        val app = context.applicationContext
        io.execute { runCatching { LocalDb.get(app).chat().clear() }; done() }
    }

    /** Runs [block] on the history thread (keeps ordering with [add]). */
    fun onIo(block: () -> Unit) = io.execute(block)
}
