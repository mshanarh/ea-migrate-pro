/**
 * Patient probe: POST a disposable cloud-g2 account and retry with the SAME
 * transaction-id until MetaApi finishes broker validation (202 → 200/201),
 * up to ~100s. Deletes the account afterwards. Masks everything secret.
 * Run: bun scripts/verify-new-key.mjs
 */
const token = (process.env.METAAPI_TOKEN ?? "").trim();
if (!token) {
  console.log("RESULT: FAIL — METAAPI_TOKEN missing");
  process.exit(1);
}
const crypto = await import("node:crypto");
const base = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const transactionId = crypto.randomUUID().replace(/-/g, "");
const headers = {
  "auth-token": token,
  Accept: "application/json",
  "Content-Type": "application/json",
  "transaction-id": transactionId,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("POST /users/current/accounts (retrying while validation runs)…");
const deadline = Date.now() + 100_000;
let accountId = null;
let lastStatus = 0;
let lastMessage = "";
for (let attempt = 1; Date.now() < deadline; attempt += 1) {
  const res = await fetch(base + "/users/current/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      login: "8700123",
      password: "TestPassword1!",
      server: "Headway-Demo",
      platform: "mt5",
      type: "cloud-g2",
      reliability: "regular",
      region: "new-york",
      magic: 100003,
      name: "key-verification-probe",
    }),
  });
  const text = await res.text().catch(() => "");
  lastStatus = res.status;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep */
  }
  lastMessage = String(parsed?.message ?? text).slice(0, 160);
  const id = parsed?._id ?? parsed?.id ?? parsed?.accountId;
  if (res.ok && typeof id === "string" && id.length > 0) {
    accountId = id;
    console.log(`  attempt ${attempt}: HTTP ${res.status} — created id ${id.slice(0, 8)}…`);
    break;
  }
  console.log(`  attempt ${attempt}: HTTP ${res.status} — ${lastMessage}`);
  const wait = Math.min(Number(/retry in (\d+)/i.exec(lastMessage)?.[1] ?? 8) + 2, 15) * 1000;
  await sleep(wait);
}

if (!accountId) {
  console.log(`RESULT: FAIL — account never materialized (last HTTP ${lastStatus}: ${lastMessage})`);
  process.exit(1);
}

const list = await fetch(base + "/users/current/accounts", { headers });
let count = "?";
try {
  count = JSON.parse(await list.text()).length;
} catch {
  /* keep */
}
console.log("GET /users/current/accounts ->", list.status, "| total hosted:", count);

const del = await fetch(`${base}/users/current/accounts/${accountId}`, {
  method: "DELETE",
  headers,
});
console.log("DELETE cleanup ->", del.status);
console.log("RESULT: OK — new key creates hosted accounts end-to-end");
