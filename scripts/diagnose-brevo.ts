/**
 * WHICH SENDER ACTUALLY DELIVERS?
 *
 * Established so far: Brevo ACCEPTS the app's mail (HTTP 201), the sender
 * `eamigratepro@gmail.com` IS verified on this account, and it is NOT the
 * Brevo account address (`biyasentobeko222@gmail.com`). Brevo's per-message
 * event log is not readable with this API key (every candidate route answers
 * 404), so delivery cannot be observed from here — the only observer is the
 * recipient's inbox.
 *
 * SO THIS SENDS TWO EMAILS THAT ARE IDENTICAL EXCEPT FOR WHO THEY COME FROM,
 * each with a different subject so they can be told apart at a glance:
 *
 *   A  from biyasentobeko222@gmail.com  (the Brevo account address itself)
 *   B  from eamigratepro@gmail.com       (what the app actually uses)
 *
 * If A arrives and B does not, the sender address is the cause and
 * `BREVO_SENDER_EMAIL` should be pointed at the account address. If both
 * arrive, it is spam filtering and the app is behaving correctly. If neither
 * arrives, it is this mailbox or the Brevo account, not the app.
 *
 * It also re-reads the suppression list using the CORRECT field (`contacts`).
 * The previous check read `blocked_contacts`, which does not exist, and so
 * reported "not suppressed" regardless of the truth.
 *
 * Run: bun scripts/diagnose-brevo.ts [address]
 */
const BREVO = "https://api.brevo.com/v3";
const TO = (process.argv[2] ?? "biyasentobeko222@gmail.com").trim().toLowerCase();
const apiKey = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!apiKey) {
  console.log("BREVO_API_KEY is not set — nothing sent.");
  process.exit(1);
}

async function brevo(path: string) {
  const response = await fetch(`${BREVO}${path}`, {
    headers: { accept: "application/json", "api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text().catch(() => "");
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}

async function sendFrom(senderEmail: string, subject: string, note: string) {
  const response = await fetch(`${BREVO}/smtp/email`, {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "EA Migrate", email: senderEmail },
      to: [{ email: TO }],
      subject,
      htmlContent: `<div style="font-family:Arial;padding:24px"><h2>${subject}</h2><p>${note}</p><p>Sent ${new Date().toISOString()}.</p></div>`,
      textContent: `${subject}\n${note}\nSent ${new Date().toISOString()}.`,
    }),
  });
  const text = await response.text().catch(() => "");
  let parsed: { messageId?: string; message?: string; code?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* keep raw */
  }
  return {
    ok: response.ok,
    messageId: parsed.messageId ?? "(none)",
    detail: response.ok ? "" : `HTTP ${response.status} ${parsed.code ?? ""} ${parsed.message ?? text.slice(0, 160)}`,
  };
}

async function main() {
  console.log(`recipient: ${TO}\n`);

  /* Suppression, read correctly this time. */
  const blocked = await brevo("/smtp/blockedContacts?limit=100&sort=desc");
  if (blocked.status === 200) {
    const contacts = (blocked.body as { contacts?: Array<{ email?: string; reason?: { code?: string; message?: string } }> })
      .contacts;
    const list = contacts ?? [];
    const hit = list.find((entry) => (entry.email ?? "").toLowerCase() === TO);
    console.log(`SUPPRESSION: ${list.length} contact(s) on the account`);
    if (hit) console.log(`  >>> ${TO} IS SUPPRESSED (${hit.reason?.code ?? "?"}) — this is why nothing arrives.`);
    else console.log(`  ${TO} is NOT suppressed.`);
  } else {
    console.log(`SUPPRESSION: could not read (HTTP ${blocked.status})`);
  }

  /* The decisive pair. */
  console.log("\nSending two test emails, one per sender address:\n");
  const a = await sendFrom(
    "biyasentobeko222@gmail.com",
    "TEST A - from the Brevo account address",
    "This one was sent from biyasentobeko222@gmail.com, the Brevo account address.",
  );
  console.log(`  A  from biyasentobeko222@gmail.com -> ${a.ok ? "ACCEPTED" : "REFUSED"} ${a.ok ? a.messageId : a.detail}`);

  const b = await sendFrom(
    "eamigratepro@gmail.com",
    "TEST B - from the address the app uses",
    "This one was sent from eamigratepro@gmail.com, which is what the app sends as.",
  );
  console.log(`  B  from eamigratepro@gmail.com      -> ${b.ok ? "ACCEPTED" : "REFUSED"} ${b.ok ? b.messageId : b.detail}`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("Both were ACCEPTED by Brevo. Accepted is not the same as delivered.");
  console.log("Check the inbox for the two subjects above, including SPAM/JUNK.");
  console.log("  both arrived      -> spam filtering; the app is fine");
  console.log("  only TEST A       -> change BREVO_SENDER_EMAIL to biyasentobeko222@gmail.com");
  console.log("  only TEST B       -> change BREVO_SENDER_EMAIL to eamigratepro@gmail.com");
  console.log("  neither           -> this mailbox or the Brevo account, not the app");
}

void main();
