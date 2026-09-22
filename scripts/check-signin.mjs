/**
 * Sign-in diagnostic — checks whether an email exists in the shared store and
 * reports ONLY metadata (exists? password set? role/status? password length).
 * Never prints the password itself.
 * Run: bun scripts/check-signin.mjs <email>
 */
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.log("Usage: bun scripts/check-signin.mjs <email>");
  process.exit(1);
}
const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
if (!url || !token) {
  console.log("RESULT: FAIL — Upstash not configured");
  process.exit(1);
}
const response = await fetch(`${url}/hget/eamp%3Aaccounts/${encodeURIComponent(email)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  console.log("RESULT: FAIL — HTTP", response.status);
  process.exit(1);
}
const payload = await response.json();
const raw = payload?.result;
if (typeof raw !== "string" || raw.length === 0) {
  console.log(`Account ${email}: NOT FOUND in the shared store`);
  console.log("RESULT: MISSING — this record never reached the cloud (old sync bug era).");
  process.exit(0);
}
try {
  const account = JSON.parse(raw);
  console.log(`Account ${email}: FOUND`);
  console.log("  role:", account.role, "| status:", account.status);
  console.log("  password set:", typeof account.password === "string" && account.password.length > 0, "| length:", String(account.password ?? "").length);
  console.log("  eas:", Array.isArray(account.eas) ? account.eas.length : 0, "| licenses:", Array.isArray(account.licenses) ? account.licenses.length : 0);
  console.log("  createdAt:", account.createdAt ?? "(unknown)");
} catch {
  console.log("RESULT: FAIL — record malformed");
}
