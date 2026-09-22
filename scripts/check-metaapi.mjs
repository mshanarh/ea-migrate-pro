/**
 * MetaApi token check — run with: bun scripts/check-metaapi.mjs
 *
 * Probes, without ever printing the token:
 *   1. The app's REAL endpoint: provisioning API host + auth-token header
 *      (this is what connect/list/status/trade actually use — the verdict).
 *   2. The user-spec URL mt-client-api-v1.agiliumtrade.agiliumtrade.ai —
 *      informational: that host currently serves an expired Kubernetes
 *      placeholder certificate and is NOT a real MetaApi API host (real
 *      client hosts are regional: mt-client-api-v1.<region>.agiliumtrade.ai).
 *
 * Exit 0 = token valid for the app; 1 = fix the environment.
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
console.log("   Token starts with:", token.slice(0, 3) === "ey" ? "ey… (JWT — correct MetaApi format)" : "(unrecognised prefix)");

async function probe(label, url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "auth-token": token, // NOT Authorization / Bearer — MetaApi requires this exact name
        "Content-Type": "application/json",
      },
    });
    const body = await response.text().catch(() => "");
    let detail = body;
    try {
      detail = JSON.parse(body)?.message ?? body;
    } catch {
      /* keep raw */
    }
    console.log(`${label} -> HTTP ${response.status}`);
    if (response.ok) return { ok: true, detail };
    console.log("   MetaApi says:", String(detail).slice(0, 220));
    return { ok: false, status: response.status, detail };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? error?.message ?? String(error);
    console.log(`${label} -> TRANSPORT FAIL (${code})`);
    return { ok: false, transport: code };
  }
}

// 1) The endpoint every app server function actually calls.
const provisioning = await probe(
  "3) GET mt-provisioning-api-v1…/users/current/accounts (auth-token header — what the app uses)",
  "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts",
);

// 2) Informational: the URL from the bug report — expect a TLS failure here.
await probe(
  "4) GET mt-client-api-v1.agiliumtrade…/users/current/provisioning-profiles (spec URL — informational)",
  "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/provisioning-profiles",
);

if (provisioning.ok) {
  console.log("RESULT: OK — METAAPI_TOKEN is valid; Connect and live trading will work.");
  process.exit(0);
}
if (provisioning.status === 401 || provisioning.status === 403) {
  console.log(
    "   RESULT: FAIL — MetaApi rejects this token. Generate a fresh master API key at app.metaapi.cloud and update METAAPI_TOKEN in Settings → Environment.",
  );
} else {
  console.log("   RESULT: FAIL — see the error above.");
}
process.exit(1);
