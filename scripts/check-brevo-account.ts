/**
 * IS THE BREVO ACCOUNT ITSELF ABLE TO SEND?
 *
 * The symptom is now unambiguous and account-wide: activation codes, licence
 * keys and admin broadcasts ALL report "sent" and NONE of them arrive —
 * including two hand-built messages that went through nothing but the raw
 * Brevo API. That rules out this application's code. A 201 means Brevo accepted
 * the message; it says nothing about whether Brevo then attempts delivery.
 *
 * The things that make an account accept and never deliver:
 *   • the account is SUSPENDED (unpaid invoice, or automated review) — this is
 *     the classic one, and it looks exactly like "works, nothing arrives"
 *   • the daily sending quota is spent
 *   • the account is still in trial and never converted
 *
 * So this asks the account about itself, and then uses Brevo's OWN test-mail
 * endpoint — `POST /v3/smtp/sendSmtpTest`, which bypasses this app entirely and
 * delivers to the account's own address. If Brevo's own test cannot arrive,
 * nothing this repository does will arrive either, and that is the answer.
 *
 * Run: bun scripts/check-brevo-account.ts
 */
const BREVO = "https://api.brevo.com/v3";
const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY is not set.");
  process.exit(1);
}

async function get(path: string) {
  const response = await fetch(`${BREVO}${path}`, {
    headers: { accept: "application/json", "api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text().catch(() => "");
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 300) } };
  }
}

async function main() {
  /* 1. What does the account say about itself? */
  const account = await get("/account");
  if (account.status === 200) {
    console.log("ACCOUNT DETAILS");
    for (const [key, value] of Object.entries(account.body)) {
      if (typeof value === "object" && value !== null) console.log(`  ${key}: ${JSON.stringify(value).slice(0, 160)}`);
      else console.log(`  ${key}: ${String(value)}`);
    }
  } else {
    console.log(`ACCOUNT DETAILS: HTTP ${account.status} — ${JSON.stringify(account.body).slice(0, 200)}`);
  }

  /* 2. Quota / sending statistics. */
  console.log("\nQUOTA & STATISTICS");
  for (const route of [
    "/smtp/statistics",
    "/email/statistics",
    "/smtp/emailStatistics",
    "/organization",
    "/senders/statistics",
  ]) {
    const result = await get(route);
    if (result.status === 200) {
      console.log(`  ${route} -> ${JSON.stringify(result.body).slice(0, 300)}`);
    } else {
      console.log(`  ${route} -> HTTP ${result.status}`);
    }
  }

  /* 3. Brevo's OWN test email — the decisive one. */
  console.log("\nBREVO'S OWN TEST MAIL (POST /v3/smtp/sendSmtpTest)");
  const response = await fetch(`${BREVO}/smtp/sendSmtpTest`, {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ to: (account.body as { email?: string }).email ?? "" }),
  });
  const text = await response.text().catch(() => "");
  console.log(`  HTTP ${response.status} ${text.slice(0, 300)}`);

  console.log("\nWHAT TO DO WITH THE ANSWER");
  console.log("  test mail arrives      -> the account is fine; the problem is the From address");
  console.log("                            (a @gmail.com sender relayed through Brevo does not pass");
  console.log("                             SPF alignment, and Gmail drops it). Publish SPF/DKIM/DMARC");
  console.log("                             for a domain you own and send from that.");
  console.log("  test mail does NOT arrive -> the ACCOUNT is the problem, not this code. Check the");
  console.log("                            Brevo dashboard for a suspended account, an unpaid invoice,");
  console.log("                            or an exhausted daily quota.");
}

void main();