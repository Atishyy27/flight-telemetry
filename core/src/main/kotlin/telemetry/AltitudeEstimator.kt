package telemetry

import kotlin.math.abs
import kotlin.math.pow

data class AltitudeReading(
    val fusedAltitudeM: Double,
    val verticalSpeedMps: Double,
    val baroAltitudeM: Double,
)

/**
 * Complementary (alpha-beta) filter fusing accelerometer prediction with barometric altitude.
 * No GPS involved, which is what lets phase detection work with the cabin GPS lock unreliable
 * or absent. Gains are derived from [bandwidthRadPerSec] and the step length, so the result
 * does not depend on the sample rate (the old fixed 0.98 per-step weight did).
 */
class ComplementaryAltitudeFilter(
    private val referencePressureHpa: Double,
    private val bandwidthRadPerSec: Double = 0.2,
) {
    private var altitudeM = 0.0
    private var verticalSpeedMps = 0.0
    private var initialized = false

    private companion object {
        /** A longer gap (a throttled sensor, a dropout) re-seeds the filter instead of integrating across it. */
        const val MAX_STEP_SECONDS = 5.0
    }

    private fun baroAltitudeM(pressureHpa: Double): Double =
        44330.0 * (1.0 - (pressureHpa / referencePressureHpa).pow(1.0 / 5.255))

    /** [verticalAccelMps2] is net vertical acceleration with gravity already removed (positive = up). */
    fun update(dtSeconds: Double, verticalAccelMps2: Double, pressureHpa: Double): AltitudeReading {
        require(dtSeconds > 0.0) { "dtSeconds must be > 0" }
        val baroAltitude = baroAltitudeM(pressureHpa)

        if (!initialized || dtSeconds > MAX_STEP_SECONDS) {
            altitudeM = baroAltitude
            verticalSpeedMps = 0.0
            initialized = true
            return AltitudeReading(altitudeM, verticalSpeedMps, baroAltitude)
        }

        val predictedSpeed = verticalSpeedMps + verticalAccelMps2 * dtSeconds
        val predictedAltitude = altitudeM + verticalSpeedMps * dtSeconds + 0.5 * verticalAccelMps2 * dtSeconds * dtSeconds
        val error = baroAltitude - predictedAltitude

        altitudeM = predictedAltitude + minOf(1.0, 2.0 * bandwidthRadPerSec * dtSeconds) * error
        verticalSpeedMps = predictedSpeed + minOf(1.0, bandwidthRadPerSec * bandwidthRadPerSec * dtSeconds) * error
        return AltitudeReading(altitudeM, verticalSpeedMps, baroAltitude)
    }
}

enum class FlightPhase { GROUND, CLIMB, CRUISE, DESCENT, LANDED }

/**
 * Sustained-threshold state machine over fused vertical speed. A phone in an airliner sees the
 * cabin pressure, whose rate is limited to about 500 ft/min up and 300 ft/min down (about 2.5
 * and 1.5 m/s), so the thresholds sit well under those and the condition must hold for
 * [sustainSeconds] before a transition. Landing is "level again after a descent of at least
 * [minDescentDropM]", not a comparison with the origin, because the destination can sit
 * hundreds of metres above or below it. A gap in samples longer than 5 s counts as 5 s.
 */
class FlightPhaseDetector(
    private val climbThresholdMps: Double = 1.0,
    private val descentThresholdMps: Double = 0.8,
    private val levelThresholdMps: Double = 0.35,
    private val sustainSeconds: Double = 20.0,
    private val minDescentDropM: Double = 100.0,
) {
    var phase: FlightPhase = FlightPhase.GROUND
        private set

    private var descentStartAltitudeM = Double.NaN
    private var conditionTimer = 0.0

    fun update(rawDtSeconds: Double, reading: AltitudeReading): FlightPhase {
        val dtSeconds = minOf(rawDtSeconds, 5.0)
        val vs = reading.verticalSpeedMps
        when (phase) {
            FlightPhase.GROUND -> {
                conditionTimer = if (vs > climbThresholdMps) conditionTimer + dtSeconds else 0.0
                if (conditionTimer >= sustainSeconds) {
                    phase = FlightPhase.CLIMB
                    conditionTimer = 0.0
                }
            }
            FlightPhase.CLIMB -> {
                conditionTimer = if (abs(vs) < levelThresholdMps) conditionTimer + dtSeconds else 0.0
                if (conditionTimer >= sustainSeconds) {
                    phase = FlightPhase.CRUISE
                    conditionTimer = 0.0
                }
            }
            FlightPhase.CRUISE -> {
                conditionTimer = if (vs < -descentThresholdMps) conditionTimer + dtSeconds else 0.0
                if (conditionTimer >= sustainSeconds) {
                    phase = FlightPhase.DESCENT
                    descentStartAltitudeM = reading.fusedAltitudeM
                    conditionTimer = 0.0
                }
            }
            FlightPhase.DESCENT -> {
                val dropped = descentStartAltitudeM - reading.fusedAltitudeM >= minDescentDropM
                conditionTimer = if (dropped && abs(vs) < levelThresholdMps) conditionTimer + dtSeconds else 0.0
                if (conditionTimer >= sustainSeconds) {
                    phase = FlightPhase.LANDED
                    conditionTimer = 0.0
                }
            }
            FlightPhase.LANDED -> Unit
        }
        return phase
    }
}
