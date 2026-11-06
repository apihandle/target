package app.target.assistant.voice

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * Android requires an assistant (VoiceInteractionService) to name a RecognitionService, and makes it the
 * system voice-input service while TARGET is the default assistant. So this is not a stub that breaks
 * voice typing: it forwards every request to the phone's real recognizer (Google etc.).
 */
class TargetRecognitionService : RecognitionService() {

    private var delegate: SpeechRecognizer? = null

    override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
        delegate?.destroy()
        val target = Listener.findDelegate(this)
        if (target == null) {
            listener.error(SpeechRecognizer.ERROR_CLIENT); return
        }
        val r = SpeechRecognizer.createSpeechRecognizer(this, target)
        delegate = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = safe { listener.readyForSpeech(params ?: Bundle()) }
            override fun onBeginningOfSpeech() = safe { listener.beginningOfSpeech() }
            override fun onRmsChanged(rmsdB: Float) = safe { listener.rmsChanged(rmsdB) }
            override fun onBufferReceived(buffer: ByteArray?) = safe { if (buffer != null) listener.bufferReceived(buffer) }
            override fun onEndOfSpeech() = safe { listener.endOfSpeech() }
            override fun onError(error: Int) = safe { listener.error(error) }
            override fun onResults(results: Bundle?) = safe { listener.results(results ?: Bundle()) }
            override fun onPartialResults(partialResults: Bundle?) = safe { listener.partialResults(partialResults ?: Bundle()) }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(recognizerIntent)
    }

    override fun onStopListening(listener: Callback) { delegate?.stopListening() }

    override fun onCancel(listener: Callback) {
        delegate?.cancel()
    }

    override fun onDestroy() {
        delegate?.destroy()
        delegate = null
        super.onDestroy()
    }

    private inline fun safe(block: () -> Unit) {
        try { block() } catch (_: Exception) { }
    }
}
