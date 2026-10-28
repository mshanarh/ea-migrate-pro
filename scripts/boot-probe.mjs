import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:5173/app/home";
const MODE = process.argv[3] ?? "online"; // online | offline | slow
const WAIT = 25000;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const [BASE_MODE, FLAG] = MODE.split("-");

// "…-session" boots with a saved session, so /app/home's guard actually has
// to ask the cloud — the case where a hanging access check used to spin.
if (FLAG === "session") {
  await context.addInitScript(() => {
    const state = {
      email: "boot@test.com",
      activeRobotId: "r1",
      robots: [
        {
          id: "r1",
          name: "Apex Sniper Pro V6+",
          key: "TEST-KEY-123",
          symbols: ["XAUUSD"],
          image: "/logo.png",
          running: false,
        },
      ],
      mt: null,
      settings: {
        background: "Neon Grid",
        backgroundEnabled: true,
        interfaceStyle: "crimson_navigator",
        font: "Inter",
        accent: 60,
        accentColor: "#FF3B3B",
        brandName: "EA Migrate",
        lotSize: "0.01",
      },
    };
    try {
      window.localStorage.setItem("eamp.app.v3", JSON.stringify(state));
      window.localStorage.setItem("eamp.access-epoch.v1", "3");
      window.localStorage.setItem("app_epoch", "v5_activation_code_20261004");
      window.localStorage.setItem("eamp.device.id", "probe-device");
    } catch {}
  });
}

const consoleLines = [];
const errors = [];
const requests = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(String(e) + "\n" + (e.stack || "")));
page.on("requestfailed", (r) =>
  requests.push(`FAILED ${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.url().includes("/api/")) requests.push(`${r.status()} ${r.url().slice(0, 120)}`);
});

if (BASE_MODE === "slow") {
  await context.route("**/*", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
}
if (BASE_MODE === "offline") {
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/scalper/**", (route) => route.abort("internetdisconnected"));
}
if (BASE_MODE === "hang") {
  // Every API request never answers — the worst case: the gate can never decide.
  await page.route("**/api/**", () => new Promise(() => {}));
}

const t0 = Date.now();
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
  console.log("goto error:", String(e));
});

let reached = null;
let snapshot = "";
for (let t = 0; t < WAIT; t += 200) {
  const info = await page
    .evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      return {
        url: location.pathname + location.search,
        text: text.slice(0, 200),
        splash: /Loading…/.test(text),
        retry: /Could not verify access|TAP TO RETRY/i.test(text),
        boot: document.documentElement.getAttribute("data-app-boot"),
        pills: !!document.querySelector("[data-testid=scalper-status-pill]"),
        spinner: !!document.querySelector(".animate-spin"),
        html: (document.body?.innerHTML || "").slice(0, 220),
      };
    })
    .catch((e) => ({ err: String(e) }));
  snapshot = JSON.stringify(info);
  const painted =
    info &&
    !info.err &&
    !info.splash &&
    (info.retry || (info.text && info.text.length > 0));
  if (painted) {
    reached = { ms: Date.now() - t0, info };
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}

console.log("MODE:", MODE, "URL:", URL);
console.log("RESULT:", reached ? `screen at ${reached.ms}ms` : `STILL SPLASH after ${WAIT}ms`);
console.log("snapshot:", snapshot);
console.log("--- page errors ---");
console.log(errors.join("\n") || "(none)");
console.log("--- console (last 30) ---");
console.log(consoleLines.slice(-30).join("\n"));
console.log("--- api/network ---");
console.log(requests.join("\n") || "(none)");
await browser.close();
