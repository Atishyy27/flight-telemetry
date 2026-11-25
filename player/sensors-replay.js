/*
 * player/sensors-replay.js - turns a sensor trace (recorded, synthetic or live) into two
 * things the player can show: where its numbers come from, and how late the plane really
 * took off. Vanilla JS, no dependencies. Works as a <script> (window.V2_REPLAY) or require().
 *
 * Trace sample: { t: seconds on the trace clock, ax: longitudinal accel m/s^2, pressureHpa }.
 * The real device source (native Android pressure and accelerometer through a JS bridge) is
 * not part of this file; it would hand the same samples to resolveState().
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.V2_REPLAY = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    takeoffAccelMps2: 2.0,   // same numbers as sensors.js; still unmeasured on a real plane
    takeoffSustainS: 4.0,
    dropoutS: 10.0,          // no sample for this long: fall back to the timer
    maxGapS: 1.0,            // a gap this long inside a roll breaks it
    maxOffsetS: 3600,        // a shift beyond an hour is treated as a false detection
  };

  var SOURCES = { timer: "timer", replay: "recorded trace", device: "device" };

  // First run of forward acceleration (ax above the threshold; braking is negative and ignored)
  // that lasts takeoffSustainS with no gap in the samples. rollStartT is where that run
  // began; confirmedT is when it was long enough.
  function detectTakeoff(samples, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var runStart = null;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (runStart != null && i > 0 && s.t - samples[i - 1].t > o.maxGapS) runStart = null;
      if ((s.ax || 0) > o.takeoffAccelMps2) {
        if (runStart == null) runStart = s.t;
        if (s.t - runStart >= o.takeoffSustainS) return { detected: true, rollStartT: runStart, confirmedT: s.t };
      } else {
        runStart = null;
      }
    }
    return { detected: false, rollStartT: null, confirmedT: null };
  }

  // Seconds to add to every planned time. Positive = the flight left later than planned.
  function correctTimeline(plannedTakeoffT, detectedTakeoffT) {
    if (typeof plannedTakeoffT !== "number" || typeof detectedTakeoffT !== "number") return 0;
    if (!isFinite(plannedTakeoffT) || !isFinite(detectedTakeoffT)) return 0;
    return detectedTakeoffT - plannedTakeoffT;
  }

  function applyOffset(plannedT, offsetS) { return plannedT + offsetS; }

  // mode: "timer" | "replay" | "device". samples: the trace so far. nowT: trace clock now.
  // Returns { source, label, offsetS, takeoff }.
  function resolveState(opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var mode = SOURCES[o.mode] ? o.mode : "timer";
    var samples = o.samples || [];
    var timer = { source: "timer", label: SOURCES.timer, offsetS: 0, takeoff: null, confirmed: false };
    if (mode === "timer") return timer;
    // Sensor mode but no usable samples: the timer runs and the last known shift is kept.
    var lost = { source: "timer", label: "timer (sensor lost)", offsetS: o.lastOffsetS || 0, takeoff: null, confirmed: false };
    if (samples.length === 0) return lost;
    var last = samples[samples.length - 1].t;
    if (typeof o.nowT === "number" && o.nowT - last > o.dropoutS) return lost;
    var upTo = typeof o.nowT === "number" ? samples.filter(function (s) { return s.t <= o.nowT; }) : samples;
    var take = detectTakeoff(upTo, o);
    var offset = take.detected ? correctTimeline(o.plannedTakeoffT, take.rollStartT) : 0;
    if (Math.abs(offset) > o.maxOffsetS) { offset = 0; take = { detected: false, rollStartT: null, confirmedT: null }; }
    return {
      source: mode,
      label: SOURCES[mode],
      offsetS: offset,
      takeoff: take,
      confirmed: take.detected,   // false until a takeoff has actually been seen
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    SOURCES: SOURCES,
    detectTakeoff: detectTakeoff,
    correctTimeline: correctTimeline,
    applyOffset: applyOffset,
    resolveState: resolveState,
  };
});
