package app.target.assistant.wake

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.telephony.TelephonyManager
import app.target.assistant.R
import app.target.assistant.SettingsActivity
import app.target.assistant.settings.Prefs
import app.target.assistant.tools.Reminders
import app.target.assistant.tools.granted
import app.target.assistant.util.Notify
import app.target.assistant.voice.Assistant
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The offline keyword-spotting model for "Hey Target": sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile
 * (int8 encoder + decoder + int8 joiner + tokens, about 5 MB unpacked). Downloaded only when the user turns the
 * wake word on, from the official k2-fsa/sherpa-onnx "kws-models" release; the archive's SHA-256 must match
 * both the release's checksum.txt and the value pinned here. Never bundled in the app or the repo.
 */
object WakeModel {
    const val NAME = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile"
    private const val RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/"
    const val URL_ARCHIVE = RELEASE + NAME + ".tar.bz2"
    const val URL_CHECKSUMS = RELEASE + "checksum.txt"
    /** From checksum.txt of the kws-models release (2026-11-06). */
    const val SHA256 = "2e6ac2577310bfa2f4b6b5fab0478b868c9d0b2cb2c51b3e13b50581b588864d"
    const val DOWNLOAD_MB = 15

    const val ENCODER = "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
    const val DECODER = "decoder-epoch-12-avg-2-chunk-16-left-64.onnx"
    const val JOINER = "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
    const val TOKENS = "tokens.txt"
    const val KEYWORDS = "keywords.txt"
    private val KEEP = setOf(ENCODER, DECODER, JOINER, TOKENS)

    fun dir(context: Context) = File(context.filesDir, "kws/$NAME")
    fun isReady(context: Context) = File(dir(context), ".ready").exists() && KEEP.all { File(dir(context), it).exists() }

    /** Writes keywords.txt with the user's boost / threshold. */
    fun writeKeywords(context: Context, boost: Float, threshold: Float): File =
        File(dir(context), KEYWORDS).apply { writeText(WakeKeywords.build(boost, threshold)) }

    private fun open(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 20_000
        readTimeout = 60_000
        instanceFollowRedirects = true
    }

    /** Blocking download + verify + unpack. [progress] gets 0..100. Returns null on success, else an error. */
    fun download(context: Context, progress: (Int) -> Unit): String? {
        val base = File(context.filesDir, "kws").apply { mkdirs() }
        val archive = File(base, "model.tar.bz2.part")
        try {
            // 1) The release's own checksum list must agree with the pinned hash.
            val list = open(URL_CHECKSUMS).let { c -> if (c.responseCode != 200) return "checksum.txt HTTP ${c.responseCode}"; c.inputStream.bufferedReader().use { it.readText() } }
            val listed = WakeKeywords.checksumFor(list, "$NAME.tar.bz2") ?: return "checksum.txt has no entry"
            if (listed != SHA256) return "checksum.txt does not match"
            // 2) Download while hashing.
            val conn = open(URL_ARCHIVE)
            if (conn.responseCode != 200) return "HTTP ${conn.responseCode}"
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: (DOWNLOAD_MB * 1_048_576L)
            val md = MessageDigest.getInstance("SHA-256")
            conn.inputStream.use { input ->
                FileOutputStream(archive).use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    var last = -1
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n); md.update(buf, 0, n)
                        done += n
                        val pct = (done * 95 / total).toInt().coerceIn(0, 95)
                        if (pct != last) { last = pct; progress(pct) }
                    }
                }
            }
            val hex = md.digest().joinToString("") { "%02x".format(it) }
            if (hex != SHA256) { archive.delete(); return "checksum mismatch" }
            // 3) Unpack only the four files the spotter needs (skips the fp32 encoder, test wavs).
            val out = dir(context).apply { deleteRecursively(); mkdirs() }
            TarArchiveInputStream(BZip2CompressorInputStream(archive.inputStream().buffered())).use { tar ->
                while (true) {
                    val e = tar.nextEntry ?: break
                    val name = e.name.substringAfterLast('/')
                    if (e.isDirectory || name !in KEEP) continue
                    FileOutputStream(File(out, name)).use { tar.copyTo(it) }
                }
            }
            archive.delete()
            if (!KEEP.all { File(out, it).exists() }) return "archive incomplete"
            File(out, ".ready").writeText("ok")
            progress(100)
            return null
        } catch (e: Exception) {
            archive.delete()
            return e.message ?: "download failed"
        }
    }

    fun delete(context: Context) { File(context.filesDir, "kws").deleteRecursively() }

    /** Keyword spotter over the downloaded model (call only when [isReady]). */
    fun createSpotter(context: Context, boost: Float, threshold: Float): KeywordSpotter {
        val dir = dir(context)
        val keywords = writeKeywords(context, boost, threshold)
        val config = KeywordSpotterConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = File(dir, ENCODER).absolutePath,
                    decoder = File(dir, DECODER).absolutePath,
                    joiner = File(dir, JOINER).absolutePath,
                ),
                tokens = File(dir, TOKENS).absolutePath,
                numThreads = 1,
                provider = "cpu",
            ),
            keywordsFile = keywords.absolutePath,
            keywordsScore = WakeKeywords.clampBoost(boost),
            keywordsThreshold = WakeKeywords.clampThreshold(threshold),
        )
        return KeywordSpotter(config = config)
    }
}

/**
 * Foreground service (type microphone) listening offline for "Hey Target" (opens the assistant) and
 * "Bye Target" (closes it). Pauses while battery saver is on, while another app records, and while
 * the assistant itself is listening. A persistent notification shows it is on.
 */
class WakeWordService : Service() {

    companion object {
        const val ACTION_STOP = "app.target.assistant.wake.STOP"
        const val ACTION_RELOAD = "app.target.assistant.wake.RELOAD"
        @Volatile var running = false
            private set
        /** What the service went through (for the settings screen and instrumented tests). */
        val statusLog = java.util.concurrent.CopyOnWriteArrayList<String>()

        private const val RATE = 16000
        private const val FRAME = 480 // 30 ms at 16 kHz
        private const val FOLLOW_UP_MS = 4000

        fun start(context: Context) {
            if (!context.granted(Manifest.permission.RECORD_AUDIO) || !WakeModel.isReady(context)) return
            try { context.startForegroundService(Intent(context, WakeWordService::class.java)) } catch (_: Exception) {}
        }

        /** Re-read boost/threshold after the user changed them. */
        fun reload(context: Context) {
            if (running) try { context.startService(Intent(context, WakeWordService::class.java).setAction(ACTION_RELOAD)) } catch (_: Exception) {}
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var spotter: KeywordSpotter? = null
    @Volatile private var worker: Thread? = null
    @Volatile private var listening = false
    private var micBusy = false
    private var assistantOpen = false

    private val powerReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) = update()
    }

    private val recordingCallback = object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>?) {
            val list = configs.orEmpty()
            // Another app records: our input gets silenced (Android 10+), or there are more sessions than our own.
            val ours = if (listening) 1 else 0
            val silenced = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && list.any { it.isClientSilenced }
            micBusy = silenced || list.size > ours
            update()
        }
    }

    private val busListener: (Assistant.Event) -> Unit = { e ->
        when (e) {
            Assistant.Event.OPENED -> { assistantOpen = true; update() }
            Assistant.Event.CLOSED -> { assistantOpen = false; main.postDelayed({ update() }, 800) }
            else -> {}
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        Notify.channels(this)
        val stopPi = PendingIntent.getService(this, 1, Intent(this, WakeWordService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val openPi = PendingIntent.getActivity(this, 2, Intent(this, SettingsActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, Notify.CH_WAKE)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(getString(R.string.wake_notif_title))
            .setContentText(getString(R.string.wake_notif_text))
            .setOngoing(true)
            .setContentIntent(openPi)
            .addAction(Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_tile), getString(R.string.wake_notif_stop), stopPi).build())
            .build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(Notify.ID_WAKE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(Notify.ID_WAKE, n)
            statusLog += "foreground"
        } catch (_: Exception) {
            statusLog += "foreground_refused"
            // Android refused a microphone service from the background (e.g. right after boot on 15+).
            stopSelf(); return
        }
        registerReceiver(powerReceiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED))
        getSystemService(AudioManager::class.java)?.registerAudioRecordingCallback(recordingCallback, main)
        Assistant.listen(busListener)
        loadSpotter()
    }

    private fun loadSpotter() {
        // No model yet (not downloaded or deleted): nothing to listen with. Stop cleanly.
        if (!WakeModel.isReady(this)) { statusLog += "no_model"; stopSelf(); return }
        Thread {
            try {
                val prefs = Prefs(this)
                val kws = WakeModel.createSpotter(this, prefs.wakeBoost, prefs.wakeThreshold)
                main.post { spotter?.release(); spotter = kws; statusLog += "spotter_ready"; update() }
            } catch (_: Throwable) {
                main.post { statusLog += "spotter_failed"; stopSelf() }
            }
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Prefs(this).wakeWord = false
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RELOAD -> { pause(); loadSpotter() }
        }
        return START_STICKY
    }

    private fun shouldListen(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return spotter != null && !(pm?.isPowerSaveMode ?: false) && !micBusy && !assistantOpen && granted(Manifest.permission.RECORD_AUDIO)
    }

    private fun update() {
        if (shouldListen()) resume() else pause()
    }

    /** Mic → 16 kHz float samples → keyword spotter, on a background thread. */
    @android.annotation.SuppressLint("MissingPermission")
    private fun resume() {
        val kws = spotter ?: return
        if (listening) return
        val minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, RATE / 5 * 2))
        } catch (_: Exception) { statusLog += "mic_unavailable"; return }
        if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); statusLog += "mic_unavailable"; return }
        listening = true
        statusLog += "listening"
        val t = Thread {
            val stream = kws.createStream("")
            val gate = EnergyGate()
            val frame = ShortArray(FRAME) // 30 ms
            try {
                record.startRecording()
                while (listening) {
                    val n = record.read(frame, 0, FRAME)
                    if (n <= 0) continue
                    val samples = FloatArray(n) { frame[it] / 32768f }
                    val wasOpen = gate.isOpen
                    val pass = gate.push(samples)
                    if (wasOpen && !gate.isOpen) kws.reset(stream) // quiet again: drop half-heard words
                    if (pass.isEmpty()) continue
                    for (f in pass) stream.acceptWaveform(f, RATE)
                    while (kws.isReady(stream)) kws.decode(stream)
                    val keyword = kws.getResult(stream).keyword
                    if (keyword.isBlank()) continue
                    kws.reset(stream)
                    val hit = WakeKeywords.meaning(keyword)
                    if (hit == WakeKeywords.Hit.WAKE && Build.VERSION.SDK_INT >= 33) {
                        // "Hey Target, YouTube pe gaana chalao" in one breath: hand the next ≤4 s of audio to the recognizer.
                        val pipe = ParcelFileDescriptor.createPipe()
                        FollowUp.put(pipe[0])
                        main.post { heard(hit, followUp = true) }
                        captureFollowUp(record, pipe[1], gate.threshold)
                        listening = false
                    } else {
                        main.post { heard(hit, followUp = false) }
                        if (hit == WakeKeywords.Hit.WAKE) listening = false // free the mic for the assistant
                    }
                }
            } catch (_: Exception) {
            } finally {
                try { record.stop() } catch (_: Exception) {}
                record.release()
                stream.release()
            }
        }
        worker = t
        t.start()
    }

    /**
     * Writes up to [FOLLOW_UP_MS] of 16-bit PCM after the wake word into [out]: stops after ~0.8 s of
     * quiet once the user spoke, or after 1.5 s if nothing was said at all.
     */
    private fun captureFollowUp(record: AudioRecord, out: ParcelFileDescriptor, threshold: Float) {
        val stream = ParcelFileDescriptor.AutoCloseOutputStream(out)
        try {
            val frame = ShortArray(FRAME)
            val bytes = ByteArray(FRAME * 2)
            var elapsed = 0
            var spoke = false
            var quietMs = 0
            while (elapsed < FOLLOW_UP_MS) {
                val n = record.read(frame, 0, FRAME)
                if (n <= 0) break
                for (i in 0 until n) { bytes[2 * i] = (frame[i].toInt() and 0xff).toByte(); bytes[2 * i + 1] = (frame[i].toInt() shr 8).toByte() }
                stream.write(bytes, 0, n * 2)
                val loud = EnergyGate.rms(FloatArray(n) { frame[it] / 32768f }) > threshold
                elapsed += n * 1000 / RATE
                if (loud) { spoke = true; quietMs = 0 } else quietMs += n * 1000 / RATE
                if (spoke && quietMs >= 800) break
                if (!spoke && elapsed >= 1500) break
            }
        } catch (_: Exception) {
        } finally {
            try { stream.close() } catch (_: Exception) {}
        }
    }

    private fun pause() {
        // Stop fully so the microphone is free for the other recorder / the assistant.
        listening = false
        worker?.join(500)
        worker = null
    }

    private fun heard(hit: WakeKeywords.Hit, followUp: Boolean) {
        when (hit) {
            WakeKeywords.Hit.SLEEP -> Assistant.post(Assistant.Event.SLEEP)
            WakeKeywords.Hit.WAKE -> {
                assistantOpen = true
                statusLog += "wake"
                Assistant.launch(this, null, fromWake = true, followUp = followUp)
                // If the overlay never reports back, listen again after a while.
                main.postDelayed({ if (assistantOpen) { assistantOpen = false; update() } }, 45_000)
            }
            WakeKeywords.Hit.ANSWER, WakeKeywords.Hit.REJECT -> if (ringing()) {
                assistantOpen = true
                listening = false
                Assistant.launch(this, if (hit == WakeKeywords.Hit.ANSWER) "call uthao" else "call kaato")
                main.postDelayed({ if (assistantOpen) { assistantOpen = false; update() } }, 30_000)
            }
            WakeKeywords.Hit.NONE -> {}
        }
    }

    @Suppress("DEPRECATION")
    private fun ringing(): Boolean = try {
        getSystemService(TelephonyManager::class.java)?.callState == TelephonyManager.CALL_STATE_RINGING
    } catch (_: SecurityException) { false }

    override fun onDestroy() {
        running = false
        Assistant.unlisten(busListener)
        try { unregisterReceiver(powerReceiver) } catch (_: Exception) {}
        getSystemService(AudioManager::class.java)?.unregisterAudioRecordingCallback(recordingCallback)
        pause()
        spotter?.release()
        spotter = null
        super.onDestroy()
    }
}

/** After a reboot: set reminders again and (if enabled) bring "Hey Target" back. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Reminders.rearmAll(context)
        if (!Prefs(context).wakeWord) return
        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15+ does not allow a microphone service to start from BOOT_COMPLETED: ask for one tap.
            val pi = PendingIntent.getForegroundService(context, 3, Intent(context, WakeWordService::class.java), PendingIntent.FLAG_IMMUTABLE)
            Notify.simple(context, Notify.ID_BOOT, context.getString(R.string.wake_boot_title), context.getString(R.string.wake_boot_text), pi)
        } else {
            WakeWordService.start(context)
        }
    }
}

/** The audio captured right after "Hey Target", waiting for the overlay's recognizer (Android 13+). */
object FollowUp {
    @Volatile private var pending: ParcelFileDescriptor? = null
    @Volatile private var at = 0L

    fun put(pfd: ParcelFileDescriptor) {
        pending?.let { try { it.close() } catch (_: Exception) {} }
        pending = pfd; at = System.currentTimeMillis()
    }

    /** The read end, once, if it is fresh (< 10 s old). */
    fun take(): ParcelFileDescriptor? {
        val p = pending ?: return null
        pending = null
        return if (System.currentTimeMillis() - at < 10_000) p else { try { p.close() } catch (_: Exception) {}; null }
    }
}
