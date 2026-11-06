package app.target.assistant

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import app.target.assistant.brain.CommandRunner
import app.target.assistant.net.TargetApi
import app.target.assistant.net.VisionApi
import app.target.assistant.settings.Prefs
import app.target.assistant.store.ChatHistory
import app.target.assistant.util.Notify
import app.target.assistant.voice.Tts
import app.target.assistant.web.PendingImage
import java.io.File

/**
 * "Camera se dekho": takes one photo with the phone's camera app (no CAMERA permission needed).
 * Native path (overlay answers on, anon key built in, online, signed in): photo + question go straight to
 * TARGET's chat API and the answer is spoken + shown as a notification. Otherwise TARGET's web composer
 * opens with the question prefilled and the photo attached; the web app uploads it and sends.
 */
class VisionActivity : ComponentActivity() {

    companion object {
        const val EXTRA_QUESTION = "question"
        const val NOTIFY_ID = 7100
    }

    private lateinit var photo: File

    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val q = intent.getStringExtra(EXTRA_QUESTION).orEmpty().ifBlank { getString(R.string.camera_default_question) }
        if (!ok || photo.length() == 0L) { photo.delete(); finish(); return@registerForActivityResult }
        if (Prefs(this).nativeChat && VisionApi.configured && TargetApi.isOnline(this)) askNative(q) else composer(q)
    }

    private fun composer(q: String) {
        if (PendingImage.setFromFile(this, photo, "camera.jpg")) CommandRunner.openWebApp(this, q, send = false)
        photo.delete()
        finish()
    }

    private fun askNative(q: String) {
        Toast.makeText(this, R.string.vision_thinking, Toast.LENGTH_SHORT).show()
        val cookie = TargetApi.cookie()
        val app = applicationContext
        Thread {
            val jpeg = PendingImage.jpegFromFile(photo)
            val out = if (jpeg == null) VisionApi.Outcome.Fallback("decode")
            else VisionApi.ask(cookie, jpeg, q) { lines -> runOnUiThread { TargetApi.storeCookies(lines) } }
            runOnUiThread {
                val r = (out as? VisionApi.Outcome.Answer)?.result
                if (r is TargetApi.Result.Ok) {
                    val text = TargetApi.spoken(r).ifBlank { getString(R.string.reply_empty_answer) }
                    ChatHistory.add(app, "user", "📷 $q", r.conversationId)
                    ChatHistory.add(app, "assistant", text, r.conversationId)
                    Tts.speak(app, text)
                    Notify.answer(app, NOTIFY_ID, q, text, r.conversationId)
                    photo.delete()
                    finish()
                } else {
                    composer(q)
                }
            }
        }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dir = File(cacheDir, "vision").apply { mkdirs() }
        photo = File(dir, "photo.jpg")
        if (savedInstanceState != null) return
        val uri = FileProvider.getUriForFile(this, "$packageName.files", photo)
        try { takePicture.launch(uri) } catch (_: Exception) { finish() }
    }
}
