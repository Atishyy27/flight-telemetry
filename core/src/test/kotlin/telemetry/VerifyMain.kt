package telemetry

import kotlin.math.abs
import kotlin.math.pow
import kotlin.system.exitProcess

/**
 * Assertion-based verification harness. No Gradle/JUnit installed in this environment yet —
 * this exercises the same behaviors a real @Test suite would, and should be lifted into
 * proper JUnit tests once the Android project is set up in Studio.
 */
private var passed = 0
private var failed = 0

private fun check(name: String, condition: Boolean, detail: String = "") {
    if (condition) {
        passed++
        println("  PASS  $name")
    } else {
        failed++
        println("  FAIL  $name  $detail")
    }
}

private fun approx(a: Double, b: Double, tolerance: Double) = abs(a - b) <= tolerance

private fun testGeo() {
    println("Geo")
    // Quarter of Earth's circumference along the equator: exactly computable by hand.
    val equatorQuarter = Geo.haversineNm(LatLon(0.0, 0.0), LatLon(0.0, 90.0))
    check("quarter-equator distance ~5403nm", approx(equatorQuarter, 5403.4, 5.0), "got $equatorQuarter")

    val zero = Geo.haversineNm(LatLon(12.0, 77.0), LatLon(12.0, 77.0))
    check("same point distance is 0", approx(zero, 0.0, 1e-6), "got $zero")

    // Both points on the equator -> the great circle IS the equator -> midpoint lat stays 0.
    val mid = Geo.greatCircleIntermediate(LatLon(0.0, 0.0), LatLon(0.0, 90.0), 0.5)
    check("equator midpoint lat ~0", approx(mid.latDeg, 0.0, 1e-6), "got ${mid.latDeg}")
    check("equator midpoint lon ~45", approx(mid.lonDeg, 45.0, 1e-6), "got ${mid.lonDeg}")

    val start = Geo.greatCircleIntermediate(LatLon(28.5562, 77.1000), LatLon(12.9716, 77.5946), 0.0)
    check("fraction=0 returns origin", approx(start.latDeg, 28.5562, 1e-6))

    val end = Geo.greatCircleIntermediate(LatLon(28.5562, 77.1000), LatLon(12.9716, 77.5946), 1.0)
    check("fraction=1 lat close to destination", approx(end.latDeg, 12.9716, 0.01), "got ${end.latDeg}")
}

private fun testAltitudeFilter() {
    println("ComplementaryAltitudeFilter")
    val filter = ComplementaryAltitudeFilter(referencePressureHpa = 1013.25)
    // Stationary on the ground: zero accel, constant pressure -> altitude should stay flat.
    var last = filter.update(1.0, 0.0, 1013.25)
    repeat(10) { last = filter.update(1.0, 0.0, 1013.25) }
    check("stationary altitude stays near 0", approx(last.fusedAltitudeM, 0.0, 1.0), "got ${last.fusedAltitudeM}")
    check("stationary vertical speed stays near 0", approx(last.verticalSpeedMps, 0.0, 0.5), "got ${last.verticalSpeedMps}")

    // Physically-consistent climb: accelerate up for 5s, hold vertical speed for 40s,
    // decelerate to level for 5s. True altitude/pressure derived analytically (same Euler
    // scheme the filter itself uses internally) so accel and pressure are self-consistent,
    // the way real sensors would report them.
    val referencePressure = 1013.25
    val climbFilter = ComplementaryAltitudeFilter(referencePressureHpa = referencePressure)
    climbFilter.update(1.0, 0.0, referencePressure)
    var trueAltitude = 0.0
    var trueVelocity = 0.0
    var reading = AltitudeReading(0.0, 0.0, 0.0)
    for (t in 1..50) {
        val accel = when {
            t <= 5 -> 1.0
            t <= 45 -> 0.0
            else -> -1.0
        }
        trueVelocity += accel * 1.0
        trueAltitude += trueVelocity * 1.0
        val truePressure = referencePressure * (1.0 - trueAltitude / 44330.0).pow(5.255)
        reading = climbFilter.update(1.0, accel, truePressure)
    }
    check(
        "filter tracks a realistic climb profile within 5m",
        approx(reading.fusedAltitudeM, trueAltitude, 5.0),
        "fused=${reading.fusedAltitudeM} true=$trueAltitude",
    )
    check(
        "vertical speed returns to ~0 after leveling off",
        approx(reading.verticalSpeedMps, 0.0, 0.5),
        "got ${reading.verticalSpeedMps}",
    )
}

private fun testPhaseDetector() {
    println("FlightPhaseDetector")
    val detector = FlightPhaseDetector()
    check("starts on GROUND", detector.phase == FlightPhase.GROUND)

    // Sustained climb vertical speed for >3s should trigger CLIMB.
    var phase = FlightPhase.GROUND
    repeat(5) {
        phase = detector.update(1.0, AltitudeReading(fusedAltitudeM = it * 5.0, verticalSpeedMps = 5.0, baroAltitudeM = 0.0))
    }
    check("sustained climb rate triggers CLIMB", phase == FlightPhase.CLIMB, "got $phase")

    // Level off for >3s should trigger CRUISE.
    repeat(5) {
        phase = detector.update(1.0, AltitudeReading(fusedAltitudeM = 300.0, verticalSpeedMps = 0.1, baroAltitudeM = 0.0))
    }
    check("leveling off triggers CRUISE", phase == FlightPhase.CRUISE, "got $phase")

    // Sustained descent should trigger DESCENT.
    repeat(5) {
        phase = detector.update(1.0, AltitudeReading(fusedAltitudeM = 300.0 - it * 5.0, verticalSpeedMps = -5.0, baroAltitudeM = 0.0))
    }
    check("sustained descent triggers DESCENT", phase == FlightPhase.DESCENT, "got $phase")

    // Back near ground reference altitude (0), level off -> LANDED.
    repeat(5) {
        phase = detector.update(1.0, AltitudeReading(fusedAltitudeM = 0.0, verticalSpeedMps = 0.0, baroAltitudeM = 0.0))
    }
    check("near ground + level triggers LANDED", phase == FlightPhase.LANDED, "got $phase")
}

private fun testTimelinePredictor() {
    println("FlightTimelinePredictor")
    // Roughly DEL -> BLR: long enough to reach cruise altitude.
    val plan = FlightPlan(
        origin = LatLon(28.5562, 77.1000),
        destination = LatLon(12.9716, 77.5946),
        scheduledBlockMinutes = 150.0,
        aircraft = AircraftProfile(
            cruiseAltitudeFt = 36000.0,
            cruiseSpeedKt = 430.0,
            climbRateFtPerMin = 2000.0,
            descentRateFtPerMin = 1500.0,
        ),
    )
    val events = FlightTimelinePredictor.predict(plan, sampleIntervalSeconds = 60.0)
    check("first event starts at t=0", events.first().elapsedSeconds == 0.0)
    check("first event phase is TAXI_OUT", events.first().phase == TimelinePhase.TAXI_OUT)
    check("last event phase is TAXI_IN", events.last().phase == TimelinePhase.TAXI_IN)
    check(
        "last event position near destination",
        approx(events.last().position.latDeg, plan.destination.latDeg, 0.1),
        "got ${events.last().position}",
    )
    check(
        "last event has near-zero distance remaining",
        events.last().distanceRemainingNm < 5.0,
        "got ${events.last().distanceRemainingNm}",
    )

    val cruiseEvents = events.filter { it.phase == TimelinePhase.CRUISE }
    check("reaches cruise altitude for a flight this long", cruiseEvents.isNotEmpty())
    check(
        "cruise altitude matches aircraft profile",
        cruiseEvents.all { approx(it.altitudeFt, plan.aircraft.cruiseAltitudeFt, 1.0) },
    )

    val climbEvents = events.filter { it.phase == TimelinePhase.CLIMB }
    check(
        "altitude is non-decreasing during climb",
        climbEvents.zipWithNext().all { (a, b) -> b.altitudeFt >= a.altitudeFt - 1e-6 },
    )
    val descentEvents = events.filter { it.phase == TimelinePhase.DESCENT }
    check(
        "altitude is non-increasing during descent",
        descentEvents.zipWithNext().all { (a, b) -> b.altitudeFt <= a.altitudeFt + 1e-6 },
    )
    check(
        "distance remaining is non-increasing overall",
        events.zipWithNext().all { (a, b) -> b.distanceRemainingNm <= a.distanceRemainingNm + 1e-6 },
    )

    // Short hop: block time too short to ever reach cruise altitude -> triangular profile.
    val shortHop = plan.copy(scheduledBlockMinutes = 45.0)
    val shortEvents = FlightTimelinePredictor.predict(shortHop, sampleIntervalSeconds = 30.0)
    check(
        "short hop never reaches full cruise altitude",
        shortEvents.maxOf { it.altitudeFt } < plan.aircraft.cruiseAltitudeFt,
        "peak=${shortEvents.maxOf { it.altitudeFt }}",
    )
    check("short hop has no CRUISE phase", shortEvents.none { it.phase == TimelinePhase.CRUISE })
}

private fun testLandmarkFinder() {
    println("LandmarkFinder")
    val landmarks = listOf(
        Landmark("Vindhya Range", LatLon(22.0, 78.0)),
        Landmark("Nilgiri Hills", LatLon(11.4, 76.7)),
    )
    val near = LandmarkFinder.nearest(LatLon(22.05, 78.05), landmarks)
    check("finds the nearby landmark", near?.name == "Vindhya Range", "got $near")

    val farAway = LandmarkFinder.nearest(LatLon(0.0, 0.0), landmarks, maxDistanceNm = 25.0)
    check("returns null when nothing is within range", farAway == null, "got $farAway")
}

fun main() {
    testGeo()
    testAltitudeFilter()
    testPhaseDetector()
    testTimelinePredictor()
    testLandmarkFinder()
    println()
    println("$passed passed, $failed failed")
    if (failed > 0) exitProcess(1)
}
