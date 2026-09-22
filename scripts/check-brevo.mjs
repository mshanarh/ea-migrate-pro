/**
 * Brevo integration check — run with: bun scripts/check-brevo.mjs
 *
 * Verifies, without ever printing the key value:
 *   1. BREVO_API_KEY is present in the environment.
 *   2. The key type is the v3 REST kind (xkeysib-…), not the SMTP-relay kind
 *      (xsmtpsib-…), which the /v3/smtp/email endpoint rejects.
 *   3. The key authenticates against GET /v3/account.
 *   4. The app's sender (eamigratepro@gmail.com) exists and is verified.
 *
 * Exit code 0 = all good; 1 = something needs fixing.
 */

const SENDER_EMAIL = "eamigratepro@gmail.com";

const key = (process.env["BREVO_API_KEY"] ?? "").trim();
console.log("1) BREVO_API_KEY present:", key.length > 0);
if (key.length === 0) {
  console.log("   RESULT: FAIL — add the key in Settings → Environment.");
  process.exit(1);
}

const keyType = key.startsWith("xkeysib-")
  ? "xkeysib (v3 REST API key — correct)"
  : key.startsWith("xsmtpsib-")
    ? "xsmtpsib (SMTP relay key — WRONG for the /v3 REST API)"
    : "unrecognised prefix";
console.log("2) Key type:", keyType);
if (!key.startsWith("xkeysib-")) {
  console.log("   RESULT: FAIL — generate a v3 API key in Brevo (SMTP & API → API Keys).");
  process.exit(1);
}

// Shape diagnostics that never reveal the secret itself.
const raw = process.env["BREVO_API_KEY"] ?? "";
console.log("2b) Key shape: length", key.length, "(xkeysib keys are ~88 chars)");
if (raw !== key) console.log("    Note: value had surrounding whitespace — it was trimmed for this test.");
if (/\s/.test(key)) console.log("    WARNING: the value contains spaces/newlines INSIDE it — re-paste the key without line breaks.");
if (key.length < 60) console.log("    WARNING: the value looks short — it may be a truncated paste.");

let account;
try {
  const response = await fetch("https://api.brevo.com/v3/account", {
    headers: { "api-key": key, accept: "application/json" },
  });
  console.log("3) GET /v3/account ->", response.status);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.message ?? body;
    } catch {
      /* keep raw */
    }
    console.log("   Brevo says:", String(detail).slice(0, 300));
    if (/revoked|invalid|unauthor/i.test(String(detail))) {
      console.log("   RESULT: FAIL — Brevo does not recognise this key. Generate a fresh one (SMTP & API → API Keys → Generate new key), copy it fully, and replace BREVO_API_KEY in Settings → Environment.");
    }
    process.exit(1);
  }
  account = (await response.json()) ?? {};
  console.log("   Authenticated as Brevo account:", account.email ?? "(unknown)");
} catch (error) {
  console.log("3) Network request failed:", error?.message ?? error);
  console.log("   RESULT: FAIL — could not reach api.brevo.com from this environment.");
  process.exit(1);
}

let senderOk = false;
try {
  const response = await fetch("https://api.brevo.com/v3/senders", {
    headers: { "api-key": key, accept: "application/json" },
  });
  console.log("4) GET /v3/senders ->", response.status);
  if (response.ok) {
    const data = (await response.json()) ?? {};
    const senders = Array.isArray(data.senders) ? data.senders : [];
    const match = senders.find((sender) => String(sender.email ?? "").toLowerCase() === SENDER_EMAIL);
    if (match) {
      senderOk = match.verified === true;
      console.log(`   Sender ${SENDER_EMAIL}: ${match.verified ? "verified ✓" : "NOT verified ✗"}`);
    } else {
      console.log(`   Sender ${SENDER_EMAIL}: not found in the senders list ✗`);
    }
  }
} catch (error) {
  console.log("4) Sender lookup failed:", error?.message ?? error);
}
if (!senderOk) {
  console.log(`   RESULT: PARTIAL — key works, but add/verify ${SENDER_EMAIL} under Brevo → Senders & IP, or Brevo will reject outgoing mail.`);
  process.exit(1);
}

console.log("RESULT: OK — key and sender are ready for the approval emails.");
