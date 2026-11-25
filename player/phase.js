/*
 * player/phase.js - flight phase detection from cabin pressure. Port of
 * AltitudeEstimator.kt (ComplementaryAltitudeFilter + FlightPhaseDetector).
 * Vanilla JS, no dependencies. Works as a <script> (window.V2_PHASE) or require().
 *
 * A phone in an airliner sees cabin pressure, not outside pressure. The cabin rate is
 * limited to about 500 ft/min up and 300 ft/min down (about 2.5 and 1.5 m/s), so the
 * thresholds sit well under those and must hold for sustainSeconds. Landing is "level again
 * after a descent of at least minDescentDropM", not a comparison with the origin elevation.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.V2_PHASE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function baroAltitudeM(pressureHpa, referenceHpa) {
    return 44330 * (1 - Math.pow(pressureHpa / referenceHpa, 1 / 5.255));
  }

  // Alpha-beta filter. Gains come from bandwidth and the step length, so the result does not
  // depend on the sample rate.
  function createAltitudeFilter(opts) {
    opts = opts || {};
    var ref = typeof opts.referencePressureHpa === "number" ? opts.referencePressureHpa : 1013.25;
    var w = typeof opts.bandwidthRadPerSec === "number" ? opts.bandwidthRadPerSec : 0.2;
    var alt = 0, vs = 0, init = false;
    return {
      update: function (dt, accel, pressureHpa) {
        if (!(dt > 0)) throw new Error("dt must be > 0");
        var baro = baroAltitudeM(pressureHpa, ref);
        if (!init || dt > 5) {
          // first sample, or a gap (throttled sensor, dropout): re-seed instead of integrating across it
          alt = baro; vs = 0; init = true;
          return { fusedAltitudeM: alt, verticalSpeedMps: vs, baroAltitudeM: baro };
        }
        var a = accel || 0;
        var predVs = vs + a * dt;
        var predAlt = alt + vs * dt + 0.5 * a * dt * dt;
        var err = baro - predAlt;
        alt = predAlt + Math.min(1, 2 * w * dt) * err;
        vs = predVs + Math.min(1, w * w * dt) * err;
        return { fusedAltitudeM: alt, verticalSpeedMps: vs, baroAltitudeM: baro };
      },
    };
  }

  function createPhaseDetector(opts) {
    opts = opts || {};
    var climb = opts.climbThresholdMps != null ? opts.climbThresholdMps : 1.0;
    var descent = opts.descentThresholdMps != null ? opts.descentThresholdMps : 0.8;
    var level = opts.levelThresholdMps != null ? opts.levelThresholdMps : 0.35;
    var sustain = opts.sustainSeconds != null ? opts.sustainSeconds : 20;
    var minDrop = opts.minDescentDropM != null ? opts.minDescentDropM : 100;
    var phase = "GROUND", descentStartAlt = NaN, timer = 0;

    function hold(cond, dt) { timer = cond ? timer + dt : 0; return timer >= sustain; }
    function go(next) { phase = next; timer = 0; }

    return {
      get phase() { return phase; },
      update: function (rawDt, reading) {
        var dt = Math.min(rawDt, 5); // a gap in samples counts as 5 s at most
        var vs = reading.verticalSpeedMps;
        if (phase === "GROUND") {
          if (hold(vs > climb, dt)) go("CLIMB");
        } else if (phase === "CLIMB") {
          if (hold(Math.abs(vs) < level, dt)) go("CRUISE");
        } else if (phase === "CRUISE") {
          if (hold(vs < -descent, dt)) { go("DESCENT"); descentStartAlt = reading.fusedAltitudeM; }
        } else if (phase === "DESCENT") {
          var dropped = descentStartAlt - reading.fusedAltitudeM >= minDrop;
          if (hold(dropped && Math.abs(vs) < level, dt)) go("LANDED");
        }
        return phase;
      },
    };
  }

  // Convenience: run a whole trace [{t, pressureHpa}] and return the phase transitions.
  function detectPhases(samples, opts) {
    var filter = createAltitudeFilter(opts);
    var det = createPhaseDetector(opts);
    var out = [];
    var prevT = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var dt = prevT == null ? 1 : s.t - prevT;
      prevT = s.t;
      if (!(dt > 0)) continue;
      var before = det.phase;
      var after = det.update(dt, filter.update(dt, 0, s.pressureHpa));
      if (after !== before) out.push({ phase: after, t: s.t });
    }
    return out;
  }

  return {
    baroAltitudeM: baroAltitudeM,
    createAltitudeFilter: createAltitudeFilter,
    createPhaseDetector: createPhaseDetector,
    detectPhases: detectPhases,
  };
});
