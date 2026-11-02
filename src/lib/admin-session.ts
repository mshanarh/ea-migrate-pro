/**
 * SCOPED SESSION REVOCATION — THE SOLE ADMIN, ON EVERY DEVICE.
 *
 * The app's session lives in the DEVICE's own storage (`eamp.app.v3`), so no
 * server call can delete it. This is the remote "sign me out everywhere" for
 * one account, and it works the same way the app's global logout epochs do: a
 * number shipped in the bundle is compared with a number the device recorded.
 *
 *   • bump `ADMIN_SESSION_EPOCH` → every device that is SIGNED IN AS THE SOLE
 *     ADMIN drops that session on its next boot (see `runForceReset`) or its
 *     next `/app` navigation (see `requireVerifiedAccess`), lands on
 *     /app/login, and has to sign in again through the normal flow. The
 *     account's payment exemption is unchanged; its device binding and
 *     reactivation rules apply exactly as they do to everybody else.
 *   • the stamp is written on EVERY device that asks, admin or not, so a
 *     device that was signed in as somebody else at the time of the bump does
 *     not kick the admin the moment they sign in afterwards.
 *   • nothing else is touched: other emails' sessions are untouched, and the
 *     admin can sign straight back in.
 */
export const ADMIN_SESSION_EPOCH = 1;

/** localStorage key that records the revocation this device has applied. */
export const ADMIN_SESSION_EPOCH_KEY = "eamp.admin-session-epoch.v1";

/** The sole admin, and its bare-domain variant — the same pair the server uses. */
export const ADMIN_SESSION_EMAILS = ["biyasentobeko222@gmail.com", "biyasentobeko222@gmail"];

/** Is this the sole admin's address? */
export function isSoleAdminSession(email: string | null | undefined): boolean {
  const clean = (email ?? "").trim().toLowerCase();
  return ADMIN_SESSION_EMAILS.includes(clean);
}

/**
 * MUST THIS DEVICE DROP THE ADMIN'S SESSION?
 *
 * True at most once per device per epoch, and only when the session on this
 * device belongs to the sole admin. Safe to call on every navigation: after the
 * first answer the stamp matches and this is a single localStorage read.
 */
export function adminSessionRevoked(email: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  let seen = 0;
  try {
    seen = Number(window.localStorage.getItem(ADMIN_SESSION_EPOCH_KEY) ?? "0") || 0;
  } catch {
    // Storage blocked (private mode, hardened WebView): no stamp can be read,
    // so no revocation can be applied — and none can be recorded either.
    return false;
  }
  if (seen >= ADMIN_SESSION_EPOCH) return false;
  try {
    window.localStorage.setItem(ADMIN_SESSION_EPOCH_KEY, String(ADMIN_SESSION_EPOCH));
  } catch {
    /* stamping is best effort — the session is still dropped below */
  }
  return isSoleAdminSession(email);
}
