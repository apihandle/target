package app.target.assistant.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class UpdateLogicTest {

    private val abcSha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

    private fun manifestJson(
        code: String = "12",
        sha: String = "\"$abcSha\"",
        url: String = "\"https://example.supabase.co/storage/v1/object/public/app-updates/android/target-12.apk\"",
        extra: String = ", \"versionName\": \"0.1.12\", \"notes\": \"Naya updater\", \"minSdk\": 26",
    ) = "{\"versionCode\": $code, \"sha256\": $sha, \"url\": $url$extra}"

    // --- version comparison ---

    @Test fun newerVersionCodeIsAnUpdate() {
        assertTrue(UpdateLogic.isNewer(5, 4))
        assertTrue(UpdateLogic.isNewer(100, 99))
    }

    @Test fun sameOrOlderVersionCodeIsNotAnUpdate() {
        assertFalse(UpdateLogic.isNewer(4, 4))
        assertFalse(UpdateLogic.isNewer(3, 4))
    }

    @Test fun largeVersionCodesCompareAsLongs() {
        assertTrue(UpdateLogic.isNewer(3_000_000_000L, 2_999_999_999L))
    }

    @Test fun minSdkBlocksOlderDevices() {
        val m = UpdateLogic.parseManifest(manifestJson())
        assertTrue(UpdateLogic.shouldUpdate(m, installedVersionCode = 3, deviceSdk = 26))
        assertTrue(UpdateLogic.shouldUpdate(m, installedVersionCode = 3, deviceSdk = 36))
        assertFalse(UpdateLogic.shouldUpdate(m, installedVersionCode = 3, deviceSdk = 25))
        assertFalse(UpdateLogic.shouldUpdate(m, installedVersionCode = 12, deviceSdk = 36))
    }

    // --- manifest parsing ---

    @Test fun parsesFullManifest() {
        val m = UpdateLogic.parseManifest(manifestJson())
        assertEquals(12L, m.versionCode)
        assertEquals("0.1.12", m.versionName)
        assertEquals(abcSha, m.sha256)
        assertTrue(m.url.endsWith("target-12.apk"))
        assertEquals("Naya updater", m.notes)
        assertEquals(26, m.minSdk)
    }

    @Test fun optionalFieldsHaveDefaults() {
        val m = UpdateLogic.parseManifest(manifestJson(extra = ""))
        assertEquals("12", m.versionName)
        assertEquals("", m.notes)
        assertEquals(1, m.minSdk)
    }

    @Test fun uppercaseShaIsNormalised() {
        val m = UpdateLogic.parseManifest(manifestJson(sha = "\"${abcSha.uppercase()}\""))
        assertEquals(abcSha, m.sha256)
    }

    @Test fun ignoresUnknownFields() {
        val m = UpdateLogic.parseManifest(manifestJson(extra = ", \"channel\": \"stable\""))
        assertEquals(12L, m.versionCode)
    }

    @Test fun rejectsBadManifests() {
        val bad = listOf(
            "not json",
            "[]",
            "{\"sha256\": \"$abcSha\", \"url\": \"https://x/y.apk\"}", // no versionCode
            manifestJson(code = "\"twelve\""),
            manifestJson(code = "0"),
            manifestJson(code = "-3"),
            manifestJson(sha = "\"abc123\""),
            manifestJson(sha = "\"${"z".repeat(64)}\""),
            manifestJson(url = "\"http://insecure.example/target.apk\""),
            manifestJson(url = "\"\""),
            manifestJson(extra = ", \"minSdk\": \"abc\""),
        )
        for (json in bad) {
            try {
                UpdateLogic.parseManifest(json)
                fail("should reject: $json")
            } catch (_: ManifestException) {
            }
        }
    }

    // --- hash verification ---

    @Test fun sha256OfKnownInput() {
        assertEquals(abcSha, UpdateLogic.sha256Hex("abc".toByteArray()))
        assertEquals(abcSha, UpdateLogic.sha256Hex("abc".byteInputStream()))
    }

    @Test fun verifiesFileHash() {
        val f = File.createTempFile("upd", ".apk")
        try {
            f.writeText("abc")
            assertTrue(UpdateLogic.verifySha256(f, abcSha))
            assertTrue(UpdateLogic.verifySha256(f, abcSha.uppercase()))
            f.writeText("abd")
            assertFalse(UpdateLogic.verifySha256(f, abcSha))
        } finally {
            f.delete()
        }
    }

    @Test fun largeFileHashMatchesByteHash() {
        val data = ByteArray(300_000) { (it % 251).toByte() }
        val f = File.createTempFile("upd", ".apk")
        try {
            f.writeBytes(data)
            assertEquals(UpdateLogic.sha256Hex(data), UpdateLogic.sha256Hex(f))
        } finally {
            f.delete()
        }
    }

    @Test fun malformedExpectedHashNeverMatches() {
        assertFalse(UpdateLogic.hashesEqual(abcSha, ""))
        assertFalse(UpdateLogic.hashesEqual(abcSha, abcSha.dropLast(1)))
        assertFalse(UpdateLogic.hashesEqual("", ""))
    }

    // --- signer comparison ---

    @Test fun signersMustMatchExactly() {
        val k = "aa".repeat(32)
        val other = "bb".repeat(32)
        assertTrue(UpdateLogic.signersMatch(setOf(k), setOf(k.uppercase())))
        assertFalse(UpdateLogic.signersMatch(setOf(k), setOf(other)))
        assertFalse(UpdateLogic.signersMatch(setOf(k), setOf(k, other)))
        assertFalse(UpdateLogic.signersMatch(emptySet(), emptySet()))
        assertFalse(UpdateLogic.signersMatch(setOf(k), emptySet()))
    }
}
