/**
 * SUPPRESSION + VERIFIED SENDERS — the two things that decide delivery.
 *
 * CORRECTION: an earlier version of the diagnostic read `blocked_contacts`
 * from the blocked-contacts response, but the field is actually `contacts`.
 * That meant the check reported "not suppressed" no matter what was on the
 * list. Brevo keeps answering 201 for a suppressed address and simply never
 * attempts delivery, so that wrong answer would have hidden the single most
 * likely cause. This reads the real field.
 *
 * The sender matters just as much: Brevo's account here is one address while
 * the app sends from another, and an unverified sender is refused outright
 * (HTTP 400), which is NOT what is happening — so this confirms it either way.
 *
 * READ-ONLY. Sends nothing.
 *
 * Run: bun scripts/probe-brevo-routes.ts [address]
 */
const BREVO = "https://api.brevo.com/v3";
const TO = (process.argv[2] ?? "biyasentobeko222@gmail.com").trim().toLowerCase();

const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY is not set.");
  process.exit(1);
}

async function brevo(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BREVO}${path}`, {
    headers: { accept: "application/json", "api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text().catch(() => "");
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

async function main() {
  console.log(`recipient under test: ${TO}\n`);

  /* Suppression — the correct field this time. */
  const blocked = await brevo("/smtp/blockedContacts?limit=500&sort=desc");
  if (blocked.status === 200) {
    const body = blocked.body as {
      contacts?: Array<{ email?: string; reason?: { message?: string; code?: string }; blockedAt?: string }>;
    };
    const list = body.contacts ?? [];
    console.log(`SUPPRESSION LIST: ${list.length} contact(s)`);
    const hit = list.find((entry) => (entry.email ?? "").toLowerCase() === TO);
    if (hit) {
      console.log(`  >>> ${TO} IS SUPPRESSED — reason: ${hit.reason?.message ?? "?"} (${hit.reason?.code ?? "?"}) since ${hit.blockedAt ?? "?"}`);
      console.log("  Brevo answers 201 for these and never tries to deliver. THIS IS THE CAUSE.");
    } else {
      console.log(`  ${TO} is NOT on the list — suppression is not the cause.`);
    }
    for (const entry of list.slice(0, 10)) {
      console.log(`    - ${entry.email}  (${entry.reason?.code ?? "?"})`);
    }
  } else {
    console.log(`SUPPRESSION LIST: could not read (HTTP ${blocked.status})`);
  }

  /* Verified senders — does this account actually own the address we send from? */
  console.log("");
  for (const route of ["/smtp/senders", "/senders", "/smtp/email/senders"]) {
    const result = await brevo(route);
    if (result.status === 200) {
      const senders = (result.body as { senders?: Array<{ email?: string; name?: string; active?: boolean }> }).senders;
      console.log(`VERIFIED SENDERS (${route}):`);
      for (const entry of senders ?? []) {
        console.log(`  - ${entry.email}${entry.active === false ? "  (INACTIVE)" : ""}`);
      }
      const appSender = "eamigratepro@gmail.com";
      const owns = (senders ?? []).some((entry) => (entry.email ?? "").toLowerCase() === appSender);
      console.log(`\n  app sends from ${appSender} → ${owns ? "VERIFIED on this account" : "NOT LISTED here"}`);
      break;
    }
    console.log(`  ${route} -> HTTP ${result.status}`);
  }

  /* The account's own identity, which is the other half of the puzzle. */
  const account = await brevo("/account");
  if (account.status === 200) {
    const a = account.body as { email?: string };
    console.log(`\nBrevo account email: ${a.email ?? "?"}`);
    console.log(`App sender         : eamigratepro@gmail.com`);
    if ((a.email ?? "").toLowerCase() !== "eamigratepro@gmail.com") {
      console.log("These differ — the app sends from an address that is NOT the Brevo account address.");
    }
  }
}

void main();
