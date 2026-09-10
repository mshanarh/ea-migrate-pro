import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Clock3, Mail, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";

export const Route = createFileRoute("/app/support")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Support — EA Migrate Pro" },
      { name: "description", content: "Get help with EA Migrate Pro." },
    ],
  }),
  component: Support,
});

const SUPPORT_EMAIL = "eamigratepro@gmail.com";
const WHATSAPP_NUMBER = "27704950612";

function Support() {
  const openWhatsApp = () => {
    window.open(`https://wa.me/${WHATSAPP_NUMBER}`, "_blank", "noopener,noreferrer");
  };

  const sendEmail = () => {
    window.location.href = `mailto:${SUPPORT_EMAIL}`;
  };

  return <AppFrame><div className="pb-8">
    <header className="flex items-center gap-3">
      <Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link>
      <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">EA Migrate Pro</p><h1 className="truncate text-2xl font-black">Support</h1></div>
    </header>

    <section className="mt-8 text-center">
      <div className="mx-auto flex size-24 items-center justify-center rounded-full border border-primary/60 bg-primary/10 text-primary shadow-glow"><MessageCircle className="size-11" /></div>
      <h2 className="mt-6 text-3xl font-black tracking-tight">We&apos;re here for you</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Need help with your robot, MetaTrader connection, or account? Reach out and our team will help you get moving.</p>
    </section>

    <section className="mt-8 space-y-3">
      <button type="button" onClick={openWhatsApp} className="group flex w-full items-center gap-4 rounded-3xl border border-emerald-300/20 bg-emerald-300/10 p-5 text-left transition hover:border-emerald-300/40 hover:bg-emerald-300/15"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950"><MessageCircle className="size-6" /></span><span className="min-w-0 flex-1"><span className="block text-lg font-black">Chat with support</span><span className="mt-1 block text-sm text-muted-foreground">Message us on WhatsApp</span></span><ChevronRight className="size-5 shrink-0 text-emerald-300 transition group-hover:translate-x-1" /></button>
      <button type="button" onClick={sendEmail} className="group flex w-full items-center gap-4 rounded-3xl border border-primary/25 bg-primary/10 p-5 text-left transition hover:border-primary/50 hover:bg-primary/15"><span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Mail className="size-6" /></span><span className="min-w-0 flex-1"><span className="block text-lg font-black">Email us</span><span className="mt-1 block truncate text-sm text-muted-foreground">{SUPPORT_EMAIL}</span></span><ChevronRight className="size-5 shrink-0 text-primary transition group-hover:translate-x-1" /></button>
    </section>

    <section className="mt-8 grid gap-3 sm:grid-cols-3">
      <div className="rounded-3xl border border-border/60 bg-card/60 p-4"><MessageCircle className="size-6 text-primary" /><h3 className="mt-4 font-black">Chat with us</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Get direct help when you need it.</p></div>
      <div className="rounded-3xl border border-border/60 bg-card/60 p-4"><Clock3 className="size-6 text-primary" /><h3 className="mt-4 font-black">Fast response</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">We aim to respond as quickly as possible.</p></div>
      <div className="rounded-3xl border border-border/60 bg-card/60 p-4"><ShieldCheck className="size-6 text-primary" /><h3 className="mt-4 font-black">Trusted support</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Your trading journey matters to us.</p></div>
    </section>

    <section className="mt-8 rounded-3xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 size-5 shrink-0 text-primary" /><div><h3 className="font-black">Trading support</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">For account, licence, and MetaTrader questions, include your robot name and a short description of what you need help with.</p></div></div></section>
  </div></AppFrame>;
}