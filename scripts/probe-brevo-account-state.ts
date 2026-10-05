/**
 * WHAT DOES THE BREVO ACCOUNT SAY ABOUT ITSELF?
 *
 * Named `probe-brevo-account-state` rather than `diagnose-brevo` on purpose:
 * there is already a `scripts/diagnose-brevo.ts` in this repo which SENDS real
 * test emails from two different senders so they can be told apart by subject.
 * This file only reads — it sends nothing — and it answers a different
 * question: is the account itself able to send, and does it hold any sending
 * domain that could carry authenticated mail?
 *
 * WHICH IS THE QUESTION WORTH ASKING FIRST.
 *
 * Brevo answers `201 Created` when it accepts a message onto its queue. That is
 * receipt, not delivery, and the difference is decided at the receiving server
 * by whether the `From:` domain authorises the sending service. An account can
 * be perfectly healthy, accept everything, and still deliver nothing — because
 * a @gmail.com `From:` relayed through Brevo is unauthenticated, since
 * `gmail.com`'s SPF is `v=spf1 redirect=_spf.google.com` and lists Google's
 * servers rather than Brevo's. That is the mechanism behind this account's
 * measured ~2 hour delivery.
 *
 * THE ROUTES THAT MATTER
 *   /account                        plan, trial end date, account identity
 *   /senders                        which From: addresses exist, and whether
 *                                   Brevo has them ACTIVE (verified)
 *   /senders/domainAuthentication   which domains are authenticated, plus the
 *                                   exact DNS records Brevo is waiting on
 *
 * The per-message event log is NOT readable with this key — every candidate
 * route answers 404 — so delivery cannot be confirmed from here. The only
 * reliable observer is the recipient's inbox, which is why
 * `scripts/diagnose-brevo.ts` exists and sends real mail, and why this file
 * deliberately does not.
 *
 * Run: bun scripts/probe-brevo-account-state.ts
 */
const BREVO = "https://api.brevo.com/v3";
const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY is not set — nothing asked.");
  process.exit(1);
}

async function call(path: string): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${BREVO}${path}`, {
      headers: { accept: "application/json", "api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text().catch(() => "");
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, body: text.slice(0, 400) };
    }
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Pull a list out of a response that may be an array or an object wrapping one.
 * Brevo has shipped both shapes for these routes, and a shape change must not
 * crash the probe into an unhelpful TypeError.
 */
function asList(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === "object") {
    for (const key of ["senders", "domains", "data", "items", "results"]) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    }
  }
  return [];
}

console.log("ACCOUNT");
const account = await call("/account");
if (account.status !== 200) {
  console.log(
    `  could not be read: HTTP ${account.status} ${JSON.stringify(account.body).slice(0, 200)}`,
  );
} else {
  const a = account.body as Record<string, unknown>;
  console.log(`  account email: ${String(a.email)}`);
  const plans = Array.isArray(a.plan) ? (a.plan as Array<Record<string, unknown>>) : [];
  for (const plan of plans) {
    console.log(
      `  plan: ${String(plan.type)} (credits ${String(plan.credits)} ${String(plan.creditsType)})`,
    );
  }
  const verticals = Array.isArray(a.planVerticals)
    ? (a.planVerticals as Array<Record<string, unknown>>)
    : [];
  for (const vertical of verticals) {
    const end = Number(vertical.endDate);
    console.log(`  ${String(vertical.name)} — status ${String(vertical.status)}`);
    if (Number.isFinite(end)) {
      const ends = new Date(end * 1000);
      const days = Math.round((ends.getTime() - Date.now()) / 86_400_000);
      console.log(`    ends ${ends.toISOString()} (${days} days from now)`);
      console.log("    After that date the account stops relaying while still answering 201,");
      console.log('    so every log line keeps saying "sent" and no mail goes out.');
    }
  }
}

console.log("\nSENDERS");
const senders = await call("/senders");
if (senders.status !== 200) {
  console.log(
    `  could not be read: HTTP ${senders.status} ${JSON.stringify(senders.body).slice(0, 200)}`,
  );
} else {
  const list = asList(senders.body);
  if (list.length === 0)
    console.log(`  none reported: ${JSON.stringify(senders.body).slice(0, 200)}`);
  for (const sender of list) {
    const active = sender.active === true;
    console.log(
      `  ${active ? "ACTIVE   " : "INACTIVE "} ${String(sender.email)} (id ${String(sender.id)})`,
    );
  }
  console.log("  ACTIVE means Brevo verified the ADDRESS. It does NOT mean the address is");
  console.log("  authorised by DNS for Brevo — a free-mail address can be verified here and");
  console.log("  still be unauthenticated in transit, which is what defers delivery.");
}

console.log("\nAUTHENTICATED SENDING DOMAINS");
const domains = await call("/senders/domainAuthentication");
if (domains.status !== 200) {
  console.log(
    `  could not be read: HTTP ${domains.status} ${JSON.stringify(domains.body).slice(0, 200)}`,
  );
  console.log("  (405 here usually means the account has no authenticated domain, or the");
  console.log("   route needs a different method — check the Brevo dashboard.)");
} else {
  const list = asList(domains.body);
  if (list.length === 0)
    console.log(`  none reported: ${JSON.stringify(domains.body).slice(0, 200)}`);
  for (const domain of list) {
    console.log(`  ${String(domain.domain)} — ${String(domain.status)}`);
    const records = domain.dnsRecords as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(records ?? {})) {
      console.log(`    dns.${key}: ${JSON.stringify(value)}`);
    }
  }
}

console.log("\nWHAT TO DO WITH THIS");
console.log("  senders ACTIVE, no authenticated domain → the From: address is verified at");
console.log("    Brevo but unauthorised in transit. Authenticate a domain you own and set");
console.log("    BREVO_SENDER_EMAIL to an address on it. See scripts/check-mail-dns.ts");
console.log("    for whether such a domain currently exists in DNS.");
console.log("  plan ended / suspended → billing, not code. Nothing in this repo can help.");
console.log("  a domain is authenticated but mail still does not arrive → check the DNS");
console.log("    records Brevo listed above actually resolve, then check spam.");
