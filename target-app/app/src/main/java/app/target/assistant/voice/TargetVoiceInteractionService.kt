package app.target.assistant.voice

import android.service.voice.VoiceInteractionService

/** Present so TARGET can hold the Assistant role. The work happens in [TargetVoiceSession]. */
class TargetVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        Tts.init(this)
    }
}
