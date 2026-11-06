package app.target.assistant

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.target.assistant.brain.CommandRunner
import app.target.assistant.ui.TargetTheme
import app.target.assistant.settings.Prefs
import app.target.assistant.voice.AssistantController
import app.target.assistant.voice.Tts

/**
 * Opened by the system for android.intent.action.ASSIST / VOICE_COMMAND (and by the Quick Settings tile
 * and the in-app mic button). A translucent bottom card: mic, live transcript, spoken reply,
 * Haan/Nahi for risky actions and a pick list — the same conversation logic as the overlay.
 */
class AssistActivity : ComponentActivity(), AssistantController.Ui {

    private var listening by mutableStateOf(false)
    private var transcript by mutableStateOf("")
    internal var reply by mutableStateOf("")
        private set
    internal var confirmQuestion by mutableStateOf<String?>(null)
        private set
    private var choices by mutableStateOf<List<String>>(emptyList())
    private lateinit var controller: AssistantController
    private val main = Handler(Looper.getMainLooper())

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) controller.startListening() else reply = getString(R.string.need_mic)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tts.init(this)
        controller = AssistantController(this, this)
        val name = Prefs(this).assistantName
        setContent {
            TargetTheme {
                AssistSheet(
                    title = name,
                    listening = listening, transcript = transcript, reply = reply,
                    confirmQuestion = confirmQuestion, choices = choices,
                    onMic = { if (listening) controller.stopListening() else ensureMicThenListen() },
                    onSend = { transcript = it; controller.userSaid(it) },
                    onYes = { controller.tapYes() },
                    onNo = { controller.tapNo() },
                    onChoice = { controller.tapChoice(it) },
                    onOpenApp = {
                        val c = Prefs(this).lastConversation
                        if (c != null) CommandRunner.openUrlInApp(this, CommandRunner.webUrlForChat(c)) else CommandRunner.openWebApp(this, null)
                        finish()
                    },
                    onSettings = { startActivity(Intent(this, SettingsActivity::class.java)); finish() },
                    onDismiss = { finish() },
                )
            }
        }
        controller.fromWake = intent?.getBooleanExtra(app.target.assistant.voice.Assistant.ARG_FROM_WAKE, false) == true
        val prefill = intent?.getStringExtra(Intent.EXTRA_TEXT)
        val followUp = if (intent?.getBooleanExtra(app.target.assistant.voice.Assistant.ARG_FOLLOW_UP, false) == true) app.target.assistant.wake.FollowUp.take() else null
        when {
            !prefill.isNullOrBlank() -> { transcript = prefill; controller.userSaid(prefill) }
            followUp != null && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> controller.startListening(followUp)
            else -> ensureMicThenListen()
        }
    }

    private fun ensureMicThenListen() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) controller.startListening()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    // ---- AssistantController.Ui ----
    override fun showTranscript(text: String) { transcript = text }
    override fun showReply(text: String) { reply = text }
    override fun showListening(on: Boolean) { listening = on; if (on) transcript = "" }
    override fun showChoices(choices: List<String>) { this.choices = choices }
    override fun showConfirm(question: String?) { confirmQuestion = question }
    override fun close(delayMs: Long) { main.postDelayed({ finish() }, delayMs) }
    override fun requestUnlock(onResult: (Boolean) -> Unit) {
        GuardActivity.callback = onResult
        startActivity(Intent(this, GuardActivity::class.java))
    }

    override fun onDestroy() {
        controller.destroy()
        super.onDestroy()
    }
}

@Composable
fun AssistSheet(
    title: String,
    listening: Boolean,
    transcript: String,
    reply: String,
    confirmQuestion: String?,
    choices: List<String>,
    onMic: () -> Unit,
    onSend: (String) -> Unit,
    onYes: () -> Unit,
    onNo: () -> Unit,
    onChoice: (Int) -> Unit,
    onOpenApp: () -> Unit,
    onSettings: () -> Unit,
    onDismiss: () -> Unit,
) {
    var typed by remember { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize().background(Color(0x66000000))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            tonalElevation = 6.dp,
            modifier = Modifier.fillMaxWidth()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        ) {
            Column(Modifier.navigationBarsPadding().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    text = transcript.ifBlank { stringResource(if (listening) R.string.listening else R.string.tap_to_speak) },
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                )
                if (reply.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(reply, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
                }
                if (confirmQuestion != null) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(onClick = onYes) { Text(stringResource(R.string.yes)) }
                        OutlinedButton(onClick = onNo) { Text(stringResource(R.string.no)) }
                    }
                }
                choices.forEachIndexed { i, c ->
                    TextButton(onClick = { onChoice(i) }, modifier = Modifier.fillMaxWidth()) { Text("${i + 1}. $c") }
                }
                Spacer(Modifier.height(16.dp))
                Box(
                    Modifier.size(72.dp).clip(CircleShape)
                        .background(if (listening) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer)
                        .clickable(onClick = onMic),
                    contentAlignment = Alignment.Center,
                ) { Text("🎤", fontSize = 30.sp) }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = typed, onValueChange = { typed = it }, singleLine = true,
                        placeholder = { Text(stringResource(R.string.type_hint)) }, modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.size(8.dp))
                    Button(onClick = { if (typed.isNotBlank()) { onSend(typed); typed = "" } }) { Text(stringResource(R.string.send)) }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = onSettings) { Text(stringResource(R.string.settings)) }
                    TextButton(onClick = onOpenApp) { Text(stringResource(R.string.open_target)) }
                }
            }
        }
    }
}
