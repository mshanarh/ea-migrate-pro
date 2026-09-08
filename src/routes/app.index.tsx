import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Bot, CheckCircle2, ExternalLink, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { activateKey, appSignIn, useAppState } from "@/lib/app-store";
import { isPaymentExemptEmail, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";

export const Route = createFileRoute("/app/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "EA Migrate Pro — Trading Bot Access" },
      { name: "description", content: "Purchase access to your trading robot or add your licence key." },
    ],
  }),
  component: AppAccess,
});

const WHOP_CHECKOUT_URL = import.meta.env.VITE_WHOP_CHECKOUT_URL || "https://whop.com";

function AppAccess() {
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const [key, setKey] = useState("");
  const [successReturn, setSuccessReturn] = useState(false);

  useEffect(() => {
    const success = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("success") === "true";
    setSuccessReturn(success);
    if (success && app.email) markEmailPaid(app.email);
  }, [app.email]);

  useEffect(() => {
    if (app.email && app.robots.length > 0 && !successReturn) window.location.replace("/app/home");
  }, [app.email, app.robots.length, successReturn]);

  const activeEmail = app.email || email.trim().toLowerCase();
  const paymentStatus = activeEmail ? paymentStatusForEmail(activeEmail) : "unpaid";
  const showLicenseView = successReturn || paymentStatus !== "unpaid";

  const continueWithEmail = (event: React.FormEvent) => {
    event.preventDefault();
    const result = appSignIn(email);
    if (result.error) { toast.error(result.error); return; }
    if (isPaymentExemptEmail(email)) toast.success("Admin access enabled — no payment is required.");
  };

  const submitLicense = (event: React.FormEvent) => {
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

  return <div className="mx-auto min-h-screen w-full max-w-md px-5 py-6 sm:max-w-lg">
    <header className="flex items-center gap-3"><span className="flex size-11 items-center justify-center overflow-hidden rounded-2xl border border-primary/40 bg-primary/10 glow-ring"><img src="/ea-migrate-platform-robot.jpg" alt="EA Migrate Pro" className="size-full object-cover object-[50%_18%]" /></span><div><p className="text-sm font-black tracking-[0.18em] uppercase">EA <span className="text-primary">Migrate</span></p><p className="text-xs text-muted-foreground">Secure robot access</p></div></header>
    <main className="flex min-h-[calc(100vh-6rem)] flex-col justify-center py-10">
      {!showLicenseView ? <PricingView email={email} setEmail={setEmail} appEmail={app.email} onContinue={continueWithEmail} checkoutUrl={WHOP_CHECKOUT_URL} /> : <LicenseView email={activeEmail} keyValue={key} setKey={setKey} onSubmit={submitLicense} admin={paymentStatus === "admin"} paid={paymentStatus === "paid" || successReturn} />}
    </main>
  </div>;
}

function PricingView({ email, setEmail, appEmail, onContinue, checkoutUrl }: { email: string; setEmail: (value: string) => void; appEmail: string | null; onContinue: (event: React.FormEvent) => void; checkoutUrl: string }) {
  return <div><div className="text-center"><span className="mx-auto inline-flex size-16 items-center justify-center rounded-3xl bg-primary/12 text-primary glow-ring"><Sparkles className="size-8" /></span><h1 className="mt-7 text-4xl font-bold tracking-tight">Trade with your edge.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Get access to your EA, then return here to add the licence key that unlocks your private robot workspace.</p></div><section className="panel mt-8 overflow-hidden p-6 glow-ring"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">EA Migrate Pro</p><h2 className="mt-2 text-2xl font-bold">Robot access</h2></div><span className="rounded-full bg-primary/12 px-3 py-1 text-xs font-bold text-primary">Whop checkout</span></div><div className="mt-6 rounded-2xl border border-border/60 bg-secondary/35 p-5"><div className="flex items-center gap-3"><Bot className="size-6 text-primary" /><div><p className="font-bold">Full EA access</p><p className="text-sm text-muted-foreground">Licence key activation on one device</p></div></div><div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4"><span className="text-sm text-muted-foreground">Secure payment</span><ShieldCheck className="size-5 text-primary" /></div></div><form className="mt-6 space-y-3" onSubmit={onContinue}><label className="block"><span className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Your email</span><div className="mt-2 flex h-14 items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-4"><Mail className="size-4 text-muted-foreground" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-full w-full bg-transparent text-sm outline-none" /></div></label>{!appEmail && <button type="submit" className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-sm font-bold hover:bg-secondary/80">Continue <ArrowRight className="size-4" /></button>}</form><a href={appEmail ? checkoutUrl : "#email"} onClick={(event) => { if (!appEmail) { event.preventDefault(); toast.error("Enter your email and press Continue first."); } }} target="_blank" rel="noreferrer" className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground glow-ring hover:brightness-110">Purchase with Whop <ExternalLink className="size-4" /></a><p className="mt-4 text-center text-xs leading-5 text-muted-foreground">After Whop sends you back to <span className="text-foreground">/app/?success=true</span>, this pricing view will automatically become the licence-key form.</p></section></div>;
}

function LicenseView({ email, keyValue, setKey, onSubmit, admin, paid }: { email: string; keyValue: string; setKey: (value: string) => void; onSubmit: (event: React.FormEvent) => void; admin: boolean; paid: boolean }) {
  return <div><div className="text-center"><span className="mx-auto inline-flex size-16 items-center justify-center rounded-3xl bg-emerald-400/12 text-emerald-300"><CheckCircle2 className="size-8" /></span><h1 className="mt-7 text-3xl font-bold">Add your licence key</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{admin ? "Admin access is active. No payment is required for this email." : paid ? "Payment received. Add the licence key sent to your email." : "Your payment return was received. Add the licence key sent to your email."}</p></div><section className="panel mt-8 p-6 glow-ring">{email ? <div className="mb-5 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-center text-sm font-semibold text-primary">{email}</div> : <label className="block"><span className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Payment email</span><input type="email" required className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-background/70 px-4 text-sm outline-none" placeholder="you@example.com" /></label>}<form onSubmit={onSubmit}><label className="block"><span className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">Licence key</span><input autoFocus required value={keyValue} onChange={(event) => setKey(event.target.value.toUpperCase())} placeholder="EMP-XXXXXXXXXXXX" className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-background/70 px-4 font-mono text-sm tracking-[0.15em] outline-none" /></label><button type="submit" className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground glow-ring">Unlock robot <ArrowRight className="size-4" /></button></form><p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-3" /> One email, one activated device</p></section></div>;
}
