package app.target.assistant.util

import android.app.Activity
import android.content.Intent
import app.target.assistant.GuardActivity
import app.target.assistant.brain.AppLock
import app.target.assistant.settings.Prefs

/** Optional app lock for the TARGET screens (chats, settings): fingerprint / face / screen lock via GuardActivity. */
object AppLockGate {
    @Volatile private var inProgress = false

    fun onResume(a: Activity) {
        if (inProgress || !AppLock.needsUnlock(Prefs(a).appLock, System.currentTimeMillis())) return
        inProgress = true
        a.window.decorView.alpha = 0f // nothing private shows behind the prompt
        GuardActivity.callback = { ok ->
            inProgress = false
            if (ok) { AppLock.unlocked(System.currentTimeMillis()); a.window.decorView.alpha = 1f } else a.finish()
        }
        a.startActivity(Intent(a, GuardActivity::class.java))
    }

    fun onPause() = AppLock.paused(System.currentTimeMillis())
}
