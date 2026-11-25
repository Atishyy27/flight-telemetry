"use strict";
// Synthetic traces for tests. No real data: a made-up cabin schedule plus seeded noise.

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  var u1 = 1 - rng(), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Cabin climbs to 7,000 ft at climbFpm, holds, descends at descentFpm. Pressure in hPa.
function cabinTrace(opts) {
  var hz = opts.hz, climbFpm = opts.climbFpm, descentFpm = opts.descentFpm;
  var noise = opts.noiseHpa || 0, holdMin = opts.holdMinutes || 90;
  var rng = mulberry32(opts.seed || 0);
  var climbStart = 60, climbDur = 7000 / climbFpm * 60;
  var holdEnd = climbStart + climbDur + holdMin * 60;
  var ground = holdEnd + 7000 / descentFpm * 60;
  var end = ground + 300;
  function ft(t) {
    if (t < climbStart) return 0;
    if (t < climbStart + climbDur) return (t - climbStart) / 60 * climbFpm;
    if (t < holdEnd) return 7000;
    if (t < ground) return 7000 - (t - holdEnd) / 60 * descentFpm;
    return 0;
  }
  var samples = [];
  for (var i = 0; i / hz < end; i++) {
    var t = i / hz;
    var p = 1013.25 * Math.pow(1 - ft(t) * 0.3048 / 44330, 5.255) + gaussian(rng) * noise;
    samples.push({ t: t, pressureHpa: p, ax: 0 });
  }
  return { samples: samples, trueDescentStart: holdEnd, trueGround: ground };
}

// Longitudinal acceleration trace: quiet taxi, a takeoff roll of rollSeconds at rollAccel
// starting at rollStartT, then quiet. Optional short jolts (turbulence, a dropped bag).
function accelTrace(opts) {
  var hz = opts.hz || 10, endT = opts.endT, rollStartT = opts.rollStartT;
  var rollSeconds = opts.rollSeconds == null ? 30 : opts.rollSeconds;
  var rollAccel = opts.rollAccel == null ? 3 : opts.rollAccel;
  var jolts = opts.jolts || [];
  var rng = mulberry32(opts.seed || 1);
  var samples = [];
  for (var i = 0; i / hz < endT; i++) {
    var t = i / hz;
    var ax = gaussian(rng) * 0.1;
    if (rollStartT != null && t >= rollStartT && t < rollStartT + rollSeconds) ax += rollAccel;
    for (var j = 0; j < jolts.length; j++) if (t >= jolts[j] && t < jolts[j] + 1) ax += 3;
    samples.push({ t: t, ax: ax, pressureHpa: 1013.25 });
  }
  return samples;
}

module.exports = { mulberry32: mulberry32, gaussian: gaussian, cabinTrace: cabinTrace, accelTrace: accelTrace };
