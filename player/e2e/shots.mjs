// CI only. Playwright run of the demo page: user stories, QA cases, and before/after
// screenshots at desktop and 360 px. Not meant to run on the laptop.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] || "docs/review-2026-11-25/shots";
fs.mkdirSync(outDir, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "text/plain" });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/demo/index.html`;

const overseas = JSON.stringify({
  id: "T 300", from: "DDD", to: "EEE", fromFull: "Delta Field", toFull: "Echo Field",
  dep: "14:00", board: "14:00", seat: "00A", mins: 120, km: 900, depH: 14, depM: 0,
  wps: [
    { km: 0, la: 51, lo: -1, n: "Delta", s: "Testland", t: "Synthetic waypoint." },
    { km: 450, la: 52.5, lo: 5, n: "Mid", s: "Testland", t: "Synthetic waypoint." },
    { km: 900, la: 54, lo: 11, n: "Echo", s: "Testland", t: "Synthetic waypoint." },
  ],
});

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${detail}`);
  if (!cond) failures++;
}

const browser = await chromium.launch();
for (const [label, vp] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 360, height: 740 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // story 1: fresh first run, 2 tabs, numbers from the timer
  await page.goto(url);
  check(`${label}: first run shows 2 flights`, (await page.locator("button.tab").count()) === 2);
  check(`${label}: badge says timer`, (await page.locator("#badge").innerText()) === "timer");
  await page.screenshot({ path: path.join(outDir, `flights-before-${label}.png`) });

  // story 2: import a non-India flight, a third tab appears and plays
  await page.fill("#import-text", overseas);
  await page.click("#import-btn");
  check(`${label}: import adds a 3rd tab`, (await page.locator("button.tab").count()) === 3);
  check(`${label}: new tab is selected`, (await page.locator("#leg-title").innerText()) === "T 300");
  await page.reload();
  check(`${label}: saved flight survives reload`, (await page.locator("button.tab").count()) === 3);

  // story 3: recorded trace says takeoff was 17 minutes late
  await page.selectOption("#mode", "replay");
  check(`${label}: badge says recorded trace`, (await page.locator("#badge").innerText()) === "recorded trace");
  const off = await page.locator("#offset").innerText();
  check(`${label}: offset shows about 17 min`, /\+17 min/.test(off), off);
  await page.screenshot({ path: path.join(outDir, `flights-after-${label}.png`) });

  // QA: no sideways scroll at this width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}`);

  // QA: bad input is an error message, not a crash
  await page.fill("#import-text", "{not json");
  await page.click("#import-btn");
  check(`${label}: invalid JSON shows an error`, (await page.locator("#errors").innerText()).includes("not valid JSON"));
  await page.fill("#import-text", JSON.stringify({ id: "X" }));
  await page.click("#import-btn");
  check(`${label}: invalid flight lists problems`, (await page.locator("#errors").innerText()).includes("must be"));

  // QA: delete saved flights
  await page.click("#reset-btn");
  check(`${label}: remove saved goes back to 2 tabs`, (await page.locator("button.tab").count()) === 2);

  // QA: corrupt storage still loads the built-in flights
  await page.evaluate(() => localStorage.setItem("flightradar.flights", "{broken"));
  await page.reload();
  check(`${label}: corrupt storage keeps 2 built-in tabs`, (await page.locator("button.tab").count()) === 2);
  check(`${label}: corrupt storage is reported`, (await page.locator("#errors").innerText()).length > 0);
  check(`${label}: no page errors`, errors.length === 0, errors.join(";"));
  await ctx.close();
}
await browser.close();
server.close();

for (const f of fs.readdirSync(outDir)) {
  const size = fs.statSync(path.join(outDir, f)).size;
  check(`shot ${f} under 300 KB`, size < 300 * 1024, `${Math.round(size / 1024)} KB`);
}
process.exit(failures ? 1 : 0);
