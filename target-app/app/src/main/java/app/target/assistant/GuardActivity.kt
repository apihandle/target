package app.target.assistant

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.view.WindowManager

/**
 * "Voice Guardian" stand-in: before a risky action, unlock the phone (if locked) or pass a
 * fingerprint / face / screen-lock check (if the user turned that on). Real speaker verification is later.
 */
class GuardActivity : Activity() {

    companion object {
        /** Result for the caller (main thread). Set just before starting this activity. */
        @Volatile var callback: ((Boolean) -> Unit)? = null
        private const val REQ_CREDENTIAL = 51
    }

    private var done = false

    private fun finishWith(ok: Boolean) {
        if (done) return
        done = true
        val cb = callback
        callback = null
        cb?.invoke(ok)
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setShowWhenLocked(true)
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        val km = getSystemService(KeyguardManager::class.java)
        if (km == null || !km.isDeviceSecure) { finishWith(true); return }
        if (km.isKeyguardLocked) {
            km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = finishWith(true)
                override fun onDismissCancelled() = finishWith(false)
                override fun onDismissError() = finishWith(false)
            })
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) biometric() else credential(km)
    }

    private fun biometric() {
        val b = BiometricPrompt.Builder(this)
            .setTitle(getString(R.string.guard_title))
            .setSubtitle(getString(R.string.guard_subtitle))
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
                b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> @Suppress("DEPRECATION") b.setDeviceCredentialAllowed(true)
            else -> b.setNegativeButton(getString(R.string.no), mainExecutor) { _, _ -> finishWith(false) }
        }
        try {
            b.build().authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) = finishWith(true)
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) = finishWith(false)
            })
        } catch (_: Exception) {
            getSystemService(KeyguardManager::class.java)?.let { credential(it) } ?: finishWith(false)
        }
    }

    @Suppress("DEPRECATION")
    private fun credential(km: KeyguardManager) {
        val i = km.createConfirmDeviceCredentialIntent(getString(R.string.guard_title), getString(R.string.guard_subtitle))
        if (i == null) finishWith(true) else startActivityForResult(i, REQ_CREDENTIAL)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_CREDENTIAL) finishWith(resultCode == RESULT_OK)
    }

    override fun onDestroy() {
        if (!done) { done = true; callback?.invoke(false); callback = null }
        super.onDestroy()
    }
}
