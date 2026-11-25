/*
 * player/fixtures.js - synthetic flights for tests and the demo page. Invented places,
 * invented times, no personal itinerary. Coordinates are generic and not tied to a person.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.V2_FIXTURES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function leg(id, from, to, fromFull, toFull, depH, mins, km, pts) {
    return {
      id: id, from: from, to: to, fromFull: fromFull, toFull: toFull,
      dep: (depH < 10 ? "0" : "") + depH + ":00", board: (depH < 10 ? "0" : "") + depH + ":00",
      seat: "00A", mins: mins, km: km, depH: depH, depM: 0,
      wps: pts.map(function (p) { return { km: p[0], la: p[1], lo: p[2], n: p[3], s: "Testland", t: "Synthetic waypoint." }; }),
    };
  }

  var builtin = [
    leg("T 100", "AAA", "BBB", "Alpha Field", "Bravo Field", 6, 90, 600, [
      [0, 10.0, 70.0, "Alpha"], [300, 12.0, 72.0, "Midway"], [600, 14.0, 74.0, "Bravo"]]),
    leg("T 200", "BBB", "CCC", "Bravo Field", "Charlie Field", 9, 80, 480, [
      [0, 14.0, 74.0, "Bravo"], [240, 16.0, 75.0, "Delta"], [480, 18.0, 76.0, "Charlie"]]),
  ];

  // Outside India on purpose: the old validator rejected it.
  var overseas = leg("T 300", "DDD", "EEE", "Delta Field", "Echo Field", 14, 120, 900, [
    [0, 51.0, -1.0, "Delta"], [450, 52.5, 5.0, "Mid"], [900, 54.0, 11.0, "Echo"]]);

  return { builtin: builtin, overseas: overseas, leg: leg };
});
