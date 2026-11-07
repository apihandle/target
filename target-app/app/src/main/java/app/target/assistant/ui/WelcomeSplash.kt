package app.target.assistant.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * When the welcome artwork may leave: never before [MIN_SHOW_MS] (it should register, not
 * flash), always by [MAX_SHOW_MS] even if the first page is still loading, and in between as
 * soon as the first page has finished. Pure logic so it is unit-testable on the JVM.
 */
object WelcomeTiming {
    const val MIN_SHOW_MS = 1_200L
    const val MAX_SHOW_MS = 3_500L

    fun shouldDismiss(shownMs: Long, pageReady: Boolean): Boolean =
        shownMs >= MAX_SHOW_MS || (pageReady && shownMs >= MIN_SHOW_MS)
}

// The website's welcome palette (tailwind.config.ts): night-water background, sun-glint gold,
// stucco ink. The artwork is the site's own water poster (public/water-poster.webp), copied
// into the APK's assets at build time — see app/build.gradle.kts.
private val WelcomeBg = Color(0xFF05090C)
private val WelcomeGold = Color(0xFFE6C487)
private val WelcomeInk = Color(0xFFEEEDE4)
private val WelcomeSoft = Color(0xFFCDD2CC)

/**
 * The welcome screen shown over the WebView on a cold start, recreating the website's hero:
 * dark night water, "Target" in script gold, "Ask anything", and the tagline. Purely visual —
 * it consumes no touches, so the page underneath is usable the moment it fades.
 */
@Composable
fun WelcomeSplash() {
    val context = LocalContext.current
    val poster = remember {
        runCatching {
            context.assets.open("water-poster.webp").use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
        }.getOrNull()
    }
    Box(Modifier.fillMaxSize().background(WelcomeBg)) {
        if (poster != null) {
            Image(
                bitmap = poster,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
        // Gentle darkening toward the bottom, like the site hero, so the words stay readable.
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.45f)),
                    startY = 300f,
                ),
            ),
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.align(Alignment.Center).padding(horizontal = 32.dp),
        ) {
            Text(
                text = "Target",
                fontFamily = FontFamily.Cursive,
                fontSize = 88.sp,
                color = WelcomeGold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "Ask anything",
                fontFamily = FontFamily.Serif,
                fontSize = 34.sp,
                color = WelcomeInk,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Your personal AI that gets things done",
                fontSize = 15.sp,
                color = WelcomeSoft,
                textAlign = TextAlign.Center,
            )
        }
    }
}
