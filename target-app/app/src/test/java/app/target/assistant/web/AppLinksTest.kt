package app.target.assistant.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** URL shaping for the Google sign-in handoff (Custom Tab → App Link → WebView). */
class AppLinksTest {

    private val base = "https://gettarget.vercel.app"

    @Test fun handoffUrlTurnsAppReturnIntoHandoff() {
        assertEquals(
            "$base/auth/app-handoff?code=abc123",
            AppLinks.handoffUrl("$base/auth/app-return?code=abc123", base),
        )
    }

    @Test fun handoffUrlRejectsOtherPathsAndMissingCode() {
        assertNull(AppLinks.handoffUrl("$base/app?code=abc123", base))
        assertNull(AppLinks.handoffUrl("$base/auth/app-return", base))
        assertNull(AppLinks.handoffUrl("$base/auth/app-return?code=", base))
        assertNull(AppLinks.handoffUrl(null, base))
        assertNull(AppLinks.handoffUrl("not a url", base))
    }

    @Test fun googleTabUrlForcesAppFlagAndDefaultNext() {
        val out = AppLinks.googleTabUrl("$base/auth/google")
        assertTrue(out.startsWith("$base/auth/google?"))
        assertTrue("app flag: $out", out.contains("app=1"))
        assertTrue("default next: $out", out.contains("next=%2Fapp"))
    }

    @Test fun googleTabUrlKeepsExistingNextAndOverridesApp() {
        val out = AppLinks.googleTabUrl("$base/auth/google?next=/app/home&app=0")
        assertTrue("next kept: $out", out.contains("next=%2Fapp%2Fhome"))
        assertTrue("app forced: $out", out.contains("app=1"))
        assertTrue("old app value gone: $out", !out.contains("app=0"))
    }

    // ---- fix #4: PKCE binding ----

    @Test fun handoffUrlAppendsVerifierWhenGiven() {
        assertEquals(
            "$base/auth/app-handoff?code=abc123&verifier=v-1_2",
            AppLinks.handoffUrl("$base/auth/app-return?code=abc123", base, "v-1_2"),
        )
    }

    @Test fun handoffUrlWithoutVerifierIsUnchanged() {
        assertEquals(
            "$base/auth/app-handoff?code=abc123",
            AppLinks.handoffUrl("$base/auth/app-return?code=abc123", base, null),
        )
        assertEquals(
            "$base/auth/app-handoff?code=abc123",
            AppLinks.handoffUrl("$base/auth/app-return?code=abc123", base, "  "),
        )
    }

    @Test fun googleTabUrlSetsChallengeAndReplacesStaleOne() {
        val out = AppLinks.googleTabUrl("$base/auth/google?code_challenge=stale", challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        assertTrue("challenge set: $out", out.contains("code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"))
        assertTrue("stale gone: $out", !out.contains("stale"))
        assertTrue("app flag kept: $out", out.contains("app=1"))
    }

    @Test fun googleTabUrlWithoutChallengeHasNoCodeChallenge() {
        val out = AppLinks.googleTabUrl("$base/auth/google")
        assertTrue("no challenge param: $out", !out.contains("code_challenge"))
    }
}
