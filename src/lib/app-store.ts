import { useSyncExternalStore } from "react";
import { bindEmailToDevice, getEmailDeviceBinding, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { travelSizedImage, travelSizedVideo } from "@/lib/media-store";
import { supabase, supabaseConfigured } from "@/lib/supabase";

/** Same checkout the app login redirects unpaid users to. */
export const WHOP_CHECKOUT_URL =
  (import.meta.env["VITE_WHOP_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

/**
 * LEAVE FOR CHECKOUT — a plain document navigation, deliberately NOT a
 * router redirect.
 *
 * `throw redirect({ href: "https://whop.com/…" })` was the original bug and
 * it failed silently for weeks: TanStack resolves `href` as an APP path, so
 * an external URL never resolved and an unpaid user simply stayed where they
 * were. Every "you must pay" decision in the app now goes through here, and
 * `location.replace` is honoured by every container that allows leaving at
 * all — browser tab, Android WebView, PWA.
 */
export function leaveForCheckout(): void {
  if (typeof window === "undefined") return;
  try {
    window.location.replace(WHOP_CHECKOUT_URL);
  } catch {
    // A container that refuses to leave (an iOS home-screen app) keeps the
    // caller on a checkout card that hands the link over by hand instead.
  }
}

/**
 * Route-guard outcome from the app access rules (same gates the /app login
 * view enforces): an unsigned-in visitor goes to the app login, an unpaid
 * email goes to checkout, and paid/admin emails pass through.
 */
export type AppAccessCheck = { action: "pass" | "signin" | "pay" | "deactivate" };

/**
 * LEGACY route guard — now a FAIL-CLOSED wrapper over the cloud gate.
 *
 * This used to decide from the LOCAL store alone (`paymentStatusForEmail`),
 * which was the bypass: a forged or remembered local record said "paid" and
 * the app opened for somebody who had never paid. Mentor approval is not
 * payment either, so no local signal may decide this.
 *
 * Every answer now comes from `requireVerifiedAccess`, which is
 * cloud-authoritative and never consults mentor approval:
 *
 *   platform owner / users.is_admin  → pass
 *   users.is_paid                    → pass
 *   license_keys row for this email  → pass
 *   Whop membership (server-side)    → pass
 *   anything else                    → signin / pay — the app does NOT open
 *
 * The import is DYNAMIC because payment-gate imports THIS module for
 * `getDeviceId` and `appSignOut`; a static import would close that cycle at
 * module-init time (the Android WebView bundle crashes on exactly that).
 */
export async function requireAppAccess(email: string | null): Promise<AppAccessCheck> {
  const { requireVerifiedAccess } = await import("@/lib/payment-gate");
  return requireVerifiedAccess(email);
}

/** Non-hook snapshot of the app state — safe inside route beforeLoad guards. */
export function getAppState(): AppState {
  load();
  return state;
}

export type Robot = {
  id: string;
  name: string;
  version?: string;
  key: string;
  symbols: string[];
  pairs?: PairSetting[];
  image?: string;
  video?: string;
  eaId?: string;
  running: boolean;
};

export type PairSetting = {
  symbol: string;
  lotSize: string;
  maxTrades: string;
  /** Trade-direction filter for this pair — BOTH by default. */
  direction?: "BOTH" | "BUY" | "SELL";
};

export type MtAccount = {
  platform: "MT5";
  broker: string;
  server: string;
  accountType: string;
  loginId: string;
  /** The user's own MetaApi account id (created under the platform token). */
  mcAccountId?: string;
  /** MetaApi region returned at connect time (used to pick the trade API host). */
  environment?: string;
  /** live or demo — detected from the broker server name (demo/trial servers). */
  kind?: "live" | "demo";
};

export type AppSettings = {
  background: string;
  backgroundEnabled: boolean;
  interfaceStyle: string;
  font: string;
  accent: number;
  accentColor: string;
  brandName: string;
  lotSize: string;
};

export type AppState = {
  email: string | null;
  activeRobotId: string | null;
  robots: Robot[];
  mt: MtAccount | null;
  settings: AppSettings;
};

const KEY = "eamp.app.v3";
const LEGACY_KEYS = ["eamp.app.v1", "eamp.app.v2"];

/**
 * GLOBAL ACCESS RESET — the access epoch. Bump this number to sign EVERY
 * device out of the app on its very next route change (admins included —
 * they are not exempt). The number the device saw last is remembered in
 * localStorage; when the code ships a higher one, the local session is
 * wiped ONCE. Anyone may sign back in afterwards — but sign-in runs the
 * cloud gate again, so only emails the database actually unlocks get in.
 * All Supabase rows (users, license_keys) are PRESERVED by this reset.
 */
const ACCESS_EPOCH = 3;
const EPOCH_KEY = "eamp.access-epoch.v1";

/** True exactly once per device per epoch bump — consumed at load(). */
function consumeAccessEpochKick(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const seen = Number(window.localStorage.getItem(EPOCH_KEY) ?? "1");
    if (seen >= ACCESS_EPOCH) return false;
    window.localStorage.setItem(EPOCH_KEY, String(ACCESS_EPOCH));
    return true;
  } catch {
    return false;
  }
}

const INTERFACE_STYLE_IDS = new Set([
  "crimson_navigator",
  "navigator_plus",
  "pablo_crimson",
  "pablo_elite",
  "quantum_blue",
  "darkweb_ai",
  "supreme_equinox",
  "ultron_mega",
  "ea_cloud",
]);

const initial: AppState = {
  email: null,
  activeRobotId: null,
  robots: [],
  mt: null,
  settings: { background: "Neon Grid", backgroundEnabled: true, interfaceStyle: "crimson_navigator", font: "Inter", accent: 60, accentColor: "#FF3B3B", brandName: "EA Migrate", lotSize: "0.01" },
};

let state: AppState = initial;
let loaded = false;
const listeners = new Set<() => void>();

const LAYOUT_ALIASES: Record<string, string> = {
  Prime: "navigator_plus",
  Custom: "crimson_navigator",
  "Neuro Scalper": "darkweb_ai",
  "Prime Pro": "pablo_elite",
  layout_orange: "crimson_navigator",
  layout_blue: "quantum_blue",
  layout_green: "ea_cloud",
  layout_sniper_circle: "crimson_navigator",
  layout_sniper_full: "navigator_plus",
  layout_sniper_vertical: "pablo_elite",
};

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  // The epoch kick runs BEFORE the saved state is read: a bumped epoch must
  // not just clear the email but also drop the stale robot/binding records
  // that belonged to the kicked session.
  const epochKick = consumeAccessEpochKick();
  try {
    LEGACY_KEYS.forEach((legacy) => window.localStorage.removeItem(legacy));
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...initial,
        ...saved,
        activeRobotId: saved.activeRobotId ?? initial.activeRobotId,
      robots: Array.isArray(saved.robots)
        ? saved.robots.map((robot) => ({
            ...robot,
            symbols: Array.isArray(robot.symbols) ? robot.symbols : [],
            // Only restore pairs when this robot actually has configured
            // symbols. robots created with pairs: [] (nothing configured
            // yet) must NOT re-seed every EA symbol into Allowed Quotes on
            // load — those symbols stay under Selected Quotes until the
            // user presses Configure.
            pairs: Array.isArray(robot.pairs) && robot.pairs.length > 0
              ? robot.pairs.map((pair) => ({
                  symbol: typeof pair?.symbol === "string" ? pair.symbol : "",
                  lotSize: typeof pair?.lotSize === "string" && pair.lotSize ? pair.lotSize : "0.01",
                  maxTrades: typeof pair?.maxTrades === "string" && pair.maxTrades ? pair.maxTrades : "0",
                })).filter((pair) => pair.symbol)
              : [],
          }))
        : initial.robots,
        settings: { ...initial.settings, ...(saved.settings ?? {}), backgroundEnabled: saved.settings?.backgroundEnabled ?? true },
      };
    }
    const savedLayout = window.localStorage.getItem("layout");
    const savedThemeColor = window.localStorage.getItem("themeColor");
    const requestedLayout = savedLayout || state.settings.interfaceStyle;
    const aliasedLayout = LAYOUT_ALIASES[requestedLayout];
    const selectedLayout = INTERFACE_STYLE_IDS.has(requestedLayout)
      ? requestedLayout
      : aliasedLayout && INTERFACE_STYLE_IDS.has(aliasedLayout)
        ? aliasedLayout
        : initial.settings.interfaceStyle;
    state = { ...state, settings: { ...state.settings, interfaceStyle: selectedLayout, accentColor: savedThemeColor || state.settings.accentColor || initial.settings.accentColor } };
  } catch {
    /* ignore */
  }
  if (epochKick) {
    // Sign everyone out locally — the cloud gate on the next route decides
    // who gets back in (unpaid emails are sent to checkout, not the app).
    state = { ...initial, settings: state.settings };
    persist();
  }
}

function persist() {
  if (typeof window !== "undefined") {
    // A quota failure (a huge robot picture, for instance) used to throw out
    // of persist() BEFORE the listeners fired — the UI froze on stale state
    // AND nothing was saved. Guard the save, always notify.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("[app-store] state save failed (storage full?) — kept in memory only", error);
    }
    try {
      window.localStorage.setItem("layout", state.settings.interfaceStyle);
      window.localStorage.setItem("themeColor", state.settings.accentColor);
    } catch {
      /* cosmetic keys — never worth breaking the app over */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot = initial;

export function useAppState() {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
}

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  const key = "eamp.device.id";
  const saved = window.localStorage.getItem(key);
  if (saved) return saved;
  const generated = "device-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  window.localStorage.setItem(key, generated);
  return generated;
}

/**
 * Restore everything a user had on another device/deployment, straight from
 * the shared cloud store: robots rebuilt from their active license keys (with
 * the EA's live name/symbols/image/video), the MT5 connection memory, and
 * payment memory (an active license already proves payment — no second Whop
 * charge for the same EA).
 */
export async function restoreRobotsFromCloud(): Promise<{ robots: number; mt5: boolean }> {
  load();
  if (typeof window === "undefined" || !state.email) return { robots: 0, mt5: false };
  const email = state.email;
  const { syncRestoreLicenses, syncGetMt5Account } = await import("@/lib/account-sync.server");
  const [licenseResult, mt5Result] = await Promise.allSettled([
    syncRestoreLicenses({ data: { email } }),
    syncGetMt5Account({ data: { userId: email } }),
  ]);

  let restoredCount = 0;
  if (licenseResult.status === "fulfilled" && licenseResult.value.enabled) {
    const robots: Robot[] = [];
    for (const license of licenseResult.value.licenses) {
      const clean = license.key.trim().toUpperCase().replace(/\s+/g, "");
      if (!clean || robots.some((robot) => robot.key === clean)) continue;
      // Paused or expired keys restore, but the home screen shows them via the
      // license state — robots only come from active licenses.
      if (!license.active) continue;
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) continue;
      robots.push({
        id: "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        key: clean,
        name: license.eaName || "Private EA",
        symbols: license.symbols,
        // All symbols start under Selected Quotes. Only the symbol the user
        // configures is moved into pairs (Allowed Quotes) — press Configure.
        pairs: [],
        ...(license.eaId ? { eaId: license.eaId } : {}),
        ...(license.image ? { image: license.image } : {}),
        ...(license.video ? { video: license.video } : {}),
        running: false,
      });
      restoredCount += 1;
    }
    if (restoredCount > 0) {
      // Merge with anything already on this device, cloud robots taking
      // precedence by key, then keep existing local-only robots.
      const existing = state.robots.filter((robot) => !robots.some((fresh) => fresh.key === robot.key));
      state = { ...state, activeRobotId: state.activeRobotId ?? robots[0]?.id ?? null, robots: [...robots, ...existing] };
      persist();
    }
  }

  let mt5Restored = false;
  if (mt5Result.status === "fulfilled" && mt5Result.value.enabled && mt5Result.value.record && !state.mt) {
    const record = mt5Result.value.record;
    state = {
      ...state,
      mt: {
        platform: "MT5",
        broker: record.broker,
        server: record.server,
        accountType: record.accountType,
        loginId: record.loginId,
        mcAccountId: record.mcAccountId,
        ...(record.environment ? { environment: record.environment } : {}),
        ...(record.kind === "demo" || record.kind === "live" ? { kind: record.kind } : {}),
      },
    };
    mt5Restored = true;
  }

  // An active license is itself proof of payment — restore payment memory so
  // the user is never charged twice for the same EA on a new deployment.
  if (restoredCount > 0 && state.email && paymentStatusForEmail(state.email) === "unpaid") {
    markEmailPaid(state.email);
  }

  return { robots: restoredCount, mt5: mt5Restored };
}

export function appSignIn(email: string): { error?: string } {
  load();
  const clean = email.trim().toLowerCase();
  if (!clean) return { error: "Enter your email address." };
  const deviceId = getDeviceId();
  const binding = getEmailDeviceBinding(clean);
  if (binding && binding.deviceId !== deviceId) return { error: "Account already used — this email is linked to another device. One email, one device." };
  if (paymentStatusForEmail(clean) === "admin") markEmailPaid(clean);
  state = { ...state, email: clean };
  persist();
  return {};
}

export function appSignOut() {
  load();
  state = { ...state, email: null };
  persist();
}

/**
 * Cloud license lookup — real users receive their key by EMAIL, which saves
 * it to Supabase `license_keys` (mentor portal + admin issuance). The mentor's
 * local store is only checked as a fallback for mentors activating on their
 * own device.
 */
async function findLicenseInCloud(
  key: string,
  email: string,
): Promise<{ error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> } | null> {
  // (shape mirrors findSavedLicenseForEmail's success contract)
  // SHARED client — building a fresh one per activation (dynamic import +
  // createClient) added seconds to every unlock before the first query ran.
  if (!supabaseConfigured || !supabase) return null;
  const client = supabase;
  try {
    // Select ea_name/expiry WITH the core columns. On a legacy table missing
    // those columns PostgREST rejects the ENTIRE select with 42703 — which
    // used to make eaName permanently undefined so the app showed "Private
    // EA" even though the mentor had named their EA. Retry with core columns
    // only, then recover the EA details from the mentor's portal account.
    type LicenseKeyRow = { id: unknown; key: unknown; email: unknown; created_at?: unknown; ea_name?: unknown; expiry?: unknown };
    // Kick the portal scan off IN PARALLEL with the license_keys read —
    // both are independent queries, so the slower one no longer doubles
    // the unlock time.
    const fromPortalPromise = findLicenseInPortalAccounts(key, email);
    let rows: LicenseKeyRow[] = [];
    let error: { code?: string; message: string } | null = null;
    {
      // LIST, not maybeSingle: the admin's "Approve All" issues THE SAME key
      // to many users — one row per email. A single-row read fails with
      // PGRST116 ("multiple rows") and the shared key could never activate.
      const full = await client
        .from("license_keys")
        .select("id, key, email, created_at, ea_name, expiry")
        .eq("key", key);
      if (full.error?.code === "42703") {
        const retry = await client
          .from("license_keys")
          .select("id, key, email, created_at")
          .eq("key", key);
        rows = (retry.data as unknown as LicenseKeyRow[] | null) ?? [];
        error = retry.error;
      } else {
        rows = (full.data as unknown as LicenseKeyRow[] | null) ?? [];
        error = full.error;
      }
    }
    if (error) {
      console.error("[key-activation] cloud lookup failed:", error.message);
      return null;
    }
    // THE PORTAL SCAN IS THE AUTHORITATIVE ANSWER, so it is collected BEFORE
    // any rejection below. A key issued through the mentor portal often has no
    // license_keys row at all, or one row whose `email` column is a different
    // (or empty) value than the one being activated; both used to return early
    // and throw away the scan that carried the EA's real name, picture and
    // symbols — the robot then activated as "Private EA" with the platform
    // logo and an empty Quotes list.
    const fromPortal = await fromPortalPromise;
    if (rows.length === 0) return fromPortal;
    // A key issued to a specific email belongs to THAT email (unset email =
    // open key, activated by whoever enters it first). Shared keys have one
    // row per user — the activator's own row (or the open row) wins.
    const lower = email.trim().toLowerCase();
    const mine = rows.find((row) => typeof row.email === "string" && row.email.trim().toLowerCase() === lower);
    const open = rows.find((row) => typeof row.email !== "string" || row.email.trim() === "");
    if (!mine && !open) {
      // The portal may still hold this key for a license whose clientEmail is
      // blank or already this email — its verdict outranks the empty
      // license_keys column. Only a genuine portal miss is an error.
      if (fromPortal) return fromPortal;
      return { error: "That license key belongs to a different email." };
    }
    const data = (mine ?? open) as LicenseKeyRow;
    // Optional columns (ea_name/expiry) exist only in the updated schema —
    // read them defensively so a legacy row never breaks activation.
    let eaName: string | undefined;
    let expiry: string | undefined;
    const extended = data as unknown as { ea_name?: unknown; expiry?: unknown };
    if (typeof extended.ea_name === "string" && extended.ea_name) eaName = extended.ea_name;
    if (typeof extended.expiry === "string" && extended.expiry) expiry = extended.expiry;
    if (fromPortal?.license) {
      const mergedLicense: { eaName?: string; expiry?: string } = {};
      const mergedName = fromPortal.license.eaName || eaName;
      const mergedExpiry = fromPortal.license.expiry || expiry;
      if (mergedName) mergedLicense.eaName = mergedName;
      if (mergedExpiry) mergedLicense.expiry = mergedExpiry;
      const merged: { error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> } = {
        license: mergedLicense,
      };
      if (fromPortal.ea) merged.ea = fromPortal.ea;
      else if (eaName) merged.ea = { name: eaName };
      return merged;
    }
    const found: { error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> } = {};
    if (eaName) {
      found.license = { eaName, ...(expiry ? { expiry } : {}) };
      found.ea = { name: eaName };
    } else {
      found.license = {};
    }
    return found;
  } catch (lookupError) {
    console.error("[key-activation] cloud lookup error:", lookupError);
    return null;
  }
}

/** Shape of the JSON blob stored in portal_accounts.data (subset we read). */
type PortalAccountShape = {
  email?: string;
  eas?: Array<{ id?: string; name?: string; symbols?: string[]; image?: string; video?: string }>;
  licenses?: Array<{
    id?: string;
    key?: string;
    eaId?: string;
    name?: string;
    robotName?: string;
    expertAdvisor?: string;
    clientEmail?: string;
    symbols?: unknown;
    active?: boolean;
    expiresAt?: string;
  }>;
};

/**
 * Portal-account fallback for key activation: scans the mentor portal store
 * (portal_accounts, readable with the anon key) for a license with this key
 * that belongs to this email, and returns the EA's live details — name,
 * symbols, image, video. This is where "Private EA" gets its real name:
 * keys issued before the license_keys table gained an ea_name column (and
 * keys whose optional columns were dropped by legacy writes) still carry
 * every EA detail inside the mentor's account record.
 */
async function findLicenseInPortalAccounts(
  key: string,
  email: string,
): Promise<{ error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> } | null> {
  // SHARED client — a fresh createClient per unlock added a second-plus of
  // dead time (module import + store boot) before the query even fired.
  if (!supabaseConfigured || !supabase) return null;
  const client = supabase;
  try {
    const { data: rows, error } = await client.from("portal_accounts").select("email, data");
    if (error) {
      console.warn("[key-activation] portal_accounts scan failed:", error.message);
      return null;
    }
    for (const row of (rows ?? []) as Array<{ email?: string; data: unknown }>) {
      let parsed: PortalAccountShape | null = null;
      try {
        parsed = typeof row.data === "string" ? (JSON.parse(row.data) as PortalAccountShape) : (row.data as PortalAccountShape);
      } catch {
        continue;
      }
      if (!parsed) continue;
      for (const license of parsed.licenses ?? []) {
        if (typeof license.key !== "string" || license.key.trim().toUpperCase() !== key) continue;
        const clientEmail = typeof license.clientEmail === "string" ? license.clientEmail.trim().toLowerCase() : "";
        // The key must belong to the activating email: either it was issued
        // TO them (clientEmail) or they are the mentor who holds it.
        //
        // A license with NO clientEmail is an UNASSIGNED key — a valid, open
        // license waiting for whoever activates it first, not somebody else's
        // property. Discarding those unless the activator happened to be the
        // mentor made a perfectly good key fail to resolve, which is why
        // robots activated through it showed "Private EA", the platform logo
        // instead of the EA picture, and an empty symbol list. Only a license
        // explicitly ASSIGNED to a different email is off limits.
        if (clientEmail && clientEmail !== email.trim().toLowerCase()) continue;
        if (license.active === false) return { error: "That license key is paused." };
        const expiresAt = typeof license.expiresAt === "string" ? license.expiresAt : "";
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return { error: "That license key has expired." };
        // Resolve the PARENT EA record. The eaId is the exact link, but
        // licenses issued before the EA list carried ids only name the EA —
        // and a name match is what brings back the picture and the symbols for
        // exactly those keys, which is the whole point of this lookup.
        const eas = parsed.eas ?? [];
        const licenseName = typeof license.name === "string" ? license.name.trim().toLowerCase() : "";
        const ea =
          eas.find((item) => item.id && item.id === license.eaId)
          ?? (licenseName ? eas.find((item) => typeof item.name === "string" && item.name.trim().toLowerCase() === licenseName) : undefined);
        const eaName = ea?.name || license.robotName || license.expertAdvisor || license.name || "";
        const symbols = (ea?.symbols ?? (Array.isArray(license.symbols) ? (license.symbols as string[]) : [])).filter(
          (symbol): symbol is string => typeof symbol === "string",
        );
        // Media from the EA entry first, then the license record itself
        // (issuance embeds the image/video on the license as a fallback).
        // The license's OWN name is the last resort for the picture too — some
        // issuances store it against the license and never on the EA row.
        const image = ea?.image ?? (license as { image?: unknown }).image;
        const video = ea?.video ?? (license as { video?: unknown }).video;
        // Fat cloud data URLs are stashed in IndexedDB behind a tiny ref so
        // the robot record never hits the localStorage quota wall.
        const resolvedVideo = typeof video === "string" && video ? await travelSizedVideo(video) : undefined;
        const result: { error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> } = {
          license: {
            ...(eaName ? { eaName } : {}),
            ...(expiresAt ? { expiry: expiresAt } : {}),
          },
          ea: {
            ...(ea?.id || license.eaId ? { eaId: (ea?.id ?? license.eaId) as string } : {}),
            ...(eaName ? { name: eaName } : {}),
            symbols,
            ...(typeof image === "string" && image ? { image } : {}),
            ...(resolvedVideo ? { video: resolvedVideo } : {}),
          },
        };
        return result;
      }
    }
    return null;
  } catch (scanError) {
    console.warn("[key-activation] portal_accounts scan error:", scanError);
    return null;
  }
}

async function findSavedLicenseForEmail(key: string, email: string) {
  if (typeof window === "undefined") return { error: "License activation is only available in the app." };
  try {
    const raw = window.localStorage.getItem("eamp.store.v1");
    const store = raw ? JSON.parse(raw) : null;
    for (const account of store?.accounts ?? []) {
      const license = (account.licenses ?? []).find((item: { key?: string }) => item.key === key);
      if (!license) continue;
      if (!license.active) return { error: "That license key is paused." };
      if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) return { error: "That license key has expired." };
      if (license.clientEmail && license.clientEmail.toLowerCase() !== email.toLowerCase()) return { error: "That license key belongs to a different email." };
      const ea = (account.eas ?? []).find((item: { id?: string }) => item.id === license.eaId);
      const robotName = ea?.name || license.robotName || license.expertAdvisor || license.name || "Private EA";
      return {
        license,
        ea: {
          eaId: ea?.id || license.eaId,
          name: robotName,
          version: ea?.version,
          symbols: ea?.symbols || license.symbols || [],
          image: ea?.image || license.image,
          video: ea?.video || license.video,
        },
      };
    }
    return { error: "That license key was not found. Confirm the key with your mentor and make sure it was issued to your email." };
  } catch {
    return { error: "That license key could not be checked. Please try again." };
  }
}

export async function activateKey(key: string): Promise<{ error?: string; robot?: Robot }> {
  load();
  // ADMIN LICENSE CAP — the dashboard's "maximum license keys" per user is
  // enforced HERE, at the one place a key turns into an active robot. The
  // count and the cap both come from the database, so a user cannot outrun
  // their allowance by reinstalling or switching devices. No cap set yet
  // (null) leaves the account's own limit rule in charge.
  try {
    const { getLicenseCapForEmail, countKeysForEmail } = await import("@/lib/admin-store");
    if (state.email) {
      const cap = await getLicenseCapForEmail(state.email);
      if (cap !== null) {
        const used = await countKeysForEmail(state.email);
        if (used >= cap) {
          return {
            error:
              cap === 0
                ? "You have no license keys available yet. Ask your admin to raise your key limit."
                : `You have used all ${cap} of your license keys. Ask your admin to raise your key limit.`,
          };
        }
      }
    }
  } catch {
    /* never block activation on a limit lookup failure */
  }
  // Tolerant normalisation: trim, uppercase and strip any spaces the user pasted.
  const clean = key.trim().toUpperCase().replace(/\s+/g, "");
  console.log("[key-activation] Checking key:", clean);
  // Format check: the current generator issues EMP-XXXX-XXXX-XXXX; older
  // legacy keys were EMP- + 12 chars. Both are accepted, any other shape is
  // rejected before it ever reaches the license lookup.
  const validFormat = /^EMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean) || /^EMP-[A-Z0-9]{12}$/.test(clean);
  if (!validFormat) {
    return { error: "That license key is invalid. It should look like EMP-XXXX-XXXX-XXXX (no spaces)." };
  }
  if (state.robots.some((robot) => robot.key === clean)) return { error: "That key is already activated." };
  if (!state.email) return { error: "Sign in with your email before activating a key." };
  // Validate the key first, then enforce the one-device binding before creating a robot.
  // CLOUD FIRST — a license_keys row bound to this email IS proof of payment, so it
  // is resolved BEFORE the local payment gate (a fresh device is always locally
  // unpaid, which must never block a real key-holder). The local mentor-store
  // fallback only runs for emails with LOCAL proof of payment (verified Whop
  // return, admin-exempt, or the mentor's own device) — a forged local record
  // cannot survive the route guards, which verify against the cloud database.
  const cloud = await findLicenseInCloud(clean, state.email);
  let licenseResult: { error?: string; license?: { eaName?: string; expiry?: string }; ea?: Partial<Robot> };
  if (cloud?.license) {
    licenseResult = cloud;
  } else if (paymentStatusForEmail(state.email) === "unpaid") {
    // No cloud license and no local proof of payment — the gate holds.
    return { error: "Complete payment before activating your licence key." };
  } else {
    licenseResult = await findSavedLicenseForEmail(clean, state.email);
  }
  if (licenseResult.error) return { error: licenseResult.error };
  if (!licenseResult.license) return { error: "That license key was not found. Confirm the key with your mentor and make sure it was issued to your email." };
  const deviceResult = bindEmailToDevice(state.email, getDeviceId());
  if (deviceResult.error) return { error: deviceResult.error };
  const savedEa = licenseResult.ea;
  // The mentor's EA picture can be a multi-MB data URL — shrink it BEFORE it
  // enters the robot/localStorage or persist() hits the quota wall and the
  // picture (and every later save) silently fails.
  const robotImage = savedEa?.image ? await travelSizedImage(savedEa.image) : undefined;
  const symbols: string[] = savedEa?.symbols ?? [];
  const robot: Robot = {
    id: "r-" + Date.now(),
    key: clean,
    name: savedEa?.name || licenseResult.license.eaName || "Private EA",
    ...(savedEa?.version ? { version: savedEa.version } : {}),
    symbols,
    // All symbols start under Selected Quotes. Only the symbol the user
    // configures is moved into pairs (Allowed Quotes) — press Configure.
    pairs: [],
    ...(savedEa?.eaId ? { eaId: savedEa.eaId } : {}),
    ...(robotImage ? { image: robotImage } : {}),
    ...(savedEa?.video ? { video: savedEa.video } : {}),
    running: false,
  };
  if (typeof window !== "undefined") window.localStorage.setItem("robotName", robot.name);
  state = { ...state, activeRobotId: state.activeRobotId || robot.id, robots: [...state.robots, robot] };
  // A valid license key IS proof of payment — mark the email paid so the
  // app gate never bounces a freshly-activated user to checkout.
  const activationEmail = state.email;
  if (activationEmail) markEmailPaid(activationEmail);
  // CLOUD PROOF: claim the key on its license_keys row, set users.is_paid=true
  // and bind THIS device in the DATABASE. All three writes are independent —
  // run them IN PARALLEL so activation doesn't queue them one by one. All
  // fire before the redirect to /app/home because /app/home re-verifies
  // against the cloud. Fire-and-forget used to lose that race: the local
  // flag only lives in localStorage, so the gate still saw "unpaid" and
  // bounced the freshly-activated user to Whop checkout (the "activated my
  // key and got kicked out" bug).
  if (activationEmail) {
    const { recordKeyActivationInCloud } = await import("@/lib/supabase-users");
    const proof = await recordKeyActivationInCloud(clean, activationEmail, getDeviceId());
    if (!proof.ok && proof.error) console.warn("[key-activation] cloud proof failed:", proof.error);
  }
  persist();
  return { robot };
}

export function setActiveRobot(id: string) {
  load();
  if (!state.robots.some((robot) => robot.id === id)) return;
  state = { ...state, activeRobotId: id };
  persist();
}

/**
 * Pull the mentor's latest EA data (symbols, image, video) into every activated
 * robot that came from that EA — so portal edits appear in the app immediately,
 * without the user re-activating. Existing per-pair settings are preserved for
 * symbols the EA still has; symbols the mentor removed are dropped.
 */
export async function syncRobotsFromPortal() {
  load();
  if (typeof window === "undefined" || state.robots.length === 0) return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem("eamp.store.v1");
  } catch {
    return;
  }
  if (!raw) return;
  let changed = false;
  try {
    const store = JSON.parse(raw) as { accounts?: { eas?: { id?: string; name?: string; symbols?: string[]; image?: string; video?: string }[] }[] };
    const eas = (store.accounts ?? []).flatMap((account) => account.eas ?? []);
    if (eas.length === 0) return;
    const robots: Robot[] = [];
    for (const robot of state.robots) {
      const ea = eas.find((candidate) => candidate.id && candidate.id === robot.eaId);
      if (!ea) {
        robots.push(robot);
        continue;
      }
      const symbols = Array.isArray(ea.symbols) ? ea.symbols : [];
      const oldPairs = robot.pairs ?? [];
      // ALLOWED QUOTES ARE THE USER'S DECISION. A portal sync may only DROP a
      // pair whose symbol the mentor removed from the EA — it must never wipe
      // the list (it used to assign [], throwing away every symbol the user
      // had allowed on each sync) and never seed new ones in.
      const portalSymbolKeys = new Set(symbols.map((symbol) => symbol.trim().toUpperCase()));
      const pairs: PairSetting[] = oldPairs.filter((pair) =>
        portalSymbolKeys.has(pair.symbol.trim().toUpperCase()),
      );
      const sameSymbols = symbols.length === robot.symbols.length && symbols.every((symbol, index) => symbol === robot.symbols[index]);
      const samePairs = pairs.length === oldPairs.length && pairs.every((pair, index) => pair === oldPairs[index]);
      if (sameSymbols && samePairs && ea.image === robot.image && ea.video === robot.video && (!ea.name || ea.name === robot.name)) {
        robots.push(robot);
        continue;
      }
      changed = true;
      // Shrink oversized pictures BEFORE they enter the robot — a raw photo
      // data URL blows the localStorage quota and the image never persists.
      const robotImage = ea.image ? await travelSizedImage(ea.image) : undefined;
      robots.push({
        ...robot,
        symbols,
        pairs,
        ...(robotImage ? { image: robotImage } : {}),
        ...(ea.video ? { video: ea.video } : {}),
        ...(ea.name ? { name: ea.name } : {}),
      });
    }
    if (!changed) return;
    state = { ...state, robots };
    persist();
  } catch {
    /* ignore malformed portal data */
  }
}

/**
 * CLOUD refresh of activated robots' media — the counterpart to
 * syncRobotsFromPortal (which only reads the LOCAL mentor store, empty on a
 * client's phone). Scans portal_accounts for licenses issued to the signed-in
 * email and pulls the mentor's live EA name/symbols/image/video into every
 * matching robot. This is what repaints a robot that was activated BEFORE
 * the activation path started carrying the picture — no re-activation needed.
 */
export async function syncRobotsFromCloudPortal(): Promise<number> {
  load();
  if (typeof window === "undefined" || !state.email || state.robots.length === 0) return 0;
  const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;
  if (!url || !anonKey) return 0;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = state.email.trim().toLowerCase();
    if (!email) return 0;

    // STEP 1 — THE PICTURE, and only the picture.
    // A mentor's EA stores its picture AND its demo video in one JSON column,
    // and the video is an inline base64 MP4 — 6.4 MB for one EA. Reading the
    // account to get a 74 KB picture meant downloading 27 MB on every home
    // visit, which is what killed the sync on a phone and left the card
    // showing the platform logo. ea_media_for_email() answers the same
    // question in a few kilobytes; the video never leaves the database.
    let picturesApplied = 0;
    try {
      const { data: media, error: mediaError } = await client.rpc("ea_media_for_email", { p_email: email });
      if (mediaError) throw new Error(mediaError.message);
      const entries = Array.isArray(media) ? (media as Array<{ id?: string; name?: string; image?: string }>) : [];
      if (entries.length > 0) {
        const byId = new Map<string, string>();
        const byName = new Map<string, string>();
        for (const entry of entries) {
          if (typeof entry.image !== "string" || !entry.image) continue;
          if (entry.id) byId.set(entry.id, entry.image);
          if (entry.name) byName.set(entry.name.trim().toLowerCase(), entry.image);
        }
        const robots = state.robots.map((robot) => {
          // The EA id is the exact link; the name is the fallback for robots
          // activated before the id started travelling with the license.
          const image = (robot.eaId ? byId.get(robot.eaId) : undefined)
            ?? byName.get((robot.name ?? "").trim().toLowerCase());
          if (!image || image === robot.image) return robot;
          picturesApplied += 1;
          return { ...robot, image };
        });
        if (picturesApplied > 0) {
          state = { ...state, robots };
          persist();
        }
      }
    } catch (error) {
      // The function is new (supabase/ea-media.sql). Until it is installed
      // the picture still has to come from the full read below, so this is
      // a fallback, not a failure.
      console.warn("[app-store] ea_media_for_email unavailable, falling back", error);
    }

    // STEP 2 — everything else (symbols, video) from the mentor accounts.
    // Narrowed to the accounts that mention this user: reading the whole
    // table is the 27 MB download this replaces.
    const { data: targeted, error: targetedError } = await client
      .from("portal_accounts")
      .select("email, data")
      .or(`data.ilike.*${email}*`);
    let rows = targeted;
    if (targetedError || !rows) {
      // The filter is an optimisation, never a requirement: if the server
      // cannot run it, fall back to the full read rather than lose the sync.
      console.warn("[app-store] targeted cloud sync failed, reading all accounts", targetedError?.message);
      const fallback = await client.from("portal_accounts").select("email, data");
      if (fallback.error || !fallback.data) return picturesApplied;
      rows = fallback.data;
    }
    // Stash each distinct cloud video once per sync (IndexedDB behind a tiny
    // ref) — the same EA media would otherwise be re-processed per license.
    const videoCache = new Map<string, Promise<string | undefined>>();
    const stashCloudVideo = (value: string): Promise<string | undefined> => {
      let cached = videoCache.get(value);
      if (!cached) {
        cached = travelSizedVideo(value);
        videoCache.set(value, cached);
      }
      return cached;
    };
    // Same treatment for PICTURES — a raw mentor photo must be shrunk before
    // it lands in the robot, or persist() hits the quota wall and the image
    // (plus every later save) silently fails.
    const imageCache = new Map<string, Promise<string | undefined>>();
    const stashCloudImage = (value: string): Promise<string | undefined> => {
      let cached = imageCache.get(value);
      if (!cached) {
        cached = travelSizedImage(value);
        imageCache.set(value, cached);
      }
      return cached;
    };
    // key → EA details, from every mentor account holding a license for me.
    const byKey = new Map<string, { name?: string; symbols?: string[]; image?: string; video?: string }>();
    // name → EA details, the FALLBACK link for robots whose key does not match
    // anything in the portal (an EA re-issued under a new key, or a robot
    // activated before the key was written to license_keys). Without this the
    // picture and symbols never come back for those robots.
    const byName = new Map<string, { name?: string; symbols?: string[]; image?: string; video?: string }>();
    /**
     * Index ONE account row's licenses.
     *
     * `strict` decides who owns an unassigned license. On the first (targeted)
     * pass it is true, so only licenses issued TO this email — or held by this
     * email's own mentor account — are indexed. On the second (full) pass it is
     * false, and a license with a BLANK clientEmail counts too: that is a valid
     * unassigned key this device may legitimately own, and refusing to index it
     * is what left those robots with the platform logo and no symbols.
     * A license explicitly assigned to a DIFFERENT email is never indexed.
     */
    const indexRow = async (row: { email?: string; data: unknown }, strict: boolean) => {
      let parsed: PortalAccountShape | null = null;
      try {
        parsed = typeof row.data === "string" ? (JSON.parse(row.data) as PortalAccountShape) : (row.data as PortalAccountShape);
      } catch {
        return;
      }
      if (!parsed) return;
      const accountEmail = (parsed.email ?? row.email ?? "").trim().toLowerCase();
      for (const license of parsed.licenses ?? []) {
        if (typeof license.key !== "string" || !license.key) continue;
        const clientEmail = typeof license.clientEmail === "string" ? license.clientEmail.trim().toLowerCase() : "";
        if (strict) {
          if (clientEmail !== email && accountEmail !== email) continue;
        } else if (clientEmail && clientEmail !== email) {
          continue;
        }
        // Resolve the parent EA by id first, then by name — licenses issued
        // before the EA list carried ids only name it, and those keys are
        // exactly the ones that came back with no picture and no symbols.
        const eas = parsed.eas ?? [];
        const licenseName = typeof license.name === "string" ? license.name.trim().toLowerCase() : "";
        const ea =
          eas.find((item) => item.id && item.id === license.eaId)
          ?? (licenseName ? eas.find((item) => typeof item.name === "string" && item.name.trim().toLowerCase() === licenseName) : undefined);
        const eaName = ea?.name || license.robotName || license.expertAdvisor || license.name;
        // IMAGE/VIDEO come from the EA entry, falling back to the license
        // record itself (newer issuance embeds the media on the license so
        // the picture reaches the cloud even when the EA list has not).
        const image = ea?.image ?? (license as { image?: unknown }).image;
        const video = ea?.video ?? (license as { video?: unknown }).video;
        const resolvedVideo = typeof video === "string" && video ? await stashCloudVideo(video) : undefined;
        const resolvedImage = typeof image === "string" && image ? await stashCloudImage(image) : undefined;
        const details = {
          ...(eaName ? { name: eaName } : {}),
          symbols: (ea?.symbols ?? (Array.isArray(license.symbols) ? (license.symbols as string[]) : [])).filter(
            (symbol): symbol is string => typeof symbol === "string",
          ),
          ...(resolvedImage ? { image: resolvedImage } : {}),
          ...(resolvedVideo ? { video: resolvedVideo } : {}),
        };
        byKey.set(license.key.trim().toUpperCase(), details);
        if (details.name) byName.set(details.name.trim().toLowerCase(), details);
      }
    };
    for (const row of rows as Array<{ email?: string; data: unknown }>) {
      await indexRow(row, true);
    }
    // NO MATCHES FROM THE TARGETED READ — widen it. The `data.ilike` filter can
    // only find accounts that literally contain this email, so an UNASSIGNED
    // license (blank clientEmail, held in the mentor's account) is invisible to
    // it. A second full read is the only way those robots get their EA back;
    // it is the same fallback the filtered read already had for server errors.
    let anyMatch = false;
    for (const robot of state.robots) {
      if (byKey.has(robot.key.trim().toUpperCase()) || byName.has((robot.name ?? "").trim().toLowerCase())) {
        anyMatch = true;
        break;
      }
    }
    if (!anyMatch) {
      const wide = await client.from("portal_accounts").select("email, data");
      if (wide.error || !wide.data) return 0;
      for (const row of wide.data as Array<{ email?: string; data: unknown }>) {
        await indexRow(row, false);
      }
    }
    if (byKey.size === 0 && byName.size === 0) return 0;
    let updated = 0;
    const robots = state.robots.map((robot) => {
      // Match on the key FIRST (it is the exact link) and fall back to the EA
      // name, so a robot still recovers its picture and symbols when its key
      // is not the one the portal holds.
      const fresh = byKey.get(robot.key.trim().toUpperCase()) ?? byName.get((robot.name ?? "").trim().toLowerCase());
      if (!fresh) return robot;
      // BACKFILL, do not clobber: an empty local symbol list is filled from the
      // cloud rather than left empty (which showed "No symbols on this EA"
      // forever), and a missing picture is taken from the cloud rather than
      // falling back to the platform logo forever.
      const symbols = fresh.symbols && fresh.symbols.length > 0 ? fresh.symbols : robot.symbols;
      const image = fresh.image ?? robot.image;
      const oldPairs = robot.pairs ?? [];
      // ONLY the symbols the user already allowed survive this sync. Every
      // other EA symbol must stay in "Selected Quotes" until they approve it
      // — the old code filled the gap with a default entry, which dumped
      // symbols they never allowed straight into "Allowed Quotes" (and START
      // then traded them).
      const cloudSymbolKeys = new Set(symbols.map((symbol) => symbol.trim().toUpperCase()));
      const pairs = oldPairs.filter((pair) => cloudSymbolKeys.has(pair.symbol.trim().toUpperCase()));
      const sameSymbols = symbols.length === robot.symbols.length && symbols.every((symbol, index) => symbol === robot.symbols[index]);
      const samePairs = pairs.length === oldPairs.length && pairs.every((pair, index) => pair === oldPairs[index]);
      if (sameSymbols && samePairs && image === robot.image && fresh.video === robot.video && (!fresh.name || fresh.name === robot.name)) return robot;
      updated += 1;
      return {
        ...robot,
        symbols,
        pairs,
        ...(image ? { image } : {}),
        ...(fresh.video ? { video: fresh.video } : {}),
        ...(fresh.name ? { name: fresh.name } : {}),
      };
    });
    if (updated > 0) {
      state = { ...state, robots };
      persist();
    }
    return updated + picturesApplied;
  } catch (error) {
    // Silent failure is what made this look like "the picture is missing"
    // rather than "the sync died". Say so in the console (adb logcat on the
    // Android wrapper forwards it).
    console.warn("[app-store] cloud robot sync failed", error);
    return 0;
  }
}

export function setRobotPairs(id: string, pairs: PairSetting[]) {
  load();
  const safePairs = pairs.filter((pair) => pair.symbol.trim()).map((pair) => ({
    symbol: pair.symbol.trim().toUpperCase(),
    lotSize: pair.lotSize || "0.01",
    maxTrades: pair.maxTrades || "0",
    ...(pair.direction && pair.direction !== "BOTH" ? { direction: pair.direction } : {}),
  }));
  state = {
    ...state,
    robots: state.robots.map((robot) => robot.id === id ? { ...robot, pairs: safePairs } : robot),
  };
  persist();
}

export function toggleRobot(id: string) {
  load();
  state = {
    ...state,
    robots: state.robots.map((r) => (r.id === id ? { ...r, running: !r.running } : r)),
  };
  persist();
}

export function removeRobot(id: string) {
  load();
  const robots = state.robots.filter((r) => r.id !== id);
  state = { ...state, activeRobotId: state.activeRobotId === id ? (robots[0]?.id ?? null) : state.activeRobotId, robots };
  persist();
}

export function connectMt(mt: MtAccount) {
  load();
  state = { ...state, mt };
  persist();
}

export function disconnectMt() {
  load();
  state = { ...state, mt: null };
  // The device-held password (used for direct bridge execution) must not
  // outlive the saved MT5 account.
  try {
    window.localStorage.removeItem("mt_password");
  } catch {
    /* ignore */
  }
  persist();
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  load();
  state = { ...state, settings: { ...state.settings, [key]: value } };
  persist();
}
