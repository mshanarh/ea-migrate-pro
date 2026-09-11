import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronRight, Mail, MessageCircle, Users, Zap } from "lucide-react";
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
    <header className="flex items-center gap-3 border-b border-border/40 pb-5">
      <Link to="/app/settings" aria-label="Back to settings" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/60"><ArrowLeft className="size-5" /></Link>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xl shadow-glow">🤖</div>
        <div className="min-w-0"><p className="truncate text-lg font-black">EA <span className="text-primary">Migrate Pro</span></p><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Trade smarter · Grow faster</p></div>
      </div>
    </header>

    <section className="mt-9 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-full border border-primary/60 bg-primary/10 text-primary shadow-glow"><MessageCircle className="size-9" /></div>
      <h1 className="mt-6 text-4xl font-black tracking-tight">Contact <span className="text-primary">Support</span></h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Need help? We&apos;re here for you 24/7.<br />Get in touch with our support team and we&apos;ll respond as soon as possible.</p>
    </section>

    <section className="mt-8 space-y-3">
      <button type="button" onClick={sendEmail} className="group flex w-full items-center gap-4 rounded-3xl border border-primary/30 bg-card/70 p-5 text-left shadow-glow-soft transition hover:-translate-y-0.5 hover:border-primary/60">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Mail className="size-6" /></span>
        <span className="min-w-0 flex-1"><span className="block text-lg font-black">Email</span><span className="block break-all text-sm font-bold">{SUPPORT_EMAIL}</span><span className="mt-1 block text-xs text-muted-foreground">We&apos;ll reply within 24 hours</span></span><ChevronRight className="size-5 shrink-0 text-primary transition group-hover:translate-x-1" />
      </button>
      <button type="button" onClick={openWhatsApp} className="group flex w-full items-center gap-4 rounded-3xl border border-emerald-300/30 bg-emerald-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/60">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950"><MessageCircle className="size-6" /></span>
        <span className="min-w-0 flex-1"><span className="block text-lg font-black">WhatsApp</span><span className="block text-sm font-bold">0704950612</span><span className="mt-1 block text-xs text-muted-foreground">Chat with us directly</span></span><ChevronRight className="size-5 shrink-0 text-emerald-300 transition group-hover:translate-x-1" />
      </button>
    </section>

    <section className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60">
      <div className="bg-card/70 p-4 text-center"><MessageCircle className="mx-auto size-6 text-primary" /><h2 className="mt-3 text-sm font-black">Live Chat</h2><p className="mt-1 text-xs text-muted-foreground">Available 24/7</p></div>
      <div className="bg-card/70 p-4 text-center"><Zap className="mx-auto size-6 text-primary" /><h2 className="mt-3 text-sm font-black">Fast Response</h2><p className="mt-1 text-xs text-muted-foreground">Quick support</p></div>
      <div className="bg-card/70 p-4 text-center"><Check className="mx-auto size-6 text-primary" /><h2 className="mt-3 text-sm font-black">Trusted Support</h2><p className="mt-1 text-xs text-muted-foreground">Your success matters</p></div>
      <div className="bg-card/70 p-4 text-center"><Users className="mx-auto size-6 text-primary" /><h2 className="mt-3 text-sm font-black">Expert Team</h2><p className="mt-1 text-xs text-muted-foreground">Trading specialists</p></div>
    </section>

    <div className="mt-8 flex items-center gap-3 text-center text-xs font-bold text-primary"><span className="h-px flex-1 bg-primary/30" />Your success is our priority<span className="h-px flex-1 bg-primary/30" /></div>
  </div></AppFrame>;
}