package app.target.assistant.update

import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * version.json published by .github/workflows/android-release.yml:
 * {"versionCode": 12, "versionName": "0.1.12", "sha256": "<64 hex>", "url": "https://…/target-12.apk",
 *  "notes": "…", "minSdk": 26}
 */
data class UpdateManifest(
    val versionCode: Long,
    val versionName: String,
    val sha256: String,
    val url: String,
    val notes: String,
    val minSdk: Int,
)

class ManifestException(message: String) : Exception(message)

object UpdateLogic {

    private val HEX64 = Regex("^[0-9a-fA-F]{64}$")

    /** Parses and validates version.json. Throws [ManifestException] on anything unusable. */
    fun parseManifest(json: String): UpdateManifest {
        val o = try {
            JSONObject(json)
        } catch (e: JSONException) {
            throw ManifestException("version.json is not valid JSON")
        }
        if (!o.has("versionCode")) throw ManifestException("versionCode missing")
        val code = try { o.getLong("versionCode") } catch (e: JSONException) { throw ManifestException("versionCode is not a number") }
        if (code <= 0) throw ManifestException("versionCode must be positive")

        val sha = o.optString("sha256", "").trim()
        if (!HEX64.matches(sha)) throw ManifestException("sha256 must be 64 hex characters")

        val url = o.optString("url", "").trim()
        if (!url.startsWith("https://")) throw ManifestException("url must be https")

        val minSdk = if (o.has("minSdk")) {
            try { o.getInt("minSdk") } catch (e: JSONException) { throw ManifestException("minSdk is not a number") }
        } else 1

        return UpdateManifest(
            versionCode = code,
            versionName = o.optString("versionName", code.toString()).ifBlank { code.toString() },
            sha256 = sha.lowercase(),
            url = url,
            notes = o.optString("notes", ""),
            minSdk = minSdk,
        )
    }

    /** True when the published build is strictly newer than the installed one. */
    fun isNewer(remoteVersionCode: Long, installedVersionCode: Long): Boolean = remoteVersionCode > installedVersionCode

    /** True when this device can run the published build. */
    fun supportsDevice(manifest: UpdateManifest, deviceSdk: Int): Boolean = deviceSdk >= manifest.minSdk

    /** An update applies only when it is newer and the device meets its minSdk. */
    fun shouldUpdate(manifest: UpdateManifest, installedVersionCode: Long, deviceSdk: Int): Boolean =
        isNewer(manifest.versionCode, installedVersionCode) && supportsDevice(manifest, deviceSdk)

    fun sha256Hex(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().toHex()
    }

    fun sha256Hex(file: File): String = file.inputStream().use { sha256Hex(it) }

    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()

    /** Constant-time, case-insensitive comparison of a file's SHA-256 with the expected hex digest. */
    fun verifySha256(file: File, expectedHex: String): Boolean = hashesEqual(sha256Hex(file), expectedHex)

    fun hashesEqual(actualHex: String, expectedHex: String): Boolean {
        val a = actualHex.trim().lowercase()
        val b = expectedHex.trim().lowercase()
        if (!HEX64.matches(a) || !HEX64.matches(b)) return false
        return MessageDigest.isEqual(a.toByteArray(), b.toByteArray())
    }

    /**
     * Signing check: the downloaded APK must be signed by exactly the same certificate(s) as the
     * installed app (SHA-256 digests of the certs). Empty on either side never matches.
     */
    fun signersMatch(installed: Set<String>, archive: Set<String>): Boolean {
        if (installed.isEmpty() || archive.isEmpty()) return false
        return installed.map { it.lowercase() }.toSet() == archive.map { it.lowercase() }.toSet()
    }

    private fun ByteArray.toHex(): String {
        val sb = StringBuilder(size * 2)
        for (b in this) sb.append(String.format("%02x", b.toInt() and 0xff))
        return sb.toString()
    }
}
