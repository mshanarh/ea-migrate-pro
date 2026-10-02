import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";
import { activateKey, appSignIn, appSignOut, getDeviceId, useAppState } from "@/lib/app-store";
import { getApprovalForEmail } from "@/lib/admin-store";
import { markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { verifyPaymentReturn } from "@/lib/payment-gate";
import { bindDeviceToEmail, checkDeviceBinding, registerWithEmail } from "@/lib/supabase-users";

export const Route = createFileRoute("/app/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Login — EA Migrate" }, { name: "description", content: "Enter your email to continue to EA Migrate." }] }),
  component: AppAccess,
});

const WHOP_CHECKOUT_URL = (import.meta.env["VITE_WHOP_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

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
  // Non-null once we know this email must pay: renders the tappable
  // checkout link that WebViews actually honour.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
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
  // EMAIL ALREADY USED — the email is bound to another device in the CLOUD.
  // The sign-in form swaps for a blocked card: the user must ask their
  // mentor to release the device (Re-activate Client in the mentor portal).
  // NO self-reactivation: delete + reinstall must NOT unlock the account.
  // Applies to EVERYONE — clients and admins alike.
  const [blockedEmail, setBlockedEmail] = useState<string | null>(null);
  // APPROVAL STATE — a signup that has not been reviewed yet ("pending")
  // and a rejected one are both held at the door. The admin console's
  // Approve button is the only way out of pending.
  const [heldEmail, setHeldEmail] = useState<{ email: string; status: "pending" | "rejected" } | null>(null);
  // "Checking…" on the held card while we re-read the approval.
  const [heldChecking, setHeldChecking] = useState(false);

  /**
   * Someone held at "waiting for approval" had no way back in: the card only
   * offered "use a different email", so once the admin approved them they still
   * could not get in without restarting the app. This re-reads the approval on
   * a timer and signs them straight through the moment it flips.
   */
  useEffect(() => {
    if (!heldEmail) return;
    let cancelled = false;
    const recheck = async () => {
      setHeldChecking(true);
      try {
        const approval = await getApprovalForEmail(heldEmail.email);
        if (cancelled) return;
        if (approval.ok && approval.status === "approved") {
          // Approved: bind this device and sign in for real, then continue
          // into the app. The home guard treats an unbound session as stale
          // and would bounce them straight back to this screen, so the bind
          // has to happen before the redirect.
          try {
            const bound = await bindDeviceToEmail(heldEmail.email, getDeviceId());
            if (!bound.ok && bound.error) toast.error(bound.error);
          } catch {
            /* a failed bind must never block the redirect */
          }
          appSignIn(heldEmail.email);
          window.location.replace("/app/home");
          return;
        }
        if (approval.ok && approval.status === "rejected") {
          setHeldEmail((current) => (current ? { ...current, status: "rejected" } : current));
        }
      } catch {
        /* transient — retried on the next tick */
      } finally {
        if (!cancelled) setHeldChecking(false);
      }
    };
    void recheck();
    const timer = setInterval(() => void recheck(), 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [heldEmail]);

  // ?pay=1 is re-read after EVERY render on purpose. /app/home sends unpaid
  // users here with a client-side navigation, and TanStack keeps the same
  // route component mounted across it — an effect keyed on app.email never
  // re-ran, the flag stayed false, and the checkout card never appeared.
  // Same value in, same value out: React bails out, so this costs nothing.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPayPrompt(params.get("pay") === "1");
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
  // A signed-in session that ALREADY has a robot goes to the app. The key
  // screen used to appear for every paid/approved session on every launch —
  // including people whose robot was already activated — so opening the app
  // always demanded another key, with no way past it. The home screen has an
  // "Add robot" dialog for anyone who genuinely needs another one.
  //
  // A return from checkout still forces the view: that is a deliberate
  // request for the licence-entry screen, not a returning session.
  const returningWithRobot = Boolean(app.email) && app.robots.length > 0;
  const showLicenseView = !returningWithRobot && (successReturn || sessionPaymentStatus !== "unpaid");

  useEffect(() => {
    if (!app.email || successReturn) return;
    // Never yank the page away while a sign-in attempt is still deciding the
    // outcome, or while a checkout / approval / blocked card is on screen.
    if (busy || checkoutUrl || payPrompt || heldEmail || blockedEmail) return;
    // A signed-in mentor goes to the app EVEN with no robots yet. This used
    // to require `app.robots.length > 0`, and robots only appear after a
    // licence key is activated — so a freshly approved mentor signed in
    // successfully and then sat on this screen forever, which looks exactly
    // like a failed sign-in. The home screen has its own "Add robot" state.
    if (showLicenseView) return;
    // An UNPAID session must not round-trip through /app/home: that guard
    // decides "pay" and sends the person back here, so the two would
    // ping-pong with nothing ever happening. The checkout screen owns them.
    if (sessionPaymentStatus === "unpaid") return;
    window.location.replace("/app/home");
  }, [app.email, successReturn, showLicenseView, busy, checkoutUrl, payPrompt, heldEmail, blockedEmail, sessionPaymentStatus]);

  /**
   * THE HOP TO WHOP. A plain browser tab follows location.assign; an iOS
   * home-screen app silently refuses to leave for an external site, and the
   * tappable link on the checkout card below is what works there. A second,
   * slightly delayed attempt covers the case where the first one landed
   * while this document was still settling.
   */
  useEffect(() => {
    if (!checkoutUrl) return;
    const timer = setTimeout(() => {
      try {
        window.location.assign(checkoutUrl);
      } catch {
        /* the visible link is the fallback */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [checkoutUrl]);

  const continueWithEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const clean = email.trim().toLowerCase();
    console.log("[app-login] Trying login:", clean);
    // Freeze the auto-redirect BEFORE the first await (see `busy`). Every
    // exit below that is not "go to checkout" puts it back.
    setBusy(true);
    // ONE shared budget for the whole decision. Each call below may only
    // spend what is left of it, so however badly the network behaves the
    // door still opens inside ~20s instead of showing "Redirecting to
    // Whop…" forever.
    const budgetStartedAt = Date.now();
    const left = () => Math.max(2_000, 20_000 - (Date.now() - budgetStartedAt));
    try {
      // CLOUD DEVICE BINDING FIRST: if this email is already bound to another
      // device, do NOT sign in — show the blocked card ("account already used,
      // please tell your mentor to reactivate"). Applies to admins and
      // clients alike — there is no self-service unlock.
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
        toast.error(result.error);
        setBusy(false);
        setRedirecting(false);
        return;
      }
      console.log("[app-login] Login success");
      // Arm the WELCOME MASTER gate — the home screen plays it (with voice) on arrival.
      window.sessionStorage.setItem("eamp_pending_welcome", "1");
      if (typeof window !== "undefined") window.localStorage.setItem("eamp.pending-payment-email", clean);

      // Supabase registration FIRST: upsert the user (so the row EXISTS),
      // create the session row, then decide the gate from the DATABASE —
      // unpaid goes to checkout, paid or admin comes in. The device bind
      // below needs the row to exist, so registration must come before it.
      //
      // FAIL CLOSED. A cloud call that does not answer in time must never be
      // read as "this account is fine" — the earlier "allow" fallback here
      // was a payment hole: a slow or failing upsert walked an unpaid user
      // straight into the app. An undecided account goes to checkout, which
      // is recoverable (the card has a way back); walking into the app
      // without paying is not.
      const registration = await withDeadline(registerWithEmail(clean), left(), { outcome: "checkout", user: null } as Awaited<ReturnType<typeof registerWithEmail>>);
      if (registration.outcome === "admin") toast.success("Admin access enabled — no payment is required.");

      // PENDING / REJECTED — the account exists but the admin has not cleared
      // it. Sign out again (the local session was armed a moment ago) and
      // show the matching card instead of the app.
      if (registration.outcome === "pending" || registration.outcome === "rejected") {
        appSignOut();
        setHeldEmail({ email: clean, status: registration.outcome });
        setBusy(false);
        setRedirecting(false);
        return;
      }

      // Bind THIS device in the cloud BEFORE any redirect — including the Whop
      // checkout hop. The access gate treats a missing binding as a stale
      // session (the global access reset), so a person who comes back AFTER
      // paying must already be bound — otherwise the gate would sign them out
      // in a loop. Bindings are written at sign-in and at key activation.
      try {
        const bound = await withDeadline(bindDeviceToEmail(clean, getDeviceId()), left(), { ok: false, error: "Device binding timed out" });
        if (!bound.ok && bound.error) {
          toast.error(bound.error);
        }
      } catch {
        /* a failed bind must never block sign-in */
      }

      if (registration.outcome === "checkout") {
        if (successReturn) {
          // The URL flag says they returned from checkout — prove it on the
          // server before granting anything. Unverifiable → straight to Whop.
          const verified = await withDeadline(verifyPaymentReturn(clean), left(), false);
          if (verified) return;
        }
        // A WebView (iOS WKWebView especially) drops a programmatic navigation
        // that happens AFTER an await — by then the browser no longer counts it
        // as a user gesture, so location.assign silently does nothing and the
        // user is left staring at a disabled button. We show a real, tappable
        // link as the reliable path, and keep the automatic hop (see the
        // effect above) as the convenience route.
        setRedirecting(true);
        setCheckoutUrl(WHOP_CHECKOUT_URL);
        return;
      }

      // allow / admin — hand them over to the app. This is NOT a forced
      // navigation: the auto-redirect effect above only walks a session into
      // /app/home when the LOCAL store says it is paid or admin, and
      // /app/home re-checks the cloud before a single pixel renders. Forcing
      // the jump here is what let an undecided account land in the app.
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
  const dismissHeld = () => setHeldEmail(null);
  /**
   * Back out of the checkout card. Reached two ways: the user tapping the
   * escape link (a payment page they did not need — an approved account on a
   * flaky connection, say) and the ?pay=1 deep link that /app/home sends
   * here. The URL is rewritten too, or a refresh would bounce them straight
   * back to checkout.
   */
  const dismissCheckout = () => {
    setCheckoutUrl(null);
    setPayPrompt(false);
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
      {(checkoutUrl || payPrompt) ? <CheckoutRedirect url={checkoutUrl ?? WHOP_CHECKOUT_URL} email={activeEmail} onCancel={dismissCheckout} /> :
      heldEmail ? <ApprovalHeldView email={heldEmail.email} status={heldEmail.status} checking={heldChecking} onCancel={dismissHeld} /> :
      blockedEmail ? <AccountUsedView email={blockedEmail} onCancel={dismissBlocked} /> :
      !showLicenseView ? <LoginView email={email} setEmail={setEmail} onSubmit={continueWithEmail} checking={busy && !redirecting} redirecting={redirecting} /> : <LicenseView email={activeEmail} setEmail={setEmail} keyValue={key} setKey={setKey} onSubmit={submitLicense} admin={sessionPaymentStatus === "admin"} paid={sessionPaymentStatus === "paid" || successReturn} unlocking={unlocking} />}
    </main>
  </div>;
}

/**
 * PENDING / REJECTED card. The account exists in the database but the admin
 * console has not cleared it yet: pending means "waiting for review", and
 * only the admin can move it on; rejected means the request was declined.
 * Both keep the person out of the app — the copy says exactly what to do,
 * and there is no self-service override.
 */
function ApprovalHeldView({
  email,
  status,
  checking,
  onCancel,
}: {
  email: string;
  status: "pending" | "rejected";
  checking: boolean;
  onCancel: () => void;
}) {
  const rejected = status === "rejected";
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.1rem] font-semibold tracking-tight">
      {rejected ? "Account rejected" : "Waiting for approval"}
    </h1>
    <div
      role="alert"
      className={
        rejected
          ? "mt-5 flex items-start gap-3 rounded-2xl border border-red-400/50 bg-red-500/15 p-4 text-left"
          : "mt-5 flex items-start gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/15 p-4 text-left"
      }
    >
      <span
        className={
          rejected
            ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-400 text-[11px] font-black text-red-950"
            : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-300 text-[11px] font-black text-amber-950"
        }
        aria-hidden="true"
      >
        {rejected ? "!" : "…"}
      </span>
      <p className={rejected ? "text-sm font-semibold leading-6 text-red-200" : "text-sm font-semibold leading-6 text-amber-100"}>
        {rejected
          ? "This registration was rejected. Contact support if you believe this is a mistake."
          : "Your account was created and is waiting for an administrator to approve it. You will be able to sign in as soon as it is approved."}
      </p>
    </div>
    <p className="mt-3 break-all text-base leading-7 text-[#8a9298]">{email}</p>
    {!rejected ? (
      <p aria-live="polite" className="mt-6 text-sm text-[#8a9298]">
        {checking ? "Checking for approval…" : "This screen updates on its own once you are approved."}
      </p>
    ) : null}
    <button
      type="button"
      onClick={onCancel}
      className="mt-8 h-14 w-full rounded-2xl border border-white/15 bg-white/5 text-base font-semibold text-white/80"
    >
      Use a different email
    </button>
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

function LoginView({ email, setEmail, onSubmit, checking, redirecting }: { email: string; setEmail: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; checking: boolean; redirecting: boolean }) {
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Login</h1>
    <p className="mt-2 text-base text-[#8a9298]">Enter your email to continue</p>
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
 * CHECKOUT REDIRECT — a real link, not a programmatic jump.
 *
 * Two different containers need two different routes out:
 *  • A browser tab or the Android WebView follows a normal external link.
 *  • An iOS home-screen (standalone) app CANNOT leave for an external site —
 *    it drops the navigation with no error at all. There the only thing that
 *    works is copying the link and opening it in the real browser, so that is
 *    what this screen offers when it detects it is running standalone.
 */
function CheckoutRedirect({ url, email, onCancel }: { url: string; email: string; onCancel: () => void }) {
  const standalone = useIsStandalone();
  const [copied, setCopied] = useState(false);
  // If the automatic hop has not left the page after a couple of seconds,
  // it was dropped by the container (an iOS home-screen app, an embedded
  // WebView). Say so plainly instead of leaving a dead screen.
  const [hopFailed, setHopFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHopFailed(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked — the link is on screen and selectable regardless.
    }
  };

  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.1rem] font-semibold tracking-tight">Payment required</h1>
    <p className="mt-3 text-base leading-7 text-[#8a9298]">
      This account needs an active subscription to use EA Migrate.
      {email ? ` Pay for ${email}.` : ""}
    </p>
    {!standalone && hopFailed ? (
      <p role="status" className="mt-4 rounded-2xl border border-amber-300/40 bg-amber-400/15 p-4 text-left text-sm font-semibold leading-6 text-amber-100">
        The automatic redirect did not open. Tap Continue to payment below to open Whop checkout.
      </p>
    ) : null}

    {standalone ? (
      <>
        {/* iOS home-screen app: an external link cannot open from here, so the
            link is handed to Safari instead of navigated to. */}
        <div className="mt-8 rounded-2xl border border-[#202930] bg-[#10161a] p-5 text-left">
          <p className="text-sm font-semibold text-white">Taking you to checkout</p>
          <p className="mt-2 text-sm leading-6 text-[#8a9298]">
            Tap copy, then open Safari and paste the link. iPhone apps cannot open payment pages
            directly.
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-base font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)] active:scale-[.98]"
          >
            {copied ? "Link copied" : "Copy checkout link"}
          </button>
          <p className="mt-4 break-all rounded-xl bg-black/40 p-3 font-mono text-xs text-[#55c7ff] select-all">
            {url}
          </p>
          <a
            href={`mailto:?subject=${encodeURIComponent("EA Migrate checkout")}&body=${encodeURIComponent(url)}`}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm font-semibold text-white/80"
          >
            Email me the link
          </a>
        </div>
      </>
    ) : (
      <>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-10 flex h-16 w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] active:scale-[.98]"
        >
          Continue to payment <ArrowRight className="size-6" />
        </a>
        <a
          href={url}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-base font-semibold text-white/80"
        >
          Open checkout in this window
        </a>
      </>
    )}

    <p className="mt-6 text-xs leading-5 text-[#59646b]">
      Already subscribed? Use the exact email you paid with.
    </p>
    {/* ESCAPE HATCH — an approved account on a slow connection can reach
        this card without owing anything, and being stuck on a payment page
        with no way out is the worst possible outcome. */}
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
