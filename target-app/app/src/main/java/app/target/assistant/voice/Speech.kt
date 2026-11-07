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

/**
 * One shared TextToSpeech, Hindi (India) first, English (India) fallback.
 * Voice, speed and pitch come from settings; [speak] can call back when the sentence has been spoken.
 */
object Tts {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var appContext: Context? = null
    private val pending = mutableListOf<Pair<String, (() -> Unit)?>>()
    private val callbacks = java.util.concurrent.ConcurrentHashMap<String, () -> Unit>()
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    @Volatile var speaking = false
        private set

    fun init(context: Context) {
        if (tts != null) return
        appContext = context.applicationContext
        tts = TextToSpeech(context.applicationContext) { status -> onInit(status) }
    }

    private fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        val t = tts ?: return
        val hi = t.setLanguage(Locale.forLanguageTag("hi-IN"))
        if (hi == TextToSpeech.LANG_MISSING_DATA || hi == TextToSpeech.LANG_NOT_SUPPORTED) t.setLanguage(Locale.forLanguageTag("en-IN"))
        t.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { speaking = true }
            override fun onDone(utteranceId: String?) = finished(utteranceId)
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finished(utteranceId)
            override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId)
            override fun onStop(utteranceId: String?, interrupted: Boolean) = finished(utteranceId)
        })
        applySettings()
        ready = true
        pending.forEach { speakNow(it.first, it.second) }
        pending.clear()
    }

    private fun finished(id: String?) {
        speaking = false
        val cb = id?.let { callbacks.remove(it) } ?: return
        main.post(cb)
    }

    /** Voice, speed, pitch from settings (call again after the user changes them). */
    fun applySettings() {
        val t = tts ?: return
        val ctx = appContext ?: return
        val p = app.target.assistant.settings.Prefs(ctx)
        t.setSpeechRate(p.ttsRate)
        t.setPitch(p.ttsPitch)
        p.ttsVoice?.let { name -> try { t.voices?.firstOrNull { it.name == name }?.let { v -> t.voice = v } } catch (_: Exception) {} }
    }

    /** Installed Hindi/English voices: (name, label). */
    fun voices(): List<Pair<String, String>> = try {
        tts?.voices.orEmpty()
            .filter { (it.locale.language == "hi" || it.locale.language == "en") && !it.isNetworkConnectionRequired }
            .sortedWith(compareBy({ it.locale.language != "hi" }, { it.locale.country != "IN" }, { it.name }))
            .map { it.name to (it.locale.displayName + " · " + it.name.substringAfterLast('-').take(16)) }
    } catch (_: Exception) { emptyList() }

    fun speak(context: Context, text: String, onDone: (() -> Unit)? = null) {
        if (text.isBlank()) { onDone?.let { main.post(it) }; return }
        init(context)
        if (ready) speakNow(text, onDone) else pending += text to onDone
    }

    private fun speakNow(text: String, onDone: (() -> Unit)?) {
        val id = "target-" + System.nanoTime()
        if (onDone != null) callbacks[id] = onDone
        val r = tts?.speak(text.take(TextToSpeech.getMaxSpeechInputLength() - 1), TextToSpeech.QUEUE_FLUSH, null, id)
        if (r != TextToSpeech.SUCCESS) finished(id)
    }

    /** Stop talking. Pending "after speaking" callbacks are dropped (the caller decides what is next). */
    fun stop() {
        callbacks.clear()
        speaking = false
        tts?.stop()
    }
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
    /** Called when the user starts talking (used to stop TTS: barge-in). */
    private val onSpeechStart: () -> Unit = {},
) {
    private var recognizer: SpeechRecognizer? = null
    private var triedFallback = false

    /** Starts recognition from the microphone, Hindi first with an English retry. */
    fun start() {
        triedFallback = false
        startWith("hi-IN")
    }

    private fun startWith(lang: String) {
        destroy()
        val r = create(context) ?: run { onError(context.getString(app.target.assistant.R.string.stt_unavailable)); return }
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = onState(true)
            override fun onBeginningOfSpeech() = onSpeechStart()
            override fun onRmsChanged(rmsdB: Float) { if (rmsdB > LOUD_DB) onSpeechStart() }
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
                if (text.isBlank()) onError(context.getString(app.target.assistant.R.string.stt_nothing_heard)) else onResult(text)
            }
            override fun onError(error: Int) {
                onState(false)
                val langProblem = error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
                if (!triedFallback && (langProblem || error == SpeechRecognizer.ERROR_NO_MATCH)) {
                    triedFallback = true; startWith("en-IN"); return
                }
                onError(
                    when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> context.getString(app.target.assistant.R.string.need_mic)
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> context.getString(app.target.assistant.R.string.stt_nothing_heard)
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> context.getString(app.target.assistant.R.string.stt_network)
                        else -> context.getString(app.target.assistant.R.string.stt_error, error)
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
        /** Voice level that counts as the user talking over TARGET. */
        private const val LOUD_DB = 9f

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
