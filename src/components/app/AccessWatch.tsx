import { useEffect } from "react";
import { appSignOut, useAppState } from "@/lib/app-store";
import { requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";

/**
 * THE MID-SESSION ACCESS WATCH — the owner's "Set unpaid" must reach a device
 * that is ALREADY inside the app.
 *
 * Every `/app` route guard asks the cloud on NAVIGATION, and Home re-asks on a
 * poll. Both read the gate's cache, where a confirmed "paid" answer is held for
 * five minutes — so a customer the owner deactivated while sitting on Metatrader
 * (or even on Home) stayed signed in until they happened to change screens or
 * the cached answer expired, and a backgrounded app never noticed at all.
 *
 * This watcher is mounted ONCE for the whole app shell (root route) and asks
 * the cloud with `fresh: true`, which skips the cache entirely and rewrites it
 * with the answer. It runs every POLL_MS while the screen is visible, and again
 * on wake (tab focus, page restore) so a phone coming back from the background
 * checks before the user can trade. A "revoked" answer signs the session out
 * and lands on /app/login?deactivated=1 — the same first page every other
 * refusal path uses.
 *
 * IT NEVER EJECTS ON DOUBT. `retry` (a store could not be read) and `pay` with
 * `undecided` (the cloud gave no verdict at all) are retried on the next tick;
 * only a DECIDED answer from the server ends a session, so a flaky network can
 * never lock a paying customer out.
 *
 * A fresh check every POLL_MS is deliberately cheap: `/api/check-access`
 * answers the verdict and the device binding in one round trip, and nothing is
 * rendered from it — the screen only leaves when the answer says so.
 */

/** How often the cloud is re-asked while the app is on screen. */
const POLL_MS = 20_000;
/** Wake events can fire in bursts (focus + pageshow + visibilitychange). */
const WAKE_THROTTLE_MS = 4_000;

/** Act on one verdict. Returns true when the session was ended. */
export function applyMidSessionVerdict(verdict: AppAccessCheck): boolean {
  if (verdict.action === "pass") return false;
  if (verdict.action === "deactivate") {
    appSignOut();
    window.location.replace("/app/login?deactivated=1");
    return true;
  }
  if (verdict.action === "signin") {
    appSignOut();
    window.location.replace("/app/login");
    return true;
  }
  if (verdict.action === "pay") {
    // No verdict is NOT a refusal — keep the screen and ask again.
    if (verdict.undecided) return false;
    appSignOut();
    window.location.replace("/app/login?pay=1");
    return true;
  }
  // "retry": a source was unreadable. Retried on the next tick.
  return false;
}

export function AccessWatch() {
  const { email } = useAppState();

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    let running = false;
    let lastWake = 0;

    const check = async () => {
      if (cancelled || running) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      running = true;
      try {
        const verdict = await requireVerifiedAccess(email, { fresh: true });
        if (!cancelled) applyMidSessionVerdict(verdict);
      } catch {
        // A thrown check is not a refusal — the next tick asks again.
      }
      running = false;
    };

    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastWake < WAKE_THROTTLE_MS) return;
      lastWake = now;
      void check();
    };

    const timer = window.setInterval(() => void check(), POLL_MS);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [email]);

  return null;
}

export default AccessWatch;
