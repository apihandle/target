package app.target.assistant.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class SupabaseSessionTest {
    private val uid = "6f1c2a3b-1111-2222-3333-444455556666"
    private fun b64(s: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(s.toByteArray())
    private val jwt = "x." + b64("""{"sub":"$uid","role":"authenticated"}""") + ".sig"
    private val json = """{"access_token":"$jwt","refresh_token":"r","user":{"id":"$uid"}}"""

    @Test fun base64Cookie() {
        val s = SupabaseSession.parse("a=1; sb-abcdref-auth-token=base64-${b64(json)}; b=2")!!
        assertEquals("abcdref", s.projectRef)
        assertEquals(jwt, s.accessToken)
        assertEquals(uid, s.userId)
        assertEquals("https://abcdref.supabase.co", s.supabaseUrl)
    }

    @Test fun chunkedCookie() {
        val v = "base64-" + b64(json)
        val c = "sb-abcdref-auth-token.1=${v.substring(40)}; sb-abcdref-auth-token.0=${v.substring(0, 40)}"
        assertEquals(uid, SupabaseSession.parse(c)!!.userId)
    }

    @Test fun urlEncodedJsonAndSubFallback() {
        val noUser = java.net.URLEncoder.encode("""{"access_token":"$jwt"}""", "UTF-8")
        assertEquals(uid, SupabaseSession.parse("sb-x1-auth-token=$noUser")!!.userId)
    }

    @Test fun garbage() {
        assertNull(SupabaseSession.parse(null))
        assertNull(SupabaseSession.parse("foo=bar"))
        assertNull(SupabaseSession.parse("sb-x1-auth-token=base64-!!!"))
        assertNull(SupabaseSession.parse("sb-x1-code-verifier=abc"))
    }

    @Test fun pathIsSafe() {
        assertEquals("$uid/u-1/my_photo_1_.jpg", SupabaseSession.storagePath(uid, "u-1", "my photo(1).jpg"))
    }
}
