/**
 * IS `eamigrate.pro` EVEN REGISTERED?
 *
 * DNS answers NXDOMAIN for it, which means no NS and no SOA — the name is not
 * delegated anywhere. That is a different problem from "the SPF record is
 * missing", and it changes the fix: records for an undelegated domain have
 * nowhere to live.
 *
 * RDAP is the public registration protocol, and it answers the question DNS
 * cannot: does a registrar hold this name, and does it have nameservers?
 *
 * Run: bun scripts/probe-domain-registration.ts
 */

/** Names to check: the one the app sends to, plus the fallback From: address's
 * domain, so the two candidates are compared rather than assumed. */
const NAMES = ["eamigrate.pro", "eamigrate.co.za", "eamigratepro.com"];

for (const name of NAMES) {
  process.stdout.write(`${name.padEnd(22)} `);
  try {
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) {
      console.log("NOT REGISTERED (RDAP 404)");
      continue;
    }
    if (!response.ok) {
      console.log(`RDAP HTTP ${response.status}`);
      continue;
    }
    const body = (await response.json()) as {
      ldhName?: string;
      status?: string[];
      nameservers?: Array<{ ldhName?: string }>;
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    const servers = (body.nameservers ?? []).map((n) => n.ldhName).filter(Boolean);
    const registered = (body.events ?? []).find((e) => e.eventAction === "registration")?.eventDate;
    console.log(`REGISTERED  status=${(body.status ?? []).join(",") || "?"}`);
    console.log(
      `${"".padEnd(22)} nameservers=${servers.length ? servers.join(", ") : "NONE PUBLISHED"}`,
    );
    if (registered) console.log(`${"".padEnd(22)} registered ${registered.slice(0, 10)}`);
  } catch (error) {
    console.log(`lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nREADING THIS");
console.log("  nameservers = NONE, or the domain not registered → nothing can be");
console.log("  published for it. Register it / delegate it first, THEN add it to Brevo");
console.log("  and publish the SPF and DKIM records Brevo issues.");
console.log("  A registrar login is needed for this; it cannot be done from a repo.");
