/**
 * BROKER IDENTITY — the broker's OWN name and logo, never a hardcoded one.
 *
 * The account sync screen used to call every account "Headway" and show the
 * MetaTrader mark, whatever the user actually connected. Both are now derived
 * from the bridge's real `/account/verify` answer:
 *
 *   • the NAME is `account.company` (MT5's own `ACCOUNT_INFO.company`), with
 *     `account.server` as the secondary line under the login number;
 *   • the LOGO is the broker's own, loaded from logo.dev by domain. The domain
 *     comes from a small lookup table keyed on the company name (and the
 *     server name, which usually carries the broker's brand too).
 *
 * Until the bridge answers, there is no company and therefore no name — the
 * caller renders nothing rather than guessing. Whenever the company is unknown
 * or the logo fails to load, the caller falls back to the built-in MetaTrader
 * mark; a broken image is never shown.
 */

export type BrokerIdentity = {
  /** The broker's own company name, exactly as MT5 reported it. Empty when unknown. */
  company: string;
  /** The matched domain (no scheme), or null when the broker is not recognised. */
  domain: string | null;
  /** A logo.dev URL for that domain, or null when unavailable. */
  logoUrl: string | null;
};

/**
 * Company/server brand → broker domain. Matched on a normalised (lowercase,
 * punctuation-free) string, so "IC Markets", "ICMarketsSC-MT5" and
 * "ic markets (pty)" all find `icmarkets.com`.
 */
const BROKER_DOMAINS: Array<{ brand: string; domain: string }> = [
  // Brokers this app already sees, plus the majors its users connect.
  { brand: "exness", domain: "exness.com" },
  { brand: "headway", domain: "headway.net" },
  { brand: "deriv", domain: "deriv.com" },
  { brand: "xmglobal", domain: "xm.com" },
  { brand: "xm", domain: "xm.com" },
  { brand: "icmarkets", domain: "icmarkets.com" },
  { brand: "fxtm", domain: "forextime.com" },
  { brand: "forextime", domain: "forextime.com" },
  { brand: "roboforex", domain: "roboforex.com" },
  { brand: "hantec", domain: "hantecmarkets.com" },
  { brand: "pepperstone", domain: "pepperstone.com" },
  { brand: "octafx", domain: "octafx.com" },
  { brand: "fbs", domain: "fbs.com" },
  { brand: "hfmarkets", domain: "hfm.com" },
  { brand: "hotforex", domain: "hfm.com" },
  { brand: "hfm", domain: "hfm.com" },
  { brand: "tickmill", domain: "tickmill.com" },
  { brand: "vantagemarkets", domain: "vantagemarkets.com" },
  { brand: "vantage", domain: "vantagemarkets.com" },
  { brand: "fusionmarkets", domain: "fusionmarkets.com" },
  { brand: "ftmo", domain: "ftmo.com" },
  { brand: "alpari", domain: "alpari.com" },
  { brand: "admiralmarkets", domain: "admiralmarkets.com" },
  { brand: "avatrade", domain: "avatrade.com" },
  { brand: "fxcm", domain: "fxcm.com" },
  { brand: "fxpro", domain: "fxpro.com" },
  { brand: "instaforex", domain: "instaforex.com" },
  { brand: "justmarkets", domain: "justmarkets.com" },
  { brand: "exnova", domain: "exnova.com" },
  { brand: "axitrader", domain: "axi.com" },
  { brand: "axi", domain: "axi.com" },
  { brand: "fxopen", domain: "fxopen.com" },
  { brand: "nordfx", domain: "nordfx.com" },
  { brand: "lmfx", domain: "lmfx.com" },
  { brand: "tradersway", domain: "tradersway.com" },
  { brand: "globalprime", domain: "globalprime.com.au" },
  { brand: "blueberrymarkets", domain: "blueberrymarkets.com" },
  { brand: "dnamarkets", domain: "dnamarkets.com" },
  { brand: "fundednext", domain: "fundednext.com" },
  { brand: "the5ers", domain: "the5ers.com" },
  { brand: "e8markets", domain: "e8markets.com" },
  { brand: "alphacapitalgroup", domain: "alphacapitalgroup.uk" },
  { brand: "startrader", domain: "startrader.com" },
  { brand: "litefinance", domain: "litefinance.org" },
  { brand: "equiti", domain: "equiti.com" },
  { brand: "multibank", domain: "multibankfx.com" },
  { brand: "metaquotes", domain: "metaquotes.net" },
];

/** Lowercase, alphanumeric only — "IC Markets" and "ic_markets" compare equal. */
function normalise(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The publishable logo.dev key (safe in the bundle — it is public by design). */
function logoDevKey(): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return (env["VITE_LOGO_DEV_KEY"] ?? env["VITE_LOGO_DEV_TOKEN"] ?? "").trim();
  } catch {
    return "";
  }
}

/** The broker's domain for a company name, falling back to the server name. */
export function brokerDomain(company: string, server = ""): string | null {
  const haystacks = [normalise(company), normalise(server)].filter(Boolean);
  if (haystacks.length === 0) return null;
  // Longest brand first so "xmglobal" wins over "xm", "fusionmarkets" over none.
  const ordered = [...BROKER_DOMAINS].sort((a, b) => b.brand.length - a.brand.length);
  for (const haystack of haystacks) {
    const exact = ordered.find((entry) => haystack === entry.brand);
    if (exact) return exact.domain;
  }
  for (const haystack of haystacks) {
    const partial = ordered.find((entry) => haystack.includes(entry.brand));
    if (partial) return partial.domain;
  }
  return null;
}

/**
 * The broker's own logo URL (logo.dev, publishable key from the environment).
 * `null` means "use the MetaTrader mark" — unknown broker, or no key set.
 */
export function brokerLogoUrl(company: string, server = "", size = 160): string | null {
  const domain = brokerDomain(company, server);
  if (!domain) return null;
  const key = logoDevKey();
  if (!key) return null;
  return `https://img.logo.dev/${domain}?token=${encodeURIComponent(key)}&size=${size}&format=png&retina=true`;
}

/** Everything the sync overlay needs about the broker, from one bridge answer. */
export function brokerIdentity(company: string, server = ""): BrokerIdentity {
  const clean = (company || "").trim();
  const domain = brokerDomain(clean, server);
  return {
    company: clean,
    domain,
    logoUrl: domain ? brokerLogoUrl(clean, server) : null,
  };
}

/**
 * Pull the broker's company out of a `/account/verify` reply. MT5 exposes it
 * as `company` on the account info; a few bridge builds return it at the top
 * level. Never invents a value: an absent company is an empty string.
 */
export function companyFromBridgeReply(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const account =
    record["account"] && typeof record["account"] === "object"
      ? (record["account"] as Record<string, unknown>)
      : {};
  const candidates = [account["company"], record["company"], account["broker"], record["broker"]];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** The server name from the same reply (secondary detail under the login). */
export function serverFromBridgeReply(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const account =
    record["account"] && typeof record["account"] === "object"
      ? (record["account"] as Record<string, unknown>)
      : {};
  for (const value of [account["server"], record["server"]]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
