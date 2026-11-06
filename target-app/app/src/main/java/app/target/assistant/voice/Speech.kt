package app.target.assistant.voice

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/** One shared TextToSpeech, Hindi (India) first, English (India) fallback. */
object Tts {
    private var tts: TextToSpeech? = null
    private var ready = false
    private val pending = mutableListOf<String>()

    fun init(context: Context) {
        if (tts != null) return
        tts = TextToSpeech(context.applicationContext) { status -> onInit(status) }
    }

    private fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        val t = tts ?: return
        val hi = t.setLanguage(Locale.forLanguageTag("hi-IN"))
        if (hi == TextToSpeech.LANG_MISSING_DATA || hi == TextToSpeech.LANG_NOT_SUPPORTED) t.setLanguage(Locale.forLanguageTag("en-IN"))
        ready = true
        pending.forEach { speakNow(it) }
        pending.clear()
    }

    fun speak(context: Context, text: String) {
        if (text.isBlank()) return
        init(context)
        if (ready) speakNow(text) else pending += text
    }

    private fun speakNow(text: String) {
        tts?.speak(text.take(TextToSpeech.getMaxSpeechInputLength() - 1), TextToSpeech.QUEUE_FLUSH, null, "target-" + System.nanoTime())
    }

    fun stop() { tts?.stop() }
}

/**
 * Wraps SpeechRecognizer: hi-IN first, en-IN fallback when Hindi is unavailable or hears nothing.
 * When TARGET is the default assistant, Android points the system "voice input" setting at our own
 * [TargetRecognitionService], so here we bind a real recognizer from another package explicitly.
 */
class Listener(
    private val context: Context,
    private val onPartial: (String) -> Unit,
    private val onResult: (String) -> Unit,
    private val onError: (String) -> Unit,
    private val onState: (listening: Boolean) -> Unit = {},
) {
    private var recognizer: SpeechRecognizer? = null
    private var triedFallback = false

    fun start() {
        triedFallback = false
        startWith("hi-IN")
    }

    private fun startWith(lang: String) {
        destroy()
        val r = create(context) ?: run { onError("Is phone par speech recognition nahi mila"); return }
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = onState(true)
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() = onState(false)
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
            }
            override fun onResults(results: Bundle?) {
                onState(false)
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isBlank() && !triedFallback) { triedFallback = true; startWith("en-IN"); return }
                if (text.isBlank()) onError("Kuch sunai nahi diya") else onResult(text)
            }
            override fun onError(error: Int) {
                onState(false)
                val langProblem = error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
                if (!triedFallback && (langProblem || error == SpeechRecognizer.ERROR_NO_MATCH)) {
                    triedFallback = true; startWith("en-IN"); return
                }
                onError(
                    when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission chahiye"
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Kuch sunai nahi diya"
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network problem"
                        else -> "Sunne mein dikkat ($error)"
                    }
                )
            }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        if (lang == "hi-IN") intent.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", arrayOf("en-IN"))
        r.startListening(intent)
    }

    fun stop() { recognizer?.stopListening() }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
    }

    companion object {
        private val PREFERRED = listOf(
            "com.google.android.googlequicksearchbox",
            "com.google.android.tts",
            "com.google.android.as",
            "com.samsung.android.bixby.agent",
        )

        /** A recognition service that is not ours (ours only proxies). Null = none installed. */
        fun findDelegate(context: Context): ComponentName? {
            val services = context.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
                .map { ComponentName(it.serviceInfo.packageName, it.serviceInfo.name) }
                .filter { it.packageName != context.packageName }
            return services.minByOrNull { c -> PREFERRED.indexOf(c.packageName).let { if (it < 0) 99 else it } }
        }

        fun create(context: Context): SpeechRecognizer? {
            val delegate = findDelegate(context)
            return when {
                delegate != null -> SpeechRecognizer.createSpeechRecognizer(context, delegate)
                SpeechRecognizer.isRecognitionAvailable(context) -> SpeechRecognizer.createSpeechRecognizer(context)
                else -> null
            }
        }
    }
}
