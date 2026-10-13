/**
 * List the platform's MetaApi hosted accounts (masked) — checks slot usage
 * and stale duplicates. Run: bun scripts/list-accounts.mjs
 */
const token = (process.env.METAAPI_TOKEN ?? "").trim();
const base = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const r = await fetch(base + "/users/current/accounts", {
  headers: { "auth-token": token, Accept: "application/json" },
});
console.log("HTTP", r.status);
const text = await r.text();
try {
  const list = JSON.parse(text);
  console.log("Total hosted accounts:", Array.isArray(list) ? list.length : "?");
  for (const a of Array.isArray(list) ? list : []) {
    const id = String(a._id ?? a.id ?? "?");
    console.log(
      ` - ${a.login}@${a.server} | ${a.platform ?? "mt5"} | ${a.type ?? "?"} | ${a.state ?? "?"} | ${a.connectionStatus ?? "?"} | id ${id.slice(0, 8)}…`,
    );
  }
} catch {
  console.log(text.slice(0, 400));
}
