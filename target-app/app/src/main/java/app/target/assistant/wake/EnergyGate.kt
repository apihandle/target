package app.target.assistant.wake

import kotlin.math.sqrt

/**
 * Cheap pre-gate in front of the keyword spotter: audio reaches the spotter only after
 * [openFrames] consecutive frames are louder than an adaptive threshold (noise floor × [ratio],
 * never below [minRms]). It stays open for [hangoverFrames] quiet frames, and on opening it
 * releases a short pre-roll so the start of "hey" is not cut. Cuts false wakes and CPU/battery in
 * silence. Pure Kotlin, unit-tested.
 */
class EnergyGate(
    private val openFrames: Int = 4,
    private val hangoverFrames: Int = 50,
    private val ratio: Float = 3f,
    private val minRms: Float = 0.006f,
    private val prerollFrames: Int = 10,
) {
    /** Running estimate of background noise RMS. */
    var noiseFloor = 0.003f
        private set
    var isOpen = false
        private set

    private var loudRun = 0
    private var quietRun = 0
    private val preroll = ArrayDeque<FloatArray>()

    val threshold: Float get() = maxOf(noiseFloor * ratio, minRms)

    /**
     * Feed one frame (e.g. 30 ms of 16 kHz float samples). Returns the frames to pass to the spotter
     * now: nothing while closed, the pre-roll + this frame on opening, this frame while open.
     */
    fun push(frame: FloatArray): List<FloatArray> {
        val r = rms(frame)
        val loud = r > threshold
        // Quiet frames teach the floor fast; loud ones slowly, so steady noise (fan, traffic) stops counting as speech.
        noiseFloor = if (!loud) noiseFloor * 0.95f + r * 0.05f else noiseFloor * 0.995f + r * 0.005f
        if (!isOpen) {
            preroll.addLast(frame)
            while (preroll.size > prerollFrames) preroll.removeFirst()
            loudRun = if (loud) loudRun + 1 else 0
            if (loudRun >= openFrames) {
                isOpen = true
                quietRun = 0
                val out = preroll.toList()
                preroll.clear()
                return out
            }
            return emptyList()
        }
        quietRun = if (loud) 0 else quietRun + 1
        if (quietRun > hangoverFrames) {
            isOpen = false
            loudRun = 0
        }
        return listOf(frame)
    }

    fun reset() {
        isOpen = false; loudRun = 0; quietRun = 0; preroll.clear()
    }

    companion object {
        fun rms(frame: FloatArray): Float {
            if (frame.isEmpty()) return 0f
            var sum = 0.0
            for (v in frame) sum += (v * v).toDouble()
            return sqrt(sum / frame.size).toFloat()
        }
    }
}
