package telemetry

import java.io.File
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sqrt
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Synthetic cabin-pressure traces. A phone in an airliner sees cabin pressure, not outside
 * pressure: the cabin climbs to about 7,000 ft at 500 ft/min, holds, then descends at a
 * limited rate (about 300 ft/min). No real data is used anywhere in this file.
 */
private class CabinTrace(
    val hz: Int,
    climbFpm: Double,
    descentFpm: Double,
    private val noiseHpa: Double,
    seed: Int,
    holdMinutes: Double = 90.0,
) {
    private val rng = Random(seed)
    private val climbStartS = 60.0
    private val climbDurS = 7000.0 / climbFpm * 60.0
    private val holdEndS = climbStartS + climbDurS + holdMinutes * 60.0
    private val groundS = holdEndS + 7000.0 / descentFpm * 60.0
    private val endS = groundS + 300.0
    private val climbRate = climbFpm
    private val descentRate = descentFpm

    val trueDescentStartS: Double get() = holdEndS
    val trueGroundS: Double get() = groundS
    val samples: List<Pair<Double, Double>>

    init {
        val dt = 1.0 / hz
        val list = ArrayList<Pair<Double, Double>>((endS * hz).toInt() + 1)
        var t = 0.0
        while (t < endS) {
            list += t to pressureAt(t)
            t += dt
        }
        samples = list
    }

    private fun cabinFt(t: Double): Double = when {
        t < climbStartS -> 0.0
        t < climbStartS + climbDurS -> (t - climbStartS) / 60.0 * climbRate
        t < holdEndS -> 7000.0
        t < groundS -> 7000.0 - (t - holdEndS) / 60.0 * descentRate
        else -> 0.0
    }

    private fun gauss(): Double {
        val u1 = 1.0 - rng.nextDouble()
        val u2 = rng.nextDouble()
        return sqrt(-2.0 * ln(u1)) * cos(2.0 * PI * u2)
    }

    private fun pressureAt(t: Double): Double {
        val meters = cabinFt(t) * 0.3048
        return 1013.25 * (1.0 - meters / 44330.0).pow(5.255) + gauss() * noiseHpa
    }
}

private data class DetectorRun(val transitions: List<Pair<FlightPhase, Double>>)

private fun runDetector(trace: CabinTrace): DetectorRun {
    val filter = ComplementaryAltitudeFilter(referencePressureHpa = 1013.25)
    val detector = FlightPhaseDetector()
    val transitions = ArrayList<Pair<FlightPhase, Double>>()
    var prevT = -1.0 / trace.hz
    for ((t, pressure) in trace.samples) {
        val dt = t - prevT
        prevT = t
        val reading = filter.update(dt, 0.0, pressure)
        val before = detector.phase
        val after = detector.update(dt, reading)
        if (after != before) transitions += after to t
    }
    return DetectorRun(transitions)
}

class CabinPhaseSweepTest {
    private val expected = listOf(FlightPhase.CLIMB, FlightPhase.CRUISE, FlightPhase.DESCENT, FlightPhase.LANDED)

    @Test
    fun phaseSequenceSurvivesCabinPressureAtAnySampleRate() {
        val seeds = 20
        val rows = StringBuilder()
        rows.append("| cabin descent | sample rate | correct sequence | false DESCENT in cruise | DESCENT delay after true start (s) |\n")
        rows.append("|---|---|---|---|---|\n")
        val failures = ArrayList<String>()

        for (descentFpm in listOf(300.0, 200.0)) {
            for (hz in listOf(1, 5, 50)) {
                var correct = 0
                var falseDescent = 0
                val delays = ArrayList<Double>()
                for (seed in 0 until seeds) {
                    val trace = CabinTrace(hz, 500.0, descentFpm, noiseHpa = 0.05, seed = seed)
                    val run = runDetector(trace)
                    val sequence = run.transitions.map { it.first }
                    val descentAt = run.transitions.firstOrNull { it.first == FlightPhase.DESCENT }?.second
                    val landedAt = run.transitions.firstOrNull { it.first == FlightPhase.LANDED }?.second
                    if (descentAt != null && descentAt < trace.trueDescentStartS) falseDescent++
                    val landedInTime = landedAt != null && landedAt >= trace.trueGroundS && landedAt - trace.trueGroundS <= 120.0
                    if (sequence == expected && landedInTime) {
                        correct++
                        delays += descentAt!! - trace.trueDescentStartS
                    }
                }
                val delayText = if (delays.isEmpty()) "n/a" else "%.0f to %.0f".format(delays.min(), delays.max())
                rows.append("| ${descentFpm.toInt()} ft/min | $hz Hz | $correct/$seeds | $falseDescent/$seeds | $delayText |\n")
                if (correct != seeds) failures += "${descentFpm.toInt()} fpm $hz Hz: correct $correct/$seeds"
                if (falseDescent != 0) failures += "${descentFpm.toInt()} fpm $hz Hz: false descent $falseDescent/$seeds"
                if (delays.isNotEmpty() && delays.max() > 60.0) failures += "${descentFpm.toInt()} fpm $hz Hz: delay over 60 s"
            }
        }

        val table = rows.toString()
        println(table)
        File("build").mkdirs()
        File("build/phase-sweep.md").writeText(table)
        assertTrue(failures.isEmpty(), "phase sweep failures: $failures")
    }
}
