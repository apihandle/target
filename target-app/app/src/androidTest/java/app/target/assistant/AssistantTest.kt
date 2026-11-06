package app.target.assistant

import android.Manifest
import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasDataString
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.target.assistant.brain.Command
import app.target.assistant.brain.CommandRunner
import app.target.assistant.brain.RiskKind
import app.target.assistant.settings.Prefs
import app.target.assistant.voice.AssistantController
import org.hamcrest.Matchers.allOf
import org.hamcrest.Matchers.anyOf
import org.hamcrest.Matchers.containsString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The assistant sheet opens and runs local commands; risky actions wait for "haan"; routines save and run. */
@RunWith(AndroidJUnit4::class)
class AssistantTest {

    /** Records what the controller asks the UI to show. */
    private class FakeUi : AssistantController.Ui {
        @Volatile var reply = ""
        @Volatile var confirm: String? = null
        @Volatile var choices: List<String> = emptyList()
        @Volatile var closed = false
        override fun showTranscript(text: String) {}
        override fun showReply(text: String) { reply = text }
        override fun showListening(on: Boolean) {}
        override fun showChoices(choices: List<String>) { this.choices = choices }
        override fun showConfirm(question: String?) { confirm = question }
        override fun close(delayMs: Long) { closed = true }
        override fun requestUnlock(onResult: (Boolean) -> Unit) = onResult(true)
        override fun startActivity(intent: Intent) { Dev.ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    private val callIntent = allOf(anyOf(hasAction(Intent.ACTION_CALL), hasAction(Intent.ACTION_DIAL)), hasDataString(containsString("9876543210")))

    @Before fun setUp() {
        Dev.clearPrefs()
        Dev.grant(Manifest.permission.RECORD_AUDIO)
        Dev.stubIntents()
    }

    @After fun tearDown() = Intents.release()

    @Test fun assistActivityOpensAndRunsLocalCommand() {
        val i = Intent(Dev.ctx, AssistActivity::class.java).putExtra(Intent.EXTRA_TEXT, "battery kitni hai")
        ActivityScenario.launch<AssistActivity>(i).use { sc ->
            var reply = ""
            sc.onActivity { reply = it.reply }
            assertTrue("reply was: $reply", reply.contains("%"))
        }
    }

    @Test fun assistActivityAsksBeforeCalling() {
        val i = Intent(Dev.ctx, AssistActivity::class.java).putExtra(Intent.EXTRA_TEXT, "9876543210 ko call karo")
        ActivityScenario.launch<AssistActivity>(i).use { sc ->
            var q: String? = null
            sc.onActivity { q = it.confirmQuestion }
            assertNotNull(q)
            assertTrue(Intents.getIntents().none { it.action == Intent.ACTION_CALL || it.action == Intent.ACTION_DIAL })
        }
    }

    @Test fun riskyActionNeedsHaan() {
        val ui = FakeUi()
        val c = Dev.onMain { AssistantController(Dev.ctx, ui) }
        Dev.onMain { c.userSaid("call 9876543210") }
        assertNotNull("confirm shown", ui.confirm)
        assertTrue("nothing called yet", Intents.getIntents().isEmpty())

        Dev.onMain { c.userSaid("nahi") }
        assertNull(ui.confirm)
        assertTrue("still nothing called", Intents.getIntents().isEmpty())

        Dev.onMain { c.userSaid("call 9876543210") }
        Dev.onMain { c.userSaid("haan ji") }
        intended(callIntent)
        Dev.onMain { c.destroy() }
    }

    @Test fun tapYesRunsAction() {
        val ui = FakeUi()
        val c = Dev.onMain { AssistantController(Dev.ctx, ui) }
        Dev.onMain { c.userSaid("call 9876543210") }
        assertNotNull(ui.confirm)
        Dev.onMain { c.tapYes() }
        intended(callIntent)
        Dev.onMain { c.destroy() }
    }

    @Test fun binaPoocheToggleSkipsConfirm() {
        Prefs(Dev.ctx).setNoAsk(RiskKind.CALL, true)
        val ui = FakeUi()
        val c = Dev.onMain { AssistantController(Dev.ctx, ui) }
        Dev.onMain { c.userSaid("call 9876543210") }
        assertNull(ui.confirm)
        intended(callIntent)
        Dev.onMain { c.destroy() }
    }

    @Test fun smsWithoutTextAsksForIt() {
        val out = Dev.onMain { CommandRunner(Dev.ctx).run(Command.Sms("9876543210", ""), "sms 9876543210") }
        assertNotNull(out.askText)
        val next = Dev.onMain { out.askText!!.invoke("main aa raha hoon") }
        assertNotNull("sms is confirmed first", next.confirm)
        assertEquals(RiskKind.SMS, next.confirm!!.kind)
    }

    @Test fun routineSavesAndRuns() {
        val r = CommandRunner(Dev.ctx)
        Dev.onMain { r.handle("routine banao test: torch on, battery kitni hai") }
        val saved = Prefs(Dev.ctx).routines.firstOrNull { it.name == "test" }
        assertNotNull(saved)
        assertEquals(listOf("torch on", "battery kitni hai"), saved!!.steps)
        val run = Dev.onMain { r.handle("test routine chalao") }
        assertEquals(2, run.steps.size)
        val last = Dev.onMain { r.handle(run.steps[1]) }
        assertTrue(last.reply.contains("%"))
    }

    @Test fun routineRunsThroughController() {
        Prefs(Dev.ctx).routines = listOf(app.target.assistant.brain.Routine("raat", listOf("battery kitni hai")))
        val ui = FakeUi()
        val c = Dev.onMain { AssistantController(Dev.ctx, ui) }
        Dev.onMain { c.userSaid("raat ka routine chalao") }
        assertTrue(ui.reply.isNotBlank())
        Dev.onMain { c.destroy() }
    }
}
