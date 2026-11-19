package app.target.assistant.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.io.File
import java.security.MessageDigest

/** Package + signing info read from an APK file or the installed app. */
data class ApkIdentity(val packageName: String, val versionCode: Long, val signerDigests: Set<String>)

/** Reads signing-certificate SHA-256 digests via PackageManager (GET_SIGNING_CERTIFICATES on API 28+). */
object AppSigning {

    fun installed(context: Context): ApkIdentity {
        val pm = context.packageManager
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(signingFlags().toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(context.packageName, signingFlags())
        }
        return identity(info, context.packageName)
    }

    /** Null when the file is not a parseable APK. */
    fun archive(context: Context, apk: File): ApkIdentity? {
        val pm = context.packageManager
        val info = archiveInfo(pm, apk, signingFlags()) ?: return null
        var id = identity(info, info.packageName ?: "")
        // Some API 28/29 builds return no signingInfo for archives: fall back to legacy signatures.
        if (id.signerDigests.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val legacy = archiveInfo(pm, apk, legacySignaturesFlag())
            if (legacy != null) id = id.copy(signerDigests = digests(legacySignatures(legacy)))
        }
        return id
    }

    private fun archiveInfo(pm: PackageManager, apk: File, flags: Int): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageArchiveInfo(apk.absolutePath, flags)
        }

    @Suppress("DEPRECATION")
    private fun legacySignaturesFlag(): Int = PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun legacySignatures(info: PackageInfo): Array<Signature>? = info.signatures

    @Suppress("DEPRECATION")
    private fun legacyVersionCode(info: PackageInfo): Long = info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES

    private fun identity(info: PackageInfo, pkg: String): ApkIdentity {
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else legacyVersionCode(info)
        val sigs: Array<Signature>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val si = info.signingInfo
            when {
                si == null -> null
                si.hasMultipleSigners() -> si.apkContentsSigners
                else -> si.signingCertificateHistory
            }
        } else {
            legacySignatures(info)
        }
        return ApkIdentity(pkg, code, digests(sigs))
    }

    private fun digests(sigs: Array<Signature>?): Set<String> {
        if (sigs == null) return emptySet()
        val md = MessageDigest.getInstance("SHA-256")
        return sigs.map { sig ->
            md.reset()
            md.digest(sig.toByteArray()).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
        }.toSet()
    }
}
