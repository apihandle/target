package app.target.assistant.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import app.target.assistant.AssistActivity

/** Opening the assistant from anywhere: the one entry point other code uses to show it. */
object Assistant {
    const val ARG_TEXT = "app.target.assistant.TEXT"

    /**
     * Shows the assistant. As the default assistant we ask our VoiceInteractionService (allowed from the
     * background); otherwise we start [AssistActivity]. [text] is handled as if the user said it.
     */
    fun launch(context: Context, text: String?) {
        val svc = TargetVoiceInteractionService.instance
        if (svc != null) {
            val args = Bundle()
            if (text != null) args.putString(ARG_TEXT, text)
            try { svc.showSession(args, 0); return } catch (_: Exception) {}
        }
        val i = Intent(context, AssistActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (text != null) i.putExtra(Intent.EXTRA_TEXT, text)
        try { context.startActivity(i) } catch (_: Exception) {}
    }
}
