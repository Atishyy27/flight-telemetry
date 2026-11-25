/*
 * player/flights.js - the flight library: saved flights are merged into the list the player
 * plays. Vanilla JS, no dependencies. Works as a <script> (window.V2_FLIGHTLIB) or require().
 *
 * Storage key and leg shape match the Settings screen of the player:
 *   localStorage "flightradar.flights" = JSON array of legs
 *   leg = { id, from, to, fromFull, toFull, dep:"HH:MM", board:"HH:MM", seat, mins, km,
 *           depH, depM, wps:[{km, la, lo, n, s, t}, ...] }
 * Built-in legs always keep their index, so saved playback state (field li) stays valid.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.V2_FLIGHTLIB = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY = "flightradar.flights";

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isStr(v) { return typeof v === "string" && v.length > 0; }

  // World bounds replace the India-only bounds of the old validator.
  function validateLeg(obj, prefix) {
    prefix = prefix || "";
    var errs = [];
    if (!obj || typeof obj !== "object") return [prefix + "is not an object"];

    ["id", "from", "to", "fromFull", "toFull", "dep", "board", "seat"].forEach(function (k) {
      if (!isStr(obj[k])) errs.push(prefix + "field '" + k + "' must be a non-empty string");
    });
    if (!isNum(obj.mins) || obj.mins <= 0) errs.push(prefix + "field 'mins' must be a positive number");
    if (!isNum(obj.km) || obj.km <= 0) errs.push(prefix + "field 'km' must be a positive number");
    if (!isNum(obj.depH) || obj.depH < 0 || obj.depH > 23 || obj.depH % 1 !== 0) errs.push(prefix + "field 'depH' must be an integer 0..23");
    if (!isNum(obj.depM) || obj.depM < 0 || obj.depM > 59 || obj.depM % 1 !== 0) errs.push(prefix + "field 'depM' must be an integer 0..59");
    if (isStr(obj.dep) && !/^\d{2}:\d{2}$/.test(obj.dep)) errs.push(prefix + "field 'dep' should look like HH:MM");
    if (isStr(obj.board) && !/^\d{2}:\d{2}$/.test(obj.board)) errs.push(prefix + "field 'board' should look like HH:MM");

    if (!Array.isArray(obj.wps) || obj.wps.length < 2) {
      errs.push(prefix + "field 'wps' must be an array of at least 2 waypoints");
      return errs;
    }
    var prevKm = null;
    obj.wps.forEach(function (wp, w) {
      var x = prefix + "wps[" + w + "]";
      if (!wp || typeof wp !== "object") { errs.push(x + " is not an object"); return; }
      if (!isNum(wp.km)) errs.push(x + ".km must be a number");
      if (!isNum(wp.la)) errs.push(x + ".la must be a number");
      if (!isNum(wp.lo)) errs.push(x + ".lo must be a number");
      ["n", "s", "t"].forEach(function (k) { if (!isStr(wp[k])) errs.push(x + "." + k + " must be a non-empty string"); });
      if (isNum(wp.la) && (wp.la < -90 || wp.la > 90)) errs.push(x + ".la=" + wp.la + " is outside -90..90");
      if (isNum(wp.lo) && (wp.lo < -180 || wp.lo > 180)) errs.push(x + ".lo=" + wp.lo + " is outside -180..180");
      if (isNum(wp.km)) {
        if (prevKm !== null && wp.km <= prevKm) errs.push(x + ".km=" + wp.km + " must be greater than the previous waypoint");
        prevKm = wp.km;
      }
    });
    var first = obj.wps[0], last = obj.wps[obj.wps.length - 1];
    if (first && isNum(first.km) && first.km !== 0) errs.push(prefix + "wps[0].km must be 0");
    if (last && isNum(last.km) && isNum(obj.km) && last.km !== obj.km) errs.push(prefix + "last waypoint km must equal leg km");
    return errs;
  }

  // Parse the stored JSON. Never throws: corrupt storage gives an empty list and an error.
  function parseSaved(raw) {
    if (raw == null || raw === "") return { legs: [], errors: [] };
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { legs: [], errors: ["saved flights are not valid JSON"] }; }
    if (!Array.isArray(parsed)) return { legs: [], errors: ["saved flights must be a JSON array"] };
    return { legs: parsed, errors: [] };
  }

  // Built-in legs first and unchanged in position; valid saved legs follow; bad or duplicate skipped.
  function mergeFlights(builtin, saved) {
    var legs = builtin.slice();
    var errors = [];
    var seen = {};
    builtin.forEach(function (l) { seen[l.id] = true; });
    saved.forEach(function (leg, i) {
      var errs = validateLeg(leg, "saved[" + i + "]: ");
      if (errs.length) { errors = errors.concat(errs); return; }
      if (seen[leg.id]) { errors.push("saved[" + i + "]: id '" + leg.id + "' already exists"); return; }
      seen[leg.id] = true;
      legs.push(leg);
    });
    return { legs: legs, errors: errors };
  }

  function loadAll(storage, builtin) {
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { /* storage blocked */ }
    var p = parseSaved(raw);
    var m = mergeFlights(builtin, p.legs);
    return { legs: m.legs, errors: p.errors.concat(m.errors), savedCount: m.legs.length - builtin.length };
  }

  function readSaved(storage) {
    var raw = null;
    try { raw = storage.getItem(KEY); } catch (e) { /* ignore */ }
    return parseSaved(raw).legs;
  }

  // Add or replace a saved flight by id. Returns {ok, action, errors}.
  function addFlight(storage, leg, builtin) {
    var errs = validateLeg(leg);
    if (errs.length) return { ok: false, action: null, errors: errs };
    if ((builtin || []).some(function (l) { return l.id === leg.id; })) {
      return { ok: false, action: null, errors: ["id '" + leg.id + "' is a built-in flight"] };
    }
    var saved = readSaved(storage);
    var action = "added";
    var idx = -1;
    saved.forEach(function (l, i) { if (l && l.id === leg.id) idx = i; });
    if (idx >= 0) { saved[idx] = leg; action = "updated"; } else saved.push(leg);
    try { storage.setItem(KEY, JSON.stringify(saved)); } catch (e) { return { ok: false, action: null, errors: ["could not save (storage full or blocked)"] }; }
    return { ok: true, action: action, errors: [] };
  }

  function removeFlight(storage, id) {
    var saved = readSaved(storage);
    var next = saved.filter(function (l) { return !(l && l.id === id); });
    if (next.length === saved.length) return false;
    try { storage.setItem(KEY, JSON.stringify(next)); } catch (e) { return false; }
    return true;
  }

  return {
    KEY: KEY,
    validateLeg: validateLeg,
    parseSaved: parseSaved,
    mergeFlights: mergeFlights,
    loadAll: loadAll,
    addFlight: addFlight,
    removeFlight: removeFlight,
  };
});
