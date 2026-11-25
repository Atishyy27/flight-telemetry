# try-it card and merge cards, review 2026-11-25

Everything here uses synthetic data. Nothing in the private player (phone/flight-player.html) was edited. The merge into the player is a hand step, listed at the end.

## D6. Try it yourself (about 5 minutes, no install)

1. Clone or pull the branch `review/2026-11-25`. Open `player/demo/index.html` by double click. You see 2 flights as tabs, and "Numbers from: timer".
2. Click "Load example", then "Import". A third tab "T 300 DDD to EEE" appears and is selected. Reload the page: it is still there. (Change 2. A flight outside India is accepted; the old check rejected it.)
3. Click "Remove saved". Back to 2 tabs. Type `{not json` in the box and Import: you get an error line, no crash.
4. Set Source to "recorded trace". The badge changes, and "Takeoff vs plan" shows "+17 min 0 s (timeline shifted)". That is a synthetic trace where the plane leaves 17 minutes late. (Change 3.)
5. Phase detection (Change 1): in a terminal in the repo run `node --test player/test/phase.test.js` (about 40 s). It prints the before and after table for 1, 5 and 50 Hz. The Kotlin version of the same table is in the CI run linked in the report.

## D7. Merge cards

### Change 1. Phase detection that works with cabin pressure and any sample rate
- What: the altitude filter is now an alpha-beta filter whose gains come from a bandwidth and the step length (it no longer depends on the sample rate). The phase detector uses cabin-rate thresholds: climb above 1.0 m/s, descent below 0.8 m/s, level under 0.35 m/s, sustained 20 s. Landing is level again after a cabin descent of at least 100 m (no comparison with the origin elevation). A gap in samples over 5 s re-seeds the filter and counts as 5 s for the timers. JS port in `player/phase.js`.
- Why: with the old filter, in a synthetic cabin trace, a false DESCENT fired during cruise in 12 of 20 runs at 1 Hz (13 of 20 in the JS port, which uses a different random generator), and no run got the right sequence at 50 Hz.
- Numbers, from CI: before 0 of 20 correct at 50 Hz and 5 Hz for 200 ft/min descents; after 20 of 20 in all six rows, 0 false DESCENT, delay 27 to 36 s (Kotlin), 28 to 35 s (JS).
- Risk: thresholds are tuned on a synthetic cabin and on 0.05 hPa of noise (an assumption). A real plane may differ. The 20 s sustain makes every transition at least 20 s late. In the private web player this change has no visible effect until a pressure source exists, because browsers have no barometer; the Kotlin side is what a future Android module would use.
- Roll back: `git revert 7b2c41d` and the round-1 hardening commit listed below (the Kotlin fix; the old tests in VerifyMain were also changed to 25 s steps, same commit) and `git revert 6f49588` for the JS port.
- Commits: cfcd959 (gradle and CI), eaf14e8 (failing test first), 7b2c41d (fix), 6f49588 (JS port).

### Change 2. Flights you add actually play
- What: `player/flights.js` merges saved flights (localStorage key `flightradar.flights`) after the built-in ones, validates them with world bounds, and never throws on corrupt or blocked storage.
- Why: the player's Settings screen saved imported flights that nothing ever played (flight-player.html line 2273 says so).
- Numbers: 16 node tests; Playwright stories pass at 1280 px and 360 px (tab count 2, then 3 after import, survives reload, back to 2 after removal; no sideways scroll). Screenshots in `docs/review-2026-11-25/shots/`.
- Risk: low. Built-in flights keep index 0 and 1, so the saved playback state (`flightradar.v1`, field `li`) stays valid. A saved flight with the same id as a built-in one is skipped with an error.
- Roll back: `git revert cac84b9`.

### Change 3. Source badge and takeoff delay correction
- What: `player/sensors-replay.js`. From a trace of samples it finds the takeoff roll (acceleration above 2.0 m/s^2 for 4 s), returns how many seconds to shift the timeline, and a source label: "timer", "recorded trace" or "device". Only forward acceleration counts (braking does not), a roll with a gap over 1 s is broken, and a detected shift over 60 minutes is rejected. With mode "timer" it uses the timer. With no samples or a gap over 10 s it shows "timer (sensor lost)" and keeps the last known shift. Until a takeoff is seen, the state says "not confirmed" and the demo shows "waiting for takeoff".
- Why: the player starts its clock when you tap play and never learns when the plane really left.
- Numbers: 16 node tests; on a synthetic trace with a 17-minute-late takeoff the worst waypoint error goes from 1020 s to under 60 s.
- Risk: the 2.0 m/s^2 for 4 s takeoff rule is a guess carried from sensors.js and has never been tried on a real plane. The real device source (an Android pressure and accelerometer bridge) does not exist; "device" is a label only.
- Roll back: `git revert 87888fd`.

CI and demo: `6eb4ef9` (demo page, Playwright, two more CI jobs). Revert it to drop them; nothing deploys.

## Hand steps to use this in the private player (not done, not tested in the player)

These are for you to do in `phone/flight-player.html`. I did not open or run that file's changes.
1. Flights: paste the contents of `player/flights.js` in a `<script>` before the first script block. Rename `const LEGS=[...]` (line 128) to `const BUILTIN_LEGS=[...]` and add `const LEGS=V2_FLIGHTLIB.loadAll(localStorage,BUILTIN_LEGS).legs;` after it. After an import in Settings, reload the page (the tab list is built once).
2. Badge and shift: paste `player/sensors-replay.js`. Where the Flight screen shows the status, show `V2_REPLAY.resolveState({mode:"timer",samples:[],nowT:t,plannedTakeoffT:0}).label`, and use `t - offsetS` as the time when the state offers one.
3. Phase: paste `player/phase.js` only when a pressure source exists. Today the browser has none.

Total tests in CI: Kotlin 29 legacy assertions plus 4 JUnit tests (2 legacy and sweep wrappers, 2 robustness); node 38.
