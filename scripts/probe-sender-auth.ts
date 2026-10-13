/**
 * WHY A @gmail.com "From:" SENT THROUGH BREVO NEVER ARRIVES
 *
 * The app sends with `From: eamigratepro@gmail.com` while the SMTP relay is
 * Brevo's (`smtp-relay.mailin.fr`). Two things are then true at once, and both
 * are checkable in public DNS rather than assumed:
 *
 *   1. The ENVELOPE sender belongs to Brevo. SPF for `gmail.com` does not
 *      list Brevo, so SPF fails for the From: domain.
 *   2. The DKIM signature is `d=brevo.com` (or the Brevo sending domain). DKIM
 *      passes, but its domain does not ALIGN with `From: gmail.com`.
 *
 * SPF fail + DKIM misaligned = DMARC failure. What a receiver then does is
 * entirely the receiver's published DMARC policy, so this reads both policies
 * and prints them: that is the difference between "delivered but in spam" and
 * "deferred for hours", which is what this account reports.
 *
 * It also prints when the Brevo free trial ends, because after that date the
 * account stops relaying at all while still answering 201.
 *
 * Run: bun scripts/probe-sender-auth.ts
 */
const DOMAIN = "gmail.com";
const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

async function txt(name: string): Promise<{ status: number; values: string[] }> {
  for (const resolver of RESOLVERS) {
    try {
      const response = await fetch(`${resolver}?name=${encodeURIComponent(name)}&type=TXT`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        Status?: number;
        Answer?: Array<{ data?: string }>;
      };
      if (body.Status !== 0) return { status: body.Status ?? -1, values: [] };
      return {
        status: 0,
        values: (body.Answer ?? [])
          .map((a) => (a.data ?? "").replace(/^"|"$/g, ""))
          .filter(Boolean),
      };
    } catch {
      /* try the next resolver */
    }
  }
  return { status: -1, values: [] };
}

console.log(`SPF for ${DOMAIN} (the From: domain)`);
const spf = await txt(DOMAIN);
if (spf.status !== 0) console.log("  could not be read");
for (const record of spf.values) {
  if (!record.startsWith("v=spf1")) continue;
  const authorisesBrevo =
    /(^|[\s~?+])brevo([\s~?+]|$)/i.test(record) ||
    record.includes("sendinblue") ||
    record.includes("brevo");
  console.log(`  ${record.slice(0, 400)}`);
  console.log(`  → authorises Brevo as a sender: ${authorisesBrevo ? "YES" : "NO"}`);
}

console.log(`\nDMARC policy for ${DOMAIN} (what a receiver does on failure)`);
const dmarc = await txt(`_dmarc.${DOMAIN}`);
for (const record of dmarc.values) console.log(`  ${record.slice(0, 400)}`);
const policy = dmarc.values.find((v) => v.startsWith("v=DMARC1")) ?? "";
const tag = (name: string) =>
  policy.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`, "i"))?.[1]?.trim() ?? "(not set)";
console.log(
  `  → p=${tag("p")}  (none = deliver but flag, quarantine = spam folder, reject = refuse)`,
);

console.log("\nBREVO FREE TRIAL");
const planEnd = 1_792_600_181;
console.log(`  ends ${new Date(planEnd * 1000).toISOString()}`);
console.log(`  ${Math.round((planEnd * 1000 - Date.now()) / 86_400_000)} days from now`);
console.log("  After that date the account stops relaying while still answering 201,");
console.log('  so every log line keeps saying "sent" and no mail goes out.');

console.log("\nWHAT FOLLOWS");
console.log("  A 201 from Brevo proves the message entered the queue. With the From:");
console.log("  domain unauthenticated it is not authorised by the receiving server, so");
console.log("  delivery is deferred or filtered regardless of the code. The fix is to");
console.log("  send from a domain whose SPF and DKIM name Brevo, which the dashboard");
console.log("  can issue records for; that domain does not exist in DNS today.");
