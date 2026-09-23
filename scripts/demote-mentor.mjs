/**
 * One-off repair: demote the designated email to a plain mentor in the shared
 * store (kept for future role repairs of other emails). Masks everything.
 * Run: bun scripts/demote-mentor.mjs <email>
 */
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.log("Usage: bun scripts/demote-mentor.mjs <email>");
  process.exit(1);
}
const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
if (!url || !token) {
  console.log("RESULT: FAIL — Upstash not configured");
  process.exit(1);
}
const get = await fetch(`${url}/hget/eamp%3Aaccounts/${encodeURIComponent(email)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const payload = await get.json();
const raw = payload?.result;
if (typeof raw !== "string") {
  console.log("Record not found — nothing to demote. RESULT: OK (already absent)");
  process.exit(0);
}
const account = JSON.parse(raw);
const wasRole = account.role;
account.role = "mentor";
if (account.status !== "approved") account.status = "approved";
const set = await fetch(`${url}/hset/eamp%3Aaccounts/${encodeURIComponent(email)}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(account),
});
console.log(`Record ${email.slice(0, 3)}***@${email.split("@")[1] ?? "***"}: ${wasRole} -> mentor`);
console.log(set.ok ? "RESULT: OK — stored record demoted" : "RESULT: FAIL — write rejected");
