package app.target.assistant.voice

import android.Manifest
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.voice.VoiceInteractionSession
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.target.assistant.AssistActivity
import app.target.assistant.GuardActivity
import app.target.assistant.R
import app.target.assistant.brain.CommandRunner
import app.target.assistant.settings.Prefs

/**
 * The overlay shown on long-press power/home when TARGET is the default assistant:
 * mic, live transcript, spoken reply, Haan/Nahi for risky actions, a pick list for contacts, and a
 * text box. Plain Views — a session window has no Compose lifecycle owner.
 */
class TargetVoiceSession(context: Context) : VoiceInteractionSession(context), AssistantController.Ui {

    private val main = Handler(Looper.getMainLooper())
    private lateinit var title: TextView
    private lateinit var transcript: TextView
    private lateinit var reply: TextView
    private lateinit var mic: Button
    private lateinit var confirmRow: LinearLayout
    private lateinit var choicesBox: LinearLayout
    private lateinit var input: EditText
    private var listening = false
    private var controller: AssistantController? = null
    private var assistText: String? = null

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), context.resources.displayMetrics).toInt()

    override fun onCreateContentView(): View {
        val root = FrameLayout(context).apply {
            setBackgroundColor(Color.parseColor("#66000000"))
            setOnClickListener { hide() }
        }
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(18), dp(20), dp(24))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
            }
            isClickable = true
        }
        title = TextView(context).apply { textSize = 18f; setTextColor(Color.BLACK); gravity = Gravity.CENTER }
        transcript = TextView(context).apply {
            text = context.getString(R.string.tap_to_speak); textSize = 17f; setTextColor(Color.DKGRAY); gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        reply = TextView(context).apply {
            textSize = 16f; setTextColor(Color.parseColor("#1F7A4D")); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8))
        }
        val replyScroll = ScrollView(context).apply { addView(reply) }
        confirmRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; visibility = View.GONE }
        confirmRow.addView(Button(context).apply { text = context.getString(R.string.yes); setOnClickListener { controller?.tapYes() } })
        confirmRow.addView(Button(context).apply { text = context.getString(R.string.no); setOnClickListener { controller?.tapNo() } })
        choicesBox = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        mic = Button(context).apply {
            text = "🎤"; textSize = 26f
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#DDEFE5")) }
            setOnClickListener { if (listening) controller?.stopListening() else controller?.startListening() }
        }
        input = EditText(context).apply {
            hint = context.getString(R.string.type_hint); setSingleLine(); imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { v, _, _ ->
                val t = v.text.toString(); if (t.isNotBlank()) { v.text = ""; transcript.text = t; controller?.userSaid(t) }; true
            }
        }
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        row.addView(Button(context).apply {
            text = context.getString(R.string.settings); isAllCaps = false
            setOnClickListener { startAssistantActivity(Intent(context, app.target.assistant.SettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); hide() }
        })
        row.addView(Button(context).apply {
            text = context.getString(R.string.open_target); isAllCaps = false
            setOnClickListener {
                val c = Prefs(context).lastConversation
                if (c != null) CommandRunner.openUrlInApp(context, CommandRunner.webUrlForChat(c)) else CommandRunner.openWebApp(context, null)
                hide()
            }
        })
        card.addView(title)
        card.addView(transcript)
        card.addView(replyScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { height = LinearLayout.LayoutParams.WRAP_CONTENT })
        card.addView(confirmRow)
        card.addView(choicesBox)
        card.addView(mic, LinearLayout.LayoutParams(dp(72), dp(72)).apply { topMargin = dp(8); bottomMargin = dp(8) })
        card.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        card.addView(row)
        root.addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        return root
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        title.text = Prefs(context).assistantName
        reply.text = ""
        showConfirm(null); showChoices(emptyList())
        controller?.destroy()
        val c = AssistantController(context, this)
        c.runner.assistScreenText = assistText
        controller = c
        val text = args?.getString(Assistant.ARG_TEXT)
        when {
            !text.isNullOrBlank() -> { transcript.text = text; c.userSaid(text) }
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> c.startListening()
            else -> {
                // The session cannot show a permission dialog; the activity can.
                reply.text = context.getString(R.string.need_mic)
                startAssistantActivity(Intent(context, AssistActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                hide()
            }
        }
    }

    /** Screen text the system shares with the assistant ("Use text from screen" in assistant settings). */
    @Deprecated("Deprecated in Java")
    override fun onHandleAssist(data: Bundle?, structure: AssistStructure?, content: android.app.assist.AssistContent?) {
        val s = structure ?: return
        val sb = StringBuilder()
        fun walk(n: AssistStructure.ViewNode?, depth: Int) {
            if (n == null || depth > 60 || sb.length > 5000) return
            val t = n.text?.toString() ?: n.contentDescription?.toString()
            if (!t.isNullOrBlank()) sb.append(t.trim()).append('\n')
            for (i in 0 until n.childCount) walk(n.getChildAt(i), depth + 1)
        }
        for (i in 0 until s.windowNodeCount) walk(s.getWindowNodeAt(i).rootViewNode, 0)
        assistText = sb.toString().trim().ifEmpty { null }
        controller?.runner?.assistScreenText = assistText
    }

    override fun onHide() {
        controller?.destroy()
        controller = null
        assistText = null
        showListening(false)
        super.onHide()
    }

    // ---- AssistantController.Ui ----
    override fun showTranscript(text: String) { transcript.text = text }
    override fun showReply(text: String) { reply.text = text }

    override fun showListening(on: Boolean) {
        listening = on
        if (::mic.isInitialized) (mic.background as? GradientDrawable)?.setColor(Color.parseColor(if (on) "#1F7A4D" else "#DDEFE5"))
        if (on && ::transcript.isInitialized) transcript.text = context.getString(R.string.listening)
    }

    override fun showChoices(choices: List<String>) {
        if (!::choicesBox.isInitialized) return
        choicesBox.removeAllViews()
        choices.forEachIndexed { i, c ->
            choicesBox.addView(Button(context).apply { text = "${i + 1}. $c"; isAllCaps = false; setOnClickListener { controller?.tapChoice(i) } })
        }
        choicesBox.visibility = if (choices.isEmpty()) View.GONE else View.VISIBLE
    }

    override fun showConfirm(question: String?) {
        if (::confirmRow.isInitialized) confirmRow.visibility = if (question == null) View.GONE else View.VISIBLE
    }

    override fun close(delayMs: Long) { main.postDelayed({ hide() }, delayMs) }

    override fun requestUnlock(onResult: (Boolean) -> Unit) {
        GuardActivity.callback = onResult
        startAssistantActivity(Intent(context, GuardActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun startActivity(intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startAssistantActivity(intent) else context.startActivity(intent)
    }
}
