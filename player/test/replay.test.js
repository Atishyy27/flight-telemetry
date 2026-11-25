"use strict";
const test = require("node:test");
const assert = require("node:assert");
const rp = require("../sensors-replay.js");
const { accelTrace } = require("./synthetic.js");

// Planned timeline: taxi until 900 s, then waypoints every 15 minutes (synthetic).
const PLANNED_TAKEOFF = 900;
const PLANNED_WAYPOINTS = [900, 1800, 2700, 3600, 4500, 5400];

function worstError(offsetS, delayS) {
  return Math.max(...PLANNED_WAYPOINTS.map((t) => Math.abs(rp.applyOffset(t, offsetS) - (t + delayS))));
}

test("takeoff 17 minutes late: error at every later waypoint goes from 17 min to under 1 min", () => {
  const delay = 17 * 60;
  const trace = accelTrace({ endT: 3000, rollStartT: PLANNED_TAKEOFF + delay });
  const st = rp.resolveState({ mode: "replay", samples: trace, nowT: 3000, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.strictEqual(st.source, "replay");
  assert.strictEqual(worstError(0, delay), delay);
  const after = worstError(st.offsetS, delay);
  assert.ok(after < 60, `after correction ${after}s`);
});

test("takeoff early: negative offset", () => {
  const delay = -5 * 60;
  const trace = accelTrace({ endT: 1500, rollStartT: PLANNED_TAKEOFF + delay });
  const st = rp.resolveState({ mode: "replay", samples: trace, nowT: 1500, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.ok(worstError(st.offsetS, delay) < 60);
  assert.ok(st.offsetS < 0);
});

test("no takeoff in the trace: offset 0, still labelled by its mode", () => {
  const trace = accelTrace({ endT: 600, rollStartT: null });
  const st = rp.resolveState({ mode: "replay", samples: trace, nowT: 600, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.strictEqual(st.offsetS, 0);
  assert.strictEqual(st.takeoff.detected, false);
});

test("short jolts do not count as a takeoff", () => {
  const trace = accelTrace({ endT: 600, rollStartT: null, jolts: [100, 200, 300] });
  assert.strictEqual(rp.detectTakeoff(trace).detected, false);
});

test("a roll shorter than the sustain time is ignored", () => {
  const trace = accelTrace({ endT: 600, rollStartT: 100, rollSeconds: 3 });
  assert.strictEqual(rp.detectTakeoff(trace).detected, false);
});

test("sensor dropout falls back to the timer", () => {
  const trace = accelTrace({ endT: 1000, rollStartT: 950 });
  const st = rp.resolveState({ mode: "replay", samples: trace, nowT: 1100, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.strictEqual(st.source, "timer");
  assert.strictEqual(st.offsetS, 0);
});

test("empty trace falls back to the timer", () => {
  const st = rp.resolveState({ mode: "device", samples: [], nowT: 10, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.strictEqual(st.label, "timer");
});

test("mode timer ignores a trace", () => {
  const trace = accelTrace({ endT: 3000, rollStartT: 1900 });
  const st = rp.resolveState({ mode: "timer", samples: trace, nowT: 3000, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.deepStrictEqual([st.label, st.offsetS], ["timer", 0]);
});

test("badge text per source", () => {
  const trace = accelTrace({ endT: 100, rollStartT: null });
  assert.strictEqual(rp.resolveState({ mode: "replay", samples: trace, nowT: 100, plannedTakeoffT: 0 }).label, "recorded trace");
  assert.strictEqual(rp.resolveState({ mode: "device", samples: trace, nowT: 100, plannedTakeoffT: 0 }).label, "device");
  assert.strictEqual(rp.resolveState({ mode: "bogus", samples: trace, nowT: 100, plannedTakeoffT: 0 }).label, "timer");
});

test("takeoff not yet happened at nowT: no correction yet", () => {
  const trace = accelTrace({ endT: 3000, rollStartT: 2000 });
  const st = rp.resolveState({ mode: "replay", samples: trace, nowT: 1500, plannedTakeoffT: PLANNED_TAKEOFF });
  assert.strictEqual(st.offsetS, 0);
});

test("correctTimeline ignores non-numbers", () => {
  assert.strictEqual(rp.correctTimeline(900, null), 0);
  assert.strictEqual(rp.correctTimeline(NaN, 1000), 0);
});
