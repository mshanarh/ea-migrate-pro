import { AUTH_EPOCH, enforceAuthEpoch } from "./auth-store";
import { appSignOut, getAppState } from "./app-store";
import { adminSessionRevoked } from "./admin-session";

/**
 * ONE-TIME GLOBAL LOGOUT — deploy-gated, runs on every device exactly once.
 *
 * Called at router-module init (before any route can render), so a bumped
 * `AUTH_EPOCH` takes effect BEFORE the first paint: every session is wiped and
 * its owner is sent back to the app's first page. Web and Android both load
 * this bundle, so one bump covers both.
 *
 * THE WIPE IS TOTAL AND DELIBERATE. `enforceAuthEpoch()` clears localStorage
 * AND sessionStorage outright, then stamps `app_epoch` with the new value.
 * That signs out EVERYONE — clients, mentors and admins alike — including
 * anyone holding a session that the server would otherwise still honour. The
 * Supabase database is untouched: users, payments, licences, approvals and
 * device bindings all live in the cloud, so a real user simply signs in again
 * and the mentor portal repopulates itself from the cloud.
 *
 * This replaced a surgical logout that preserved the portal store locally.
 * The blunt wipe is intentional now: a partial reset could leave a stale
 * approval or a stale "paid" marker alive on a device, which is exactly the
 * class of bug this epoch exists to eliminate.
 *
 * To force ANOTHER global logout later, bump AUTH_EPOCH in src/lib/auth-store.ts.
 * For a logout scoped to the SOLE ADMIN only, bump ADMIN_SESSION_EPOCH in
 * src/lib/admin-session.ts — that one never touches anybody else.
 */
export function runForceReset(): void {
  if (typeof window === "undefined") return;

  // Read the "did this device have a session?" signal BEFORE the wipe — after
  // `clear()` there is nothing left to inspect.
  let hadSession = false;
  try {
    hadSession =
      window.localStorage.getItem("eamp.app.v3") !== null ||
      window.localStorage.getItem("eamp.store.v1") !== null ||
      window.localStorage.getItem("eamp.pending-payment-email") !== null ||
      window.localStorage.getItem("eamp.device.id") !== null ||
      window.localStorage.getItem("eamp.access-epoch.v1") !== null ||
      window.localStorage.getItem("eamp_session_v2") !== null ||
      Object.keys(window.sessionStorage).some((key) => key.startsWith("eamp"));
  } catch {
    /* storage blocked — treat as "no session to kick" */
  }

  // The scoped revocation reads the session email BEFORE the storage wipe, so
  // a global reset and a scoped one can never mask each other.
  const sessionEmail = getAppState().email;
  const wiped = enforceAuthEpoch();
  // A global wipe already dropped this device's admin session; stamping the
  // scoped epoch as applied is what stops the admin being kicked a second time
  // the moment they sign back in.
  if (wiped) adminSessionRevoked(null);
  const revokedAdmin = !wiped && adminSessionRevoked(sessionEmail);
  if (revokedAdmin) appSignOut();

  // Anyone who HAD a session starts from the email page again. A first-time
  // visitor has nothing to be kicked out of, and any /app/* route already
  // lands them on /app/login through its guard.
  if ((wiped && hadSession) || revokedAdmin) {
    try {
      window.location.replace("/app/login");
    } catch {
      /* a container that refuses to navigate — the route guards still hold */
    }
  }
}

/** The epoch currently shipped — exposed for diagnostics/tests. */
export const CURRENT_AUTH_EPOCH = AUTH_EPOCH;
