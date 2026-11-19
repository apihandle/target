package app.target.assistant.web

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * PKCE-style verifier for the Google sign-in handoff (fix #4). Before the Custom Tab opens,
 * the app generates a [newVerifier] and keeps it in app-private storage (Prefs); only its
 * SHA-256 [challenge] travels with the /auth/google start URL and is stored server-side with
 * the parked session. When the App Link returns, the app presents the verifier itself to
 * /auth/app-handoff — so a handoff code intercepted by another browser is useless without
 * this phone. Pure JVM (java.security / java.util only) so unit tests can cover it.
 */
object HandoffVerifier {

    /** 32 random bytes → a 43-char base64url verifier (256 bits, same shape as the handoff code). */
    fun newVerifier(random: SecureRandom = SecureRandom()): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    /** base64url(SHA-256(verifier)) — the code_challenge the server stores (RFC 7636, S256). */
    fun challenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
}
