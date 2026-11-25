"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const phase = require("../phase.js");
const { cabinTrace } = require("./synthetic.js");

// The pre-change algorithm (fixed 0.98 per-step weight, 2.0 m/s thresholds, 3 s sustain),
// ported from the old AltitudeEstimator.kt so before and after sit in one table.
function legacyPhases(samples) {
  const W = 0.98;
  let alt = 0, vs = 0, init = false, prev = null, ph = "GROUND", timer = 0, gref = 0;
  const out = [];
  for (const s of samples) {
    const dt = prev == null ? 1 : s.t - prev;
    prev = s.t;
    const b = phase.baroAltitudeM(s.pressureHpa, 1013.25);
    if (!init) { alt = b; init = true; continue; }
    const na = W * (alt + vs * dt) + (1 - W) * b;
    const nv = W * vs + (1 - W) * ((b - alt) / dt);
    alt = na; vs = nv;
    const step = (cond, next) => {
      timer = cond ? timer + dt : 0;
      if (timer >= 3) { ph = next; timer = 0; out.push({ phase: next, t: s.t }); }
    };
    if (ph === "GROUND") { gref = alt; step(vs > 2, "CLIMB"); }
    else if (ph === "CLIMB") step(Math.abs(vs) < 0.75, "CRUISE");
    else if (ph === "CRUISE") step(vs < -2, "DESCENT");
    else if (ph === "DESCENT") step(Math.abs(alt - gref) < 60 && Math.abs(vs) < 0.75, "LANDED");
  }
  return out;
}

const EXPECTED = ["CLIMB", "CRUISE", "DESCENT", "LANDED"];

function sweep(detect) {
  const rows = [];
  for (const descentFpm of [300, 200]) {
    for (const hz of [1, 5, 50]) {
      let correct = 0, falseDescent = 0, maxDelay = -Infinity;
      for (let seed = 0; seed < 20; seed++) {
        const tr = cabinTrace({ hz, climbFpm: 500, descentFpm, noiseHpa: 0.05, seed });
        const res = detect(tr.samples);
        const seq = res.map((r) => r.phase);
        const d = res.find((r) => r.phase === "DESCENT");
        if (d && d.t < tr.trueDescentStart) falseDescent++;
        if (JSON.stringify(seq) === JSON.stringify(EXPECTED)) {
          correct++;
          maxDelay = Math.max(maxDelay, d.t - tr.trueDescentStart);
        }
      }
      rows.push({ descentFpm, hz, correct, falseDescent, maxDelay: correct ? Math.round(maxDelay) : null });
    }
  }
  return rows;
}

test("phase sweep: before and after on synthetic cabin traces", () => {
  const before = sweep(legacyPhases);
  const after = sweep((s) => phase.detectPhases(s));
  let md = "| cabin descent | rate | before: correct | before: false DESCENT | after: correct | after: false DESCENT | after: max delay (s) |\n|---|---|---|---|---|---|---|\n";
  before.forEach((b, i) => {
    const a = after[i];
    md += `| ${b.descentFpm} ft/min | ${b.hz} Hz | ${b.correct}/20 | ${b.falseDescent}/20 | ${a.correct}/20 | ${a.falseDescent}/20 | ${a.maxDelay} |\n`;
  });
  console.log(md);
  fs.mkdirSync("player/out", { recursive: true });
  fs.writeFileSync("player/out/phase-sweep-js.md", md);
  for (const a of after) {
    assert.strictEqual(a.correct, 20, `correct sequence at ${a.hz} Hz, ${a.descentFpm} fpm`);
    assert.strictEqual(a.falseDescent, 0, `false descent at ${a.hz} Hz`);
    assert.ok(a.maxDelay <= 60, `descent delay ${a.maxDelay}s at ${a.hz} Hz`);
  }
});

test("rate independence: the filter reads the same climb rate at 1, 5 and 50 Hz", () => {
  const truth = 500 / 60 * 0.3048;
  for (const hz of [1, 5, 50]) {
    const f = phase.createAltitudeFilter();
    let r;
    for (let i = 0; i < 120 * hz; i++) {
      const altM = (i / hz) * truth;
      r = f.update(1 / hz, 0, 1013.25 * Math.pow(1 - altM / 44330, 5.255));
    }
    assert.ok(Math.abs(r.verticalSpeedMps - truth) < 0.1, `${hz} Hz: got ${r.verticalSpeedMps}, want ${truth}`);
  }
});

test("a jolt does not change the phase (sustain)", () => {
  const det = phase.createPhaseDetector();
  for (let i = 0; i < 10; i++) det.update(1, { fusedAltitudeM: 0, verticalSpeedMps: 5, baroAltitudeM: 0 });
  assert.strictEqual(det.phase, "GROUND");
});

test("dt must be positive", () => {
  assert.throws(() => phase.createAltitudeFilter().update(0, 0, 1013.25));
});

test("a long gap in samples does not flip the phase", () => {
  const f = phase.createAltitudeFilter();
  const det = phase.createPhaseDetector();
  const flat = 1013.25;
  let r = f.update(1, 0, flat);
  det.update(1, r);
  // 10 minutes with no samples, then one sample at a pressure 30 m higher (a weather shift)
  r = f.update(600, 0, flat * Math.pow(1 - 30 / 44330, 5.255));
  det.update(600, r);
  assert.strictEqual(det.phase, "GROUND");
  assert.ok(Math.abs(r.verticalSpeedMps) < 0.01, "vs " + r.verticalSpeedMps);
});

test("landing works when the destination is 2000 m above the origin", () => {
  const det = phase.createPhaseDetector();
  const step = (n, alt, vs) => { for (let i = 0; i < n; i++) det.update(1, { fusedAltitudeM: alt, verticalSpeedMps: vs, baroAltitudeM: alt }); };
  step(25, 0, 3);       // climb
  step(25, 2100, 0);    // cruise (cabin about 2100 m)
  step(25, 2000, -1.2); // descent starts
  assert.strictEqual(det.phase, "DESCENT");
  step(25, 2000, 0);    // level, but only a 100 m drop would be needed; none yet
  assert.strictEqual(det.phase, "DESCENT");
  for (let i = 0; i < 25; i++) det.update(1, { fusedAltitudeM: 1800, verticalSpeedMps: 0, baroAltitudeM: 1800 });
  assert.strictEqual(det.phase, "LANDED");
});
