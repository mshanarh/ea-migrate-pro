import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAppState, hasPendingLicense } from "@/lib/app-store";

/**
 * /app is a redirect — the app's first page used to be /app/login, so opening
 * the app always demanded the email again even when the session was already
 * saved in localStorage (`eamp.app.v3`). That is the "I am already logged in
 * and it still asks for my email" bug.
 *
 * The rule now:
 *   • a saved email and no ?reset=1  → straight into /app/home
 *   • a saved email and ?reset=1      → /app/login (the explicit "start over"
 *     escape hatch, so a stale session can always be cleared by hand)
 *   • no saved email                  → /app/login
 *
 * The Whop checkout returns users to /app?success=true, so ?success is still
 * forwarded — that flow needs the login screen to verify the payment.
 *
 * NOTE: this is a CONVENIENCE redirect, not the security boundary.
 * /app/home's own beforeLoad re-verifies the session against the cloud on every
 * entry, so a hand-edited localStorage still cannot grant access.
 */
export const Route = createFileRoute("/app/")({
  ssr: false,
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.search);
    const reset = params.get("reset") === "1";
    const sessionEmail = getAppState().email;
    /**
     * AN OWED LICENCE KEY GOES BACK TO THE LICENCE FORM, not to /app/home.
     *
     * This is the launch path of the Android/ios wrapper: reopen the app, the
     * saved session is still there, and the old rule sent the person to the
     * dashboard — whose guard has nothing to show an account with no robot and
     * hands them to the login page, i.e. "it went back to the first page".
     * While a key is owed, the licence form is the correct destination and this
     * screen must not decide otherwise.
     */
    if (sessionEmail && !reset && getAppState().robots.length === 0 && hasPendingLicense(sessionEmail)) {
      throw redirect({ href: "/app/login?license=1" });
    }
    if (sessionEmail && !reset) {
      throw redirect({ href: "/app/home" });
    }
    const success = params.get("success");
    throw redirect({ href: success ? `/app/login?success=true` : "/app/login" });
  },
  component: () => null,
});