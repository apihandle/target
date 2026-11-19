package app.target.assistant.voice

import android.service.voice.VoiceInteractionService

/** Present so TARGET can hold the Assistant role. The work happens in [TargetVoiceSession]. */
class TargetVoiceInteractionService : VoiceInteractionService() {

    companion object {
        /** Set while the system has us bound as the active assistant (used by "Hey Target"). */
        @Volatile var instance: TargetVoiceInteractionService? = null
            private set
    }

    override fun onReady() {
        super.onReady()
        instance = this
        Tts.init(this)
    }

    override fun onShutdown() {
        instance = null
        super.onShutdown()
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }
}
