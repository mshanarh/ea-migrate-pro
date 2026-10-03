import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";
import { activateKey, appSignIn, getDeviceId, useAppState } from "@/lib/app-store";
import { markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { verifyPaymentReturn, invalidateAccessCache, resolveCloudAccess, type CloudAccess } from "@/lib/payment-gate";
import { bindDeviceToEmail, checkDeviceBinding, registerWithEmail } from "@/lib/supabase-users";

export const Route = createFileRoute("/app/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Login — EA Migrate" }, { name: "description", content: "Enter your email to continue to EA Migrate." }] }),
  component: AppAccess,
});

/**
 * THE TWO PLANS. An unpaid account stops on the Choose Plan screen and picks
 * one; nothing hops automatically, because there are two destinations and
 * guessing would send somebody to the wrong product. Both links are plain
 * anchors, so every container (browser, Android WebView, iOS home-screen app)
 * has a route out that does not depend on scripted navigation.
 */
const WHOP_MONTHLY_URL =
  (import.meta.env["VITE_WHOP_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_wgIWJdSwjlMGS";
const WHOP_LIFETIME_URL = "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

/** The plans, in the order they are offered. */
const PLANS: Array<{ url: string; title: string; blurb: string; badge?: string }> = [
  {
    url: WHOP_MONTHLY_URL,
    title: "Monthly Recurring",
    blurb: "Billed every month. Cancel any time.",
  },
  {
    url: WHOP_LIFETIME_URL,
    title: "Lifetime Access",
    blurb: "One payment. Yours for good, including every future update.",
    badge: "BEST VALUE",
  },
];

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
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const [key, setKey] = useState("");
  const [successReturn, setSuccessReturn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  // True once we know this email must pay: renders the Choose Plan screen
  // (monthly + lifetime) instead of any part of the app.
  const [choosePlan, setChoosePlan] = useState(false);
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPayPrompt(params.get("pay") === "1");
    setDeactivated(params.get("deactivated") === "1");
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = typeof window !== "undefined" && params.get("success") === "true";
    setSuccessReturn(success);
    // SECURITY: ?success=true alone must NEVER unlock the app — typing that
    // URL used to call markEmailPaid() locally, which is exactly how a
    // non-payer got in. The flag only shows the key entry view; unlock
    // happens ONLY after the SERVER verifies the Whop membership (or the
    // database already holds an approval/license for this email).
    if (success && app.email) {
      void verifyPaymentReturn(app.email).then((verified) => {
        if (verified) {
          if (typeof window !== "undefined") window.localStorage.removeItem("eamp.pending-payment-email");
        } else {
          setSuccessReturn(false);
        }
      });
    }
  }, [app.email]);

  const activeEmail = app.email || email.trim().toLowerCase();
  // Only a SIGNED-IN session (app.email) may open the license view directly.
  // The TYPED email must never pre-switch the view: an owner typing their
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
  const effectiveStatus = cloudStatus ?? sessionPaymentStatus;  // A signed-in session that ALREADY has a robot goes to the app. The key
  // screen used to appear for every paid/approved session on every launch —
  // including people whose robot was already activated — so opening the app
  // always demanded another key, with no way past it. The home screen has an
  // "Add robot" dialog for anyone who genuinely needs another one.
  //
  // A return from checkout still forces the view: that is a deliberate
  // request for the licence-entry screen, not a returning session.
  const returningWithRobot = Boolean(app.email) && app.robots.length > 0;
  const showLicenseView = !returningWithRobot && (successReturn || effectiveStatus !== "unpaid");
  // OPENING THE APP WITH AN UNPAID SESSION MUST GO TO WHOP — but ONLY on the
  // DATABASE's word. The local store is a hint that this device has not seen a
  // payment, and treating a hint as a verdict is what sent a customer who had
  // just been marked paid straight back to checkout: for the instant between
  // signing in and the database answering, this screen believed the hint,
  // decided "unpaid", and fired three hard redirects at Whop. Nothing here may
  // act on anything but `cloudStatus === "unpaid"`.
  const mustPay = Boolean(app.email) && cloudStatus === "unpaid" && !returningWithRobot && !checkoutDismissed;

  /**
   * Ask the database who this session is, and send an unpaid one straight to
   * Whop without waiting to be asked. ALWAYS FRESH — this is the answer that
   * decides whether the customer sees their app or a payment page, so a
   * remembered "unpaid" from before the owner pressed Mark paid would be
   * exactly the wrong thing to trust.
   */
  useEffect(() => {
    if (!app.email || successReturn || choosePlan) return;
    let cancelled = false;
    setCloudStatus(null);
    void (async () => {
      const status = await withDeadline(resolveCloudAccess(app.email, { fresh: true }), 15_000, null);
      if (cancelled) return;
      setCloudStatus(status);
      if (status === "unpaid") {
        setCheckoutDismissed(false);
        setChoosePlan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.email, successReturn, choosePlan]);

  useEffect(() => {
    if (!app.email || successReturn) return;
    // Never yank the page away while a sign-in attempt is still deciding the
    // outcome, or while a checkout / approval / blocked card is on screen.
    if (busy || choosePlan || payPrompt || mustPay || blockedEmail) return;
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
    // successfully and then sat on this screen forever, which looks exactly
    // like a failed sign-in. The home screen has its own "Add robot" state.
    if (showLicenseView) return;
    // An UNPAID session must not round-trip through /app/home: that guard
    // decides "unpaid" and sends the person back here, so the two would
    // ping-pong with nothing ever happening. The Choose Plan screen owns them.
    if (effectiveStatus === "unpaid") return;
    window.location.replace("/app/home");
  }, [app.email, successReturn, showLicenseView, busy, choosePlan, payPrompt, mustPay, blockedEmail, effectiveStatus]);

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
  const showChoosePlan = choosePlan || payPrompt || mustPay;

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
      const registration = await withDeadline(registerWithEmail(clean), left(), { outcome: "checkout", user: null } as Awaited<ReturnType<typeof registerWithEmail>>);
      if (typeof window !== "undefined") window.localStorage.setItem("eamp.pending-payment-email", clean);

      if (registration.outcome === "checkout") {
        if (successReturn) {
          // The URL flag says they returned from checkout — prove it on the
          // server before granting anything. Unverifiable → Choose Plan.
          const verified = await withDeadline(verifyPaymentReturn(clean), left(), false);
          if (verified) return;
        }
        // STOP HERE. The unpaid account does not go near /app/home; it lands
        // on the Choose Plan screen and picks monthly or lifetime.
        setRedirecting(false);
        setChoosePlan(true);
        return;
      }

      // ENTITLED — admin, or marked paid / holding a licence key. Only NOW do
      // the device rules apply: if this email is bound to another phone, do
      // NOT sign in — show the blocked card ("account already used, please
      // tell your mentor to reactivate"). There is no self-service unlock.
      try {
        const binding = await withDeadline(checkDeviceBinding(clean, getDeviceId()), left(), { boundToOtherDevice: false });
        if (binding.boundToOtherDevice) {
          setBlockedEmail(clean);
          setBusy(false);
          setRedirecting(false);
          return;
        }
      } catch {
        /* unreachable cloud — fall through to the normal sign-in path */
      }
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
      if (registration.outcome === "admin") toast.success("Admin access enabled — no payment is required.");

      // Bind THIS device in the cloud before letting them in. The access gate
      // treats a missing binding as a stale session (the global access reset),
      // so an entitled person must be bound on THIS device or the very next
      // route change would sign them straight back out again. A bind failure
      // is never worth an error toast here — it says nothing the customer can
      // act on, and a red banner over a working sign-in reads as a failure.
      try {
        const bound = await withDeadline(bindDeviceToEmail(clean, getDeviceId()), left(), { ok: false, error: "Device binding timed out" });
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

      // ENTITLED — the database just confirmed it. The auto-redirect effect
      // above walks the session into /app/home, which re-checks the cloud
      // before a single pixel renders. Nothing is forced from here, so an
      // undecided account can never be dropped into the app.
      setBusy(false);
      setRedirecting(false);
    } catch (error) {
      // A thrown network/registration error must never leave the button
      // stuck on "Redirecting to Whop…" forever.
      console.warn("[app-login] sign-in failed:", error);
      setBusy(false);
      setRedirecting(false);
      toast.error("Could not sign you in. Check your connection and try again.");
    }
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
        try { await registerWithEmail(clean); } catch { /* fail open */ }
        const signInResult = appSignIn(clean);
        if (signInResult.error) { toast.error(signInResult.error); return; }
      }
      // Same tolerant normalisation as activation: trim, uppercase, strip spaces.
      const normalizedKey = key.trim().toUpperCase().replace(/\s+/g, "");
      const result = await activateKey(normalizedKey);
      if (result.error) { toast.error(result.error); return; }
      toast.success((result.robot?.name || "Robot") + " activated on this device");
      // Arm the WELCOME MASTER gate — the home screen plays it (with voice) on arrival.
      window.sessionStorage.setItem("eamp_pending_welcome", "1");
      window.location.replace("/app/home");
    } finally {
      setUnlocking(false);
    }
  };

  return <div className="min-h-screen w-full bg-[#070d10] text-white">
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pt-safe pb-safe-xl">
      {showChoosePlan ? <ChoosePlanView email={activeEmail} onCancel={dismissCheckout} /> :
      blockedEmail ? <AccountUsedView email={blockedEmail} onCancel={dismissBlocked} /> :
      !showLicenseView ? <LoginView email={email} setEmail={setEmail} onSubmit={continueWithEmail} checking={busy && !redirecting} redirecting={redirecting} deactivated={deactivated} /> : <LicenseView email={activeEmail} setEmail={setEmail} keyValue={key} setKey={setKey} onSubmit={submitLicense} admin={effectiveStatus === "admin"} paid={effectiveStatus === "paid" || successReturn} unlocking={unlocking} />}
    </main>
  </div>;
}

/**
 * Email-already-used → BLOCKED card. The cloud says this email is bound to
 * another device. There is deliberately NO self-service unlock: deleting
 * and reinstalling the app must NOT get back in. The user asks their
 * mentor, who releases the device from the portal (Re-activate Client).
 * This applies to every email — clients and admins alike.
 */
function AccountUsedView({ email, onCancel }: { email: string; onCancel: () => void }) {
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Account already used</h1>
    <div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/50 bg-red-500/15 p-4 text-left">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-400 text-[11px] font-black text-red-950" aria-hidden="true">!</span>
      <p className="text-sm font-semibold leading-6 text-red-200">
        Account already used — please tell your mentor to reactivate.
      </p>
    </div>
    <p className="mt-3 text-base leading-7 text-[#8a9298]">
      <span className="font-semibold text-[#55c7ff]">{email}</span> is already activated on another device.
      One email works on one device only. Ask your mentor to re-activate your account —
      they can release your device from their portal in seconds, and your licence,
      payment and robots stay exactly as they are.
    </p>
    <div className="mt-10 space-y-4">
      <button type="button" onClick={onCancel} className="h-14 w-full rounded-full text-sm font-semibold text-[#8a9298] transition-colors hover:text-white">
        Use a different email
      </button>
    </div>
    <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
  </div>;
}

function LoginView({ email, setEmail, onSubmit, checking, redirecting, deactivated }: { email: string; setEmail: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; checking: boolean; redirecting: boolean; deactivated?: boolean }) {
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Login</h1>
    <p className="mt-2 text-base text-[#8a9298]">Enter your email to continue</p>
    {deactivated ? (
      <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/15 p-4 text-left">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black text-amber-950" aria-hidden="true">!</span>
        <p className="text-sm font-semibold leading-6 text-amber-100">Your access has been deactivated.</p>
      </div>
    ) : null}
    <form className="mt-12 space-y-4" onSubmit={onSubmit}>
      <label className="flex h-[4.55rem] items-center gap-4 rounded-full border border-[#202930] bg-[#10161a] px-7 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.03)] focus-within:border-[#08a8ef]">
        <Mail className="size-6 shrink-0 text-[#aab2b7]" />
        <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="h-full w-full bg-transparent text-lg text-white outline-none placeholder:text-[#8a9298]" />
      </label>
      <button type="submit" disabled={checking || redirecting} className="flex h-[4.55rem] w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70">{redirecting ? "Redirecting to Whop…" : checking ? "Checking your account…" : "Proceed"}<ArrowRight className="size-6" /></button>
    </form>
    <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
  </div>;
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
 * CHOOSE PLAN — the one screen an unpaid account ever sees.
 *
 * The app is gated on payment alone, so somebody who is not paid stops here
 * and nothing else of EA Migrate is reachable. Two products are offered as
 * real anchors (a browser tab, the Android WebView and an iOS home-screen app
 * all follow a plain external link), and there is deliberately NO automatic
 * redirect: with two destinations, a programmatic hop could only guess.
 *
 * The links are built from PLANS at module scope, so the exact checkout URLs
 * live in exactly one place.
 */
function ChoosePlanView({ email, onCancel }: { email: string; onCancel: () => void }) {
  const standalone = useIsStandalone();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  // If the automatic hop has not left the page after a couple of seconds,
  // it was dropped by the container (an iOS home-screen app, an embedded
  // WebView). Say so plainly instead of leaving a dead screen.
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2500);
    } catch {
      // Clipboard blocked — the links are on screen and selectable regardless.
    }
  };

  return <div className="-translate-y-4 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.1rem] font-semibold tracking-tight">Choose your plan</h1>
    <p className="mt-3 text-base leading-7 text-[#8a9298]">
      This account has no active subscription yet, so the app stays closed.
      {email ? ` Pay for ${email} below.` : ""}
    </p>

    <div className="mt-8 space-y-4 text-left">
      {PLANS.map((plan) => (
        <div key={plan.url} className="rounded-[1.75rem] border border-[#202930] bg-[#10161a] p-5 shadow-[0_0_28px_rgba(8,168,239,.10)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-bold text-white">{plan.title}</p>
            {plan.badge ? (
              <span className="shrink-0 rounded-full bg-[#08a8ef] px-3 py-1 text-[10px] font-black tracking-[0.12em] text-[#061018]">
                {plan.badge}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-[#8a9298]">{plan.blurb}</p>
          {standalone ? (
            // iOS home-screen app: an external link cannot open from here, so
            // the link is handed to Safari instead of navigated to.
            <>
              <button
                type="button"
                onClick={() => void copy(plan.url)}
                className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-base font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)] active:scale-[.98]"
              >
                {copiedUrl === plan.url ? "Link copied" : "Copy checkout link"}
              </button>
              <p className="mt-3 break-all rounded-xl bg-black/40 p-3 font-mono text-xs text-[#55c7ff] select-all">
                {plan.url}
              </p>
            </>
          ) : (
            <a
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-base font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] active:scale-[.98]"
            >
              Continue to payment <ArrowRight className="size-5" />
            </a>
          )}
        </div>
      ))}
    </div>

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
  </div>;
}

function LicenseView({ email, setEmail, keyValue, setKey, onSubmit, admin, paid, unlocking }: { email: string; setEmail: (value: string) => void; keyValue: string; setKey: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; admin: boolean; paid: boolean; unlocking: boolean }) {
  return <div className="-translate-y-4">
    <div className="text-center"><div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-9" /></div><h1 className="mt-7 text-3xl font-bold">Add your licence key</h1><p className="mt-3 text-sm leading-6 text-[#8a9298]">{admin ? "Admin access is active. No payment is required for this email." : paid ? "Payment received. Add the licence key sent to your email." : "Your payment return was received. Add the licence key sent to your email."}</p></div>
    <section className="mt-8 rounded-[2rem] border border-[#202930] bg-[#10161a] p-6 shadow-[0_0_28px_rgba(8,168,239,.12)]">{email ? <div className="mb-5 rounded-full border border-[#08a8ef]/40 bg-[#08a8ef]/10 px-4 py-3 text-center text-sm font-semibold text-[#55c7ff]">{email}</div> : <label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Payment email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 text-sm outline-none focus:border-[#08a8ef]" placeholder="you@example.com" /></label>}<form onSubmit={onSubmit}><label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Licence key</span><input autoFocus required value={keyValue} onChange={(event) => setKey(event.target.value.toUpperCase())} placeholder="EMP-XXXXXXXXXXXX" className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 font-mono text-sm tracking-[0.15em] outline-none focus:border-[#08a8ef]" /></label><button type="submit" disabled={unlocking} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-sm font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)] disabled:cursor-wait disabled:opacity-70">{unlocking ? "Unlocking…" : "Unlock robot"}<ArrowRight className="size-4" /></button></form><p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#69757c]"><LockKeyhole className="size-3" /> One email, one activated device</p></section>
  </div>;
}
