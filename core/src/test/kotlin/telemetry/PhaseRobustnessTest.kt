package telemetry

import kotlin.math.abs
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PhaseRobustnessTest {
    @Test
    fun longGapInSamplesDoesNotFlipThePhase() {
        val filter = ComplementaryAltitudeFilter(referencePressureHpa = 1013.25)
        val detector = FlightPhaseDetector()
        detector.update(1.0, filter.update(1.0, 0.0, 1013.25))
        val shifted = 1013.25 * (1.0 - 30.0 / 44330.0).pow(5.255)
        val reading = filter.update(600.0, 0.0, shifted)
        detector.update(600.0, reading)
        assertEquals(FlightPhase.GROUND, detector.phase)
        assertTrue(abs(reading.verticalSpeedMps) < 0.01, "vs ${reading.verticalSpeedMps}")
    }

    @Test
    fun landingWorksWhenDestinationIsHigherThanOrigin() {
        val detector = FlightPhaseDetector()
        fun step(n: Int, alt: Double, vs: Double) =
            repeat(n) { detector.update(1.0, AltitudeReading(alt, vs, alt)) }
        step(25, 0.0, 3.0)
        step(25, 2100.0, 0.0)
        step(25, 2000.0, -1.2)
        assertEquals(FlightPhase.DESCENT, detector.phase)
        step(25, 2000.0, 0.0)
        assertEquals(FlightPhase.DESCENT, detector.phase)
        step(25, 1800.0, 0.0)
        assertEquals(FlightPhase.LANDED, detector.phase)
    }
}
