package app.target.assistant.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeSecurityTest {
    private val base = "https://gettarget.vercel.app"

    @Test fun originRuleDropsPathAndDefaultPort() {
        assertEquals("https://gettarget.vercel.app", BridgeSecurity.originRule("https://GetTarget.vercel.app/app?q=1"))
        assertEquals("https://gettarget.vercel.app", BridgeSecurity.originRule("https://gettarget.vercel.app:443/"))
        assertEquals("http://10.0.2.2:3000", BridgeSecurity.originRule("http://10.0.2.2:3000/app"))
    }

    @Test fun sameOriginOnly() {
        assertTrue(BridgeSecurity.sameOrigin("https://gettarget.vercel.app/app/chat/1", base))
        assertTrue(BridgeSecurity.sameOrigin("https://gettarget.vercel.app", base))
        assertFalse("http downgrade", BridgeSecurity.sameOrigin("http://gettarget.vercel.app/app", base))
        assertFalse("other port", BridgeSecurity.sameOrigin("https://gettarget.vercel.app:8443/", base))
        assertFalse("look-alike", BridgeSecurity.sameOrigin("https://gettarget.vercel.app.evil.com/", base))
        assertFalse("subdomain", BridgeSecurity.sameOrigin("https://x.gettarget.vercel.app/", base))
        assertFalse("userinfo trick", BridgeSecurity.sameOrigin("https://gettarget.vercel.app@evil.com/", base))
        assertFalse(BridgeSecurity.sameOrigin("null", base))
        assertFalse(BridgeSecurity.sameOrigin("", base))
        assertFalse(BridgeSecurity.sameOrigin(null, base))
        assertFalse(BridgeSecurity.sameOrigin("javascript:alert(1)", base))
        assertFalse(BridgeSecurity.sameOrigin("data:text/html,hi", base))
    }

    @Test fun onlyTopFrameOnOwnPage() {
        val page = "https://gettarget.vercel.app/app"
        assertTrue(BridgeSecurity.allowed("https://gettarget.vercel.app", true, page, base))
        assertFalse("iframe", BridgeSecurity.allowed("https://gettarget.vercel.app", false, page, base))
        assertFalse("other origin", BridgeSecurity.allowed("https://evil.example.com", true, page, base))
        assertFalse("top page elsewhere", BridgeSecurity.allowed("https://gettarget.vercel.app", true, "https://evil.example.com/", base))
        assertFalse("no page yet", BridgeSecurity.allowed("https://gettarget.vercel.app", true, null, base))
    }

    @Test fun shimListsEveryMethod() {
        val js = BridgeSecurity.shimJs()
        BridgeSecurity.METHODS.forEach { assertTrue(it, js.contains("'$it'")) }
        assertFalse(js.contains("%METHODS%"))
        assertTrue("iframes skip the shim", js.contains("window.top !== window"))
    }
}
