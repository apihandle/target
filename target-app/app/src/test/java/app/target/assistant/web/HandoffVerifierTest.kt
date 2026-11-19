package app.target.assistant.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** PKCE verifier generation and challenge computation for the sign-in handoff (fix #4). */
class HandoffVerifierTest {

    @Test fun challengeMatchesRfc7636TestVector() {
        // RFC 7636 Appendix B: the canonical S256 example pair.
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            HandoffVerifier.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test fun newVerifierIs43CharBase64url() {
        val v = HandoffVerifier.newVerifier()
        assertEquals(43, v.length)
        assertTrue("base64url charset: $v", v.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test fun newVerifiersDifferAndChallengesDiffer() {
        val a = HandoffVerifier.newVerifier()
        val b = HandoffVerifier.newVerifier()
        assertNotEquals(a, b)
        assertNotEquals(HandoffVerifier.challenge(a), HandoffVerifier.challenge(b))
        // The challenge is a hash, never the verifier itself.
        assertNotEquals(a, HandoffVerifier.challenge(a))
        assertEquals(43, HandoffVerifier.challenge(a).length)
    }
}
