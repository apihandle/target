package app.target.assistant.voice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.voice.VoiceInteractionSession
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.target.assistant.AssistActivity
import app.target.assistant.R
import app.target.assistant.brain.CommandRunner

/**
 * The overlay shown on long-press power/home when TARGET is the default assistant:
 * mic button, live transcript, reply (also spoken). Plain Views — a session window has no
 * Compose lifecycle owner.
 */
class TargetVoiceSession(context: Context) : VoiceInteractionSession(context) {

    private val main = Handler(Looper.getMainLooper())
    private lateinit var transcript: TextView
    private lateinit var reply: TextView
    private lateinit var mic: Button
    private var listening = false
    private val runner = CommandRunner(context)
    private val listener = Listener(context,
        onPartial = { transcript.text = it },
        onResult = { transcript.text = it; handle(it) },
        onError = { reply.text = it; setListening(false) },
        onState = { setListening(it) },
    )

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), context.resources.displayMetrics).toInt()

    override fun onCreateContentView(): View {
        val root = FrameLayout(context).apply {
            setBackgroundColor(Color.parseColor("#66000000"))
            setOnClickListener { hide() }
        }
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
            }
            isClickable = true
        }
        card.addView(TextView(context).apply {
            text = context.getString(R.string.app_name); textSize = 18f; setTextColor(Color.BLACK); gravity = Gravity.CENTER
        })
        transcript = TextView(context).apply {
            text = context.getString(R.string.tap_to_speak); textSize = 17f; setTextColor(Color.DKGRAY); gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }
        reply = TextView(context).apply {
            textSize = 16f; setTextColor(Color.parseColor("#1F7A4D")); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8))
        }
        mic = Button(context).apply {
            text = "🎤"; textSize = 26f
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#DDEFE5")) }
            setOnClickListener { if (listening) listener.stop() else startListening() }
        }
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        row.addView(Button(context).apply {
            text = context.getString(R.string.type_instead); isAllCaps = false
            setOnClickListener { openAssistActivity() }
        })
        row.addView(Button(context).apply {
            text = context.getString(R.string.open_target); isAllCaps = false
            setOnClickListener { CommandRunner.openWebApp(context, null); hide() }
        })
        card.addView(transcript)
        card.addView(reply)
        card.addView(mic, LinearLayout.LayoutParams(dp(72), dp(72)).apply { topMargin = dp(8); bottomMargin = dp(8) })
        card.addView(row)
        root.addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        return root
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        reply.text = ""
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else {
            // The session cannot show a permission dialog; the activity can.
            reply.text = context.getString(R.string.need_mic)
            openAssistActivity()
        }
    }

    override fun onHide() {
        listener.destroy()
        setListening(false)
        super.onHide()
    }

    private fun openAssistActivity() {
        startAssistantActivity(Intent(context, AssistActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        hide()
    }

    private fun startListening() {
        Tts.stop()
        transcript.text = context.getString(R.string.listening)
        reply.text = ""
        setListening(true)
        listener.start()
    }

    private fun setListening(on: Boolean) {
        listening = on
        if (::mic.isInitialized) (mic.background as? GradientDrawable)?.setColor(Color.parseColor(if (on) "#1F7A4D" else "#DDEFE5"))
    }

    private fun handle(text: String) {
        setListening(false)
        val outcome = runner.handle(text)
        reply.text = outcome.reply
        Tts.speak(context, outcome.reply)
        // Let the user read the reply, then get out of the way (the app/screen we opened is behind us).
        main.postDelayed({ hide() }, if (outcome.handledLocally) 1800L else 300L)
    }
}
