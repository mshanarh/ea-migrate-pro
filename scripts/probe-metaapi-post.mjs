/**
 * POST-permission probe — checks whether METAAPI_TOKEN is accepted for POST
 * (account creation), not just GET. Uses an intentionally INVALID body so no
 * account is created (expected 400 if the token can write, 401/403 if it
 * cannot). Never prints the token; prints a masked fingerprint instead.
 * Run: bun scripts/probe-metaapi-post.mjs
 */
const token = (process.env.METAAPI_TOKEN ?? "").trim();
if (!token) {
  console.log("RESULT: FAIL — METAAPI_TOKEN missing");
  process.exit(1);
}
const base = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const crypto = await import("node:crypto");
const hash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 10);
console.log("Token fingerprint: len=" + token.length + " sha256:" + hash);

// 1) GET baseline (known-good earlier)
const get = await fetch(base + "/users/current/accounts", {
  headers: { "auth-token": token, Accept: "application/json" },
});
console.log("1) GET /users/current/accounts ->", get.status);

// 2) POST with deliberately INVALID body — creates nothing.
//    400 => token accepted for writes (reaches validation)
//    401/403 => token rejected for writes (read-only scope)
const post = await fetch(base + "/users/current/accounts", {
  method: "POST",
  headers: {
    "auth-token": token,
    Accept: "application/json",
    "Content-Type": "application/json",
    "transaction-id": "diag-" + Date.now(),
  },
  body: JSON.stringify({
    login: "",
    password: "",
    server: "",
    platform: "mt5",
    type: "cloud-g2",
    region: "new-york",
    name: "diag",
  }),
});
const postText = await post.text().catch(() => "");
console.log("2) POST /users/current/accounts (invalid body) ->", post.status);
console.log("   says:", postText.slice(0, 200));

if (get.status === 200 && post.status === 400) {
  console.log("RESULT: OK — token has read AND write permission. 401 in the app is not this token.");
  process.exit(0);
}
if (post.status === 401 || post.status === 403) {
  console.log("RESULT: FAIL — token is READ-ONLY for POST. Generate a full-access copy at app.metaapi.cloud and replace METAAPI_TOKEN.");
} else {
  console.log("RESULT: UNEXPECTED — see statuses above.");
}
process.exit(1);
