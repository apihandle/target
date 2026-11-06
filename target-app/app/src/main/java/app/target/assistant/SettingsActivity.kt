package app.target.assistant

import android.Manifest
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.target.assistant.access.TargetAccessibilityService
import app.target.assistant.brain.CommandRunner
import app.target.assistant.brain.Persona
import app.target.assistant.brain.RiskKind
import app.target.assistant.brain.Routine
import app.target.assistant.brain.Routines
import app.target.assistant.net.OfflineQueue
import app.target.assistant.notify.TargetNotificationListener
import app.target.assistant.store.ChatEntry
import app.target.assistant.store.ChatHistory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import app.target.assistant.settings.Prefs
import app.target.assistant.tools.Reminders
import app.target.assistant.tools.SystemControl
import app.target.assistant.tools.granted
import app.target.assistant.ui.TargetTheme
import app.target.assistant.voice.Tts
import app.target.assistant.wake.WakeModel
import app.target.assistant.wake.WakeWordService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import app.target.assistant.update.UpdateManager
import app.target.assistant.update.UpdatePrefs
import app.target.assistant.update.UpdateScheduler

/**
 * Setup and settings. Every special access is opt-in: each one first shows a short Hinglish
 * explanation (what it is for, what TARGET will and will not do), then opens the system screen.
 */
class SettingsActivity : ComponentActivity() {

    companion object {
        const val EXTRA_SECTION = "section"
        const val SECTION_CONTACTS = "contacts"
        const val SECTION_CALLS = "calls"
        const val SECTION_ACCESSIBILITY = "accessibility"
        const val SECTION_NOTIFICATIONS = "notifications"
        const val SECTION_DND = "dnd"
        const val SECTION_BRIGHTNESS = "brightness"
        const val SECTION_ALARMS = "alarms"
        const val SECTION_WAKE = "wake"
        const val SECTION_MIC = "mic"

        private val AUTO_REPLY_APPS = listOf(
            "com.whatsapp" to "WhatsApp",
            "com.whatsapp.w4b" to "WhatsApp Business",
            "org.telegram.messenger" to "Telegram",
            "com.google.android.apps.messaging" to "Messages",
            "org.thoughtcrime.securesms" to "Signal",
            "com.instagram.android" to "Instagram",
        )
    }

    private lateinit var prefs: Prefs
    private var tick by mutableStateOf(0)
    private var explain by mutableStateOf<String?>(null)
    private var downloadPct by mutableStateOf(-1)
    private var downloadError by mutableStateOf<String?>(null)
    private var autoUpdate by mutableStateOf(true)
    private var checking by mutableStateOf(false)
    private var updateStatus by mutableStateOf<String?>(null)
    private var lastCheck by mutableStateOf<String?>(null)

    private var askedRole = false
    private val roleRequest = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        refresh()
        // Many Android builds mark the assistant role as not requestable and cancel at once:
        // then send the user to Settings → Default apps → Digital assistant app.
        if (askedRole && !isAssistant()) openAssistantSettings()
        askedRole = false
    }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        Tts.init(this)
        if (savedInstanceState == null) explain = intent?.getStringExtra(EXTRA_SECTION)
        setContent { TargetTheme { Surface(Modifier.fillMaxSize()) { Screen() } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_SECTION)?.let { explain = it }
    }

    @androidx.compose.runtime.Composable
    private fun UpdateSection() {
        Text(stringResource(R.string.update_section), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auto_update), modifier = Modifier.weight(1f))
            Switch(checked = autoUpdate, onCheckedChange = { on ->
                autoUpdate = on
                UpdatePrefs.setAutoUpdate(this@SettingsActivity, on)
                if (on) UpdateScheduler.onAppLaunch(this@SettingsActivity) else UpdateScheduler.cancel(this@SettingsActivity)
            })
        }
        Text(stringResource(R.string.auto_update_desc), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { checkNow() }, enabled = !checking, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (checking) R.string.update_checking else R.string.check_now))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.current_version, UpdateManager.installedVersionName(this), installedCode()),
            style = MaterialTheme.typography.bodyMedium,
        )
        updateStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        lastCheck?.let { Text(stringResource(R.string.update_last_check, it), style = MaterialTheme.typography.bodySmall) }
    }

    private fun installedCode(): Int = try {
        UpdateManager.installedVersionCode(this).toInt()
    } catch (_: Exception) {
        BuildConfig.VERSION_CODE
    }

    private fun checkNow() {
        if (checking) return
        checking = true
        updateStatus = getString(R.string.update_checking)
        val app = applicationContext
        Thread {
            UpdateManager.check(app)
            runOnUiThread {
                checking = false
                refreshUpdate()
            }
        }.start()
    }

    private fun refreshUpdate() {
        autoUpdate = UpdatePrefs.isAutoUpdate(this)
        if (!checking) updateStatus = UpdatePrefs.status(this)
        lastCheck = UpdatePrefs.lastCheckText(this)
    }

    override fun onResume() {
        super.onResume()
        app.target.assistant.util.AppLockGate.onResume(this)
        refresh()
    }

    override fun onPause() {
        super.onPause()
        app.target.assistant.util.AppLockGate.onPause()
    }

    private fun refresh() { refreshUpdate(); tick++ }

    // ---- state helpers ----------------------------------------------------------------------------

    private fun isAssistant(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
    } else false

    private fun has(vararg p: String) = p.all { granted(it) }

    private fun notificationListenerOn(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners").orEmpty()
        return flat.contains(ComponentName(this, TargetNotificationListener::class.java).flattenToString())
    }

    private fun accessibilityOn(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        return TargetAccessibilityService.isOn() || flat.contains(ComponentName(this, TargetAccessibilityService::class.java).flattenToString())
    }

    private fun open(vararg intents: Intent) {
        for (i in intents) {
            try { startActivity(i); return } catch (_: ActivityNotFoundException) { } catch (_: SecurityException) { }
        }
    }

    private fun requestAssistantRole() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && !rm.isRoleHeld(RoleManager.ROLE_ASSISTANT)) {
                try {
                    askedRole = true
                    roleRequest.launch(rm.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT))
                    return
                } catch (_: ActivityNotFoundException) { askedRole = false }
            }
        }
        openAssistantSettings()
    }

    private fun openAssistantSettings() = open(
        Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
        Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
    )

    /** What "Theek hai" does after the explanation of [section]. */
    private fun grant(section: String) {
        when (section) {
            SECTION_MIC -> permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            SECTION_CONTACTS -> permissions.launch(arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE, Manifest.permission.SEND_SMS))
            SECTION_CALLS -> {
                prefs.callAnnounce = true
                permissions.launch(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG, Manifest.permission.ANSWER_PHONE_CALLS, Manifest.permission.READ_CONTACTS))
            }
            SECTION_ACCESSIBILITY -> open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            SECTION_NOTIFICATIONS -> {
                if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) permissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            SECTION_DND -> SystemControl.openDndAccess(this)
            SECTION_BRIGHTNESS -> SystemControl.openWriteSettings(this)
            SECTION_ALARMS -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            }
            SECTION_WAKE -> startWakeWord()
        }
    }

    private fun startWakeWord() {
        if (!has(Manifest.permission.RECORD_AUDIO)) { permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO)); return }
        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) permissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        if (WakeModel.isReady(this)) {
            prefs.wakeWord = true; WakeWordService.start(this); refresh(); return
        }
        downloadError = null
        downloadPct = 0
        val app = applicationContext
        Thread {
            val err = WakeModel.download(app) { p -> runOnUiThread { downloadPct = p } }
            runOnUiThread {
                downloadPct = -1
                if (err == null) { prefs.wakeWord = true; WakeWordService.start(this) } else downloadError = err
                refresh()
            }
        }.start()
    }

    // ---- UI ---------------------------------------------------------------------------------------

    @Composable
    private fun Screen() {
        @Suppress("UNUSED_VARIABLE") val t = tick // recompose on refresh()
        Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))

            // Default assistant + mic
            Section(stringResource(R.string.sec_assistant))
            Text(stringResource(if (isAssistant()) R.string.assistant_is_default else R.string.assistant_not_default))
            Button(onClick = { requestAssistantRole() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.make_default_assistant)) }
            Status(has(Manifest.permission.RECORD_AUDIO), R.string.mic_granted, R.string.mic_needed)
            if (!has(Manifest.permission.RECORD_AUDIO)) OutlinedButton(onClick = { explain = SECTION_MIC }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.grant_mic)) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { startActivity(Intent(this@SettingsActivity, AssistActivity::class.java)) }) { Text(stringResource(R.string.try_assistant)) }
                OutlinedButton(onClick = { CommandRunner.openWebApp(this@SettingsActivity, null) }) { Text(stringResource(R.string.open_target)) }
            }

            // Persona & voice
            Section(stringResource(R.string.sec_persona))
            var name by remember { mutableStateOf(prefs.assistantName) }
            OutlinedTextField(value = name, onValueChange = { name = it.take(24); prefs.assistantName = name }, singleLine = true,
                label = { Text(stringResource(R.string.assistant_name)) }, modifier = Modifier.fillMaxWidth())
            Persona.entries.forEach { p ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = prefs.persona == p, onClick = { prefs.persona = p; refresh() })
                    Text(stringResource(when (p) {
                        Persona.DEFAULT -> R.string.persona_default
                        Persona.DOST -> R.string.persona_dost
                        Persona.PROFESSIONAL -> R.string.persona_professional
                    }))
                }
            }
            Text(stringResource(R.string.tts_rate, prefs.ttsRate))
            Slider(value = prefs.ttsRate, onValueChange = { prefs.ttsRate = it; refresh() }, valueRange = 0.5f..2f, onValueChangeFinished = { Tts.applySettings() })
            Text(stringResource(R.string.tts_pitch, prefs.ttsPitch))
            Slider(value = prefs.ttsPitch, onValueChange = { prefs.ttsPitch = it; refresh() }, valueRange = 0.5f..2f, onValueChangeFinished = { Tts.applySettings() })
            var showVoices by remember { mutableStateOf(false) }
            TextButton(onClick = { showVoices = !showVoices }) { Text(stringResource(R.string.tts_voice, prefs.ttsVoice ?: "—")) }
            if (showVoices) Tts.voices().take(25).forEach { (id, label) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = prefs.ttsVoice == id, onClick = { prefs.ttsVoice = id; Tts.applySettings(); refresh() })
                    Text(label, style = MaterialTheme.typography.bodySmall)
                }
            }
            OutlinedButton(onClick = { Tts.applySettings(); Tts.speak(this@SettingsActivity, getString(R.string.tts_sample, prefs.assistantName)) }) { Text(stringResource(R.string.tts_test)) }

            // Conversation
            Section(stringResource(R.string.sec_conversation))
            Toggle(R.string.conversation_mode, R.string.conversation_mode_help, prefs.conversationMode) { prefs.conversationMode = it }
            Toggle(R.string.barge_in, R.string.barge_in_help, prefs.bargeIn) { prefs.bargeIn = it }
            Toggle(R.string.native_chat, R.string.native_chat_help, prefs.nativeChat) { prefs.nativeChat = it }

            // Wake word
            Section(stringResource(R.string.sec_wake))
            Text(stringResource(R.string.wake_help), style = MaterialTheme.typography.bodySmall)
            when {
                downloadPct >= 0 -> Text(stringResource(R.string.wake_downloading, downloadPct))
                prefs.wakeWord && WakeWordService.running -> Text(stringResource(R.string.wake_on))
                else -> {}
            }
            downloadError?.let { Text(stringResource(R.string.wake_download_failed, it), color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!prefs.wakeWord) Button(onClick = { explain = SECTION_WAKE }, enabled = downloadPct < 0) { Text(stringResource(R.string.wake_enable)) }
                else OutlinedButton(onClick = { prefs.wakeWord = false; WakeWordService.stop(this@SettingsActivity); refresh() }) { Text(stringResource(R.string.wake_disable)) }
                if (WakeModel.isReady(this@SettingsActivity) && !prefs.wakeWord) TextButton(onClick = { WakeModel.delete(this@SettingsActivity); refresh() }) { Text(stringResource(R.string.wake_delete_model)) }
            }
            Text(stringResource(R.string.wake_boost, prefs.wakeBoost))
            Slider(value = prefs.wakeBoost, onValueChange = { prefs.wakeBoost = it; refresh() }, valueRange = 0.5f..3f, onValueChangeFinished = { WakeWordService.reload(this@SettingsActivity) })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.wake_false_count, prefs.falseWakes), modifier = Modifier.weight(1f))
                TextButton(onClick = { prefs.falseWakes = 0; refresh() }) { Text(stringResource(R.string.wake_false_reset)) }
            }
            Text(stringResource(R.string.wake_threshold, prefs.wakeThreshold))
            Slider(value = prefs.wakeThreshold, onValueChange = { prefs.wakeThreshold = it; refresh() }, valueRange = 0.05f..0.6f, onValueChangeFinished = { WakeWordService.reload(this@SettingsActivity) })

            // Special access
            Section(stringResource(R.string.sec_access))
            Access(R.string.access_contacts, has(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE, Manifest.permission.SEND_SMS)) { explain = SECTION_CONTACTS }
            Access(R.string.access_accessibility, accessibilityOn()) { explain = SECTION_ACCESSIBILITY }
            Access(R.string.access_notifications, notificationListenerOn()) { explain = SECTION_NOTIFICATIONS }
            Access(R.string.access_calls, prefs.callAnnounce && has(Manifest.permission.READ_PHONE_STATE, Manifest.permission.ANSWER_PHONE_CALLS)) { explain = SECTION_CALLS }
            if (prefs.callAnnounce) TextButton(onClick = { prefs.callAnnounce = false; refresh() }) { Text(stringResource(R.string.calls_off)) }
            Access(R.string.access_dnd, SystemControl.hasDndAccess(this@SettingsActivity)) { explain = SECTION_DND }
            Access(R.string.access_brightness, SystemControl.canWriteSettings(this@SettingsActivity)) { explain = SECTION_BRIGHTNESS }
            Access(R.string.access_alarms, Reminders.canExact(this@SettingsActivity)) { explain = SECTION_ALARMS }

            // Risky actions
            Section(stringResource(R.string.sec_risky))
            Text(stringResource(R.string.risky_help), style = MaterialTheme.typography.bodySmall)
            RiskKind.entries.forEach { k ->
                Toggle(riskLabel(k), R.string.no_ask_help, prefs.noAsk(k)) { prefs.setNoAsk(k, it) }
            }
            Toggle(R.string.guard_always, R.string.guard_help, prefs.guardAlways) { prefs.guardAlways = it }
            Toggle(R.string.app_lock, R.string.app_lock_help, prefs.appLock) { on ->
                prefs.appLock = on
                if (on) app.target.assistant.brain.AppLock.unlocked(System.currentTimeMillis()) // already inside the app
            }

            // Auto-reply
            Section(stringResource(R.string.sec_auto_reply))
            Text(stringResource(R.string.auto_reply_help), style = MaterialTheme.typography.bodySmall)
            var msg by remember { mutableStateOf(prefs.autoReplyMessage) }
            OutlinedTextField(value = msg, onValueChange = { msg = it.take(300); prefs.autoReplyMessage = msg },
                label = { Text(stringResource(R.string.auto_reply_message)) }, modifier = Modifier.fillMaxWidth())
            AUTO_REPLY_APPS.forEach { (pkg, label) ->
                Toggle(label, prefs.autoReplyApps.contains(pkg)) { on ->
                    prefs.autoReplyApps = if (on) prefs.autoReplyApps + pkg else prefs.autoReplyApps - pkg
                }
            }
            Toggle(R.string.auto_reply_on, R.string.auto_reply_on_help, prefs.autoReply, enabled = msg.isNotBlank() && prefs.autoReplyApps.isNotEmpty() && notificationListenerOn()) { prefs.autoReply = it }
            val log = prefs.autoReplyLog()
            if (log.isNotEmpty()) {
                Text(stringResource(R.string.auto_reply_log), style = MaterialTheme.typography.titleSmall)
                val fmt = SimpleDateFormat("d MMM, h:mm a", Locale.getDefault())
                log.take(15).forEach { e -> Text("${fmt.format(Date(e.at))} · ${e.app} → ${e.to}: ${e.text}", style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = { prefs.clearAutoReplyLog(); refresh() }) { Text(stringResource(R.string.auto_reply_log_clear)) }
            }

            // Routines
            Section(stringResource(R.string.sec_routines))
            Text(stringResource(R.string.routines_help), style = MaterialTheme.typography.bodySmall)
            prefs.routines.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${r.name}: ${r.steps.joinToString(" → ")}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { prefs.routines = prefs.routines.filter { it.name != r.name }; refresh() }) { Text(stringResource(R.string.delete)) }
                }
            }
            var rName by remember { mutableStateOf("") }
            var rSteps by remember { mutableStateOf("") }
            OutlinedTextField(value = rName, onValueChange = { rName = it.take(30) }, singleLine = true, label = { Text(stringResource(R.string.routine_name)) }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = rSteps, onValueChange = { rSteps = it.take(1000) }, label = { Text(stringResource(R.string.routine_steps)) }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            Button(onClick = {
                val steps = Routines.splitSteps(rSteps)
                val key = Routines.key(rName)
                if (key.isNotEmpty() && steps.isNotEmpty()) {
                    prefs.routines = Routines.upsert(prefs.routines, Routine(key, steps)); rName = ""; rSteps = ""; refresh()
                }
            }) { Text(stringResource(R.string.routine_save)) }

            // Local chat history (Room) + offline queue
            Section(stringResource(R.string.sec_history))
            Text(stringResource(R.string.history_help), style = MaterialTheme.typography.bodySmall)
            var history by remember { mutableStateOf<List<ChatEntry>>(emptyList()) }
            var queued by remember { mutableStateOf(0) }
            LaunchedEffect(tick) {
                val ctx = applicationContext
                val (h, q) = withContext(Dispatchers.IO) { ChatHistory.recent(ctx, 20) to OfflineQueue.pending(ctx).size }
                history = h; queued = q
            }
            if (queued > 0) Text(stringResource(R.string.history_queued, queued), color = MaterialTheme.colorScheme.primary)
            if (history.isEmpty()) Text(stringResource(R.string.history_empty), style = MaterialTheme.typography.bodySmall)
            else {
                val fmt = SimpleDateFormat("d MMM, h:mm a", Locale.getDefault())
                history.forEach { e ->
                    val who = if (e.role == "user") stringResource(R.string.history_you) else prefs.assistantName
                    Text("${fmt.format(Date(e.createdAt))} · $who: ${e.text.take(200)}" + if (e.queued) " ⏳" else "", style = MaterialTheme.typography.bodySmall)
                }
                TextButton(onClick = { ChatHistory.clear(applicationContext) { runOnUiThread { refresh() } } }) { Text(stringResource(R.string.history_clear)) }
            }

            // App update (signed releases, auto-update)
            Spacer(Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))
            UpdateSection()

            // Login help (Google sign-in inside the WebView)
            Section(stringResource(R.string.sec_login))
            Text(stringResource(R.string.login_help), style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { CommandRunner.openWebApp(this@SettingsActivity, null) }) { Text(stringResource(R.string.open_target)) }

            Spacer(Modifier.height(24.dp))
            Text(stringResource(R.string.settings_help), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(24.dp))
        }

        explain?.let { section ->
            val (title, body) = explanation(section)
            AlertDialog(
                onDismissRequest = { explain = null },
                title = { Text(stringResource(title)) },
                text = { Text(stringResource(body)) },
                confirmButton = { Button(onClick = { explain = null; grant(section) }) { Text(stringResource(R.string.explain_ok)) } },
                dismissButton = { TextButton(onClick = { explain = null }) { Text(stringResource(R.string.explain_cancel)) } },
            )
        }
    }

    private fun explanation(section: String): Pair<Int, Int> = when (section) {
        SECTION_MIC -> R.string.exp_mic_title to R.string.exp_mic
        SECTION_CONTACTS -> R.string.exp_contacts_title to R.string.exp_contacts
        SECTION_CALLS -> R.string.exp_calls_title to R.string.exp_calls
        SECTION_ACCESSIBILITY -> R.string.exp_accessibility_title to R.string.exp_accessibility
        SECTION_NOTIFICATIONS -> R.string.exp_notifications_title to R.string.exp_notifications
        SECTION_DND -> R.string.exp_dnd_title to R.string.exp_dnd
        SECTION_BRIGHTNESS -> R.string.exp_brightness_title to R.string.exp_brightness
        SECTION_ALARMS -> R.string.exp_alarms_title to R.string.exp_alarms
        SECTION_WAKE -> R.string.exp_wake_title to R.string.exp_wake
        else -> R.string.settings_title to R.string.settings_help
    }

    private fun riskLabel(k: RiskKind): Int = when (k) {
        RiskKind.CALL -> R.string.risk_call
        RiskKind.SMS -> R.string.risk_sms
        RiskKind.WHATSAPP -> R.string.risk_whatsapp
        RiskKind.NOTIFICATION_REPLY -> R.string.risk_reply
        RiskKind.ANSWER_CALL -> R.string.risk_answer
        RiskKind.REJECT_CALL -> R.string.risk_reject
        RiskKind.DELETE -> R.string.risk_delete
    }

    @Composable
    private fun Section(title: String) {
        Spacer(Modifier.height(20.dp))
        HorizontalDivider()
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
    }

    @Composable
    private fun Status(ok: Boolean, okText: Int, needText: Int) {
        Text(stringResource(if (ok) okText else needText), modifier = Modifier.padding(vertical = 6.dp))
    }

    @Composable
    private fun Access(label: Int, on: Boolean, onClick: () -> Unit) {
        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text((if (on) "✅ " else "⬜ ") + stringResource(label), modifier = Modifier.weight(1f))
            TextButton(onClick = onClick) { Text(stringResource(if (on) R.string.access_change else R.string.access_turn_on)) }
        }
    }

    @Composable
    private fun Toggle(label: Int, help: Int, value: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(label))
                Text(stringResource(help), style = MaterialTheme.typography.bodySmall)
            }
            Switch(checked = value, enabled = enabled, onCheckedChange = { onChange(it); refresh() })
        }
    }

    @Composable
    private fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, modifier = Modifier.weight(1f))
            Switch(checked = value, onCheckedChange = { onChange(it); refresh() })
        }
    }
}
