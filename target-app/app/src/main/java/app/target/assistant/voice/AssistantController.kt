package app.target.assistant.voice

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import app.target.assistant.R
import app.target.assistant.SettingsActivity
import app.target.assistant.brain.Answer
import app.target.assistant.brain.CommandRunner
import app.target.assistant.brain.ConfirmWords
import app.target.assistant.brain.ContactMatcher
import app.target.assistant.brain.Outcome
import app.target.assistant.brain.Pending
import app.target.assistant.settings.Prefs

/**
 * The conversation logic shared by the assistant overlay (VoiceInteractionSession) and AssistActivity:
 * listen → understand → act/answer → (confirm / pick / more text) → listen again in conversation mode.
 * Risky actions wait for a spoken "haan" or a tap, unless that action's "bina pooche" toggle is on.
 */
class AssistantController(private val context: Context, private val ui: Ui) {

    interface Ui {
        fun showTranscript(text: String)
        fun showReply(text: String)
        fun showListening(on: Boolean)
        fun showChoices(choices: List<String>)
        /** Non-null: show Haan / Nahi buttons with this question. */
        fun showConfirm(question: String?)
        /** Close the overlay after [delayMs]. */
        fun close(delayMs: Long)
        /** Fingerprint / screen lock before a risky action. */
        fun requestUnlock(onResult: (Boolean) -> Unit)
        /** Start an activity from this UI (the session needs startAssistantActivity). */
        fun startActivity(intent: Intent)
    }

    private val main = Handler(Looper.getMainLooper())
    private val prefs = Prefs(context)
    val runner = CommandRunner(context)
    var conversationMode = prefs.conversationMode
        private set

    private var pending: Pending? = null
    private var choiceHandler: ((Int) -> Outcome)? = null
    private var choices: List<String> = emptyList()
    private var textHandler: ((String) -> Outcome)? = null
    private val steps = ArrayDeque<String>()
    private var closed = false
    private var bargeArmed = false

    private val listener = Listener(context,
        onPartial = { ui.showTranscript(it) },
        onResult = { ui.showTranscript(it); userSaid(it) },
        onError = { err -> ui.showListening(false); onListenError(err) },
        onState = { ui.showListening(it) },
        onSpeechStart = { if (bargeArmed && Tts.speaking) { bargeArmed = false; Tts.stop() } },
    )

    private val sleepListener: (Assistant.Event) -> Unit = { if (it == Assistant.Event.SLEEP) { say(context.getString(R.string.reply_bye)) { finish(0) } } }

    init {
        Tts.init(context)
        Assistant.listen(sleepListener)
        Assistant.post(Assistant.Event.OPENED)
    }

    fun startListening() {
        if (closed) return
        Tts.stop()
        bargeArmed = false
        ui.showListening(true)
        listener.start()
    }

    fun stopListening() = listener.stop()

    private var emptyTurns = 0

    private fun onListenError(err: String) {
        ui.showReply(err)
        // In conversation mode, two silent turns in a row end the loop quietly.
        if (conversationMode && waiting() == false && ++emptyTurns < 2) main.postDelayed({ startListening() }, 600)
        else if (waiting()) emptyTurns = 0
    }

    private fun waiting(): Boolean = pending != null || choiceHandler != null || textHandler != null

    /** Handles one user utterance (spoken or typed). */
    fun userSaid(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || closed) return
        emptyTurns = 0
        pending?.let { p ->
            when (ConfirmWords.classify(text)) {
                Answer.YES -> { pending = null; ui.showConfirm(null); runConfirmed(p) }
                Answer.NO -> { pending = null; ui.showConfirm(null); deliver(Outcome(context.getString(R.string.reply_cancelled))) }
                Answer.UNKNOWN -> say(context.getString(R.string.ask_yes_no)) { startListening() }
            }
            return
        }
        choiceHandler?.let { h ->
            val i = ContactMatcher.pickChoice(text, choices)
            if (i < 0) { say(context.getString(R.string.ask_pick)) { startListening() }; return }
            choiceHandler = null; choices = emptyList(); ui.showChoices(emptyList())
            deliver(h(i))
            return
        }
        textHandler?.let { h ->
            textHandler = null
            deliver(h(text))
            return
        }
        deliver(runner.handle(text))
    }

    fun tapYes() { pending?.let { p -> pending = null; ui.showConfirm(null); runConfirmed(p) } }
    fun tapNo() { if (pending != null) { pending = null; ui.showConfirm(null); deliver(Outcome(context.getString(R.string.reply_cancelled))) } }
    fun tapChoice(i: Int) {
        val h = choiceHandler ?: return
        if (i !in choices.indices) return
        choiceHandler = null; choices = emptyList(); ui.showChoices(emptyList())
        deliver(h(i))
    }

    private fun runConfirmed(p: Pending) {
        listener.destroy()
        if (runner.needsGuard()) {
            ui.requestUnlock { ok -> if (ok) deliver(p.run()) else deliver(Outcome(context.getString(R.string.reply_unlock_failed))) }
        } else {
            deliver(p.run())
        }
    }

    private fun say(text: String, then: (() -> Unit)? = null) {
        ui.showReply(text)
        Tts.speak(context, text, then)
    }

    /** Speaks [text]; in conversation mode with barge-in, listens at the same time so the user can cut in. */
    private fun sayThenListen(text: String) {
        if (conversationMode && prefs.bargeIn && text.length > 60) {
            ui.showReply(text)
            Tts.speak(context, text) { if (!listenerActive) startListening() }
            main.postDelayed({ bargeArmed = true; listenerActive = true; ui.showListening(true); listener.start() }, 700)
        } else {
            say(text) { startListening() }
        }
    }
    private var listenerActive = false

    fun deliver(o: Outcome) {
        if (closed) return
        listenerActive = false
        o.conversation?.let { conversationMode = it }
        if (o.setup != null) {
            say(o.reply)
            ui.startActivity(Intent(context, SettingsActivity::class.java).putExtra(SettingsActivity.EXTRA_SECTION, o.setup).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(1500)
            return
        }
        if (o.close) {
            steps.clear()
            say(o.reply)
            val after = o.afterClose
            finish(if (after != null) 900 else 1500)
            if (after != null) main.postDelayed({ after() }, 1300)
            return
        }
        o.confirm?.let { p ->
            if (prefs.noAsk(p.kind)) { ui.showReply(o.reply); runConfirmed(p); return }
            pending = p
            ui.showConfirm(p.question)
            say(p.question) { startListening() }
            return
        }
        if (o.choices.isNotEmpty() && o.onChoice != null) {
            choices = o.choices
            choiceHandler = o.onChoice
            ui.showChoices(o.choices)
            val spoken = o.reply + " " + o.choices.take(5).mapIndexed { i, c -> "${i + 1}: $c" }.joinToString(", ")
            say(spoken) { startListening() }
            return
        }
        o.askText?.let { h ->
            textHandler = h
            say(o.reply) { startListening() }
            return
        }
        o.async?.let { job ->
            ui.showReply(o.reply)
            job { result -> main.post { deliver(result) } }
            return
        }
        if (o.steps.isNotEmpty()) {
            steps.addAll(o.steps)
            say(o.reply) { nextStep() }
            return
        }
        if (!o.handledLocally) { ui.showReply(o.reply); finish(300); return }
        if (steps.isNotEmpty()) { say(o.reply) { nextStep() }; return }
        if (conversationMode) { sayThenListen(o.reply); return }
        say(o.reply)
        if (!o.keepOpen) finish(2200)
    }

    private fun nextStep() {
        val s = steps.removeFirstOrNull() ?: run { if (conversationMode) startListening() else finish(1200); return }
        ui.showTranscript(s)
        deliver(runner.handle(s))
    }

    private fun finish(delayMs: Long) {
        if (closed) return
        closed = true
        listener.destroy()
        ui.close(delayMs)
    }

    /** Call when the UI goes away. */
    fun destroy() {
        closed = true
        listener.destroy()
        Assistant.unlisten(sleepListener)
        Assistant.post(Assistant.Event.CLOSED)
    }
}
