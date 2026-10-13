/**
 * CAN ANY OF THESE DOMAINS CARRY MAIL?
 *
 * The app sends activation codes with `From: eamigratepro@gmail.com`, and mail
 * from a @gmail.com relay never reaches a Gmail inbox in time to matter. The fix
 * is to send from a domain whose SPF and DKIM name the sending service — but
 * that domain must first EXIST in DNS, and the name previously assumed for it
 * (`eamigrate.pro`) turns out not to be registered at all.
 *
 * So this checks every domain the product actually references and reports, per
 * domain, the three things that decide deliverability:
 *
 *   NS / SOA   the domain is delegated at all — without this nothing can be
 *              published for it, and SPF would silently never match
 *   SPF        authorises the sending service's IPs
 *   DKIM       signs the message, under a selector the service assigns
 *   DMARC      says what a receiver does when SPF and DKIM both fail
 *
 * DNS-OVER-HTTPS, not the system resolver: a sandbox with no local resolver
 * answers nothing at all, and "nothing answered" must not be read as "no
 * records exist". A DoH `Status: 3` (NXDOMAIN) IS an authoritative "no such
 * name" and is reported as such; a transport failure is reported as UNKNOWN and
 * the script refuses to conclude from it.
 *
 * Run: bun scripts/check-mail-dns.ts
 */
import { lookup as rdap } from "./lib/rdap";

/** Domains worth checking: the one the product names, plus the fallback the
 * code uses when BREVO_SENDER_EMAIL is unset. */
const DOMAINS = ["ea-migrate-pro.com", "eamigratepro.vercel.app", "eamigrate.pro"];

/** DKIM selectors to probe. The service assigns the real one when a domain is
 * added, so the common ones are checked rather than one guessed name. */
const SELECTORS = [
  "resend",
  "brevo",
  "k1",
  "s1",
  "s2",
  "default",
  "mail",
  "zoho",
  "sendgrid",
  "mandrill",
  "mailin",
];

const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

type Result =
  { kind: "records"; values: string[] } | { kind: "absent" } | { kind: "unknown"; why: string };

/** One DoH lookup, tried against two resolvers so a single resolver's outage
 * cannot be mistaken for a missing record. */
async function query(name: string, type: string): Promise<Result> {
  let last = "";
  for (const resolver of RESOLVERS) {
    try {
      const response = await fetch(`${resolver}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        last = `HTTP ${response.status}`;
        continue;
      }
      const body = (await response.json()) as {
        Status?: number;
        Answer?: Array<{ data?: string }>;
      };
      // NXDOMAIN is authoritative: the name genuinely does not exist.
      if (body.Status === 3) return { kind: "absent" };
      if (body.Status !== 0) {
        last = `DNS status ${body.Status}`;
        continue;
      }
      const values = (body.Answer ?? [])
        .map((answer) => (answer.data ?? "").replace(/^"|"$/g, ""))
        .filter(Boolean);
      return values.length > 0 ? { kind: "records", values } : { kind: "absent" };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  return { kind: "unknown", why: last || "no resolver answered" };
}

/** Does this name exist in DNS at all?
 *
 * NS records live at the ZONE apex only, so a subdomain such as
 * `app.vercel.app` resolves perfectly while having no NS record of its own.
 * Asking only for NS/SOA therefore calls a working subdomain "undelegated",
 * which is exactly the wrong answer to give. An address record settles it: if
 * the name has an A or AAAA it demonstrably exists, whatever its NS looks like.
 */
async function exists(domain: string): Promise<boolean | null> {
  for (const type of ["A", "AAAA"]) {
    const address = await query(domain, type);
    if (address.kind === "records") return true;
    if (address.kind === "unknown") return null;
  }
  const ns = await query(domain, "NS");
  if (ns.kind === "records") return true;
  if (ns.kind === "unknown") return null;
  const soa = await query(domain, "SOA");
  if (soa.kind === "unknown") return null;
  return soa.kind === "records";
}

/** Does any published SPF record name a transactional sending service? */
function spfNamesSender(values: string[]): boolean {
  const services = [
    "brevo",
    "sendinblue",
    "resend",
    "sendgrid",
    "mailgun",
    "postmark",
    "zoho",
    "mandrill",
    "amazonses",
    "mailin",
  ];
  return values.some(
    (v) => v.startsWith("v=spf1") && services.some((service) => v.toLowerCase().includes(service)),
  );
}

/** Run every check for one domain and print its verdict inline. */
async function inspect(domain: string) {
  console.log(`\n=== ${domain}`);

  const live = await exists(domain);
  if (live === false) {
    // Before concluding "does not exist", confirm with registration data: a
    // name can be registered with broken delegation, and the two need
    // different fixes — a registrar login, versus only adding DNS records.
    const registration = await rdap(domain);
    const hint =
      registration.status === "registered"
        ? "it is REGISTERED but does not resolve — set its nameservers at the registrar, then add mail records"
        : registration.status === "unregistered"
          ? "it is NOT REGISTERED — register it before any mail record can exist for it"
          : `registration could not be checked (${registration.why})`;
    console.log(`  ✗ does not resolve at all: ${hint}`);
    return { domain, usable: false as const, reason: "does not exist" };
  }
  if (live === null) {
    console.log("  ?? could not be checked — DNS did not answer");
    return { domain, usable: null, reason: "unknown" };
  }
  console.log("  ✓ exists in DNS");

  const spf = await query(domain, "TXT");
  const spfValues = spf.kind === "records" ? spf.values : [];
  if (spf.kind === "records") {
    const named = spfValues.find((v) => v.startsWith("v=spf1"));
    console.log(
      `  ${named ? (spfNamesSender(spfValues) ? "✓" : "✗") : "·"} SPF: ${(named ?? spfValues.join(" ")).slice(0, 180)}`,
    );
    if (named && !spfNamesSender(spfValues)) {
      console.log("      published, but it does not name a transactional sending service");
    }
  } else {
    console.log(`  ✗ SPF: ${spf.kind === "absent" ? "no TXT record" : `unknown — ${spf.why}`}`);
  }

  const dmarc = await query(`_dmarc.${domain}`, "TXT");
  const dmarcValue =
    dmarc.kind === "records" ? dmarc.values.find((v) => v.startsWith("v=DMARC1")) : undefined;
  console.log(
    `  ${dmarcValue ? "✓" : "·"} DMARC: ${dmarcValue ? dmarcValue.slice(0, 140) : "not published"}`,
  );

  let dkim = false;
  let unknownSelector = false;
  for (const selector of SELECTORS) {
    const result = await query(`${selector}._domainkey.${domain}`, "TXT");
    if (result.kind === "records") {
      console.log(`  ✓ DKIM (${selector}): ${result.values.join(" ").slice(0, 120)}`);
      dkim = true;
    } else if (result.kind === "unknown") {
      unknownSelector = true;
    }
  }
  if (!dkim)
    console.log(
      `  ${unknownSelector ? "??" : "✗"} DKIM: ${unknownSelector ? "could not be fully checked" : "no _domainkey record on any common selector"}`,
    );

  const usable = spfNamesSender(spfValues) && dkim;
  console.log(
    `  → ${usable ? "USABLE as a mail sender once BREVO_SENDER_EMAIL points here" : "cannot carry authenticated mail yet"}`,
  );
  return {
    domain,
    usable: spf.kind === "unknown" || unknownSelector ? null : usable,
    reason: usable ? "ready" : "records missing",
  };
}

const results = [];
for (const domain of DOMAINS) results.push(await inspect(domain));

console.log("\n\nVERDICT");
const ready = results.filter((r) => r.usable === true).map((r) => r.domain);
if (ready.length > 0) {
  console.log(`  These can send authenticated mail: ${ready.join(", ")}`);
  console.log("  Add the domain to the sending service, publish the records it issues,");
  console.log("  then set BREVO_SENDER_EMAIL to an address on it.");
} else {
  console.log("  No domain currently has both SPF naming a sending service and a DKIM key,");
  console.log("  so nothing this app sends can be authorised by a receiving server.");
  console.log("  Until one does, the only available From: is a @gmail.com address, which");
  console.log("  Gmail does not authorise for Brevo — the code arrives hours later or not");
  console.log("  at all, and a code that expires in two minutes can never be used.");
}
