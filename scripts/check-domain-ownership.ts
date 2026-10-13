/**
 * DO WE ACTUALLY OWN A DOMAIN TO SEND MAIL FROM?
 *
 * This is the load-bearing question behind "it says sent but nothing arrives".
 * Every send is answered 201 by Brevo, which only means the message entered its
 * queue. What decides whether an inbox takes it is whether the `From:` domain
 * authorises the sending service — and that needs a domain which actually
 * EXISTS in DNS.
 *
 * WHY THIS EXISTS NOW: an earlier version of this check concluded that every
 * candidate was unregistered, including `eamigrate.co.za` — which is wrong. The
 * domain resolves, has GoDaddy nameservers and a SOA. The mistake was trusting
 * RDAP as the final word: ARIN's RDAP endpoint only serves the gTLDs it
 * administers, and for any other suffix it answers "not found", which means
 * "I have no record of it" and NOT "no registrar holds it".
 *
 * So the verdict here is drawn from DNS, which is authoritative and
 * registry-independent, and RDAP is reported only as one corroborating signal.
 *
 *   NS / SOA    the name is delegated to a registrar's nameservers
 *   A / MX      it resolves
 *   TXT         any mail records already published
 *   SPF         whether Brevo is authorised to send for it
 *   DKIM        whether a signing key exists
 *
 * WHAT "OWNED" LOOKS LIKE
 * NS and SOA present means a registrar is serving the zone: that is ownership,
 * proven without trusting any registry's own API. A domain can also be owned and
 * undelegated, which RDAP alone would be needed to detect — hence it is still
 * shown, but never as the deciding vote.
 *
 * Run: bun scripts/check-domain-ownership.ts
 */
import { lookup as rdap } from "./lib/rdap";

/** Every domain the product references, plus the likely .co.za. */
const CANDIDATES = ["eamigrate.co.za", "ea-migrate-pro.com", "eamigrate.pro", "eamigratepro.com"];

/** Brevo publishes DKIM under a selector it assigns when a domain is added. */
const DKIM_SELECTORS = [
  "brevo",
  "mail",
  "k1",
  "s1",
  "default",
  "zoho",
  "sendgrid",
  "mailin",
  "mandrill",
];

const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

/** DoH lookup across two resolvers; `Status: 3` (NXDOMAIN) is authoritative. */
async function dns(name: string, type: string): Promise<{ found: boolean; value: string }> {
  for (const resolver of RESOLVERS) {
    try {
      const response = await fetch(`${resolver}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        Status?: number;
        Answer?: Array<{ data?: string }>;
      };
      if (body.Status === 3) return { found: false, value: "NXDOMAIN" };
      if (body.Status !== 0) continue;
      const values = (body.Answer ?? []).map((a) => a.data ?? "").filter(Boolean);
      return values.length > 0
        ? { found: true, value: values.join(" | ").slice(0, 110) }
        : { found: false, value: "no answer" };
    } catch {
      /* try the next resolver */
    }
  }
  return { found: false, value: "resolver did not answer" };
}

const RESULTS = new Map<string, { ns: string; soa: string; delegated: boolean }>();

for (const domain of CANDIDATES) {
  console.log(`\n=== ${domain}`);

  const ns = await dns(domain, "NS");
  const soa = await dns(domain, "SOA");
  // A delegated zone has NS; NS with no SOA is a broken delegation. Either way,
  // NS is the signal that a registrar is serving the name.
  const delegated = ns.found || soa.found;
  RESULTS.set(domain, { ns: ns.value, soa: soa.value, delegated });

  console.log(`  NS   : ${ns.value}`);
  console.log(`  SOA  : ${soa.value}`);
  console.log(`  A    : ${(await dns(domain, "A")).value}`);
  console.log(`  MX   : ${(await dns(domain, "MX")).value}`);
  console.log(`  TXT  : ${(await dns(domain, "TXT")).value}`);

  const spf = await dns(domain, "TXT");
  const spfRecords = spf.found ? spf.value : "";
  console.log(`  SPF  : ${spf.value}`);
  if (spfRecords) {
    const authorises = /brevo|sendinblue|resend|sendgrid|mailgun|postmark|amazonses/i.test(
      spfRecords,
    );
    console.log(`         authorises a sending service: ${authorises ? "YES" : "NO"}`);
  }

  for (const selector of DKIM_SELECTORS) {
    const dkim = await dns(`${selector}._domainkey.${domain}`, "TXT");
    if (dkim.found) {
      console.log(`  DKIM (${selector}): ${dkim.value}`);
    }
  }

  const registration = await rdap(domain);
  console.log(
    `  RDAP : ${registration.status}${registration.status === "registered" ? ` — ${registration.nameservers.join(", ") || "no nameservers published"}` : ""}` +
      (registration.status === "unregistered"
        ? "   (not conclusive: ARIN RDAP only serves gTLDs; ignore this for .co.za and other ccTLDs)"
        : ""),
  );
}

console.log("\n\nVERDICT");
const owned = [...RESULTS.entries()].filter(([, r]) => r.delegated).map(([d]) => d);
const sendable = [...RESULTS.entries()].filter(([, r]) => r.delegated).map(([d]) => d);

if (owned.length === 0) {
  console.log("  No candidate domain is delegated in DNS, so none can carry mail records.");
  console.log("  Buying and delegating one is the first step.");
} else {
  console.log(`  DELEGATED (so owned and able to hold mail records): ${owned.join(", ")}`);
  console.log("");
  console.log("  This is the thing to fix. Everything else in the send path already works:");
  console.log("  Brevo accepts the message and the app reports it as sent. What is missing");
  console.log("  is DNS authorisation for the From: domain, without which a receiving server");
  console.log("  is free to defer or discard the message.");
  console.log("");
  console.log("  In order:");
  console.log(`    1. Brevo dashboard -> Senders & Domains -> add ${sendable[0]}`);
  console.log("    2. Publish the SPF and DKIM records Brevo gives you, in your registrar's");
  console.log("       DNS zone for that domain");
  console.log("    3. Set BREVO_SENDER_EMAIL to an address on that domain on the server");
  console.log("    4. Re-run this script: the SPF and DKIM lines above should then say YES");
}
