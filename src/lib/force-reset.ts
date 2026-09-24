/**
 * ONE-TIME forced logout — deploy-gated, runs on every device exactly once.
 *
 * Called at router-module init (before any route can render):
 *   1. Every trace of a signed-in session is cleared — the app store (email,
 *      robots/license memory, MT5 memory), the pending-payment marker, ALL
 *      session storage, the legacy session keys, and the mentor portal's
 *      signed-in-account pointer.
 *   2. Anyone who HAD a session is hard-redirected to /app/login — the app's
 *      first page, where the email is entered. Nobody auto-logs-in after
 *      this, not even admins.
 *
 * Deliberately NOT touched (this is a logout, not a data wipe): the
 * mentor-portal database (eamp.store.v1 accounts/licenses/payments), the
 * device binding, scan counters, and brand/media stores.
 *
 * To force ANOTHER global logout later, bump FORCE_RESET_VERSION.
 */
const FORCE_RESET_VERSION = "force-logout-2026-09-24";
const FLAG_KEY = "eamp.force-reset.v1";

/** Literal legacy session keys from the user's reset list. */
const LEGACY_SESSION_KEYS = ["licenseKey", "ea_license_key", "userEmail", "session"];

export function runForceReset() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(FLAG_KEY) === FORCE_RESET_VERSION) return;

    const hadSession =
      LEGACY_SESSION_KEYS.some((key) => window.localStorage.getItem(key) !== null) ||
      window.localStorage.getItem("eamp.app.v3") !== null ||
      window.localStorage.getItem("eamp.pending-payment-email") !== null ||
      Object.keys(window.sessionStorage).some((key) => key.startsWith("eamp"));

    // 1. Session buckets: everything a signed-in session leaves behind.
    window.sessionStorage.clear();
    for (const key of LEGACY_SESSION_KEYS) window.localStorage.removeItem(key);
    window.localStorage.removeItem("eamp.pending-payment-email");
    window.localStorage.removeItem("robotName");

    // 2. The app session store (email, robots/licenses, MT5 memory) — the
    //    next load re-initialises it to its default empty state. Theme and
    //    layout keys ride along: they are app-scoped state, not user data.
    window.localStorage.removeItem("eamp.app.v3");
    window.localStorage.removeItem("layout");
    window.localStorage.removeItem("themeColor");

    // 3. Portal sign-in pointer: accounts/licenses/payments survive, but the
    //    signed-in mentor/admin does not — the portal dashboard guard sends
    //    them to /signin on next visit.
    const raw = window.localStorage.getItem("eamp.store.v1");
    if (raw) {
      try {
        const store = JSON.parse(raw) as { currentId?: string | null };
        if (store && "currentId" in store) {
          store.currentId = null;
          window.localStorage.setItem("eamp.store.v1", JSON.stringify(store));
        }
      } catch {
        /* ignore malformed store */
      }
    }

    // Set BEFORE redirecting so the /app/login load never re-runs this.
    window.localStorage.setItem(FLAG_KEY, FORCE_RESET_VERSION);

    // 4. Everyone who HAD a session starts from the email page again.
    //    (Visitors with no session at all have nothing to be kicked out of;
    //    opening any /app/* page already lands them on /app/login via guards.)
    if (hadSession) window.location.replace("/app/login");
  } catch {
    /* storage blocked — the route guards still keep everyone out of the app */
  }
}
