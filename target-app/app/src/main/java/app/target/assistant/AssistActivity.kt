package app.target.assistant

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
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
import app.target.assistant.voice.Listener
import app.target.assistant.voice.Tts

/**
 * Opened by the system for android.intent.action.ASSIST / VOICE_COMMAND (and by the Quick Settings tile
 * and the in-app mic button). A translucent bottom card: mic, live transcript, spoken reply.
 */
class AssistActivity : ComponentActivity() {

    private var listening by mutableStateOf(false)
    private var transcript by mutableStateOf("")
    private var reply by mutableStateOf("")
    private lateinit var listener: Listener
    private lateinit var runner: CommandRunner

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startListening() else reply = getString(R.string.need_mic)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tts.init(this)
        runner = CommandRunner(this)
        listener = Listener(this,
            onPartial = { transcript = it },
            onResult = { transcript = it; handle(it) },
            onError = { reply = it; listening = false },
            onState = { listening = it },
        )
        setContent {
            TargetTheme {
                AssistSheet(
                    listening = listening, transcript = transcript, reply = reply,
                    onMic = { if (listening) listener.stop() else ensureMicThenListen() },
                    onSend = { transcript = it; handle(it) },
                    onOpenApp = { CommandRunner.openWebApp(this, null); finish() },
                    onSettings = { startActivity(Intent(this, SettingsActivity::class.java)); finish() },
                    onDismiss = { finish() },
                )
            }
        }
        val prefill = intent?.getStringExtra(Intent.EXTRA_TEXT)
        if (!prefill.isNullOrBlank()) handle(prefill) else ensureMicThenListen()
    }

    private fun ensureMicThenListen() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else micPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startListening() {
        Tts.stop()
        reply = ""
        transcript = ""
        listening = true
        listener.start()
    }

    private fun handle(text: String) {
        listening = false
        val outcome = runner.handle(text)
        reply = outcome.reply
        Tts.speak(this, outcome.reply)
        if (!outcome.handledLocally) finish()
    }

    override fun onDestroy() {
        listener.destroy()
        super.onDestroy()
    }
}

@Composable
fun AssistSheet(
    listening: Boolean,
    transcript: String,
    reply: String,
    onMic: () -> Unit,
    onSend: (String) -> Unit,
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
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    text = transcript.ifBlank { stringResource(if (listening) R.string.listening else R.string.tap_to_speak) },
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                )
                if (reply.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(reply, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
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
