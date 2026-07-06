// End-to-end smoke test: expects `npm run build` done and the server running
// on :8080. Drives headless Chromium through the real login flow, walks
// around, toggles panels, and fails on any page error, console error, or a
// blank 3D view. Saves screenshots so the rendered game can be eyeballed.
//
//   npm run build && SAVE_PATH=/tmp/smoke.json npx tsx server/index.ts &
//   node tools/smoke-test.mjs

import { chromium } from "playwright";

const URL = process.env.URL ?? "http://localhost:8080";
const SHOT = process.env.SHOT ?? "smoke.png";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const problems = [];
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.fill("#name", "SmokeTester");
await page.click("#play");

// Let the world stream in and render.
await page.waitForTimeout(5000);

// The start overlay must be gone and the HUD populated.
const overlayHidden = await page.$eval("#start", (el) => el.classList.contains("hidden"));
const skillRows = await page.$$eval("#skills .skill-row", (rows) => rows.length);
const healthText = await page.$eval("#health span", (el) => el.textContent ?? "");

// Close the help, walk forward for a second (exercises physics + move sync).
await page.keyboard.press("KeyH");
await page.keyboard.down("KeyW");
await page.waitForTimeout(1000);
await page.keyboard.up("KeyW");
await page.waitForTimeout(400);

// A world region with no HUD over it: blank = tiny PNG, rendered scene = big.
const clipShot = await page.screenshot({ clip: { x: 340, y: 60, width: 600, height: 400 } });
await page.screenshot({ path: SHOT });

// Toggle the crafting and equipment panels (each shows, then hides).
for (const key of ["KeyC", "KeyC", "KeyE", "KeyE"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);

await browser.close();

console.log(`overlay hidden: ${overlayHidden}`);
console.log(`skill rows: ${skillRows}, health: "${healthText.trim()}"`);
console.log(`world-view screenshot bytes: ${clipShot.length} (blank would be < 8000)`);
if (problems.length) {
  console.log("--- page problems ---");
  for (const p of [...new Set(problems)].slice(0, 12)) console.log(" ", p);
}

const pass = overlayHidden && skillRows >= 10 && clipShot.length > 8000 && problems.length === 0;
console.log(pass ? "SMOKE TEST PASS" : "SMOKE TEST FAIL");
process.exit(pass ? 0 : 1);
