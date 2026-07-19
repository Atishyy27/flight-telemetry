package telemetry

import kotlin.math.abs
import kotlin.math.pow

data class AltitudeReading(
    val fusedAltitudeM: Double,
    val verticalSpeedMps: Double,
    val baroAltitudeM: Double,
)

/**
 * Complementary filter fusing accelerometer-integrated altitude (responsive, drifts)
 * with barometric altitude (drift-free, noisy/slow). No GPS involved — this is what
 * lets phase detection work with the cabin GPS lock unreliable or absent.
 */
class ComplementaryAltitudeFilter(
    private val referencePressureHpa: Double,
    private val altitudeWeight: Double = 0.98,
) {
    private var altitudeM = 0.0
    private var verticalSpeedMps = 0.0
    private var initialized = false

    private fun baroAltitudeM(pressureHpa: Double): Double =
        44330.0 * (1.0 - (pressureHpa / referencePressureHpa).pow(1.0 / 5.255))

    /** [verticalAccelMps2] is net vertical acceleration with gravity already removed (positive = up). */
    fun update(dtSeconds: Double, verticalAccelMps2: Double, pressureHpa: Double): AltitudeReading {
        require(dtSeconds > 0.0) { "dtSeconds must be > 0" }
        val baroAltitude = baroAltitudeM(pressureHpa)

        if (!initialized) {
            altitudeM = baroAltitude
            verticalSpeedMps = 0.0
            initialized = true
            return AltitudeReading(altitudeM, verticalSpeedMps, baroAltitude)
        }

        val accelVerticalSpeed = verticalSpeedMps + verticalAccelMps2 * dtSeconds
        val accelAltitude = altitudeM + verticalSpeedMps * dtSeconds + 0.5 * verticalAccelMps2 * dtSeconds * dtSeconds

        val fusedAltitude = altitudeWeight * accelAltitude + (1.0 - altitudeWeight) * baroAltitude
        val baroImpliedSpeed = (baroAltitude - altitudeM) / dtSeconds
        val fusedSpeed = altitudeWeight * accelVerticalSpeed + (1.0 - altitudeWeight) * baroImpliedSpeed

        altitudeM = fusedAltitude
        verticalSpeedMps = fusedSpeed
        return AltitudeReading(altitudeM, verticalSpeedMps, baroAltitude)
    }
}

enum class FlightPhase { GROUND, CLIMB, CRUISE, DESCENT, LANDED }

/**
 * Sustained-threshold state machine over fused vertical speed. Requires the climb/level/
 * descent condition to hold for [sustainSeconds] before transitioning, so a single gust
 * or a jolt of turbulence can't flip the phase.
 */
class FlightPhaseDetector(
    private val climbThresholdMps: Double = 2.0,
    private val levelThresholdMps: Double = 0.75,
    private val sustainSeconds: Double = 3.0,
    private val groundAltitudeBandM: Double = 60.0,
) {
    var phase: FlightPhase = FlightPhase.GROUND
        private set

    private var groundReferenceAltitudeM = 0.0
    private var conditionTimer = 0.0

    fun update(dtSeconds: Double, reading: AltitudeReading): FlightPhase {
        val vs = reading.verticalSpeedMps
        when (phase) {
            FlightPhase.GROUND -> {
                groundReferenceAltitudeM = reading.fusedAltitudeM
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
                conditionTimer = if (vs < -climbThresholdMps) conditionTimer + dtSeconds else 0.0
                if (conditionTimer >= sustainSeconds) {
                    phase = FlightPhase.DESCENT
                    conditionTimer = 0.0
                }
            }
            FlightPhase.DESCENT -> {
                val nearGround = abs(reading.fusedAltitudeM - groundReferenceAltitudeM) < groundAltitudeBandM
                conditionTimer = if (nearGround && abs(vs) < levelThresholdMps) conditionTimer + dtSeconds else 0.0
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
