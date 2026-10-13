// Screenshot helper: ORIGINAL Angular app (:4200, API :5123) vs NEW React app (:5173, API :5200). Logs in as the demo user first.
//
//   SHOT_APP=ref|new            which app
//   SHOT_PATH=/{P}/dashboard    route to capture; {P} is replaced with the seeded "Demo Plaza" project id
//   SHOT_OUT=/abs/path.png      output file (default tools/visual-compare/out/<app>.png)
//   SHOT_DARK=1                 dark mode (sets localStorage theme=dark before load)
//   SHOT_W=1440 SHOT_H=900      viewport
//   SHOT_CLICK="Button text"    click the first element containing this text before capturing (e.g. open a dialog)
//   SHOT_EVAL="js"              evaluate JS in the page before capturing
//   SHOT_WAIT=1500              extra settle time (ms)
//
//   node ~/.claude/skills/browser-automation/browser.mjs http://localhost:4200/login --script tools/visual-compare/shot.mjs   (ref)
//   node ~/.claude/skills/browser-automation/browser.mjs http://localhost:5173/login --script tools/visual-compare/shot.mjs   (new)
//
// Prereqs: both APIs running on a dev database seeded with `npm run db:seed-demo` (BetterPlacemaking.SERVER.EXPRESS). Login: demo@example.com / DemoPass123!
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function findProjectId(api) {
  const login = await fetch(`${api}/api/login/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@example.com", password: "DemoPass123!" }),
  }).then((r) => r.json());
  const projects = await fetch(`${api}/api/project`, { headers: { Authorization: `Bearer ${login.Token}` } }).then((r) => r.json());
  return projects.find((p) => p.Title === "Demo Plaza")?.Id ?? projects[0]?.Id;
}

export default async function run(page) {
  const app = process.env.SHOT_APP === "ref" ? "ref" : "new";
  const base = app === "ref" ? "http://localhost:4200" : "http://localhost:5173";
  const api = app === "ref" ? "http://localhost:5123" : "http://localhost:5200";
  const out = process.env.SHOT_OUT || path.join(HERE, "out", `${app}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.setViewportSize({ width: Number(process.env.SHOT_W || 1440), height: Number(process.env.SHOT_H || 900) });

  let route = process.env.SHOT_PATH || "/projects";
  if (route.includes("{P}")) route = route.replaceAll("{P}", await findProjectId(api));

  const setTheme = () =>
    process.env.SHOT_DARK ? page.evaluate(() => localStorage.setItem("theme", "dark")) : page.evaluate(() => localStorage.removeItem("theme"));
  await setTheme();

  if (!route.startsWith("/login") && !route.startsWith("/forgot-password")) {
    await page.goto(base + "/login", { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(800);
    const pw = page.locator('input[type="password"]');
    if (await pw.count()) {
      const inputs = await page.locator("input").all();
      await inputs[0].fill("demo@example.com");
      await pw.first().fill("DemoPass123!");
      await page.getByRole("button", { name: /sign in/i }).first().click();
      await page.waitForTimeout(2200);
    }
    await setTheme();
  }

  await page.goto(base + route, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(Number(process.env.SHOT_WAIT || 1800));

  if (process.env.SHOT_CLICK) {
    await page.getByText(process.env.SHOT_CLICK, { exact: false }).first().click().catch((e) => console.log("click failed:", e.message));
    await page.waitForTimeout(800);
  }
  if (process.env.SHOT_EVAL) {
    await page.evaluate(process.env.SHOT_EVAL);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: out });
  return { app, url: page.url(), out };
}
