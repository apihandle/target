package app.target.assistant

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import app.target.assistant.brain.CommandRunner
import app.target.assistant.web.PendingImage
import java.io.File

/**
 * "Camera se dekho": takes one photo with the phone's camera app (no CAMERA permission needed), then
 * opens TARGET with the question prefilled and the photo attached; the web app uploads it and sends.
 */
class VisionActivity : ComponentActivity() {

    companion object {
        const val EXTRA_QUESTION = "question"
    }

    private lateinit var photo: File

    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val q = intent.getStringExtra(EXTRA_QUESTION).orEmpty()
        if (ok && photo.length() > 0 && PendingImage.setFromFile(this, photo, "camera.jpg")) {
            CommandRunner.openWebApp(this, q, send = false)
        }
        photo.delete()
        finish()
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
