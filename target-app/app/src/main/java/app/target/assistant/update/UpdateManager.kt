package app.target.assistant.update

import android.content.Context
import android.os.Build
import android.util.Log
import app.target.assistant.BuildConfig
import app.target.assistant.R
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.DateFormat
import java.util.Date

/** Stored settings + last status line for the Settings screen. */
object UpdatePrefs {
    private const val FILE = "updates"
    private const val KEY_AUTO = "auto_update"
    private const val KEY_STATUS = "status"
    private const val KEY_LAST_CHECK = "last_check"

    private fun prefs(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun isAutoUpdate(c: Context): Boolean = prefs(c).getBoolean(KEY_AUTO, true)
    fun setAutoUpdate(c: Context, on: Boolean) = prefs(c).edit().putBoolean(KEY_AUTO, on).apply()
    fun status(c: Context): String? = prefs(c).getString(KEY_STATUS, null)
    fun setStatus(c: Context, s: String) = prefs(c).edit().putString(KEY_STATUS, s).apply()
    fun lastCheck(c: Context): Long = prefs(c).getLong(KEY_LAST_CHECK, 0L)
    fun markChecked(c: Context) = prefs(c).edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
    fun lastCheckText(c: Context): String? {
        val t = lastCheck(c)
        if (t == 0L) return null
        return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(t))
    }
}

sealed class UpdateResult {
    data object UpToDate : UpdateResult()
    data class Installing(val versionName: String) : UpdateResult()
    data class Failed(val message: String, val retryable: Boolean) : UpdateResult()
}

/**
 * One update check: fetch version.json → compare versionCode → download to cache → verify SHA-256
 * → verify package name, versionCode and signing certificate against the installed app → install.
 */
object UpdateManager {

    private const val TAG = "TargetUpdate"
    private const val MAX_MANIFEST_BYTES = 64 * 1024
    private const val MAX_APK_BYTES = 200L * 1024 * 1024
    private val lock = Any()

    fun installedVersionCode(context: Context): Long = AppSigning.installed(context).versionCode

    fun installedVersionName(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: BuildConfig.VERSION_NAME
    } catch (e: Exception) {
        BuildConfig.VERSION_NAME
    }

    /** Blocking: call from a worker or background thread. */
    fun check(context: Context): UpdateResult = synchronized(lock) {
        val app = context.applicationContext
        val result = try {
            runCheck(app)
        } catch (e: IOException) {
            Log.w(TAG, "update check network error", e)
            UpdateResult.Failed(app.getString(R.string.update_error_network), retryable = true)
        } catch (e: ManifestException) {
            Log.w(TAG, "bad version.json", e)
            UpdateResult.Failed(app.getString(R.string.update_failed, e.message ?: "version.json"), retryable = false)
        } catch (e: Exception) {
            Log.w(TAG, "update failed", e)
            UpdateResult.Failed(app.getString(R.string.update_failed, e.message ?: e.javaClass.simpleName), retryable = true)
        }
        UpdatePrefs.markChecked(app)
        UpdatePrefs.setStatus(app, when (result) {
            is UpdateResult.UpToDate -> app.getString(R.string.update_latest)
            is UpdateResult.Installing -> app.getString(R.string.update_found, result.versionName)
            is UpdateResult.Failed -> result.message
        })
        result
    }

    private fun runCheck(app: Context): UpdateResult {
        val manifestUrl = BuildConfig.UPDATE_MANIFEST_URL
        if (manifestUrl.isBlank()) return UpdateResult.Failed(app.getString(R.string.update_error_config), retryable = false)

        val manifest = UpdateLogic.parseManifest(fetchText(manifestUrl))
        val installed = AppSigning.installed(app)

        if (!UpdateLogic.isNewer(manifest.versionCode, installed.versionCode)) {
            cleanCache(app, keep = null)
            return UpdateResult.UpToDate
        }
        if (!UpdateLogic.supportsDevice(manifest, Build.VERSION.SDK_INT)) {
            return UpdateResult.Failed(app.getString(R.string.update_error_minsdk), retryable = false)
        }

        val apk = File(updateDir(app), "target-${manifest.versionCode}.apk")
        cleanCache(app, keep = apk)
        if (!(apk.exists() && UpdateLogic.verifySha256(apk, manifest.sha256))) {
            download(manifest.url, apk)
            if (!UpdateLogic.verifySha256(apk, manifest.sha256)) {
                apk.delete()
                return UpdateResult.Failed(app.getString(R.string.update_error_hash), retryable = true)
            }
        }

        val archive = AppSigning.archive(app, apk)
        if (archive == null || archive.packageName != app.packageName || archive.versionCode != manifest.versionCode) {
            apk.delete()
            return UpdateResult.Failed(app.getString(R.string.update_failed, "APK package/version mismatch"), retryable = false)
        }
        if (!UpdateLogic.signersMatch(installed.signerDigests, archive.signerDigests)) {
            apk.delete()
            return UpdateResult.Failed(app.getString(R.string.update_error_signature), retryable = false)
        }

        UpdateInstaller.install(app, apk)
        return UpdateResult.Installing(manifest.versionName)
    }

    private fun updateDir(app: Context): File = File(app.cacheDir, "updates").apply { mkdirs() }

    private fun cleanCache(app: Context, keep: File?) {
        updateDir(app).listFiles()?.forEach { if (it != keep) it.delete() }
    }

    private fun open(url: String): HttpURLConnection {
        val u = URL(url)
        if (u.protocol != "https") throw IOException("https only")
        return (u.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
            setRequestProperty("User-Agent", "TARGET-Android/${BuildConfig.VERSION_NAME}")
        }
    }

    private fun fetchText(url: String): String {
        val c = open(url)
        try {
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
            val bytes = c.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_MANIFEST_BYTES) throw IOException("version.json too large")
                }
                out.toByteArray()
            }
            return String(bytes, Charsets.UTF_8)
        } finally {
            c.disconnect()
        }
    }

    private fun download(url: String, dest: File) {
        val tmp = File(dest.parentFile, dest.name + ".part")
        val c = open(url)
        try {
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
            var total = 0L
            c.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_APK_BYTES) throw IOException("APK too large")
                        out.write(buf, 0, n)
                    }
                }
            }
            if (!tmp.renameTo(dest)) throw IOException("could not save APK")
        } finally {
            c.disconnect()
            tmp.delete()
        }
    }
}
