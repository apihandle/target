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
}
