import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";
import { activateKey, appSignIn, useAppState } from "@/lib/app-store";
import { isPaymentExemptEmail, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";

export const Route = createFileRoute("/app/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Login — EA Migrate Pro" }, { name: "description", content: "Enter your email to continue to EA Migrate Pro." }] }),
  component: AppAccess,
});

const WHOP_CHECKOUT_URL = (import.meta.env["VITE_WHOP_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

function AppAccess() {
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const [key, setKey] = useState("");
  const [successReturn, setSuccessReturn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const success = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("success") === "true";
    setSuccessReturn(success);
    if (success && app.email) {
      markEmailPaid(app.email);
      if (typeof window !== "undefined") window.localStorage.removeItem("eamp.pending-payment-email");
    }
  }, [app.email]);

  useEffect(() => {
    if (app.email && app.robots.length > 0 && !successReturn) window.location.replace("/app/home");
  }, [app.email, app.robots.length, successReturn]);

  const activeEmail = app.email || email.trim().toLowerCase();
  const paymentStatus = activeEmail ? paymentStatusForEmail(activeEmail) : "unpaid";
  const showLicenseView = successReturn || paymentStatus !== "unpaid";

  const continueWithEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = email.trim().toLowerCase();
    const result = appSignIn(clean);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (typeof window !== "undefined") window.localStorage.setItem("eamp.pending-payment-email", clean);
    if (successReturn) {
      markEmailPaid(clean);
      return;
    }
    if (isPaymentExemptEmail(clean)) {
      toast.success("Admin access enabled — no payment is required.");
      return;
    }
    if (paymentStatusForEmail(clean) === "paid") return;
    setRedirecting(true);
    window.location.assign(WHOP_CHECKOUT_URL);
  };

  const submitLicense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!app.email) {
      const signInResult = appSignIn(email);
      if (signInResult.error) { toast.error(signInResult.error); return; }
    }
    const result = activateKey(key);
    if (result.error) { toast.error(result.error); return; }
    toast.success((result.robot?.name || "Robot") + " activated on this device");
    window.location.replace("/app/home");
  };

  return <div className="min-h-screen w-full bg-[#070d10] text-white">
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 pb-20 pt-10">
      {!showLicenseView ? <LoginView email={email} setEmail={setEmail} onSubmit={continueWithEmail} redirecting={redirecting} /> : <LicenseView email={activeEmail} setEmail={setEmail} keyValue={key} setKey={setKey} onSubmit={submitLicense} admin={paymentStatus === "admin"} paid={paymentStatus === "paid" || successReturn} />}
    </main>
  </div>;
}

function LoginView({ email, setEmail, onSubmit, redirecting }: { email: string; setEmail: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; redirecting: boolean }) {
  return <div className="-translate-y-8 text-center">
    <div className="mx-auto flex size-28 items-center justify-center overflow-hidden rounded-[2rem] bg-[#08a8ef] shadow-[0_0_34px_rgba(8,168,239,.42)]">
      <img src="/ea-migrate-platform-robot.jpg" alt="EA Migrate Pro" className="size-full object-cover object-[50%_18%]" />
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
    <p className="mt-7 text-xs text-[#59646b]">One email can be activated on one device.</p>
  </div>;
}

function LicenseView({ email, setEmail, keyValue, setKey, onSubmit, admin, paid }: { email: string; setEmail: (value: string) => void; keyValue: string; setKey: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; admin: boolean; paid: boolean }) {
  return <div className="-translate-y-4">
    <div className="text-center"><div className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-9" /></div><h1 className="mt-7 text-3xl font-bold">Add your licence key</h1><p className="mt-3 text-sm leading-6 text-[#8a9298]">{admin ? "Admin access is active. No payment is required for this email." : paid ? "Payment received. Add the licence key sent to your email." : "Your payment return was received. Add the licence key sent to your email."}</p></div>
    <section className="mt-8 rounded-[2rem] border border-[#202930] bg-[#10161a] p-6 shadow-[0_0_28px_rgba(8,168,239,.12)]">{email ? <div className="mb-5 rounded-full border border-[#08a8ef]/40 bg-[#08a8ef]/10 px-4 py-3 text-center text-sm font-semibold text-[#55c7ff]">{email}</div> : <label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Payment email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 text-sm outline-none focus:border-[#08a8ef]" placeholder="you@example.com" /></label>}<form onSubmit={onSubmit}><label className="block"><span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a9298]">Licence key</span><input autoFocus required value={keyValue} onChange={(event) => setKey(event.target.value.toUpperCase())} placeholder="EMP-XXXXXXXXXXXX" className="mt-2 h-14 w-full rounded-2xl border border-[#202930] bg-[#070d10] px-4 font-mono text-sm tracking-[0.15em] outline-none focus:border-[#08a8ef]" /></label><button type="submit" className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#08a8ef] text-sm font-bold text-[#061018] shadow-[0_0_26px_rgba(8,168,239,.28)]">Unlock robot <ArrowRight className="size-4" /></button></form><p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#69757c]"><LockKeyhole className="size-3" /> One email, one activated device</p></section>
  </div>;
}
