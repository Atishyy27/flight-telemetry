# flight-telemetry

A pre-takeoff-generated, fully offline flight timeline you can scrub through and hear
called out during the flight — altitude, phase, what's below you, ETA — with zero
reliance on GPS or a connection once airborne.

## Why not just use GPS

The closest thing that exists is [`lewishadden/offline-flight-tracker`](https://github.com/lewishadden/offline-flight-tracker):
same idea of pre-downloading before boarding, same Kotlin/Compose/Room stack. But it
still needs a live GPS lock in the cabin to show your position — its own README admits
that only works "near windows," 30-90s to lock, and plenty of aircraft/seats never get
one at all. It also doesn't predict anything; it just plots live GPS against cached
tiles.

This is different on both axes:

- **No GPS dependency.** Position, altitude, and flight phase (climb/cruise/descent)
  come from fusing the phone's accelerometer and barometer — sensors that work through
  a metal fuselage regardless of window seat or GPS lock.
- **Predictive, not just live.** The whole flight gets simulated *before takeoff* from
  the schedule and aircraft performance profile — a "playlist" of what altitude/speed/
  position/ETA to expect at every point in the flight — then played back against
  elapsed time and corrected by the live sensor fusion once airborne.

## What's built

`core/` — pure Kotlin, no Android dependency, so it runs and tests on any JVM:

- `Geo.kt` — great-circle distance + interpolation (Aviation Formulary formulas)
- `AltitudeEstimator.kt` — complementary filter (accel + barometric pressure -> fused
  altitude/vertical speed) and a sustained-threshold flight-phase state machine
  (GROUND -> CLIMB -> CRUISE -> DESCENT -> LANDED)
- `FlightTimelinePredictor.kt` — builds the pre-takeoff timeline from a `FlightPlan`
  (route + schedule + aircraft profile), handling both normal 3-phase flights and short
  hops that never reach cruise altitude

No Gradle/JUnit installed in this environment yet, so `core/src/test/kotlin/telemetry/VerifyMain.kt`
is an assertion-based harness covering the same behavior real `@Test`s would (29/29
passing) — lift it into proper JUnit once the Android project is opened in Studio.

## Not built yet

- Android app module (Compose UI, sensor reading via `SensorManager`, TTS callouts)
- Flight-number lookup + offline cache (data source undecided — likely FlightAware
  AeroAPI, same as the prior-art project, fetched while still on the ground)
- Landmark dataset (the `LandmarkFinder` API exists; no real landmark data wired in yet)
