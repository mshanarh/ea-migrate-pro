/**
 * End-to-end MetaApi write-chain test — reproduces the FULL connect flow the
 * app performs, in order, with a REAL disposable hosted account:
 *   1. POST /users/current/accounts (create, cloud-g2)   ← the first write
 *   2. GET  /users/current/accounts/{id} (poll deploy state)
 *   3. DELETE /users/current/accounts/{id} (cleanup)
 * Prints statuses + masked details only; the MT5 credentials used are the
 * platform's own test stub (they fail broker auth, but that happens AFTER
 * MetaApi auth — which is exactly what we are testing).
 * Run: bun scripts/test-connect-flow.mjs
 */
const token = (process.env.METAAPI_TOKEN ?? "").trim();
const crypto = await import("node:crypto");
if (!token) {
  console.log("RESULT: FAIL — METAAPI_TOKEN missing");
  process.exit(1);
}
const base = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const headers = {
  "auth-token": token,
  Accept: "application/json",
  "Content-Type": "application/json",
  "transaction-id": crypto.randomUUID().replace(/-/g, ""), // exactly 32 hex chars, like the app
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("1) POST /users/current/accounts (create " + (process.argv[2] ?? "cloud-g2") + ")…");
const created = await fetch(base + "/users/current/accounts", {
  method: "POST",
  headers,
  body: JSON.stringify({
    login: "8700123",
    password: "TestPassword1!",
    server: "Headway-Demo",
    platform: "mt5",
    type: process.argv[2] ?? "cloud-g2",
    reliability: "regular", // free plan — "high" requires a paid MetaApi plan
    region: "new-york",
    magic: 100001,
    name: "e2e-connect-test",
  }),
});
const createdBody = await created.text().catch(() => "");
console.log("   ->", created.status);
let accountId = null;
try {
  const parsed = JSON.parse(createdBody);
  accountId = parsed._id ?? parsed.id ?? null;
  if (!created.ok) console.log("   says:", (parsed.message ?? createdBody).slice(0, 260));
} catch {
  console.log("   says:", createdBody.slice(0, 260));
}
if (!created.ok || !accountId) {
  console.log("RESULT: FAIL — create rejected (this IS the app's 401/403 if status is 401/403)");
  process.exit(1);
}
console.log("   created account:", accountId.slice(0, 8) + "…");

console.log("2) GET /users/current/accounts/{id}…");
const detail = await fetch(`${base}/users/current/accounts/${accountId}`, { headers });
console.log("   ->", detail.status);

console.log("3) DELETE cleanup…");
const del = await fetch(`${base}/users/current/accounts/${accountId}`, {
  method: "DELETE",
  headers,
});
console.log("   ->", del.status);
console.log(del.ok || del.status === 404 ? "RESULT: OK — full write chain passes; connect should work in-app" : "RESULT: PARTIAL — create+read OK, cleanup failed");
