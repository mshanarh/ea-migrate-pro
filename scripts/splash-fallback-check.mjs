/**
 * Proves the shell's boot watchdog: load the built SPA shell in jsdom WITHOUT
 * running the app bundle (exactly the "hydration never happened" case) and
 * confirm the black splash is replaced by the retry card inside 8 seconds.
 *
 * Usage: node scripts/splash-fallback-check.mjs [dist/index.html]
 */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";

const file = process.argv[2] ?? "dist/index.html";
const html = fs.readFileSync(file, "utf8");
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});

const dom = new JSDOM(html, {
  url: "https://eamigratepro.vercel.app/app/home",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

const splashAtStart = window.document.body.textContent?.includes("Loading") ?? false;
console.log(`splash rendered in the shell at t=0: ${splashAtStart}`);

// A mounted app stamps data-app-boot before the watchdog fires; pass the file
// again with `--booted` to check the watchdog then leaves the screen alone.
const booted = process.argv.includes("--booted");
if (booted) {
  window.document.documentElement.setAttribute("data-app-boot", "1");
  console.log("stamped data-app-boot=1 at t=0 (app mounted)");
}

await new Promise((resolve) => setTimeout(resolve, 8_600));

const text = window.document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";

if (booted) {
  const stillSplash = /Loading…/.test(text);
  console.log(`splash untouched while booted: ${stillSplash}`);
  process.exit(stillSplash ? 0 : 1);
}
console.log(`body text at t=8.6s: ${text.slice(0, 160)}`);
const hasRetry = /Could not verify access/i.test(text) && /TAP TO RETRY/i.test(text);
console.log(`retry card shown: ${hasRetry}`);
console.log(`splash still on screen: ${/Loading…/.test(text)}`);
process.exit(hasRetry && !/Loading…/.test(text) ? 0 : 1);
