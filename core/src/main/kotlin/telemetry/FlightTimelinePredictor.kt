package telemetry

data class AircraftProfile(
    val cruiseAltitudeFt: Double,
    val cruiseSpeedKt: Double,
    val climbRateFtPerMin: Double,
    val descentRateFtPerMin: Double,
    val transitionSpeedKt: Double = 160.0,
)

data class FlightPlan(
    val origin: LatLon,
    val destination: LatLon,
    val scheduledBlockMinutes: Double,
    val taxiOutMinutes: Double = 15.0,
    val taxiInMinutes: Double = 10.0,
    val aircraft: AircraftProfile,
)

enum class TimelinePhase { TAXI_OUT, CLIMB, CRUISE, DESCENT, TAXI_IN }

data class TimelineEvent(
    val elapsedSeconds: Double,
    val phase: TimelinePhase,
    val altitudeFt: Double,
    val groundSpeedKt: Double,
    val position: LatLon,
    val distanceRemainingNm: Double,
)

/**
 * Builds the pre-takeoff "playlist": a predicted timeline for the whole flight, generated
 * entirely from the schedule + aircraft performance profile before departure. Nothing in
 * here depends on live GPS or a connection — it's what gets played back against elapsed
 * time (and corrected by [FlightPhaseDetector]) once airborne.
 */
object FlightTimelinePredictor {

    fun predict(plan: FlightPlan, sampleIntervalSeconds: Double = 60.0): List<TimelineEvent> {
        require(sampleIntervalSeconds > 0.0) { "sampleIntervalSeconds must be > 0" }
        val totalDistanceNm = Geo.haversineNm(plan.origin, plan.destination)
        val airborneMinutes = (plan.scheduledBlockMinutes - plan.taxiOutMinutes - plan.taxiInMinutes)
            .coerceAtLeast(1.0)

        val idealClimbMinutes = plan.aircraft.cruiseAltitudeFt / plan.aircraft.climbRateFtPerMin
        val idealDescentMinutes = plan.aircraft.cruiseAltitudeFt / plan.aircraft.descentRateFtPerMin

        val climbMinutes: Double
        val descentMinutes: Double
        val peakAltitudeFt: Double
        if (idealClimbMinutes + idealDescentMinutes <= airborneMinutes) {
            climbMinutes = idealClimbMinutes
            descentMinutes = idealDescentMinutes
            peakAltitudeFt = plan.aircraft.cruiseAltitudeFt
        } else {
            // Short hop: never reaches cruise altitude. Triangular profile — climb straight
            // into descent, with both legs reaching the same peak altitude at the same instant.
            climbMinutes = airborneMinutes * plan.aircraft.descentRateFtPerMin /
                (plan.aircraft.climbRateFtPerMin + plan.aircraft.descentRateFtPerMin)
            descentMinutes = airborneMinutes - climbMinutes
            peakAltitudeFt = climbMinutes * plan.aircraft.climbRateFtPerMin
        }
        val cruiseMinutes = (airborneMinutes - climbMinutes - descentMinutes).coerceAtLeast(0.0)

        val climbAvgSpeedKt = (plan.aircraft.transitionSpeedKt + plan.aircraft.cruiseSpeedKt) / 2.0
        val descentAvgSpeedKt = (plan.aircraft.cruiseSpeedKt + plan.aircraft.transitionSpeedKt) / 2.0
        var distanceClimbNm = climbAvgSpeedKt * (climbMinutes / 60.0)
        var distanceDescentNm = descentAvgSpeedKt * (descentMinutes / 60.0)
        var distanceCruiseNm = totalDistanceNm - distanceClimbNm - distanceDescentNm
        if (distanceCruiseNm < 0.0) {
            val scale = totalDistanceNm / (distanceClimbNm + distanceDescentNm)
            distanceClimbNm *= scale
            distanceDescentNm *= scale
            distanceCruiseNm = 0.0
        }

        val taxiOutSeconds = plan.taxiOutMinutes * 60.0
        val climbSeconds = climbMinutes * 60.0
        val cruiseSeconds = cruiseMinutes * 60.0
        val descentSeconds = descentMinutes * 60.0
        val totalSeconds = taxiOutSeconds + climbSeconds + cruiseSeconds + descentSeconds + plan.taxiInMinutes * 60.0

        val events = mutableListOf<TimelineEvent>()
        var t = 0.0
        while (t < totalSeconds) {
            events += sampleAt(
                t, plan, taxiOutSeconds, climbSeconds, cruiseSeconds, descentSeconds,
                distanceClimbNm, distanceCruiseNm, distanceDescentNm, totalDistanceNm, peakAltitudeFt,
            )
            t += sampleIntervalSeconds
        }
        events += sampleAt(
            totalSeconds, plan, taxiOutSeconds, climbSeconds, cruiseSeconds, descentSeconds,
            distanceClimbNm, distanceCruiseNm, distanceDescentNm, totalDistanceNm, peakAltitudeFt,
        )
        return events
    }

    private data class PhaseSample(
        val phase: TimelinePhase,
        val altitudeFt: Double,
        val speedKt: Double,
        val distanceFlownNm: Double,
    )

    private fun sampleAt(
        t: Double,
        plan: FlightPlan,
        taxiOutSeconds: Double,
        climbSeconds: Double,
        cruiseSeconds: Double,
        descentSeconds: Double,
        distanceClimbNm: Double,
        distanceCruiseNm: Double,
        distanceDescentNm: Double,
        totalDistanceNm: Double,
        peakAltitudeFt: Double,
    ): TimelineEvent {
        val climbEnd = taxiOutSeconds + climbSeconds
        val cruiseEnd = climbEnd + cruiseSeconds
        val descentEnd = cruiseEnd + descentSeconds

        val sample = when {
            t < taxiOutSeconds -> PhaseSample(TimelinePhase.TAXI_OUT, 0.0, 0.0, 0.0)
            t < climbEnd -> {
                val frac = if (climbSeconds > 0.0) (t - taxiOutSeconds) / climbSeconds else 1.0
                PhaseSample(
                    TimelinePhase.CLIMB, peakAltitudeFt * frac,
                    lerp(plan.aircraft.transitionSpeedKt, plan.aircraft.cruiseSpeedKt, frac),
                    distanceClimbNm * frac,
                )
            }
            t < cruiseEnd -> {
                val frac = if (cruiseSeconds > 0.0) (t - climbEnd) / cruiseSeconds else 0.0
                PhaseSample(
                    TimelinePhase.CRUISE, peakAltitudeFt, plan.aircraft.cruiseSpeedKt,
                    distanceClimbNm + distanceCruiseNm * frac,
                )
            }
            t < descentEnd -> {
                val frac = if (descentSeconds > 0.0) (t - cruiseEnd) / descentSeconds else 1.0
                PhaseSample(
                    TimelinePhase.DESCENT, peakAltitudeFt * (1.0 - frac),
                    lerp(plan.aircraft.cruiseSpeedKt, plan.aircraft.transitionSpeedKt, frac),
                    distanceClimbNm + distanceCruiseNm + distanceDescentNm * frac,
                )
            }
            else -> PhaseSample(TimelinePhase.TAXI_IN, 0.0, 0.0, totalDistanceNm)
        }

        val positionFrac = (sample.distanceFlownNm / totalDistanceNm).coerceIn(0.0, 1.0)
        val position = Geo.greatCircleIntermediate(plan.origin, plan.destination, positionFrac)
        return TimelineEvent(
            t, sample.phase, sample.altitudeFt, sample.speedKt, position,
            (totalDistanceNm - sample.distanceFlownNm).coerceAtLeast(0.0),
        )
    }

    private fun lerp(a: Double, b: Double, f: Double) = a + (b - a) * f
}
