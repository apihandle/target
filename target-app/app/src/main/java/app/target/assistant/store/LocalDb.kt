package app.target.assistant.store

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import app.target.assistant.brain.QueuedItem

/** One line of the local chat history (only on this phone). role = "user" | "assistant". */
@Entity(tableName = "chat_history")
data class ChatEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val role: String,
    val text: String,
    val conversationId: String?,
    val createdAt: Long,
    /** true while the question waits in the offline queue. */
    val queued: Boolean = false,
)

@Entity(tableName = "offline_queue")
data class QueuedEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val text: String,
    val createdAt: Long,
    val attempts: Int = 0,
) {
    fun toItem() = QueuedItem(id, text, createdAt, attempts)
    companion object { fun of(i: QueuedItem) = QueuedEntity(i.id, i.text, i.createdAt, i.attempts) }
}

@Dao
interface ChatDao {
    @Insert fun insert(e: ChatEntry): Long
    @Query("SELECT * FROM chat_history ORDER BY createdAt DESC, id DESC LIMIT :limit") fun recent(limit: Int): List<ChatEntry>
    @Query("SELECT COUNT(*) FROM chat_history") fun count(): Int
    @Query("UPDATE chat_history SET queued = 0 WHERE role = 'user' AND queued = 1 AND text = :text") fun markSent(text: String)
    @Query("DELETE FROM chat_history WHERE id NOT IN (SELECT id FROM chat_history ORDER BY createdAt DESC, id DESC LIMIT :keep)") fun trim(keep: Int)
    @Query("DELETE FROM chat_history") fun clear()
}

@Dao
interface QueueDao {
    @Insert fun insert(e: QueuedEntity): Long
    @Query("SELECT * FROM offline_queue ORDER BY createdAt ASC, id ASC") fun all(): List<QueuedEntity>
    @Update fun update(list: List<QueuedEntity>)
    @Query("DELETE FROM offline_queue WHERE id IN (:ids)") fun delete(ids: List<Long>)
    @Query("DELETE FROM offline_queue") fun clear()
}

@Database(entities = [ChatEntry::class, QueuedEntity::class], version = 1, exportSchema = false)
abstract class LocalDb : RoomDatabase() {
    abstract fun chat(): ChatDao
    abstract fun queue(): QueueDao

    companion object {
        const val HISTORY_KEEP = 500
        @Volatile private var instance: LocalDb? = null

        /** Do not call on the main thread (Room refuses main-thread queries). */
        fun get(context: Context): LocalDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, LocalDb::class.java, "target-local.db")
                .fallbackToDestructiveMigration(true)
                .build().also { instance = it }
        }
    }
}
