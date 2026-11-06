package app.target.assistant.brain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contact matching, confirm words, routines, transliteration, personas. */
class PureLogicTest {

    private val book = listOf(
        ContactEntry(1, "Mummy ❤️", "+91 98765 00001"),
        ContactEntry(2, "Papa Ji", "98765 00002"),
        ContactEntry(3, "Rahul Sharma", "98765 00003", starred = true),
        ContactEntry(4, "Rahul Verma", "98765 00004"),
        ContactEntry(5, "Pooja Singh", "98765 00005"),
        ContactEntry(6, "Bhaiya", "98765 00006"),
        ContactEntry(7, "Neha Didi", "98765 00007"),
        ContactEntry(8, "Amit Office", "98765 00008"),
        ContactEntry(9, "Mummy ❤️", "098765 00001"), // same phone saved twice
    )

    // ---- contact matching ----
    @Test fun mummyMatchesRelation() {
        val m = ContactMatcher.match("mummy", book)
        assertEquals("Mummy ❤️", m.first().contact.name)
        assertTrue(ContactMatcher.isConfident(m))
    }
    @Test fun maaMatchesMummy() = assertEquals(1L, ContactMatcher.match("maa", book).first().contact.id)
    @Test fun momMatchesMummy() = assertEquals(1L, ContactMatcher.match("mom", book).first().contact.id)
    @Test fun papaMatchesPapaJi() = assertEquals(2L, ContactMatcher.match("papa", book).first().contact.id)
    @Test fun dadMatchesPapa() = assertEquals(2L, ContactMatcher.match("dad", book).first().contact.id)
    @Test fun bhaiMatchesBhaiya() = assertEquals(6L, ContactMatcher.match("bhai", book).first().contact.id)
    @Test fun didiMatchesNehaDidi() = assertEquals(7L, ContactMatcher.match("didi", book).first().contact.id)
    @Test fun rahulIsAmbiguous() {
        val m = ContactMatcher.match("rahul", book)
        assertEquals(2, m.size)
        assertFalse(ContactMatcher.isConfident(m))
        assertEquals(3L, m.first().contact.id) // starred first
    }
    @Test fun rahulSharmaIsConfident() {
        val m = ContactMatcher.match("rahul sharma", book)
        assertEquals(3L, m.first().contact.id)
        assertTrue(ContactMatcher.isConfident(m))
    }
    @Test fun pujaSpellingDrift() = assertEquals(5L, ContactMatcher.match("puja", book).first().contact.id)
    @Test fun sarmaSpellingDrift() = assertEquals(3L, ContactMatcher.match("rahul sarma", book).first().contact.id)
    @Test fun noMatch() = assertTrue(ContactMatcher.match("zubair", book).isEmpty())
    @Test fun duplicatePhoneDeduped() = assertEquals(1, ContactMatcher.match("mummy", book).count { it.contact.name.startsWith("Mummy") })
    @Test fun devanagariContact() = assertEquals(10L, ContactMatcher.match("mummy", listOf(ContactEntry(10, "मम्मी", "1234567890"))).first().contact.id)
    @Test fun normalizeFlattens() {
        assertEquals(ContactMatcher.normalize("Pooja"), ContactMatcher.normalize("Puja"))
        assertEquals(ContactMatcher.normalize("Shweta"), ContactMatcher.normalize("Sveta"))
    }
    @Test fun levenshteinBasic() = assertEquals(3, ContactMatcher.levenshtein("kitten", "sitting"))
    @Test fun phoneKeyLast10() = assertEquals(ContactMatcher.phoneKey("+91 98765-43210"), ContactMatcher.phoneKey("098765 43210"))
    @Test fun waNumberIndia() = assertEquals("919876543210", ContactMatcher.waNumber("98765 43210"))
    @Test fun waNumberPlus() = assertEquals("14155550100", ContactMatcher.waNumber("+1 415 555 0100"))
    @Test fun waNumberTrunkZero() = assertEquals("919876543210", ContactMatcher.waNumber("09876543210"))
    @Test fun pickPehla() = assertEquals(0, ContactMatcher.pickChoice("pehla wala", listOf("Rahul Sharma", "Rahul Verma")))
    @Test fun pickDusra() = assertEquals(1, ContactMatcher.pickChoice("dusra", listOf("Rahul Sharma", "Rahul Verma")))
    @Test fun pickNumber() = assertEquals(1, ContactMatcher.pickChoice("number 2", listOf("Rahul Sharma", "Rahul Verma")))
    @Test fun pickByName() = assertEquals(1, ContactMatcher.pickChoice("Verma", listOf("Rahul Sharma", "Rahul Verma")))
    @Test fun pickNothing() = assertEquals(-1, ContactMatcher.pickChoice("pata nahi", listOf("Rahul Sharma", "Rahul Verma")))
    @Test fun relationGroup() {
        assertEquals(ContactMatcher.relationGroup("maa"), ContactMatcher.relationGroup("mummy"))
        assertEquals(-1, ContactMatcher.relationGroup("rahul"))
    }

    // ---- confirm words ----
    @Test fun haan() = assertEquals(Answer.YES, ConfirmWords.classify("haan"))
    @Test fun haanJiBhejo() = assertEquals(Answer.YES, ConfirmWords.classify("Haan ji, bhejo"))
    @Test fun yesPlease() = assertEquals(Answer.YES, ConfirmWords.classify("yes please"))
    @Test fun theekHai() = assertEquals(Answer.YES, ConfirmWords.classify("theek hai"))
    @Test fun karDo() = assertEquals(Answer.YES, ConfirmWords.classify("kar do"))
    @Test fun nahi() = assertEquals(Answer.NO, ConfirmWords.classify("nahi"))
    @Test fun nahiMatKaro() = assertEquals(Answer.NO, ConfirmWords.classify("nahi, mat karo"))
    @Test fun noDontSend() = assertEquals(Answer.NO, ConfirmWords.classify("no don't send"))
    @Test fun rehneDo() = assertEquals(Answer.NO, ConfirmWords.classify("rehne do"))
    @Test fun cancel() = assertEquals(Answer.NO, ConfirmWords.classify("cancel"))
    @Test fun unknownWords() = assertEquals(Answer.UNKNOWN, ConfirmWords.classify("aaj mausam kaisa hai"))
    @Test fun empty() = assertEquals(Answer.UNKNOWN, ConfirmWords.classify("  "))

    // ---- routines ----
    @Test fun splitCommas() = assertEquals(listOf("alarm 6 baje", "torch on", "news"), Routines.splitSteps("alarm 6 baje, torch on; news"))
    @Test fun splitPhir() = assertEquals(listOf("torch on", "whatsapp kholo"), Routines.splitSteps("torch on phir whatsapp kholo"))
    @Test fun splitLines() = assertEquals(listOf("a", "b"), Routines.splitSteps("a\n\n b \n"))
    @Test fun routineKey() = assertEquals("subah", Routines.key("Subah ka Routine"))
    @Test fun findRoutine() {
        val list = listOf(Routine("subah", listOf("torch on")), Routine("raat", listOf("torch off")))
        assertEquals("raat", Routines.find("raat wala routine", list)?.name)
        assertNull(Routines.find("dopahar", list))
    }
    @Test fun upsertReplaces() {
        val list = Routines.upsert(listOf(Routine("subah", listOf("a"))), Routine("Subah", listOf("b")))
        assertEquals(1, list.size)
        assertEquals(listOf("b"), list.first().steps)
    }

    // ---- transliteration ----
    @Test fun translitDictionary() = assertEquals("mummy ko call karo", Translit.romanize("मम्मी को कॉल करो"))
    @Test fun translitLetters() = assertEquals("kamal", Translit.romanizeWord("कमल"))
    @Test fun translitDigits() = assertEquals("7", Translit.romanizeWord("७"))
    @Test fun translitKeepsWordCount() = assertEquals(5, Translit.romanize("कल ५ बजे याद दिलाना").split(' ').size)
    @Test fun translitNukta() = assertEquals("zyada", Translit.romanizeWord("ज़्यादा"))
    @Test fun translitLatinUntouched() = assertEquals("call Rahul", Translit.romanize("call Rahul"))

    // ---- persona ----
    @Test fun personaDefaultNoPrefix() = assertEquals("", Persona.DEFAULT.prefix("TARGET"))
    @Test fun personaDostNamesAssistant() = assertTrue(Persona.DOST.prefix("Jarvis").contains("Jarvis"))
    @Test fun personaOf() = assertEquals(Persona.PROFESSIONAL, Persona.of("professional"))

    // ---- speech text / OTP ----
    @Test fun speechStripsMarkdown() = assertEquals("Mausam. Aaj Delhi mein 24°C hai. Halki dhoop source", SpeechText.clean("## Mausam\n- **Aaj** Delhi mein 24°C hai\n- Halki dhoop [source](https://x.com)"))
    @Test fun speechDropsFences() = assertEquals("Jawab", SpeechText.clean("Jawab\n```sources\n[1] a\n```"))
    @Test fun speechTruncates() = assertTrue(SpeechText.clean("Ek. ".repeat(400), 100).length <= 101)
    @Test fun otpSensitive() = assertTrue(SpeechText.isSensitive("HDFC", "Your OTP is 482913"))
    @Test fun codeSensitive() = assertTrue(SpeechText.isSensitive("Google", "G-123456 is your verification code"))
    @Test fun hindiOtpSensitive() = assertTrue(SpeechText.isSensitive("Bank", "आपका ओटीपी 1234 है"))
    @Test fun underscoreOtpSensitive() = assertTrue(SpeechText.isSensitive("Bank", "Your_OTP_is_482913"))
    @Test fun normalMessageNotSensitive() = assertFalse(SpeechText.isSensitive("Rahul", "kal 5 baje milte hain"))

    // ---- wake word keywords ----
    @Test fun keywordsHaveAllPhrases() {
        val k = app.target.assistant.wake.WakeKeywords.build()
        assertTrue(k.contains("▁HE Y ▁T AR GE T :1.50 #0.25 @HEY_TARGET"))
        assertTrue(k.contains("@BYE_TARGET"))
        assertEquals(8, k.trim().lines().size)
        assertTrue(k.contains("@WAKE_UP_TARGET") && k.contains("@SO_JAO") && k.contains("@GO_TO_SLEEP") && k.contains("@HELLO_TARGET"))
    }
    @Test fun keywordsClamp() = assertTrue(app.target.assistant.wake.WakeKeywords.build(9f, 0f).contains(":3.00 #0.05"))
    @Test fun keywordMeaning() {
        assertEquals(app.target.assistant.wake.WakeKeywords.Hit.WAKE, app.target.assistant.wake.WakeKeywords.meaning("HEY_TARGET"))
        assertEquals(app.target.assistant.wake.WakeKeywords.Hit.SLEEP, app.target.assistant.wake.WakeKeywords.meaning("bye target"))
        assertEquals(app.target.assistant.wake.WakeKeywords.Hit.WAKE, app.target.assistant.wake.WakeKeywords.meaning("WAKE_UP_TARGET"))
        assertEquals(app.target.assistant.wake.WakeKeywords.Hit.SLEEP, app.target.assistant.wake.WakeKeywords.meaning("SO_JAO"))
        assertEquals(app.target.assistant.wake.WakeKeywords.Hit.NONE, app.target.assistant.wake.WakeKeywords.meaning(""))
    }
    @Test fun checksumParse() = assertEquals(
        "2e6ac2577310bfa2f4b6b5fab0478b868c9d0b2cb2c51b3e13b50581b588864d",
        app.target.assistant.wake.WakeKeywords.checksumFor(
            "a.tar.bz2\tf170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a\nm.tar.bz2\t2E6AC2577310BFA2F4B6B5FAB0478B868C9D0B2CB2C51B3E13B50581B588864D\n", "m.tar.bz2"),
    )

    // ---- energy gate ----
    private fun tone(level: Float) = FloatArray(480) { if (it % 2 == 0) level else -level }

    @Test fun gateStaysClosedInSilence() {
        val g = app.target.assistant.wake.EnergyGate()
        repeat(200) { assertTrue(g.push(tone(0.001f)).isEmpty()) }
        assertFalse(g.isOpen)
    }
    @Test fun gateOpensAfterFourLoudFramesWithPreroll() {
        val g = app.target.assistant.wake.EnergyGate()
        repeat(20) { g.push(tone(0.001f)) }
        assertTrue(g.push(tone(0.2f)).isEmpty())
        assertTrue(g.push(tone(0.2f)).isEmpty())
        assertTrue(g.push(tone(0.2f)).isEmpty())
        val out = g.push(tone(0.2f))
        assertTrue(g.isOpen)
        assertEquals(10, out.size) // pre-roll includes the quiet frames before "hey"
    }
    @Test fun gateIgnoresShortClick() {
        val g = app.target.assistant.wake.EnergyGate()
        repeat(20) { g.push(tone(0.001f)) }
        g.push(tone(0.5f)); g.push(tone(0.5f)); g.push(tone(0.001f))
        assertFalse(g.isOpen)
    }
    @Test fun gateClosesAfterHangover() {
        val g = app.target.assistant.wake.EnergyGate(hangoverFrames = 5)
        repeat(4) { g.push(tone(0.3f)) }
        assertTrue(g.isOpen)
        repeat(6) { g.push(tone(0.0005f)) }
        assertFalse(g.isOpen)
    }
    @Test fun gateAdaptsToNoise() {
        val g = app.target.assistant.wake.EnergyGate()
        repeat(300) { g.push(tone(0.01f)) } // steady fan noise: louder than minRms but it is background
        assertTrue(g.threshold > 0.02f)
    }
}
