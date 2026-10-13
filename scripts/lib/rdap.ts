/**
 * PUBLIC REGISTRATION LOOKUP, shared by the mail probes.
 *
 * DNS can say a name does not resolve; it cannot say whether a registrar holds
 * it. Those two states need different fixes — "registered but no nameservers"
 * means set nameservers, "not registered" means buy it — and telling them apart
 * is what stops the mail advice from sending the owner to add a DKIM record to a
 * domain that does not exist.
 *
 * RDAP is the public successor to WHOIS and needs no credentials.
 */

/** What a name's registration status is, at the precision the caller needs. */
export type Registration =
  | { status: "registered"; nameservers: string[]; registeredAt?: string }
  | { status: "unregistered" }
  | { status: "unknown"; why: string };

/**
 * Ask RDAP about a domain.
 *
 * 404 is authoritative: the registry says it holds no such name. A transport
 * failure returns `unknown` so no caller can mistake "could not reach RDAP" for
 * "not registered" — the first is our problem, the second is the owner's.
 */
export async function lookup(domain: string): Promise<Registration> {
  try {
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return { status: "unregistered" };
    if (!response.ok) return { status: "unknown", why: `RDAP HTTP ${response.status}` };
    const body = (await response.json()) as {
      nameservers?: Array<{ ldhName?: string }>;
      events?: Array<{ eventAction?: string; eventDate?: string }>;
    };
    return {
      status: "registered",
      nameservers: (body.nameservers ?? [])
        .map((n) => n.ldhName)
        .filter((n): n is string => Boolean(n)),
      registeredAt: (body.events ?? []).find((e) => e.eventAction === "registration")?.eventDate,
    };
  } catch (error) {
    return { status: "unknown", why: error instanceof Error ? error.message : String(error) };
  }
}
