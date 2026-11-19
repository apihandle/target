package app.target.assistant.store

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.SharedPreferencesMigration
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.target.assistant.brain.Routine
import app.target.assistant.brain.Routines
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking

/** Routines ("subah ka routine" → steps) live in Preferences DataStore. Old SharedPreferences data is migrated once. */
private val Context.routineDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "routines",
    produceMigrations = { ctx -> listOf(SharedPreferencesMigration(ctx, "target_prefs", setOf("routines"))) },
)

object RoutineStore {
    private val KEY = stringPreferencesKey("routines")

    fun flow(context: Context): Flow<List<Routine>> =
        context.applicationContext.routineDataStore.data.map { Routines.fromJson(it[KEY]) }

    suspend fun update(context: Context, change: (List<Routine>) -> List<Routine>) {
        context.applicationContext.routineDataStore.edit { p -> p[KEY] = Routines.toJson(change(Routines.fromJson(p[KEY]))) }
    }

    /** Blocking read (small, cached by DataStore after the first load). */
    fun get(context: Context): List<Routine> = runBlocking { flow(context).first() }

    /** Blocking write. */
    fun set(context: Context, list: List<Routine>) = runBlocking { update(context) { list } }
}
