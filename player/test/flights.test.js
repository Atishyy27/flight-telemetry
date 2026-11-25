"use strict";
const test = require("node:test");
const assert = require("node:assert");
const lib = require("../flights.js");
const fx = require("../fixtures.js");

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

test("empty storage: only built-in flights, no errors", () => {
  const r = lib.loadAll(fakeStorage(), fx.builtin);
  assert.strictEqual(r.legs.length, 2);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.savedCount, 0);
});

test("a saved flight shows up after reload: 2 tabs become 3", () => {
  const s = fakeStorage();
  assert.strictEqual(lib.loadAll(s, fx.builtin).legs.length, 2);
  const add = lib.addFlight(s, fx.overseas, fx.builtin);
  assert.deepStrictEqual([add.ok, add.action], [true, "added"]);
  const reloaded = lib.loadAll(s, fx.builtin);
  assert.strictEqual(reloaded.legs.length, 3);
  assert.strictEqual(reloaded.legs[2].id, "T 300");
});

test("built-in legs keep their index when flights are saved", () => {
  const s = fakeStorage();
  lib.addFlight(s, fx.overseas, fx.builtin);
  const legs = lib.loadAll(s, fx.builtin).legs;
  assert.strictEqual(legs[0].id, fx.builtin[0].id);
  assert.strictEqual(legs[1].id, fx.builtin[1].id);
});

test("a non-India leg is accepted (world bounds)", () => {
  assert.deepStrictEqual(lib.validateLeg(fx.overseas), []);
});

test("out-of-range coordinates are rejected with a clear message", () => {
  const bad = clone(fx.overseas);
  bad.wps[1].la = 95;
  const errs = lib.validateLeg(bad);
  assert.ok(errs.some((e) => e.includes("outside -90..90")), errs.join("; "));
});

test("delete removes the saved flight and the tab", () => {
  const s = fakeStorage();
  lib.addFlight(s, fx.overseas, fx.builtin);
  assert.strictEqual(lib.removeFlight(s, "T 300"), true);
  assert.strictEqual(lib.loadAll(s, fx.builtin).legs.length, 2);
  assert.strictEqual(lib.removeFlight(s, "T 300"), false);
});

test("corrupt JSON in storage: built-in flights still load, one error", () => {
  const s = fakeStorage({ [lib.KEY]: "{not json" });
  const r = lib.loadAll(s, fx.builtin);
  assert.strictEqual(r.legs.length, 2);
  assert.strictEqual(r.errors.length, 1);
});

test("storage holding a non-array is reported, not thrown", () => {
  const r = lib.loadAll(fakeStorage({ [lib.KEY]: '{"a":1}' }), fx.builtin);
  assert.strictEqual(r.legs.length, 2);
  assert.ok(r.errors[0].includes("array"));
});

test("blocked storage does not throw", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.strictEqual(lib.loadAll(blocked, fx.builtin).legs.length, 2);
  const r = lib.addFlight(blocked, fx.overseas, fx.builtin);
  assert.strictEqual(r.ok, false);
});

test("duplicate id: a built-in id cannot be overwritten", () => {
  const r = lib.addFlight(fakeStorage(), clone(fx.builtin[0]), fx.builtin);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors[0].includes("built-in"));
});

test("adding the same saved id twice updates, not duplicates", () => {
  const s = fakeStorage();
  lib.addFlight(s, fx.overseas, fx.builtin);
  const again = clone(fx.overseas);
  again.mins = 130;
  assert.strictEqual(lib.addFlight(s, again, fx.builtin).action, "updated");
  const legs = lib.loadAll(s, fx.builtin).legs;
  assert.strictEqual(legs.length, 3);
  assert.strictEqual(legs[2].mins, 130);
});

test("a saved duplicate of a built-in id in storage is skipped with an error", () => {
  const s = fakeStorage({ [lib.KEY]: JSON.stringify([fx.builtin[0], fx.overseas]) });
  const r = lib.loadAll(s, fx.builtin);
  assert.strictEqual(r.legs.length, 3);
  assert.ok(r.errors.some((e) => e.includes("already exists")));
});

test("waypoints out of order are rejected", () => {
  const bad = clone(fx.overseas);
  bad.wps[1].km = 900;
  bad.wps[2].km = 450;
  assert.ok(lib.validateLeg(bad).length > 0);
});

test("missing waypoints are rejected", () => {
  const bad = clone(fx.overseas);
  bad.wps = [bad.wps[0]];
  assert.ok(lib.validateLeg(bad).some((e) => e.includes("at least 2")));
});

test("a null entry in the saved array does not crash the merge", () => {
  const s = fakeStorage({ [lib.KEY]: JSON.stringify([null, fx.overseas]) });
  const r = lib.loadAll(s, fx.builtin);
  assert.strictEqual(r.legs.length, 3);
  assert.strictEqual(r.errors.length, 1);
});

test("ids named like object properties are accepted", () => {
  const odd = clone(fx.overseas);
  odd.id = "constructor";
  const s = fakeStorage();
  assert.strictEqual(lib.addFlight(s, odd, fx.builtin).ok, true);
  assert.strictEqual(lib.loadAll(s, fx.builtin).legs.length, 3);
});
