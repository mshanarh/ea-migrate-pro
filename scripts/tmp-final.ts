/** TEMPORARY (deleted after use): print the exact error text a caller receives. */
import { sendMail } from "../src/lib/mailjet.server";

const saved = { ...process.env };

console.log("=== 1. missing MAILJET_API_KEY ===");
delete process.env["MAILJET_API_KEY"];
console.log(JSON.stringify(await sendMail({ to: "x@y.invalid", subject: "s", html: "h", text: "t" })));
process.env["MAILJET_API_KEY"] = saved["MAILJET_API_KEY"]!;

console.log("\n=== 2. bad credentials (real Mailjet 401) ===");
process.env["MAILJET_API_KEY"] = "invalid";
process.env["MAILJET_SECRET_KEY"] = "invalid";
const r = await sendMail({ to: "x@y.invalid", subject: "s", html: "h", text: "t" });
console.log(r.ok ? "ok:true" : "error: " + String(r.error).slice(0, 200));

console.log("\n=== 3. valid credentials (happy path) ===");
process.env["MAILJET_API_KEY"] = saved["MAILJET_API_KEY"]!;
process.env["MAILJET_SECRET_KEY"] = saved["MAILJET_SECRET_KEY"]!;
const ok = await sendMail({
  to: "probe.final.check@eamigratepro.invalid",
  subject: "EA Migrate Pro final check",
  html: "<p>final</p>",
  text: "final",
});
console.log(ok.ok ? "ok:true (MessageID logged above)" : "error: " + String(ok.error).slice(0, 160));