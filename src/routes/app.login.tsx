import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { activateKey, appSignIn, getDeviceId, useAppState } from "@/lib/app-store";
import { markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { requireVerifiedAccess, verifyPaymentReturn } from "@/lib/payment-gate";
import { checkDeviceBinding, reactivateEmailToDevice, registerWithEmail } from "@/lib/supabase-users";

export const Route = createFileRoute("/app/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Login — EA Migrate" }, { name: "description", content: "Enter your email to continue to EA Migrate." }] }),
  component: AppAccess,
});

const WHOP_CHECKOUT_URL = (import.meta.env["VITE_WHOP_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

function AppAccess() {
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const [key, setKey] = useState("");
  const [successReturn, setSuccessReturn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  // The license key IS the payment — this path lets the user skip checkout
  // entirely and go straight to entering the key their mentor issued.
  const [keyMode, setKeyMode] = useState(false);
  // EMAIL REACTIVATION — the email is bound to another device. The sign-in
  // form swaps for a reactivation card; confirming releases the old device
  // and binds this one (admins included — everyone gets the same flow).
  const [reactivateEmail, setReactivateEmail] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);

  useEffect(() => {
    const success = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("success") === "true";
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

  useEffect(() => {
    if (app.email && app.robots.length > 0 && !successReturn) window.location.replace("/app/home");
  }, [app.email, app.robots.length, successReturn]);

  const activeEmail = app.email || email.trim().toLowerCase();
  const paymentStatus = activeEmail ? paymentStatusForEmail(activeEmail) : "unpaid";
  const showLicenseView = keyMode || successReturn || paymentStatus !== "unpaid";

  const continueWithEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = email.trim().toLowerCase();
    console.log("[app-login] Trying login:", clean);
    // CLOUD DEVICE BINDING FIRST: if this email is already bound to another
    // device, do NOT sign in — offer reactivation instead ("email already
    // used — reactivate to log in"). Applies to admins and clients alike.
    try {
      const binding = await checkDeviceBinding(clean, getDeviceId());
      if (binding.boundToOtherDevice) {
        setReactivateEmail(clean);
        return;
      }
    } catch {
      /* unreachable cloud — fall through to the normal sign-in path */
    }
    const result = appSignIn(clean);
    if (result.error) {
      console.log("[app-login] Login error:", result.error);
      toast.error(result.error);
      return;
    }
    console.log("[app-login] Login success");
    // Arm the WELCOME MASTER gate — the home screen plays it (with voice) on arrival.
    window.sessionStorage.setItem("eamp_pending_welcome", "1");
    if (typeof window !== "undefined") window.localStorage.setItem("eamp.pending-payment-email", clean);

    // Bind THIS device in the cloud (best-effort — a failure never blocks).
    void import("@/lib/supabase-users").then(({ reactivateEmailToDevice }) =>
      reactivateEmailToDevice(clean, getDeviceId()).catch(() => {}),
    );

    // Supabase registration: upsert the user, create the session row, then
    // decide the gate from the DATABASE — unpaid goes to checkout, paid or
    // admin comes in. Falls back to the legacy local payment store while
    // Supabase is unconfigured, so the flow never blocks.
    const registration = await registerWithEmail(clean);
    if (registration.outcome === "checkout") {
      if (successReturn) {
        // The URL flag says they returned from checkout — prove it on the
        // server before granting anything. Unverifiable → straight to Whop.
        const verified = await verifyPaymentReturn(clean);
        if (verified) return;
      }
      setRedirecting(true);
      window.location.assign(WHOP_CHECKOUT_URL);
      return;
    }
    if (registration.outcome === "admin") toast.success("Admin access enabled — no payment is required.");
  };

  /** Confirm reactivation: release the old device, bind this one, sign in. */
  const confirmReactivate = async () => {
    const clean = reactivateEmail;
    if (!clean || reactivating) return;
    setReactivating(true);
    const result = await reactivateEmailToDevice(clean, getDeviceId());
    setReactivating(false);
    if (!result.ok) {
      toast.error(result.error ?? "Reactivation failed — try again.");
      return;
    }
    toast.success("Device reactivated — welcome back!");
    setReactivateEmail(null);
    // Normal sign-in continues (the local guard now also passes because the
    // local binding either matches or is absent on a fresh device).
    const signInResult = appSignIn(clean);
    if (signInResult.error) {
      // Local binding from an OLD device on THIS storage — clear it; the
      // cloud just ruled this device the active one.
      window.localStorage.removeItem("eamp.pending-payment-email");
    }
    window.sessionStorage.setItem("eamp_pending_welcome", "1");
    void import("@/lib/supabase-users").then(({ registerWithEmail }) => registerWithEmail(clean)).then((registration) => {
      if (registration.outcome === "checkout") {
        setRedirecting(true);
        window.location.assign(WHOP_CHECKOUT_URL);
        return;
      }
      if (registration.outcome === "admin") toast.success("Admin access enabled — no payment is required.");
    });
  };

  const submitLicense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!app.email) {
      const signInResult = appSignIn(email.trim().toLowerCase());
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
  };

  return <div className="min-h-screen w-full bg-[#070d10] text-white">
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pt-safe pb-safe-xl">
      {reactivateEmail ? <ReactivateView email={reactivateEmail} onConfirm={() => void confirmReactivate()} onCancel={() => setReactivateEmail(null)} busy={reactivating} /> :
      !showLicenseView ? <LoginView email={email} setEmail={setEmail} onSubmit={continueWithEmail} redirecting={redirecting} onEnterKey={() => {
        const clean = email.trim().toLowerCase();
        if (!clean) { toast.error("Enter your email first — the key is checked against it."); return; }
        const signInResult = appSignIn(clean);
        if (signInResult.error) { toast.error(signInResult.error); return; }
        setKeyMode(true);
      }} /> : <LicenseView email={activeEmail} setEmail={setEmail} keyValue={key} setKey={setKey} onSubmit={submitLicense} admin={paymentStatus === "admin"} paid={paymentStatus === "paid" || successReturn || keyMode} />}
    </main>
  </div>;
}

/**
 * Email-already-used → Reactivate card. Shown when the cloud says the
 * email is bound to another device. One tap releases the old device and
 * signs this one in — subscription, license keys and payment untouched.
 */
function ReactivateView({ email, onConfirm, onCancel, busy }: { email: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-full bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/logo.png" alt="EA Migrate" className="size-full object-contain" />
    </div>
    <h1 className="mt-8 text-[2.45rem] font-semibold tracking-tight">Email already used</h1>
    <p className="mt-3 text-base leading-7 text-[#8a9298]">
      <span className="font-semibold text-[#55c7ff]">{email}</span> is activated on another device.
      Reactivate to log in on this one — the previous device is signed out
      and your licence, payment and robots stay exactly as they are.
    </p>
    <div className="mt-10 space-y-4">
      <button type="button" onClick={onConfirm} disabled={busy} className="flex h-[4.55rem] w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70">
        {busy ? <span className="flex items-center gap-3"><span className="size-5 animate-spin rounded-full border-[3px] border-[#061018]/70 border-t-transparent" />Reactivating…</span> : <><RefreshCcw className="size-6" /> Reactivate &amp; log in</>}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="h-14 w-full rounded-full text-sm font-semibold text-[#8a9298] transition-colors hover:text-white">
        Use a different email
      </button>
    </div>
    <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
  </div>;
}

function LoginView({ email, setEmail, onSubmit, redirecting, onEnterKey }: { email: string; setEmail: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; redirecting: boolean; onEnterKey: () => void }) {
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
      <button type="submit" disabled={redirecting} className="flex h-[4.55rem] w-full items-center justify-center gap-3 rounded-full bg-[#08a8ef] text-lg font-bold text-[#061018] shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70">{redirecting ? "Redirecting to Whop…" : "Proceed"}<ArrowRight className="size-6" /></button>
    </form>
    <button type="button" onClick={onEnterKey} className="mx-auto mt-6 flex items-center gap-2 text-sm font-bold text-[#55c7ff] underline-offset-4 hover:underline">
      <LockKeyhole className="size-4" /> I already have a license key
    </button>
    <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
  </div>;
}

function LicenseView({ email, setEmail, keyValue, setKey, onSubmit, admin, paid }: { email: string; setEmail: (value: string) => void; keyValue: string; setKey: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; admin: boolean; paid: boolean }) {
  return <div className="-translate-y-4">
    <div className="text-center"><div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-9" /></div><h1 className="mt-7 text-3xl font-bold">Add your licence key</h1><p className="mt-3 text-sm leading-6 text-[#8a9298]">{admin ? "Admin access is active. No payment is required for this email." : paid ? "Payment received. Add the licence key sent to your email." : "Your payment return was received. Add the licence key sent to your email."}</p></div>
    <section className="mt-8 rounded-[2rem] border border-[#202930] bg-[#10161a] p-6 shadow-[0_0_28px_rgba(8,168,239,.12)]">{email ? <div className="mb-5 rounded-full border border-[#08a8ef]/40 bg-[#08a8ef]/10 px-4 py-3 text-center text-sm font-semibold text-[#55c7ff]">{email}</div> : <label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Payment email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 text-sm outline-none focus:border-[#08a8ef]" placeholder="you@example.com" /></label>}<form onSubmit={onSubmit}><label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Licence key</span><input autoFocus required value={keyValue} onChange={(event) => setKey(event.target.value.toUpperCase())} placeholder="EMP-XXXXXXXXXXXX" className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 font-mono text-sm tracking-[0.15em] outline-none focus:border-[#08a8ef]" /></label><button type="submit" className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-sm font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)]">Unlock robot <ArrowRight className="size-4" /></button></form><p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#69757c]"><LockKeyhole className="size-3" /> One email, one activated device</p></section>
  </div>;
}
