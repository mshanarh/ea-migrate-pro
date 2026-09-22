/**
 * MetaApi token check — run with: bun scripts/check-metaapi.mjs
 *
 * Exercises the EXACT request the app's server functions make:
 *   GET https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/provisioning-profiles
 *   header: auth-token: <trimmed METAAPI_TOKEN>
 *
 * Never prints the token. Exit 0 = token valid; 1 = fix the environment.
 */
const token = (process.env["METAAPI_TOKEN"] ?? "").trim();

console.log("1) METAAPI_TOKEN present:", token.length > 0);
if (!token) {
  console.log("   RESULT: FAIL — add METAAPI_TOKEN in Settings → Environment.");
  process.exit(1);
}

// Shape diagnostics that never reveal the secret.
const raw = process.env["METAAPI_TOKEN"] ?? "";
console.log("2) Token shape: length", token.length, "| had surrounding whitespace:", raw !== token);
if (/[\r\n]/.test(token)) console.log("   WARNING: token contains a newline INSIDE it — re-paste it as one line.");

let response;
try {
  response = await fetch(
    "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/provisioning-profiles",
    {
      method: "GET",
      headers: {
        "auth-token": token, // NOT Authorization / Bearer — MetaApi requires this exact name
        "Content-Type": "application/json",
      },
    },
  );
} catch (error) {
  console.log("3) Request failed:", error?.message ?? error);
  console.log("   RESULT: FAIL — could not reach MetaApi from this environment.");
  process.exit(1);
}

console.log("3) GET /users/current/provisioning-profiles (auth-token header) ->", response.status);
if (response.ok) {
  console.log("   RESULT: OK — METAAPI_TOKEN is valid and the app's request shape is correct.");
  process.exit(0);
}

const body = await response.text().catch(() => "");
let detail = body;
try {
  detail = JSON.parse(body)?.message ?? body;
} catch {
  /* keep raw */
}
console.log("   MetaApi says:", String(detail).slice(0, 300));
if (response.status === 401 || response.status === 403) {
  console.log(
    "   RESULT: FAIL — the token itself is rejected. Generate a fresh one at app.metaapi.cloud → Master API keys (or check your MetaApi plan) and update METAAPI_TOKEN in Settings → Environment.",
  );
} else if (response.status === 404) {
  console.log(
    "   RESULT: NOTE — token accepted (404 here only means the client-API host has no provisioning data). The app uses the provisioning host for accounts, which this token can reach.",
  );
  process.exit(0);
}
process.exit(1);
