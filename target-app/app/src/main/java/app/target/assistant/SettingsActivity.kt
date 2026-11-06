package app.target.assistant

import android.Manifest
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.target.assistant.brain.CommandRunner
import app.target.assistant.ui.TargetTheme
import app.target.assistant.update.UpdateManager
import app.target.assistant.update.UpdatePrefs
import app.target.assistant.update.UpdateScheduler

/** Setup: make TARGET the default assistant, grant mic, open the web app. */
class SettingsActivity : ComponentActivity() {

    private var isAssistant by mutableStateOf(false)
    private var hasMic by mutableStateOf(false)
    private var autoUpdate by mutableStateOf(true)
    private var checking by mutableStateOf(false)
    private var updateStatus by mutableStateOf<String?>(null)
    private var lastCheck by mutableStateOf<String?>(null)

    private var askedRole = false
    private val roleRequest = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        refresh()
        // Many Android builds mark the assistant role as not requestable and cancel at once:
        // then send the user to Settings → Default apps → Digital assistant app.
        if (askedRole && !isAssistant) { askedRole = false; openAssistantSettings() }
        askedRole = false
    }
    private val micRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TargetTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState())) {
                        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(16.dp))
                        Text(stringResource(if (isAssistant) R.string.assistant_is_default else R.string.assistant_not_default))
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { requestAssistantRole() }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.make_default_assistant))
                        }
                        Spacer(Modifier.height(16.dp))
                        Text(stringResource(if (hasMic) R.string.mic_granted else R.string.mic_needed))
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { micRequest.launch(Manifest.permission.RECORD_AUDIO) }, enabled = !hasMic, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.grant_mic))
                        }
                        Spacer(Modifier.height(16.dp))
                        OutlinedButton(onClick = { startActivity(Intent(this@SettingsActivity, AssistActivity::class.java)) }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.try_assistant))
                        }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = { CommandRunner.openWebApp(this@SettingsActivity, null) }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.open_target))
                        }
                        Spacer(Modifier.height(24.dp))
                        UpdateSection()
                        Spacer(Modifier.height(24.dp))
                        Text(stringResource(R.string.settings_help), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
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
        refresh()
    }

    private fun refresh() {
        refreshUpdate()
        hasMic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        isAssistant = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
        } else false
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

    /** Fallback: the assistant role is often not grantable by dialog; open the system screens. */
    private fun openAssistantSettings() {
        val candidates = listOf(
            Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
            Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (i in candidates) {
            try { startActivity(i); return } catch (_: ActivityNotFoundException) { }
        }
    }
}
