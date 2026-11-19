package app.target.assistant.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import app.target.assistant.AssistActivity
import java.util.concurrent.CopyOnWriteArraySet

/** Opening the assistant from anywhere, and a tiny in-process event bus between overlay, wake word and calls. */
object Assistant {
    const val ARG_TEXT = "app.target.assistant.TEXT"
    const val ARG_FROM_WAKE = "app.target.assistant.FROM_WAKE"
    const val ARG_FOLLOW_UP = "app.target.assistant.FOLLOW_UP"

    enum class Event { OPENED, CLOSED, SLEEP }

    private val listeners = CopyOnWriteArraySet<(Event) -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    fun listen(l: (Event) -> Unit) { listeners += l }
    fun unlisten(l: (Event) -> Unit) { listeners -= l }
    fun post(e: Event) = main.post { listeners.forEach { it(e) } }

    /**
     * Shows the assistant. As the default assistant we ask our VoiceInteractionService (allowed from the
     * background); otherwise we start [AssistActivity]. [text] is handled as if the user said it.
     */
    fun launch(context: Context, text: String?, fromWake: Boolean = false, followUp: Boolean = false) {
        val svc = TargetVoiceInteractionService.instance
        if (svc != null) {
            val args = Bundle()
            if (text != null) args.putString(ARG_TEXT, text)
            args.putBoolean(ARG_FROM_WAKE, fromWake)
            args.putBoolean(ARG_FOLLOW_UP, followUp)
            try { svc.showSession(args, 0); return } catch (_: Exception) {}
        }
        val i = Intent(context, AssistActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (text != null) i.putExtra(Intent.EXTRA_TEXT, text)
        i.putExtra(ARG_FROM_WAKE, fromWake).putExtra(ARG_FOLLOW_UP, followUp)
        try { context.startActivity(i) } catch (_: Exception) {}
    }
}
