package app.target.assistant.update

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Background update check (WorkManager, needs a network connection). */
class UpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (!UpdatePrefs.isAutoUpdate(applicationContext)) return Result.success()
        return when (val r = UpdateManager.check(applicationContext)) {
            is UpdateResult.Failed -> if (r.retryable && runAttemptCount < 3) Result.retry() else Result.success()
            else -> Result.success()
        }
    }
}

object UpdateScheduler {
    private const val PERIODIC = "target-update-periodic"
    private const val ON_LAUNCH = "target-update-launch"

    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Called on app launch: one check now plus the ~6 h periodic check, when auto-update is on. */
    fun onAppLaunch(context: Context) {
        // Debug builds are signed with a different key, so a release update could never install on them.
        if (!UpdatePrefs.isAutoUpdate(context) || app.target.assistant.BuildConfig.DEBUG) {
            cancel(context)
            return
        }
        val wm = WorkManager.getInstance(context)
        wm.enqueueUniquePeriodicWork(
            PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS, 1, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build(),
        )
        wm.enqueueUniqueWork(
            ON_LAUNCH,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<UpdateWorker>().setConstraints(constraints).build(),
        )
    }

    fun cancel(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(PERIODIC)
        wm.cancelUniqueWork(ON_LAUNCH)
    }
}
