import { BrandLogo } from "@/components/BrandLogo";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { usePlatform } from "@/lib/platform";
import { OWNER_EMAILS } from "@/lib/auth-store";
import { ArrowRight, Check, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  activateKey,
  appSignIn,
  appSignOut,
  clearPendingLicense,
  getAppState,
  getDeviceId,
  hasPendingLicense,
  leaveForCheckout,
  markPendingLicense,
  useAppState,
} from "@/lib/app-store";
import { enforceAuthEpoch, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { callNative } from "@/lib/native-bridge";
import {
  verifyPaymentReturn,
  invalidateAccessCache,
  resolveCloudAccess,
  requireVerifiedAccess,
  type AppAccessCheck,
  type CloudAccess,
} from "@/lib/payment-gate";
import { bindDeviceToEmail, checkDeviceBinding, registerWithEmail } from "@/lib/supabase-users";
import { checkActivationCode, requestActivationCode } from "@/lib/activation-client";
import { accentColorValue, useCustomization } from "@/lib/app-customization";

/**
 * Query flags that mean "this page was DELIBERATELY sent here" — a route guard
 * or a payment return. Each one has to keep the user on the login screen even
 * when a session email is sitting in localStorage, or the resume redirect would
 * bounce them straight back where they came from:
 *   ?pay=1         — the access gate decided this account must pay
 *   ?deactivated=1 — an admin pressed "Set unpaid"; there is a notice to read
 *   ?success=true  — straight back from Whop checkout, awaiting verification
 *   ?reset=1       — the explicit "start over" escape hatch
 *   ?license=1     — the account proved its code and still owes a licence key;
 *                    this screen holds the form instead of hopping into the app
 */
const RESUME_EXEMPT_FLAGS = new Set(["pay", "deactivated", "success", "reset", "awaiting", "license"]);

/**
 * Support contact shown wherever the customer has to finish something by hand.
 * These are the same addresses the marketing FAQ quotes, so the copy matches
 * what they have been told elsewhere on the site.
 */
const SUPPORT_EMAIL = "eamigratepro@gmail.com";
const SUPPORT_WHATSAPP = "070 495 0612";

export const Route = createFileRoute("/app/login")({
  ssr: false,
  /**
   * PERSISTENT SESSION — never ask for the email twice.
   *
   * A saved session (localStorage `eamp.app.v3`) used to be ignored here, so
   * every app launch opened the email form even for someone already signed in
   * — including on the deep link out of the Whatsop/checkout return. If the
   * database is asked first (requireVerifiedAccess, which is the authority
   * everywhere else), this screen can send an entitled session straight on.
   *
   * This is CONVENIENCE ONLY, never the security boundary: /app/home's own
   * beforeLoad re-verifies against the cloud on entry, so a hand-edited
   * localStorage still cannot grant access. The flags in RESUME_EXEMPT_FLAGS
   * are the deliberate hand-offs and must survive the redirect.
   */
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.search);
    for (const flag of RESUME_EXEMPT_FLAGS) {
      if (params.get(flag) === "1" || params.get(flag) === "true") return;
    }
    if (getAppState().email) throw redirect({ href: "/app/home" });
  },
  head: () => ({
    meta: [
      { title: "Login — EA Migrate" },
      { name: "description", content: "Enter your email to continue to EA Migrate." },
    ],
  }),
  component: AppAccess,
});

/**
 * THE TWO CHECKOUT TARGETS. Declared at the top of the file so the exact Whop
 * URLs live in exactly one place and the plan cards cannot drift from them.
 */
export const WHOP_LIFETIME_URL = "https://whop.com/checkout/plan_pAzDfC1tIC9p3";
export const WHOP_MONTHLY_URL = "https://whop.com/checkout/plan_wgIWJdSwjlMGS";

/** Which plan the customer picked. Monthly is the default. */
export type PlanId = "monthly" | "lifetime";

/**
 * THE PLANS. An unpaid account stops on the Plan Selection screen and picks
 * one; nothing hops automatically, because there are two destinations and
 * guessing would send somebody to the wrong product.
 */
const PLANS: Record<
  PlanId,
  { url: string; title: string; badge: string; subtitle: string; note: string }
> = {
  monthly: {
    url: WHOP_MONTHLY_URL,
    title: "Monthly Subscription",
    badge: "Recurring — Per Month",
    subtitle: "Billed monthly. Cancel anytime.",
    note: "(Recurring)",
  },
  lifetime: {
    url: WHOP_LIFETIME_URL,
    title: "Lifetime Access",
    badge: "Lifetime Access",
    subtitle: "Pay once, keep access forever. No recurring fees.",
    note: "(One-Time)",
  },
};

/** The order the plans are offered in — monthly first, it is the default. */
const PLAN_ORDER: PlanId[] = ["monthly", "lifetime"];

/**
 * A HARD DEADLINE around every cloud call on the way in.
 *
 * A sign-in is a chain of five or six sequential Supabase round trips, and a
 * stalled mobile connection leaves `fetch` pending indefinitely — the button
 * said "Redirecting to Whop…" forever and nothing ever happened. Nothing on
 * this path is allowed to freeze the door: if a call has not answered in
 * time, the screen moves on with a safe fallback and the route guard on
 * /app/home (which is cloud-authoritative anyway) has the final say.
 */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function AppAccess() {
  const platform = usePlatform();
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const [key, setKey] = useState("");
  const [successReturn, setSuccessReturn] = useState(false);
  /**
   * Paid on Whop, not yet activated by the owner. A waiting room, not a
   * refusal — see the `verifyPaymentReturn` effect below.
   */
  const [awaitingActivation, setAwaitingActivation] = useState(false);

  /**
   * WAITING ROOM → APP, THE MOMENT THEY ARE MARKED PAID.
   *
   * Activation is a manual step the owner performs in the console, so the
   * person who has already paid is sitting on a screen that cannot know when
   * that happens. Polling turns that from "close the app and keep reopening it"
   * into "leave it open and it goes through by itself".
   *
   * `fresh: true` on every tick is deliberate: the gate caches a POSITIVE
   * answer for a minute, but a refusal is only cached for 5s, so the very first
   * poll after the ledger row appears already sees it. 15s is well inside that.
   * Anything other than a plain refusal — deactivated, revoked — leaves the
   * screen alone rather than bouncing somebody somewhere they did not ask to
   * go, and the route guards still decide what actually opens.
   */
  useEffect(() => {
    if (!awaitingActivation) return;
    const waitingEmail = app.email || email.trim().toLowerCase();
    if (!waitingEmail) return;
    let cancelled = false;
    const poll = async () => {
      const status = await resolveCloudAccess(waitingEmail, { fresh: true });
      if (cancelled) return;
      if (status === "paid" || status === "admin") {
        setAwaitingActivation(false);
        window.location.replace("/app/home");
      }
    };
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [awaitingActivation, app.email, email]);
  const [redirecting, setRedirecting] = useState(false);
  // True once we know this email must pay: renders the Choose Plan screen
  // (monthly + lifetime) instead of any part of the app.
  const [choosePlan, setChoosePlan] = useState(false);
  // WHICH PLAN THE CUSTOMER PICKED. Monthly is the default, and the choice
  // only decides which Whop URL the Continue button opens — selecting a card
  // never charges anybody or navigates on its own.
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("monthly");
  // A sign-in attempt is IN FLIGHT. Set synchronously by the Proceed tap,
  // before the first await, and cleared on every exit except checkout.
  // Without it the auto-redirect effect below fired on the render right
  // after appSignIn() and hard-navigated to /app/home, destroying this
  // async flow before it could ever reach checkout — which is exactly the
  // "I pressed Proceed and it bounced me back to Login" bug.
  const [busy, setBusy] = useState(false);
  // ?pay=1 — /app/home's guard decided this email must pay and handed the
  // decision here, because an external URL is NOT a valid router location.
  const [payPrompt, setPayPrompt] = useState(false);
  // ?deactivated=1 — this account was marked UNPAID in the admin console
  // while it was signed in. The gate ended the session and sent it here;
  // the notice below is what the person is told.
  const [deactivated, setDeactivated] = useState(false);
  // EMAIL ALREADY USED — the email is bound to another device in the CLOUD.
  // The sign-in form swaps for a blocked card: the user must ask their
  // mentor to release the device (Re-activate Client in the mentor portal).
  // NO self-reactivation: delete + reinstall must NOT unlock the account.
  // Applies to EVERYONE — clients and admins alike.
  const [blockedEmail, setBlockedEmail] = useState<string | null>(null);
  /**
   * RESUMING A SAVED SESSION.
   *
   * True from the first paint whenever localStorage already holds an email, and
   * it stays true until the cloud has ruled on that session. It renders the
   * "Restoring your session…" screen instead of the email form, which is the
   * whole point of the persistent session: an activated user is NEVER asked for
   * their email again on a normal launch.
   *
   * It is deliberately NOT seeded from `app.email` (a reactive snapshot) but
   * from the store read at mount, so it cannot flicker on after a fresh
   * sign-in typed on this very screen — that flow stays on the form until its
   * own handler finishes.
   */
  /**
   * A LICENCE KEY IS STILL OWED (see `hasPendingLicense` in app-store.ts).
   *
   * Set the moment the code step succeeds for an account that has no robot
   * yet, and cleared only when a key activates (or the session is signed out).
   * While it is true this screen shows the licence form and the resume
   * handshake does NOT run — the handshake would answer "pass", which is what
   * walked a paid customer out of this form and, on the next launch, back onto
   * the email form. That round trip is the bug being fixed.
   */
  const [licensePending, setLicensePending] = useState<boolean>(() =>
    hasPendingLicense(getAppState().email),
  );
  // A SAVED SESSION IS RESUMED ONLY WHEN NO LICENCE KEY IS OWED — otherwise
  // the first paint is already the licence form and there is no ResumingView
  // flash to sit through.
  const [resuming, setResuming] = useState<boolean>(
    () => Boolean(getAppState().email) && !hasPendingLicense(getAppState().email),
  );
  // NOTE: there is deliberately no "waiting for approval" card here any more.
  // Mentor approval is a PORTAL decision; typing an email into the app is a
  // payment attempt, so the only two outcomes are "you are paid, welcome" and
  // Whop. The portal signup (src/routes/signup.tsx) still asks for approval.
  /**
   * THE DATABASE'S ANSWER for this session, read on arrival.
   *
   * The local store only knows what THIS device has seen, so opening the app
   * with a signed-in but never-verified session looked identical to opening
   * it as a paying customer — the person landed on a login form and had to
   * work it out themselves. resolveCloudAccess is the same function the route
   * guards use, so the first screen agrees with the gate by construction.
   * `null` means the database could not be reached; the local store is the
   * fallback hint until it answers.
   */
  // Typed to `CloudAccess` ONLY — there is deliberately no "approved" member.
  // Mentor approval is a PORTAL decision and must never reach this screen's
  // access logic, so the state that drives the app cannot even represent it.
  const [cloudStatus, setCloudStatus] = useState<CloudAccess | null>(null);
  // The user pressed "Back" on the checkout card. Until the decision changes
  // we stop forcing it back up, or the card would be impossible to leave.
  const [checkoutDismissed, setCheckoutDismissed] = useState(false);

  // ?pay=1 is re-read after EVERY render on purpose. /app/home sends unpaid
  // users here with a client-side navigation, and TanStack keeps the same
  // route component mounted across it — an effect keyed on app.email never
  // re-ran, the flag stayed false, and the checkout card never appeared.
  // Same value in, same value out: React bails out, so this costs nothing.
  // ?deactivated=1 rides along: an admin pressed "Set unpaid" for this
  // account and the access gate signed the session out on the way here —
  // the FIRST screen must say so, instead of silently offering checkout.
  /**
   * GLOBAL AUTH EPOCH — enforced on the FIRST page as well as at boot.
   *
   * router.tsx runs the same check before any route loads, but this screen is
   * the one place a wiped session must always land: if a device reaches
   * /app/login with an epoch it has not applied yet (a bookmark, a deep link,
   * a restored tab), the buckets are cleared here and the page reloads so
   * every store re-initialises empty. `enforceAuthEpoch()` returns true only
   * on the run that wipes, so this can never loop.
   */
  const [epochCleared, setEpochCleared] = useState(false);
  useEffect(() => {
    if (enforceAuthEpoch()) {
      // The buckets were just wiped. `resuming` was seeded from the email that
      // no longer exists, so drop it — otherwise the resume handshake below
      // would spend a cloud call verifying a session the epoch just revoked.
      setResuming(false);
      window.location.replace("/app/login");
      return;
    }
    setEpochCleared(true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPayPrompt(params.get("pay") === "1");
    setDeactivated(params.get("deactivated") === "1");
    // Re-read the owed-key flag every render: a deep link from /app/home or
    // /app carries ?license=1, and the flag itself survives the app closing.
    //
    // IT BELONGS TO ONE ACCOUNT. If a DIFFERENT email is the signed-in session
    // now, the flag is stale — the licence form is for an account that owes a
    // key, and showing it to somebody who signed in afresh would skip their
    // email step entirely. `hasPendingLicense` is the comparison.
    const session = getAppState().email;
    if (session && !hasPendingLicense(session)) {
      clearPendingLicense();
      setLicensePending(false);
      return;
    }
    setLicensePending(
      (current) => current || hasPendingLicense(session) || params.get("license") === "1",
    );
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = typeof window !== "undefined" && params.get("success") === "true";
    // ?awaiting=1 survives a reload on the waiting screen — it is only a
    // "show this screen" flag and grants nothing, exactly like ?pay=1.
    if (params.get("awaiting") === "1") setAwaitingActivation(true);
    setSuccessReturn(success);
    // SECURITY: ?success=true alone must NEVER unlock the app — typing that
    // URL used to call markEmailPaid() locally, which is exactly how a
    // non-payer got in. The flag only shows the key entry view; unlock
    // happens ONLY after the SERVER verifies the Whop membership (or the
    // database already holds an approval/license for this email).
    if (success && app.email) {
      void verifyPaymentReturn(app.email).then((verified) => {
        if (verified) {
          if (typeof window !== "undefined")
            window.localStorage.removeItem("eamp.pending-payment-email");
        } else {
          // NOT A REFUSAL — THIS ACCOUNT IS AWAITING ACTIVATION.
          //
          // We activate by hand: the customer pays on Whop, messages support,
          // and the owner presses Mark paid. Until that button is pressed the
          // database honestly says "unpaid", so this is exactly the state a
          // real, just-paid customer is in on the way back from checkout.
          //
          // This used to fall through to the Choose Plan screen, which asked
          // somebody who had ALREADY paid to pay a second time and never told
          // them why. They had no route forward except guessing. It is a
          // separate state with its own screen (AwaitingActivation), which
          // names the situation, gives them support to contact with their
          // email, and re-checks so the app opens by itself the moment the
          // owner marks them paid.
          setAwaitingActivation(true);
          setSuccessReturn(false);
          if (typeof window !== "undefined")
            window.history.replaceState({}, "", "/app/login?awaiting=1");
        }
      });
    }
  }, [app.email]);

  const activeEmail = app.email || email.trim().toLowerCase();
  // MOBILE OWNER SKIP — Android and iOS never reach the Choose Plan screen for
  // ntobekotraders.official@gmail.com, biyasentobeko222@gmail.com and
  // pablosimpson808@gmail.com. They go straight to /app/home instead of being
  // asked to pick a subscription on the device they already paid on.
  // TYPED email must never pre-switch the view: an owner typing their
  // email used to jump straight to the key screen WITHOUT pressing Proceed,
  // which skipped the cloud device-binding check — the exact reason admins
  // were never asked to reactivate after delete + reinstall. A typed email
  // always goes through continueWithEmail, which runs the binding check for
  // EVERY email — admins included.
  const sessionPaymentStatus = app.email ? paymentStatusForEmail(app.email) : "unpaid";
  // THE TRUTH about this session. The database outranks the device, and the
  // device is only consulted while the database is still thinking (or could
  // not be reached). Everything below — the license screen, the auto-hop to
  // Whop, the hop into the app — reads this one value, so the first screen
  // can never disagree with the route guard that follows it.
  const effectiveStatus = cloudStatus ?? sessionPaymentStatus;

  // A signed-in session that ALREADY has a robot goes to the app. The key
  // screen used to appear for every paid/approved session on every launch —
  // including people whose robot was already activated — so opening the app
  // always demanded another key, with no way past it. The home screen has an
  // "Add robot" dialog for anyone who genuinely needs another one.
  //
  // A return from checkout still forces the view: that is a deliberate
  // request for the licence-entry screen, not a returning session.
  const returningWithRobot = Boolean(app.email) && app.robots.length > 0;

  // The license-entry screen is the passthrough for already-entitled sessions
  // (paid or admin) that already own a robot. Anything else on this login screen
  // gets a plan choice or a sign-in form instead.
  /**
   * THE LICENCE FORM OWNS A PENDING SESSION.
   *
   * `licensePending` is checked FIRST and needs only an email: this account has
   * already passed the code step, so it must see the key form even while the
   * cloud is still answering. Everything else keeps its old rule. Nothing here
   * redirects, and the auto-hop effect below returns on `showLicenseView`, so
   * there is no path from this screen back to the email form short of signing
   * out or clearing the app's data.
   */
  const showLicenseView =
    (licensePending && Boolean(app.email)) ||
    (!returningWithRobot && (successReturn || cloudStatus === "paid" || cloudStatus === "admin"));

  // OPENING THE APP WITH AN UNPAID SESSION MUST GO TO WHOP — but ONLY on the
  // DATABASE's word. The local store is a hint that this device has not seen a
  // payment, and treating a hint as a verdict is what sent a customer who had
  // just been marked paid straight back to checkout: for the instant between
  // signing in and the database answering, this screen believed the hint,
  // decided "unpaid", and fired three hard redirects at Whop. Nothing here may
  // act on anything but `cloudStatus === "unpaid"`.
  const mustPay =
    Boolean(app.email) && cloudStatus === "unpaid" && !returningWithRobot && !checkoutDismissed;

  /* ── The six-digit activation code ───────────────────────────────────
   *
   * `codeStage` is the email a code was just sent to, and it is non-null only
   * between "Proceed was pressed on a paid account" and "the code came back
   * right". It is the app's own state rather than a URL flag on purpose: the
   * code is the gate, and a flag anybody could add to the address bar would be
   * useless against it.
   * exactly the thing the code exists to prevent.
   *
   * `sendingCode` and `verifyingCode` are separate from `busy` because they
   * describe two different screens' buttons, and both are cleared the moment
   * their step ends — a stuck spinner on a screen nobody is on is what made
   * this screen feel broken before.
   */
  const [codeStage, setCodeStage] = useState<{ email: string } | null>(null);
  const [codeValue, setCodeValue] = useState("");
  const [codeError, setCodeError] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  /** Put a new code in the inbox for an account that is already mid-flow. */
  const [resendingCode, setResendingCode] = useState(false);

  /**
   * Ask the database who this session is, and send an unpaid one straight to
   * Whop without waiting to be asked. ALWAYS FRESH — this is the answer that
   * decides whether the customer sees their app or a payment page, so a
   * remembered "unpaid" from before the owner pressed Mark paid would be
   * exactly the wrong thing to trust.
   */
  /**
   * RESUME A SAVED SESSION — the persistent-session handshake.
   *
   * Runs ONCE, on mount, and only when a session email was already in the
   * store when the page loaded. It asks `requireVerifiedAccess`, the SAME
   * function every route guard uses, so this screen can never disagree with
   * the gate:
   *
   *   pass       → straight into /app/home. No email prompt, and — deliberately
   *                — no `robots.length > 0` condition: an activated account
   *                with no robot yet belongs on the home screen, which has its
   *                own "Add robot" state. Requiring a robot is what stranded
   *                people on this login form looking like a failed sign-in.
   *   signin     → no session any more (revoked elsewhere); show the form.
   *   deactivate → the owner marked the account unpaid; sign out and show the
   *                deactivation notice.
   *   pay        → must pay; sign out (the gate's own rule) and show the plans.
   *
   * The deadline is deliberately generous (25s). A wrong or absent answer here
   * must NEVER open the app — it falls through to the plain login form, and the
   * cloud guard on /app/home re-checks everything regardless.
   */
  useEffect(() => {
    if (!epochCleared || !resuming) return;
    const sessionEmail = getAppState().email;
    if (!sessionEmail) {
      setResuming(false);
      return;
    }
    /**
     * THE WAITING ROOM OWNS THIS SESSION.
     *
     * Somebody coming back from Whop is still carrying their session, so this
     * handshake runs — and its answer for a not-yet-activated account is "pay",
     * which navigates them straight BACK to Whop. That is the loop that made a
     * paid customer think checkout was broken. The waiting room's own poll is
     * watching the same database, so skipping this loses nothing.
     */
    if (awaitingActivation) {
      setResuming(false);
      return;
    }
    /**
     * THE OWED LICENCE KEY OWNS THIS SESSION TOO.
     *
     * Running the handshake here would answer "pass" (the account IS paid) and
     * `window.location.replace("/app/home")` would carry the person out of the
     * licence form — and /app/home's guard then sends them to the login page,
     * which is the "it went back to the first page" report. The flag is only
     * cleared by a successful activation, so this screen simply stays put.
     */
    if (hasPendingLicense(sessionEmail)) {
      setLicensePending(true);
      setResuming(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const access = await withDeadline<AppAccessCheck>(
        requireVerifiedAccess(sessionEmail),
        25_000,
        { action: "signin" },
      );
      if (cancelled) return;
      if (access.action === "pass") {
        // Mirror the verdict locally so the app renders as entitled from the
        // very first frame instead of flashing an "unpaid" state on the way in.
        markEmailPaid(sessionEmail);
        setCloudStatus(paymentStatusForEmail(sessionEmail) === "admin" ? "admin" : "paid");
        window.location.replace("/app/home");
        return;
      }
      if (access.action === "deactivate") {
        appSignOut();
        // A revoked account does not owe a licence key — drop the flag or this
        // screen would keep showing the key form to an account the owner has
        // already switched off.
        clearPendingLicense();
        setLicensePending(false);
        setCloudStatus(null);
        window.history.replaceState({}, "", "/app/login?deactivated=1");
        setDeactivated(true);
        setResuming(false);
        return;
      }
      if (access.action === "pay") {
        leaveForCheckout();
        setCloudStatus("unpaid");
        setChoosePlan(true);
        setResuming(false);
        return;
      }
      // signin — the stored session is no longer valid (device revoked or the
      // epoch was reset). Drop it so the form starts clean.
      appSignOut();
      setCloudStatus(null);
      setResuming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [resuming, epochCleared, awaitingActivation]);

  useEffect(() => {
    if (resuming || !app.email || successReturn || choosePlan) return;
    let cancelled = false;
    setCloudStatus(null);
    void (async () => {
      const status = await withDeadline(
        resolveCloudAccess(app.email, { fresh: true }),
        15_000,
        null,
      );
      if (cancelled) return;
      setCloudStatus(status);
      // DEACTIVATED / REJECTED — the database says this account was revoked,
      // or the console removed it entirely. Both mean something was taken away
      // and neither has any payment to hand over, so the person is signed out
      // and shown the deactivation notice: they must not see the Choose Plan
      // screen, and offering checkout to somebody who has nothing left would
      // lie about why they are locked out. `resolveCloudAccess` maps a console
      // REJECTION to the same "revoked" verdict that "Mark unpaid" produces, so
      // one branch covers both.
      if (status === "revoked") {
        appSignOut();
        clearPendingLicense();
        setLicensePending(false);
        setCloudStatus(null);
        setChoosePlan(false);
        setPayPrompt(false);
        setCheckoutDismissed(false);
        window.history.replaceState({}, "", "/app/login?deactivated=1");
        setDeactivated(true);
        return;
      }
      if (status === "unpaid") {
        setCheckoutDismissed(false);
        setChoosePlan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.email, successReturn, choosePlan, resuming]);

  useEffect(() => {
    if (resuming || !app.email || successReturn) return;
    // Never yank the page away while a sign-in attempt is still deciding the
    // outcome, or while a checkout / approval / blocked card is on screen.
    if (busy || choosePlan || payPrompt || mustPay || blockedEmail || codeStage) return;
    // NOTHING IS DECIDED YET. `effectiveStatus` falls back to the device's own
    // memory while the database is still answering, and that memory is exactly
    // what a forged or stale session exploits — walking an account into
    // /app/home on it is how an unpaid user reached the dashboard. Wait for the
    // DATABASE to answer; the Choose Plan screen above handles "unpaid", so an
    // unpaid session can never fall through to here.
    if (cloudStatus === null) return;
    // A signed-in mentor goes to the app EVEN with no robots yet. This used
    // to require `app.robots.length > 0`, and robots only appear after a
    // licence key is activated — so a freshly approved mentor signed in
    // successfully and then sat on this screen forever, which looks exactly    // like a failed sign-in. The home screen has its own "Add robot" state.
    if (cloudStatus === "admin") return;
    if (showLicenseView) return;
    // An UNPAID session must not round-trip through /app/home: that guard
    // decides "unpaid" and sends the person back here, so the two would
    // ping-pong with nothing ever happening. The Choose Plan screen owns them.
    if (effectiveStatus === "unpaid") return;
    window.location.replace("/app/home");
  }, [
    app.email,
    successReturn,
    showLicenseView,
    busy,
    choosePlan,
    payPrompt,
    mustPay,
    blockedEmail,
    codeStage,
    effectiveStatus,
    resuming,
  ]);

  /**
   * THE CHOOSE PLAN GATE — one place decides whether ANY part of the app may
   * paint. Every way the app can learn that somebody owes money funnels here:
   *
   *   • the Proceed tap            → registration said "checkout"
   *   • ?pay=1 from a route guard  → the gate signed them out and sent them
   *                                  here (see requireVerifiedAccess)
   *   • opening the app on an unpaid session → resolveCloudAccess said so
   *
   * There is NO automatic hop any more. There are two products, so the choice
   * belongs to the customer; a programmatic redirect could only ever guess,
   * and it also silently fails in an iOS home-screen app. The screen below
   * offers both plans as real links.
   */
  // The three emails are the first three entries of OWNER_EMAILS in auth-store.ts;
  // they were already shaded as platform owners/admins through that list. They also
  // never reach the Choose Plan screen on desktop, so this flag is the only mobile
  // branch at runtime: on Android or iOS it downgrades a paid owner from the plan
  // chooser straight into /app/home, and there is no code path that grants the
  // user the option to see the plan on those platforms.
  const isMobileOwnerSession =
    Boolean(app.email && OWNER_EMAILS.slice(0, 3).includes(app.email.toLowerCase())) &&
    (platform === "android" || platform === "ios");
  const showChoosePlan = (choosePlan || payPrompt || mustPay) && !isMobileOwnerSession;

  const continueWithEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const clean = email.trim().toLowerCase();
    console.log("[app-login] Trying login:", clean);
    // Freeze the auto-redirect BEFORE the first await (see `busy`). Every
    // exit below that is not "go to checkout" puts it back.
    setBusy(true);
    setCheckoutDismissed(false);
    // ONE shared budget for the whole decision. Each call below may only
    // spend what is left of it, so however badly the network behaves the
    // door still opens inside ~20s instead of showing "Redirecting to
    // Whop…" forever.
    const budgetStartedAt = Date.now();
    const left = () => Math.max(2_000, 20_000 - (Date.now() - budgetStartedAt));
    try {
      // PAYMENT IS DECIDED FIRST, BEFORE ANYTHING ELSE.
      //
      // The device-binding check used to run here, at the top, which meant an
      // email that had never been marked paid and was bound to some other
      // phone got told "Account already used — ask your mentor" instead of
      // being sent to checkout. That is the wrong screen at the wrong moment:
      // somebody who has not bought anything yet has no business being told
      // their account is in use. Unpaid goes to Whop, full stop — the binding
      // is only examined once the database says this account is entitled to
      // the app at all.
      //
      // FAIL CLOSED. A cloud call that does not answer in time must never be
      // read as "this account is fine" — an earlier "allow" fallback here was
      // a payment hole. An undecided account goes to checkout, which is
      // recoverable; walking into the app without paying is not.
      const registration = await withDeadline(registerWithEmail(clean), left(), {
        outcome: "checkout",
        user: null,
        verified: false,
      } as Awaited<ReturnType<typeof registerWithEmail>>);
      if (typeof window !== "undefined")
        window.localStorage.setItem("eamp.pending-payment-email", clean);

      /**
       * STRICT ENTITLEMENT CHECK — the ONE gate in front of everything else.
       *
       * `registration.verified` is true only when the database positively
       * confirmed this email (is_paid, is_admin, a platform owner, or a
       * license_keys row issued to it). It is false for a checkout answer AND
       * for every error path, so a failed or undecided lookup can never be
       * mistaken for permission. A timeout lands here as `verified: false`
       * too, because the deadline fallback above says so explicitly.
       *
       * NOTHING BELOW THIS BLOCK RUNS FOR AN UNVERIFIED ACCOUNT: no device
       * binding, no blocked card, no sign-in. In particular an unpaid email can
       * never be told "Account already used — ask your mentor", which is the
       * screen that used to appear instead of the plans.
       */
      if (!registration.verified) {
        if (successReturn) {
          // The URL flag says they returned from checkout — prove it on the
          // server before granting anything. A successful verification means
          // the money is in and the next screen is the activation code, NOT a
          // second plan choice.
          const verified = await withDeadline(verifyPaymentReturn(clean), left(), false);
          if (verified) return;
        }
        // DEACTIVATED FIRST, ALWAYS. An account the owner revoked is not an
        // unpaid account: it must never be answered with Choose Plan, on any
        // device. `registerWithEmail` cannot tell the two apart (both are
        // "not entitled"), so the gate is asked for the cloud's own verdict
        // before this sign-in is allowed to fall through to checkout. This is
        // the path a FRESH sign-in takes — a device that was never let in has
        // no local record, which is exactly why the answer is read from the
        // database rather than from memory.
        const cloud = await withDeadline(resolveCloudAccess(clean, { fresh: true }), left(), null);
        if (cloud === "revoked") {
          appSignOut();
          invalidateAccessCache(clean);
          setCloudStatus(null);
          setChoosePlan(false);
          setPayPrompt(false);
          setCheckoutDismissed(false);
          setBusy(false);
          setRedirecting(false);
          window.history.replaceState({}, "", "/app/login?deactivated=1");
          setDeactivated(true);
          return;
        }
        // STOP HERE. The unpaid account does not go near /app/home; it lands
        // on the Plan Selection screen and picks monthly or lifetime.
        setRedirecting(false);
        setChoosePlan(true);
        return;
      }
      // A successful Whop return already put the money in, so the account is
      // entitled: the next screen is the activation code, not the plans. The
      // owner turns the account on; the customer does not pay again.
      if (successReturn) {
        setSuccessReturn(false);
        setAwaitingActivation(true);
        window.history.replaceState({}, "", "/app/login?awaiting=1");
        return;
      }

      // ENTITLED — the database has positively confirmed this account. Only
      // NOW do the device rules apply: if this email is bound to another
      // phone, do NOT sign in — show the blocked card ("account already used,
      // please tell your mentor to reactivate"). There is no self-service
      // unlock. This is reachable ONLY for a verified paid/admin account.
      try {
        const binding = await withDeadline(checkDeviceBinding(clean, getDeviceId()), left(), {
          boundToOtherDevice: false,
        });
        if (binding.boundToOtherDevice) {
          setBlockedEmail(clean);
          setBusy(false);
          setRedirecting(false);
          return;
        }
      } catch {
        /* unreachable cloud — fall through to the normal sign-in path */
      }
      /**
       * THE SIX-DIGIT CODE — nobody enters the app without it.
       *
       * From here on the database has positively confirmed this account, so
       * Proceed now sends a one-time code to the inbox it paid with and waits.
       * The sign-in below is deliberately NOT reached yet: `finishSignIn` only
       * runs once that code comes back (see `submitActivationCode`).
       *
       * An unpaid email never gets this far — `registration.verified` was
       * required above — and if the SERVER refuses to issue a code (its
       * entitlement check is the authority, and it is stricter than the
       * browser's), the account is sent to the plans rather than being let in.
       *
       * If there is no endpoint at all, NOTHING opens: see the branch below.
       */
      setSendingCode(true);
      const codeSent = await requestActivationCode(clean);
      setSendingCode(false);
      setBusy(false);
      setRedirecting(false);
      if (codeSent.status === "offline") {
        // NO SERVER TO SEND A CODE FROM. This deployment cannot prove inbox
        // control, and the account is NOT sent to the plans, because it is
        // paid. Nothing is faked and nothing is opened.
        console.warn("[app-login] no activation endpoint:", codeSent.error);
        // FAIL CLOSED ON THE GATE. This used to hand the account to the waiting
        // room, whose 15-second poll resolves the cloud and sends any PAID
        // account straight to /app/home — which is the code gate quietly not
        // happening. That is exactly the bypass this screen exists to close, so
        // the account stays on the form instead: no endpoint, no code, no entry.
        //
        // The remedy is a deployment fix (the function must exist and be
        // configured), not a way around it, and the plans screen is NOT the right
        // answer either — this account is paid and must never be asked to pay
        // again.
        //
        // THIS MESSAGE USED TO BE A DEAD END, and saying so hid a total
        // outage. Both serverless functions once failed to boot, answering
        // `500 x-vercel-error: FUNCTION_INVOCATION_FAILED`, and because every
        // non-2xx was flattened into `offline` the customer was asked to
        // "message support" while the operator had no status, no reason and no
        // way to tell a dead deploy from a mistyped address. `offline` now
        // means only "no function on this host" (see activation-client.ts), so
        // naming the deployment here is both accurate and the thing worth fixing.
        toast.error("We could not send your code right now.", {
          description:
            "The activation service is not responding. Please try again in a moment — if it keeps " +
            "happening, message support and quote “activation service not responding”.",
        });
        return;
      }
      if (!codeSent.ok) {
        // The endpoint answered and said no. "Not marked as paid" is the plans
        // screen; anything else is a send failure that must not look like a
        // payment problem.
        //
        // THE SERVER'S OWN REASON IS THE DESCRIPTION, not a generic sentence.
        // This is the whole point of the outcome contract above: a 400 from
        // Mailjet refusing an unverified sender, a 503 from a misconfigured
        // deployment and a rate limit are three different bugs, and the text
        // under this toast is the only place the customer can tell them apart.
        //
        // BRANCH ON THE FLAG, NOT THE SENTENCE. This used to test the error
        // text with /has not been activated/i, which the new wording
        // ("This email is not marked as paid. Contact admin.") does not match
        // — so rewording the message quietly stopped unpaid people being sent
        // to the plans and left them with a dead toast. The regex is kept only
        // as a fallback for an older deployment still sending the old text.
        toast.error("We could not send your code.", {
          description: codeSent.error ?? "Please try again in a moment.",
        });
        if (
          codeSent.notPaid ||
          /has not been activated|not marked as paid/i.test(codeSent.error ?? "")
        ) {
          setChoosePlan(true);
        }
        return;
      }
      setCodeValue("");
      setCodeError("");
      setCodeStage({ email: clean });
      return;
    } catch (error) {
      // A thrown network/registration error must never leave the button
      // stuck on "Redirecting to Whop…" forever.
      console.warn("[app-login] sign-in failed:", error);
      setBusy(false);
      setRedirecting(false);
      toast.error("Could not sign you in. Check your connection and try again.");
    }
  };

  /**
   * THE SECOND HALF OF SIGN-IN, behind the code.
   *
   * Everything the paid path did after its entitlement check lives here, and
   * it runs only when `verifyActivationCode` says the six digits match the
   * code this server issued for this email. Proving inbox control is what
   * turns "typed a paid address" into "is the person who paid".
   */
  const submitActivationCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!codeStage || verifyingCode) return;
    const code = codeValue.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setCodeError("Enter the six-digit code from your email.");
      return;
    }
    setVerifyingCode(true);
    setCodeError("");
    try {
      const result = await checkActivationCode(codeStage.email, code);
      if (result.status === "offline") {
        // The endpoint disappeared between sending and checking. Say so; do NOT
        // let them in on a check that never ran.
        setCodeError("We could not check that code. Please try again in a moment.");
        return;
      }
      if (!result.ok) {
        setCodeError(result.error ?? "That code is not right.");
        return;
      }
      // VERIFIED — the account is proved, so the session is opened and the
      // licence-key screen takes over from here.
      await finishSignIn(codeStage.email);
      // An account that ALREADY has a robot activated has nothing to enter on
      // the licence screen, so it goes to the app instead. Without this it
      // would be dropped back onto the login form looking like a failed
      // sign-in.
      if (getAppState().robots.length > 0) {
        clearPendingLicense();
        setLicensePending(false);
        setCodeStage(null);
        window.location.replace("/app/home");
        return;
      }
      /**
       * REMEMBER THAT A LICENCE KEY IS OWED — this is what makes the form stay.
       *
       * The code step has proved the inbox and the database has proved the
       * payment, so the ONLY thing left is the key. Without this line the form
       * is pure component state: reopen the app (or let the route re-evaluate)
       * and the person is back on the email form with nothing to click. The flag
       * lives in localStorage, so it survives the app being closed and is gone
       * only when a key activates or the app's data is cleared.
       */
      markPendingLicense(codeStage.email);
      setLicensePending(true);
      setCodeStage(null);
    } finally {
      setVerifyingCode(false);
    }
  };

  /**
   * Open the session for an account whose payment (and inbox) are proven.
   *
   * Split out of `continueWithEmail` so the paid path has exactly ONE sign-in
   * implementation: pressing Proceed and typing the code cannot drift into two
   * different sets of rules.
   */
  const finishSignIn = async (clean: string) => {
    const result = appSignIn(clean);
    if (result.error) {
      console.log("[app-login] Login error:", result.error);
      // The device's own record also knows about bindings, so a repeat
      // offender is shown the same blocked card the cloud produced rather
      // than a bare toast — one clear way to say "this email is on another
      // phone", never a dead end.
      if (/already used|another device/i.test(result.error)) setBlockedEmail(clean);
      else toast.error(result.error);
      setBusy(false);
      setRedirecting(false);
      return;
    }
    console.log("[app-login] Login success");
    // Arm the WELCOME MASTER gate — the home screen plays it (with voice) on arrival.
    window.sessionStorage.setItem("eamp_pending_welcome", "1");
    // There is no "no payment required" path here any more: every account,
    // admins and platform owners included, is opened by a payment record.

    // Bind THIS device in the cloud before letting them in. The access gate
    // treats a missing binding as a stale session (the global access reset),
    // so an entitled person must be bound on THIS device or the very next
    // route change would sign them straight back out again. A bind failure
    // is never worth an error toast here — it says nothing the customer can
    // act on, and a red banner over a working sign-in reads as a failure.
    try {
      const bound = await withDeadline(bindDeviceToEmail(clean, getDeviceId()), 12_000, {
        ok: false,
        error: "Device binding timed out",
      });
      if (!bound.ok && bound.error) console.warn("[app-login] device bind:", bound.error);
    } catch {
      /* a failed bind must never block sign-in */
    }

    // ENTITLED — the database just said so, so drop any remembered refusal
    // before the route guards ask. Without this a cached "unpaid" from
    // before the owner pressed Mark paid could send them back to Whop on
    // the very next navigation.
    invalidateAccessCache(clean);
    // Mirror the verdict locally so the in-app UI agrees with the database
    // immediately rather than waiting for the next render's cloud read.
    markEmailPaid(clean);

    // The auto-redirect effect above walks an entitled session into
    // /app/home, which re-checks the cloud before a single pixel renders.
    // Nothing is forced from here, so an undecided account can never be
    // dropped into the app.
    setBusy(false);
    setRedirecting(false);
  };

  /** Dismiss the blocked card and try a different email. */
  const dismissBlocked = () => setBlockedEmail(null);
  /**
   * Back out of the checkout card. Reached two ways: the user tapping the
   * escape link (a payment page they did not need — an approved account on a
   * flaky connection, say) and the ?pay=1 deep link that /app/home sends
   * here. The URL is rewritten too, or a refresh would bounce them straight
   * back to checkout.
   */
  const dismissCheckout = () => {
    setChoosePlan(false);
    setPayPrompt(false);
    setCheckoutDismissed(true);
    setRedirecting(false);
    setBusy(false);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/app/login");
    }
  };

  /**
   * The "check again" button on the waiting room. Same question the poll asks,
   * asked on demand so somebody who has just messaged support gets an answer
   * without waiting out the interval.
   */
  const [checkingActivation, setCheckingActivation] = useState(false);
  /**
   * Back out of the waiting room for somebody who has NOT paid — they are on
   * this screen because they came back from Whop or followed the link, and
   * leaving it must not leave `?awaiting=1` behind in the history or a refresh
   * would put them straight back on it.
   */
  const leaveWaitingRoom = () => {
    setAwaitingActivation(false);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/app/login");
    }
  };
  const recheckActivation = async () => {
    if (checkingActivation) return;
    const waitingEmail = activeEmail;
    if (!waitingEmail) return;
    setCheckingActivation(true);
    try {
      const status = await resolveCloudAccess(waitingEmail, { fresh: true });
      if (status === "paid" || status === "admin") {
        window.location.replace("/app/home");
        return;
      }
      if (status === "revoked") {
        toast.info("Account not available", {
          description: "This account has been turned off by the team. There is nothing to pay — contact us if you think that is a mistake.",
        });
        return;
      }
      toast.info("Not activated yet", {
        description: "We are still waiting on your activation message. Try again in a few minutes.",
      });
    } finally {
      setCheckingActivation(false);
    }
  };

  /**
   * Send the code again for the account already on the code screen.
   *
   * The code is derived, not stored, so a "resend" simply asks for it to be
   * mailed again — there is nothing to invalidate, and a resend inside the same
   * half hour simply arrives as the same six digits.
   */
  const resendActivationCode = async () => {
    if (!codeStage || resendingCode) return;
    setResendingCode(true);
    setCodeError("");
    try {
      const result = await requestActivationCode(codeStage.email);
      if (result.status === "offline") {
        setCodeError(
          "We could not send your code. The activation service is not responding — please try again in a moment.",
        );
        return;
      }
      if (!result.ok) {
        // The server's own reason, not a generic retry sentence: see the same
        // branch in the first sign-in step.
        setCodeError(result.error ?? "We could not send your code. Please try again.");
        return;
      }
      toast.success("We sent a new code to your email.");
    } finally {
      setResendingCode(false);
    }
  };

  /**
   * Leave the code screen for a different email.
   *
   * Only the code step is discarded. Nothing has been signed in yet — the
   * session is opened by `finishSignIn` after the code comes back — so there is
   * no half-proved session to clean up, and an account that was already signed
   * in on this device keeps its session and its robots exactly as they were.
   */
  const cancelActivationCode = () => {
    setCodeStage(null);
    setCodeValue("");
    setCodeError("");
  };

  const [unlocking, setUnlocking] = useState(false);
  const submitLicense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unlocking) return;
    setUnlocking(true);
    try {
      if (!app.email) {
        const clean = email.trim().toLowerCase();
        // Register FIRST so the users row exists — the cloud proof write
        // inside activateKey (is_paid + device bind) needs that row, and a
        // fresh reinstall has none.
        try {
          await registerWithEmail(clean);
        } catch {
          /* fail open */
        }
        const signInResult = appSignIn(clean);
        if (signInResult.error) {
          toast.error(signInResult.error);
          return;
        }
      }
      // Same tolerant normalisation as activation: trim, uppercase, strip spaces.
      const normalizedKey = key.trim().toUpperCase().replace(/\s+/g, "");
      const result = await activateKey(normalizedKey);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success((result.robot?.name || "Robot") + " activated on this device");
      // THE KEY IS IN — the licence step is no longer owed, so nothing sends
      // this account back to the form on the next launch.
      clearPendingLicense();
      setLicensePending(false);
      // Arm the WELCOME MASTER gate — the home screen plays it (with voice) on arrival.
      window.sessionStorage.setItem("eamp_pending_welcome", "1");
      window.location.replace("/app/home");
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#070d10] text-white">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pt-safe pb-safe-xl">
        {resuming ? (
          <ResumingView />
        ) : blockedEmail ? (
          <AccountUsedView email={blockedEmail} onCancel={dismissBlocked} />
        ) : /* THE MAIL ROUTE IS BROKEN, so there is nothing to wait for. Checked
         before `codeStage` because the code screen promises an email that is
         never going to arrive, and showing it would be a broken promise. */
        codeStage ? (
          <ActivationCodeView
            email={codeStage.email}
            value={codeValue}
            setValue={setCodeValue}
            error={codeError}
            verifying={verifyingCode}
            resending={resendingCode}
            onSubmit={submitActivationCode}
            onResend={resendActivationCode}
            onCancel={cancelActivationCode}
          />
        ) : awaitingActivation && !successReturn && activeEmail ? (
          <AwaitingActivation
            email={activeEmail}
            onRecheck={recheckActivation}
            checking={checkingActivation}
            onCancel={leaveWaitingRoom}
          />
        ) : showChoosePlan ? (
          <PlanSelection
            email={activeEmail}
            selectedPlan={selectedPlan}
            onSelectPlan={setSelectedPlan}
            onCancel={dismissCheckout}
          />
        ) : !showLicenseView ? (
          <LoginView
            email={email}
            setEmail={setEmail}
            onSubmit={continueWithEmail}
            checking={(busy && !redirecting) || sendingCode}
            redirecting={redirecting}
            deactivated={deactivated}
          />
        ) : (
          <LicenseView
            email={activeEmail}
            setEmail={setEmail}
            keyValue={key}
            setKey={setKey}
            onSubmit={submitLicense}
            admin={effectiveStatus === "admin"}
            paid={effectiveStatus === "paid" || successReturn}
            unlocking={unlocking}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The persistent-session loader.
 *
 * Shown while `requireVerifiedAccess` rules on a session that was already in
 * localStorage. It has to look like a considered part of the app rather than a
 * frozen form — the alternative (painting the email input first and replacing
 * it a second later) is exactly the flicker that made the old behaviour feel
 * like the app had forgotten who you were.
 *
 * Nothing here is clickable: there is no decision to make while the cloud is
 * thinking, and a button here could only ever be a lie about what it does.
 */
function ResumingView() {
  return (
    <div
      className="-translate-y-8 flex flex-col items-center text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex size-28 items-center justify-center">
        <span
          className="absolute inset-0 animate-ping rounded-full bg-[#08a8ef]/20"
          style={{ animationDuration: "1.8s" }}
          aria-hidden="true"
        />
        <div className="relative flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
          <img src="/logo.png" alt="" className="size-full object-contain" />
        </div>
      </div>
      <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-base text-[#8a9298]">Restoring your session…</p>
      <span className="mt-10 h-1 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span className="block h-full w-1/2 animate-pulse rounded-full bg-[#08a8ef]" />
      </span>
    </div>
  );
}

/**
 * Email-already-used → BLOCKED card. The cloud says this email is bound to
 * another device. There is deliberately NO self-service unlock: deleting
 * and reinstalling the app must NOT get back in. The user asks their
 * mentor, who releases the device from the portal (Re-activate Client).
 * This applies to every email — clients and admins alike.
 */
function AccountUsedView({ email, onCancel }: { email: string; onCancel: () => void }) {
  return (
    <div className="-translate-y-8 text-center">
      <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
        <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
      </div>
      <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Account already used</h1>
      <div
        role="alert"
        className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/50 bg-red-500/15 p-4 text-left"
      >
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-400 text-[11px] font-black text-red-950"
          aria-hidden="true"
        >
          !
        </span>
        <p className="text-sm font-semibold leading-6 text-red-200">
          Account already used — please tell your mentor to reactivate.
        </p>
      </div>
      <p className="mt-3 text-base leading-7 text-[#8a9298]">
        <span className="font-semibold text-[#55c7ff]">{email}</span> is already activated on
        another device. One email works on one device only. Ask your mentor to re-activate your
        account — they can release your device from their portal in seconds, and your licence,
        payment and robots stay exactly as they are.
      </p>
      <div className="mt-10 space-y-4">
        <button
          type="button"
          onClick={onCancel}
          className="h-14 w-full rounded-full text-sm font-semibold text-[#8a9298] transition-colors hover:text-white"
        >
          Use a different email
        </button>
      </div>
      <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
    </div>
  );
}

function LoginView({
  email,
  setEmail,
  onSubmit,
  checking,
  redirecting,
  deactivated,
}: {
  email: string;
  setEmail: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  checking: boolean;
  redirecting: boolean;
  deactivated?: boolean;
}) {
  return (
    <>
      {/*
        THE SCREEN-WIDE GLOW. It must be a SIBLING of the transformed content
        wrapper, never its child: a CSS transform makes that element the
        containing block for position:fixed descendants, so the old glow —
        `fixed inset-x-0 top-0 h-[60vh]` inside `-translate-y-4` — was pinned
        to the login CARD instead of the viewport and painted as a teal
        rectangle floating in black margins. `inset-0` (no fixed height)
        plus a page-level ancestor lets it fill every screen size edge to
        edge. `pointer-events-none` keeps taps passing through to the form.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(8,168,239,.18),transparent)]"
      />
      <div className="relative -translate-y-4 text-center">
        <div className="relative mx-auto flex size-32 items-center justify-center overflow-hidden rounded-[32px] border border-white/10 bg-[#0d1418] p-3 shadow-[0_0_40px_rgba(8,168,239,.35)]">
          <BrandLogo className="size-full object-contain" />
        </div>
        <p className="relative mt-6 text-xs font-bold tracking-[0.35em] text-[#8a9298] uppercase">
          EA Migrate
        </p>
        <h1 className="relative mt-2 text-[2.45rem] font-bold tracking-tight">Sign in</h1>
        <p className="relative mt-2 text-base text-[#aab2b7]">
          Use the email linked to your membership
        </p>
        {deactivated ? <DeactivatedNotice /> : null}
        <form
          className="relative mt-10 space-y-4 rounded-[28px] border border-white/10 bg-gradient-to-b from-[#121a1f] to-[#0a0f12] p-6 text-left"
          onSubmit={onSubmit}
        >
          <label
            htmlFor="app-login-email"
            className="text-xs font-bold tracking-[0.2em] text-[#8a9298] uppercase"
          >
            Email
          </label>
          <input
            id="app-login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@email.com"
            className="h-14 w-full rounded-2xl border border-white/10 bg-[#070d10] px-5 text-lg text-white outline-none placeholder:text-[#59646b] focus:border-[#08a8ef]"
          />
          <button
            type="submit"
            disabled={checking || redirecting}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70"
          >
            {redirecting
              ? "Redirecting to Whop…"
              : checking
                ? "Checking your account…"
                : "Continue"}
          </button>
        </form>
        <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
      </div>
    </>
  );
}

/**
 * PAID, WAITING FOR ACTIVATION — the waiting room.
 *
 * How access is actually granted here: the customer pays on Whop, messages
 * support, and the owner presses "Mark paid". So on the way back from checkout
 * the database honestly says "unpaid" for a few minutes or hours, and this
 * screen is what sits in that gap. It is deliberately NOT the Choose Plan
 * screen — that one asks somebody who has already handed over money to hand
 * over money again, which is how a paying customer ends up believing the
 * product is broken.
 *
 * The copy therefore does exactly three things: confirm the payment is in hand,
 * say that a person (not a button) switches the account on, and hand over the
 * address and number to message. It promises no timeline because there isn't
 * one to promise.
 *
 * The parent polls while this is on screen and navigates to /app/home the
 * instant the ledger row appears, so "check again" below is a reassurance for
 * somebody in a hurry, not the mechanism that unlocks anything.
 */
function AwaitingActivation({
  email,
  onRecheck,
  checking,
  onCancel,
}: {
  email: string;
  onRecheck: () => void;
  checking: boolean;
  onCancel: () => void;
}) {
  const whatsappHref = `https://wa.me/27704950612?text=${encodeURIComponent(`Hi EA Migrate, I have just paid and I am waiting for activation. My email is ${email || "my email"}.`)}`;
  return (
    <div className="-translate-y-8 text-center">
      <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
        <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
      </div>
      <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Payment received</h1>
      <p className="mt-2 text-base leading-7 text-[#8a9298]">
        Thanks
        {email ? (
          <>
            {" "}
            <span className="font-semibold text-[#55c7ff]">{email}</span>
          </>
        ) : null}{" "}
        — your payment is in, and your account is being switched on now.
      </p>
      <div
        role="status"
        className="mt-6 rounded-2xl border border-[#08a8ef]/45 bg-[#08a8ef]/10 p-5 text-left"
      >
        <p className="text-base font-bold leading-6 text-[#9fdcff]">Activation is done by hand</p>
        <p className="mt-1.5 text-sm leading-6 text-[#bcd9e8]/80">
          Each account is opened by our team after your payment is confirmed, so this step takes a
          short time rather than being instant. Send us a message to get it moved along — include
          the email you paid with.
        </p>
      </div>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noreferrer"
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] font-bold text-black transition hover:brightness-110"
      >
        Message us on WhatsApp
      </a>
      <p className="mt-2 text-sm text-[#8a9298]">
        {SUPPORT_WHATSAPP} · or email{" "}
        <a
          className="font-semibold text-[#55c7ff] underline"
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Payment received — please activate my account")}&body=${encodeURIComponent(`My email is ${email}. I have paid and I am waiting for activation.`)}`}
        >
          {SUPPORT_EMAIL}
        </a>
      </p>
      <button
        type="button"
        onClick={onRecheck}
        disabled={checking}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 font-semibold transition hover:border-[#08a8ef]/60 hover:text-[#55c7ff] disabled:opacity-60"
      >
        {checking ? "Checking…" : "I have contacted support — check again"}
      </button>
      <p className="mt-4 text-sm text-[#8a9298]">
        Leave this screen open — the app opens itself as soon as your account is activated.
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-sm font-semibold text-[#8a9298] underline transition hover:text-[#55c7ff]"
      >
        I haven&apos;t paid yet — back to sign in
      </button>
    </div>
  );
}

/**
 * THE DEACTIVATION NOTICE — the one thing a person whose account was turned
 * off needs to read.
 *
 * It exists because the gate now answers "revoked" from the database rather
 * than guessing from this device's memory, so a FRESH sign-in on a new phone
 * reaches this screen too. Offering checkout there would tell somebody who was
 * removed from the platform to buy their way back in, so the copy names the
 * decision, says signing in again will not reverse it, and points at support.
 */
function DeactivatedNotice() {
  return (
    <div
      role="alert"
      className="mt-6 rounded-2xl border border-red-400/45 bg-red-500/15 p-5 text-left"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-red-400 text-[13px] font-black text-red-950"
          aria-hidden="true"
        >
          !
        </span>
        <div>
          <p className="text-base font-bold leading-6 text-red-100">
            Your portal has been deactivated.
          </p>
          <p className="mt-1.5 text-sm leading-6 text-red-200/80">
            An administrator turned this account off — by rejecting it or marking it unpaid — so the
            portal and the app can no longer be used. Signing in again will not bring it back.
            Message support on WhatsApp with your email if you think this is a mistake.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * True when the page is running as an installed iOS/Android home-screen app
 * rather than inside a normal browser tab.
 *
 * This matters for checkout: iOS does NOT allow a standalone web app to
 * navigate to an external site, so the payment link is silently dropped and
 * the user is stuck on this screen with no error. Detecting it lets us offer
 * the one route that does work — handing the link to the real browser.
 */
function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ios = (window.navigator as { standalone?: boolean }).standalone === true;
    const displayMode = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
    setStandalone(ios || displayMode);
  }, []);
  return standalone;
}

/**
 * PLAN SELECTION — the one screen an unpaid account ever sees.
 *
 * The app is gated on payment alone, so somebody who is not paid stops here
 * and nothing else of EA Migrate is reachable. The customer TAPS a plan (the
 * card highlights) and presses Continue to Payment; there is deliberately no
 * automatic redirect, because with two destinations a programmatic hop could
 * only ever guess.
 *
 * Every route out is covered: a browser tab and the Android WebView follow
 * the link, the Android wrapper is asked to open the SYSTEM browser through
 * its native bridge, and an iOS home-screen app (which cannot leave for an
 * external site at all) gets copy-link and email-link fallbacks instead.
 */
function PlanSelection({
  email,
  selectedPlan,
  onSelectPlan,
  onCancel,
}: {
  email: string;
  selectedPlan: PlanId;
  onSelectPlan: (plan: PlanId) => void;
  onCancel: () => void;
}) {
  const standalone = useIsStandalone();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  /**
   * OPEN THE CHOSEN CHECKOUT.
   *
   * INSIDE THE ANDROID APP the page must NOT navigate itself to an external
   * site: `callNative("openUrl")` asks the wrapper to launch the system
   * browser, which is the only route iOS-style WebViews reliably honour and
   * the one that keeps the payment page in a real browser where the customer
   * can actually pay. Everywhere else a plain location assignment is what the
   * container follows.
   */
  const openCheckout = (url: string) => {
    if (typeof window === "undefined") return;
    if (callNative("openUrl", url)) return;
    try {
      window.location.href = url;
    } catch {
      // A container that refuses to leave keeps the tappable link on screen.
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2500);
    } catch {
      // Clipboard blocked — the links are on screen and selectable regardless.
    }
  };

  return (
    <div className="-translate-y-4 text-center">
      <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
        <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
      </div>
      <h1 className="mt-8 text-[2.1rem] font-semibold tracking-tight">Choose your plan</h1>
      <p className="mt-3 text-base leading-7 text-[#8a9298]">
        This account has no active subscription yet, so the app stays closed.
        {email ? ` Pay for ${email} below.` : ""}
      </p>

      {/* SELECTABLE PLAN CARDS — tap to choose, the active one is marked with
        the brand border and a checkmark. Choosing never navigates: it only
        decides what Continue to Payment opens. */}
      <div className="mt-8 space-y-4 text-left" role="radiogroup" aria-label="Choose your plan">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const active = selectedPlan === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelectPlan(id)}
              className={`block w-full rounded-[1.75rem] border p-5 text-left transition-colors ${
                active
                  ? "border-[#08a8ef] bg-[#08a8ef]/10 shadow-[0_0_30px_rgba(8,168,239,.28)]"
                  : "border-[#202930] bg-[#10161a] shadow-[0_0_28px_rgba(8,168,239,.10)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-bold text-white">
                  {plan.title} <span className="text-[#8a9298]">{plan.note}</span>
                </p>
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                    active
                      ? "border-[#08a8ef] bg-[#08a8ef] text-[#061018]"
                      : "border-[#2b3440] text-transparent"
                  }`}
                >
                  {active ? <Check className="size-4" /> : null}
                </span>
              </div>
              <span
                className={`mt-2 inline-block rounded-full px-3 py-1 text-[10px] font-black tracking-[0.12em] ${
                  active ? "bg-[#08a8ef] text-[#061018]" : "bg-[#08a8ef]/15 text-[#55c7ff]"
                }`}
              >
                {plan.badge}
              </span>
              <p className="mt-2 text-sm leading-6 text-[#8a9298]">{plan.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* CONTINUE TO PAYMENT — opens the SELECTED plan. On Android the native
        bridge hands the URL to the system browser; elsewhere a plain
        navigation (and, on iOS standalone, the copy/email fallbacks). */}
      {standalone ? (
        <div className="mt-6 rounded-2xl border border-[#202930] bg-[#10161a] p-5 text-left">
          <p className="text-sm font-semibold text-white">Finish in Safari</p>
          <p className="mt-2 text-sm leading-6 text-[#8a9298]">
            Tap copy, then open Safari and paste the link. iPhone apps cannot open payment pages
            directly.
          </p>
          <button
            type="button"
            onClick={() => void copy(PLANS[selectedPlan].url)}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-base font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)] active:scale-[.98]"
          >
            {copiedUrl === PLANS[selectedPlan].url ? "Link copied" : "Copy checkout link"}
          </button>
          <a
            href={`mailto:?subject=${encodeURIComponent("EA Migrate checkout")}&body=${encodeURIComponent(PLANS[selectedPlan].url)}`}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/80"
          >
            Email me the link
          </a>
          <p className="mt-3 break-all rounded-xl bg-black/40 p-3 font-mono text-xs text-[#55c7ff] select-all">
            {PLANS[selectedPlan].url}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => openCheckout(PLANS[selectedPlan].url)}
          className="mt-6 flex h-16 w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] active:scale-[.98]"
        >
          Continue to Payment <ArrowRight className="size-6" />
        </button>
      )}

      <p className="mt-6 text-xs leading-5 text-[#59646b]">
        {standalone
          ? "Tap copy, then open Safari and paste the link — iPhone apps cannot open payment pages directly."
          : "Already subscribed? Use the exact email you paid with."}
      </p>
      {/* ESCAPE HATCH — an account on a slow connection can reach this screen
        without owing anything, and being stuck on a payment page with no way
        out is the worst possible outcome. */}
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 h-12 w-full text-sm font-semibold text-[#8a9298] transition-colors hover:text-white"
      >
        Back — use a different email
      </button>
    </div>
  );
}

/**
 * THE SIX-DIGIT CODE — the second step of every paid sign-in.
 *
 * Reached only after the database positively confirmed the account, so the copy
 * never has to hedge about payment: the money is in, what is left is proving
 * this device can read the inbox it was paid with. The code itself is never
 * stored anywhere (it is derived server-side from a secret), so there is no
 * "we forgot your code" state — Resend is the whole recovery path.
 *
 * Six separate boxes rather than one field: it is the shape people expect from
 * a code they are reading out of an email, it keeps the digits legible on a
 * phone, and it makes a mistyped digit obvious instead of silent.
 */

function ActivationCodeView({
  email,
  value,
  setValue,
  error,
  verifying,
  resending,
  onSubmit,
  onResend,
  onCancel,
}: {
  email: string;
  value: string;
  setValue: (value: string) => void;
  error: string;
  verifying: boolean;
  resending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  // Keep focus in the hidden input so typing, pasting and backspace all work
  // while the six boxes are what the customer sees.
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="-translate-y-4 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-[#08a8ef]/10 text-[#55c7ff]">
        <Mail className="size-9" />
      </div>
      <h1 className="mt-7 text-3xl font-bold">Enter your code</h1>
      <p className="mt-3 text-sm leading-6 text-[#8a9298]">
        We sent a six-digit code to <span className="font-semibold text-[#55c7ff]">{email}</span>.
        Enter it to continue to your licence key.
      </p>
      <form className="mt-8" onSubmit={onSubmit}>
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="Six-digit activation code"
            className="absolute inset-0 h-full w-full opacity-0"
          />
          <div className="pointer-events-none flex justify-between gap-2" aria-hidden="true">
            {digits.map((digit, index) => (
              <span
                key={index}
                className={`flex h-16 flex-1 items-center justify-center rounded-2xl border text-2xl font-black transition-colors ${
                  error
                    ? "border-red-400/60 bg-red-500/10 text-red-200"
                    : index === value.length
                      ? "border-[#08a8ef] bg-[#08a8ef]/10 text-white"
                      : "border-[#202930] bg-[#10161a] text-white"
                }`}
              >
                {digit.trim()}
              </span>
            ))}
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={verifying}
          className="mt-6 flex h-[4.55rem] w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70"
        >
          {verifying ? "Checking your code…" : "Continue"}
          <ArrowRight className="size-6" />
        </button>
      </form>
      <div className="mt-5 space-y-2">
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="h-11 w-full text-sm font-semibold text-[#55c7ff] disabled:cursor-wait disabled:opacity-60"
        >
          {resending ? "Sending…" : "Send the code again"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 w-full text-sm font-semibold text-[#8a9298] transition-colors hover:text-white"
        >
          Use a different email
        </button>
      </div>
      <p className="mt-5 text-xs leading-5 text-[#59646b]">
        The code stops working after 5 minutes. It can be sent again if it expires.
      </p>
    </div>
  );
}

/**
 * THE KEY SHAPE THE GENERATOR ACTUALLY ISSUES — EMP-XXXX-XXXX-XXXX.
 * The field advertises this one, so the placeholder always describes the ACTIVE
 * format. (The 12-character `EMP-XXXXXXXXXXXX` shape is still accepted by
 * `activateKey` for keys issued before it changed, but it is not what this
 * screen tells anyone to expect.)
 */
const KEY_PLACEHOLDER = "EMP-XXXX-XXXX-XXXX";

/**
 * WHICH LABEL COLOUR AN ACCENT-FILLED CONTROL NEEDS.
 *
 * The accent list runs from near-black blues (`#0066FF`) to pure white
 * (`#FFFFFF`), so no single label colour is readable across it — the old screen
 * dodged the problem by hardcoding a dark label against its own hardcoded blue.
 *
 * This picks black or white by actual WCAG contrast ratio: the accent's sRGB
 * luminance is linearised and the ratio against each candidate is compared.
 * A plain "is it a light colour?" threshold gets the mid-tones wrong — copper
 * (`#B87333`) and algohost amber (`#F97316`) both read as "light" yet are far
 * more legible with a near-black label (7.5:1 vs 2.8:1 on the amber). Derived
 * from the live accent; nothing here is a colour copied from a design.
 */
function readableOn(accent: string): string {
  const hex = accent.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  const linear = (slice: string): number | null => {
    const value = Number.parseInt(slice, 16);
    if (!Number.isFinite(value)) return null;
    const ratio = value / 255;
    // The sRGB → linear curve WCAG contrast is defined on.
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(full.slice(0, 2));
  const green = linear(full.slice(2, 4));
  const blue = linear(full.slice(4, 6));
  if (red === null || green === null || blue === null) return "#ffffff";
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const againstBlack = (luminance + 0.05) / 0.05;
  const againstWhite = 1.05 / (luminance + 0.05);
  return againstBlack > againstWhite ? "#05070a" : "#ffffff";
}

/**
 * THE ROBOT ACTIVATION SCREEN.
 *
 * A single focused panel: the platform's logo over a halo drawn in the live
 * accent colour, the "Activate robot" headline, one ROBOT KEY field and one
 * button. Rebuilt from the layout the owner asked for, with two rules kept:
 *
 *   1. EVERY COLOUR IS DERIVED. The rings, the glow, the field's focus border,
 *      the button fill and the email chip all read the accent from
 *      `useCustomization()` — the user's own pick in Settings → Customization.
 *      There is no palette baked into this file and no image used as artwork,
 *      so the screen follows the app instead of fighting it.
 *   2. THE LOGO IS THE PLATFORM'S. `<BrandLogo>` renders whatever logo the
 *      platform is configured with (a custom upload, else the built-in
 *      mascot), which is the same mark every other surface shows.
 *
 * The key field itself is unchanged in behaviour: uppercase, the live
 * EMP-XXXX-XXXX-XXXX shape, validated by `activateKey` before this screen ever
 * mattered.
 */
function LicenseView({
  email,
  setEmail,
  keyValue,
  setKey,
  onSubmit,
  admin,
  paid,
  unlocking,
}: {
  email: string;
  setEmail: (value: string) => void;
  keyValue: string;
  setKey: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  admin: boolean;
  paid: boolean;
  unlocking: boolean;
}) {
  const platform = usePlatform();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const onAccent = readableOn(accent);
  const isIos = platform === "ios";
  const [focused, setFocused] = useState(false);
  const fieldShape = isIos ? "rounded-[16px]" : "rounded-[12px]";
  /*
   * The key field's resting border is the theme token on its className; the
   * ACCENT only takes over while it is focused. Keeping the resting state in
   * the class means the single colour this screen writes inline is the one the
   * user picked — there is no palette value living in this file.
   */
  const keyFieldStyle = focused ? { borderColor: accent, boxShadow: `0 0 0 3px ${accent}26` } : undefined;

  return (
    <div className="-translate-y-4">
      {/* HERO — the platform logo over an accent halo built from CSS rings, not
          an image, so it recolours with the accent and nothing is baked in. */}
      {/* The halo is sized to the box on purpose: an oversized ring would push
          past the top of the screen on a phone and read as a clipped graphic. */}
      <div className="relative mx-auto flex h-[176px] w-full max-w-[300px] items-center justify-center">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="absolute size-[168px] rounded-full border" style={{ borderColor: `${accent}1a` }} />
          <span className="absolute size-[126px] rounded-full border" style={{ borderColor: `${accent}29` }} />
          <span
            className="absolute size-[92px] rounded-full"
            style={{ background: `radial-gradient(circle, ${accent}33 0%, transparent 72%)` }}
          />
        </div>
        <BrandLogo
          className="relative size-[96px] object-contain"
          style={{ filter: `drop-shadow(0 0 22px ${accent}73)` }}
        />
      </div>

      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.44em] text-white/35">EA Migrate</p>
        <h1 className="mt-3 text-[34px] font-black leading-none tracking-tight text-white">Activate robot</h1>
        <p className="mx-auto mt-3 max-w-[19rem] text-[13px] leading-5 text-white/50">
          {admin
            ? "Admin access is active — add the robot key to continue."
            : paid
              ? "Enter the license key from your mentor."
              : "Your payment return was received. Enter the license key from your mentor."}
        </p>
      </div>

      <section
        className={`mt-7 border border-white/10 bg-white/[0.035] p-5 ${isIos ? "rounded-[26px]" : "rounded-[20px]"}`}
        style={{ boxShadow: `0 26px 64px -28px ${accent}80` }}
      >
        {email ? (
          <div
            className="mb-5 truncate rounded-full border px-4 py-2.5 text-center text-[13px] font-semibold text-white/75"
            style={{ borderColor: `${accent}40`, background: `${accent}14` }}
          >
            {email}
          </div>
        ) : (
          <label className="mb-5 block">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Payment email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`mt-2 h-[54px] w-full border border-white/10 bg-black/40 px-4 text-[15px] text-white outline-none placeholder:text-white/25 ${fieldShape}`}
              placeholder="you@example.com"
            />
          </label>
        )}
        <form onSubmit={onSubmit}>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Robot key</span>
            <input
              autoFocus
              required
              value={keyValue}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={KEY_PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label="Robot key"
              className={`mt-2 h-[58px] w-full border border-white/10 bg-black/40 px-4 font-mono text-[15px] tracking-[0.16em] text-white outline-none transition-colors placeholder:text-white/25 ${fieldShape}`}
              style={keyFieldStyle}
            />
          </label>
          <button
            type="submit"
            disabled={unlocking}
            className="mt-4 flex h-[58px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-black tracking-wide transition-transform active:scale-[.99] disabled:cursor-wait disabled:opacity-70"
            style={{ background: accent, color: onAccent, boxShadow: `0 14px 36px -14px ${accent}e6` }}
          >
            {unlocking ? "Activating…" : "Activate"}
          </button>
        </form>
        <p className="mt-5 flex items-center justify-center gap-2 text-[11px] text-white/35">
          <LockKeyhole className="size-3" style={{ color: accent }} /> One email, one activated device
        </p>
      </section>
    </div>
  );
}
