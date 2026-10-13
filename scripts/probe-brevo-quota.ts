/**
 * DOES THE BREVO ACCOUNT STILL HAVE ANY SENDING CREDIT?
 *
 * `/account` reported `plan: [{ type: "free", credits: 0, creditsType:
 * "sendLimit" }]`. A `credits: 0` on a free plan is the one state in which
 * Brevo keeps ACCEPTING messages — answering 201, so every log in this app
 * says "sent" — while having nothing left to actually relay. That matches the
 * symptom exactly: no error anywhere, and nothing arrives.
 *
 * This prints the account, quota and mail-template views verbatim so the
 * number is read rather than inferred, and does a real transactional send so
 * the response body is on the record too.
 *
 * Run: bun scripts/probe-brevo-quota.ts
 */
const BREVO = "https://api.brevo.com/v3";
const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY is not set.");
  process.exit(1);
}

async function show(label: string, path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${BREVO}${path}`, {
      ...init,
      headers: { accept: "application/json", "api-key": apiKey, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text().catch(() => "");
    console.log(`\n── ${label}  (${path})\nHTTP ${response.status}\n${text.slice(0, 1500)}`);
    return { status: response.status, text };
  } catch (error) {
    console.log(`\n── ${label}\nERROR ${error instanceof Error ? error.message : String(error)}`);
    return { status: 0, text: "" };
  }
}

await show("ACCOUNT (full)", "/account");
await show("ORGANISATION QUOTAS", "/organization/quotas");
await show("SMTP TEMPLATES", "/smtp/template?limit=5");
await show("TRANSACTIONAL EMAIL STATS", "/smtp/emailStatistics");

/* A real send, to the account's own address, so the response body says whether
 * Brevo is queueing or refusing. The recipient is NOT printed with its address
 * echoed back beyond what the API returns. */
const to = process.env["BREVO_PROBE_TO"] ?? "biyasentobeko222@gmail.com";
await show("LIVE SEND to the account address", "/smtp/email", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sender: {
      name: "EA Migrate",
      email: process.env["BREVO_SENDER_EMAIL"] ?? "eamigratepro@gmail.com",
    },
    to: [{ email: to }],
    subject: "EA Migrate delivery check",
    textContent: "This is a delivery check. If you are reading it, mail is being delivered.",
  }),
});
