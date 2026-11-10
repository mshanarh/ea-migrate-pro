import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Zap, ShieldCheck, Clock, Newspaper, Snowflake, Lock, Headphones, Download,
  Smartphone, Star, CheckCircle2, MessageCircle, Send, Youtube, Instagram, Apple, Server, Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BrandLogo } from "@/components/BrandLogo";
import { BrokerPromoPopup } from "@/components/BrokerPromoPopup";
import { MaintenancePopup } from "@/components/MaintenancePopup";
import heroApp from "/ea-migrate-hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EA Migrate — Mobile VPS on the Go for MT4 & MT5" },
      { name: "description", content: "Host your Expert Advisors 24/7 from your phone. Mobile VPS hosting for MT4 & MT5 with news event trading and freeze protection." },
      { property: "og:title", content: "EA Migrate — Mobile VPS on the Go" },
      { property: "og:description", content: "24/7 EA hosting for MT4 & MT5, straight from your phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const MONTHLY_URL = "https://whop.com/checkout/plan_wgIWJdSwjlMGS";
const LIFETIME_URL = "https://whop.com/checkout/plan_pAzDfC1tIC9p3";

const why = [
  { icon: Zap, title: "Ultra-Fast Execution", desc: "Orders reach your broker in milliseconds." },
  { icon: ShieldCheck, title: "Secure Hosting", desc: "Encrypted connections; your funds never leave your broker." },
  { icon: Clock, title: "24/7 EA Hosting", desc: "Your EA trades around the clock, phone on or off." },
  { icon: Newspaper, title: "News Event Trading", desc: "Trade high-impact releases from the live calendar." },
  { icon: Snowflake, title: "Platform Freeze Protection", desc: "No frozen terminals, no missed entries." },
  { icon: Lock, title: "Cutting-Edge Cybersecurity", desc: "Licence keys locked to one account and device." },
  { icon: Headphones, title: "24/7 Support", desc: "Email and WhatsApp help whenever you need it." },
];

const setup = [
  { n: 1, title: "Choose plan", desc: "Pick Monthly or Lifetime access and complete checkout." },
  { n: 2, title: "Get licence key", desc: "Your mentor issues your EMP licence key." },
  { n: 3, title: "Link EA and MT4/MT5", desc: "Activate the key, connect your account and press Start." },
];

const floating = [
  { icon: Server, text: "Hosted 24/7", pos: "-left-4 top-10" },
  { icon: Smartphone, text: "Phone locked? Your EA keeps trading", pos: "-right-6 top-1/3" },
  { icon: Newspaper, text: "News event trading", pos: "-left-6 bottom-1/4" },
  { icon: Monitor, text: "MT4 & MT5", pos: "-right-2 bottom-8" },
];

type ChatMessage = { from: "bot" | "user"; text: string };

function LandingChatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      from: "bot",
      text: "Hi — I’m the EA Migrate bot. Ask me anything about the platform: what it is, building & hosting EAs, the AI scanner, licences & activation, the fundamentals calendar, payments, your trading account, support — I know it all.",
    },
  ]);

  const answer = (question: string) => {
    const text = question.toLowerCase();

    // ── Support & contact ────────────────────────────────────────────
    if (text.includes("support") || text.includes("contact") || text.includes("email") || text.includes("help me") || text.includes("reach") || text.includes("whatsapp") || text.includes("phone") || text.includes("talk to")) {
      return "You can reach the EA Migrate team any time:\n• Email: eamigratepro@gmail.com — we respond within 24 hours\n• WhatsApp: 070 495 0612 — real-time chat with support\n• The /support page has a full contact form too. If it's about your portal (approval, licence keys, MT5 connection), message WhatsApp with your registered email so we can find your account fast.";
    }

    // ── What is the platform ────────────────────────────────────────
    if (text.includes("what is") || text.includes("what's") || text.includes("about") || text.includes("platform") || text.includes("ea migrate") || text.includes("tell me")) {
      return "EA Migrate is a forex robot (EA) hosting platform for MT4 and MT5. Your mentor builds your Expert Advisor, hosts it 24/7 in the cloud, and issues you a licence key. You activate the key, connect your MT5 account, and the robot trades it — no VPS, no coding, no keeping your PC on. There's also an AI chart scanner, a fundamentals economic calendar, and customisable app themes.";
    }

    // ── How it works / getting started ────────────────────────────
    if (text.includes("how") || text.includes("work") || text.includes("start") || text.includes("step") || text.includes("begin")) {
      return "Getting started is 4 steps:\n1. Register on the signup page with your email — your portal is created instantly.\n2. Your mentor approves the portal and issues you a licence key (EMP-XXXX-XXXX-XXXX).\n3. Activate the key in the app and connect your MT5 account on the MetaTrader page.\n4. Turn the robot on — it trades 24/7 in the cloud, even with your phone off.";
    }

    // ── MT4 / MT5 / brokers ─────────────────────────────────────
    if (text.includes("mt4") || text.includes("mt5") || text.includes("broker") || text.includes("metatrader")) {
      return "EA Migrate supports MT4 and MT5 with any broker (Exness, Pepperstone, OctaFX, FBS, Deriv, XM, IC Markets and more). Your account stays with your broker — the platform hosts the EA and sends trade instructions through a secure connection. Demo and cent accounts work too, so you can test safely before going live.";
    }

    // ── AI Scanner ──────────────────────────────────────────────
    if (text.includes("scan") || text.includes("chart") || text.includes("signal")) {
      return "The AI Scanner: upload or snap a chart, pick one of your EA's configured pairs, and get an instant signal setup — direction (BUY/SELL), lot size and max trades. One tap executes: the platform opens the broker connection, sends the trades, then closes the connection automatically.";
    }

    // ── Fundamentals / calendar ─────────────────────────────────
    if (text.includes("fundamental") || text.includes("calendar") || text.includes("news") || text.includes("economic") || text.includes("session")) {
      return "The FUNDAMENTALS page (Settings → Fundamentals) shows this week's real economic calendar from ForexFactory: every event with time, currency, impact level (bulls), forecast (FC) and previous (PREV) values. It also shows the four market sessions — Sydney, Tokyo, London and New York — glowing live with open/close countdowns. Tap a session to filter events to that region's currencies, or use the HIGH IMPACT and TODAY/TOMORROW/ALL WEEK filters.";
    }

    // ── Licences & activation ───────────────────────────────────
    if (text.includes("licen") || text.includes("key") || text.includes("activat") || text.includes("emp-")) {
      return "Licence keys look like EMP-XXXX-XXXX-XXXX and are issued by your mentor after your portal is approved. Activate one on the Activate page in the app: enter the key exactly as you received it (no spaces). Each key is locked to a single trading account and can be paused or expired by your mentor. Lost your key? Ask your mentor or contact support at eamigratepro@gmail.com.";
    }

    // ── Payments ────────────────────────────────────────────────
    if (text.includes("price") || text.includes("cost") || text.includes("payment") || text.includes("pay") || text.includes("subscription") || text.includes("free") || text.includes("refund")) {
      return "You start by creating your portal account. Payment options are shown when you activate — access is unlocked once payment is confirmed and your key is issued. Questions about pricing, refunds or a specific plan? Your mentor handles plans, or email eamigratepro@gmail.com and support will sort it out.";
    }

    // ── Trading account safety ──────────────────────────────────
    if (text.includes("safe") || text.includes("secure") || text.includes("password") || text.includes("withdraw") || text.includes("risk") || text.includes("scam")) {
      return "Your funds stay in YOUR broker account — the platform never withdraws and never holds your money. The hosted robot only sends trade instructions through an encrypted connection, and you can disconnect your MT5 account any time from the MetaTrader page. As with any trading, losses are possible — trade responsibly and start on a demo account.";
    }

    // ── Robot / hosting behaviour ───────────────────────────────
    if (text.includes("host") || text.includes("vps") || text.includes("cloud") || text.includes("phone") || text.includes("offline") || text.includes("24") || text.includes("robot") || text.includes("ea ") || text.includes("build")) {
      return "Your EA is hosted in the cloud 24/7 — no VPS to rent and no need to keep your phone or PC on. Your mentor builds the robot from your strategy, you activate it with your licence key, and it executes trades on your MT4/MT5 account around the clock. You can watch it live from the app and stop it whenever you like.";
    }

    // ── App customisation ───────────────────────────────────────
    if (text.includes("theme") || text.includes("custom") || text.includes("colour") || text.includes("color") || text.includes("font") || text.includes("music") || text.includes("background") || text.includes("settings")) {
      return "Open Settings in the app to make it yours: accent colours, interface themes, fonts, background animations, music (even your own uploads or a Spotify link), your own logo, and the Fundamentals calendar. Everything applies instantly and is saved on your device.";
    }

    // ── Portal approval / account issues ────────────────────────
    if (text.includes("pending") || text.includes("approv") || text.includes("register") || text.includes("sign up") || text.includes("signup") || text.includes("account") || text.includes("login") || text.includes("password")) {
      return "Register with your email on the signup page and your portal is created instantly — it just needs a quick approval before your mentor issues keys. Already registered? Sign in with the same email on any device. Waiting too long on approval, or trouble signing in? Message WhatsApp (070 495 0612) or email eamigratepro@gmail.com with your registered email.";
    }

    // ── Fallback: full summary ──────────────────────────────────
    return "Here's what I know about EA Migrate:\n• WHAT: forex EA hosting for MT4/MT5 — your mentor builds the robot, the cloud runs it 24/7\n• START: register → portal approved → activate your EMP licence key → connect MT5 → robot on\n• AI SCANNER: upload a chart, get a signal setup, execute in one tap\n• FUNDAMENTALS: live economic calendar + market sessions (Settings → Fundamentals)\n• SAFETY: your funds stay at your broker; disconnect any time\n• CUSTOMISE: themes, colours, fonts, music and your own logo\nAsk me about any of these — or for support: eamigratepro@gmail.com / WhatsApp 070 495 0612.";
  };

  const send = (value = input) => {
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [...current, { from: "user", text: question }, { from: "bot", text: answer(question) }]);
    setInput("");
  };

  return (
    <div className="fixed right-4 bottom-20 z-[9998] flex flex-col items-end gap-3">
      {open && (
        <div className="max-w-[360px] overflow-hidden rounded-3xl border border-primary/30 bg-background/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-border/60 bg-card/80 px-4 py-3">
            <BrandLogo alt="EA Migrate" className="size-10 rounded-full border-2 border-primary object-contain" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">EA Migrate assistant</p>
              <p className="text-xs text-primary">Online · Ask anything</p>
            </div>
            <button type="button" aria-label="Close chatbot" onClick={() => setOpen(false)} className="text-xl text-muted-foreground hover:text-foreground">×</button>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message, index) => (
              <div key={index} className={message.from === "user" ? "ml-8 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "mr-8 rounded-2xl rounded-bl-md bg-card px-3 py-2 text-sm text-foreground"}>
                {message.text}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {["How does it work?", "Support email", "Is it safe?", "Fundamentals calendar"].map((question) => (
              <button key={question} type="button" onClick={() => send(question)} className="rounded-full border border-primary/30 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10">{question}</button>
            ))}
          </div>
          <form className="flex gap-2 border-t border-border/60 p-3" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about EA Migrate..." aria-label="Message the EA Migrate assistant" className="min-w-0 flex-1 rounded-full border border-border/70 bg-card/60 px-4 py-2 text-sm outline-none focus:border-primary" />
            <button type="submit" aria-label="Send message" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Send className="size-4" /></button>
          </form>
        </div>
      )}
      <motion.button type="button" aria-label={open ? "Close EA Migrate assistant" : "Open EA Migrate assistant"} onClick={() => setOpen((value) => !value)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="relative flex size-14 items-center justify-center rounded-full border-2 border-primary bg-card/40 p-1.5 glow-ring backdrop-blur-sm">
        <BrandLogo alt="EA Migrate" className="size-full object-contain" />
        <span className="absolute right-0 bottom-0 size-4 rounded-full border-2 border-background bg-primary" />
        <MessageCircle className="absolute -right-1 -top-1 size-5 rounded-full bg-primary p-1 text-primary-foreground" />
      </motion.button>
    </div>
  );
}

function Home() {
  const [installResult, setInstallResult] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const handleAndroidDownload = async () => {
    try {
      setInstallResult("Downloading the EA Migrate APK…");
      const response = await fetch("/ea-migrate.apk");
      if (!response.ok) throw new Error("not built yet");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ea-migrate.apk";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setInstallResult("Downloaded ✓ — open it and allow “Install from this source” when Android asks.");
    } catch {
      setInstallResult("The APK is building — try again in a few minutes.");
    }
  };

  return (
    <div data-eamp-no-cycle className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--primary)_28%,transparent),transparent_70%)]" />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 glow-ring">
              <BrandLogo alt="EA Migrate" className="size-8 rounded-full object-contain" />
            </span>
            <span className="font-bold uppercase">EA <span className="text-primary">Migrate</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/signin">Sign In</Link></Button>
            <Button asChild size="sm" className="rounded-full"><Link to="/signup">Sign Up</Link></Button>
          </div>
        </div>
      </header>

      <main className="relative">
        <section className="mx-auto max-w-3xl px-5 pt-14 pb-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full border border-primary/40 bg-card/40 glow-ring backdrop-blur">
              <BrandLogo alt="EA Migrate" className="size-14 object-contain" />
            </div>
            <span className="inline-block rounded-full border border-primary/40 bg-primary/10 px-4 py-1 text-xs font-semibold tracking-[0.25em] text-primary">MOBILE VPS ON THE GO</span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight sm:text-6xl">
              Host your EA <span className="text-primary">24/7</span> from your phone
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              EA Migrate is mobile VPS hosting for MT4 &amp; MT5. No PC, no rented server — your Expert Advisor keeps trading even when your phone is locked.
            </p>
            <div className="mx-auto mt-8 grid max-w-md gap-3 sm:grid-cols-2">
              <Button size="lg" className="h-13 rounded-full font-semibold" onClick={() => void handleAndroidDownload()}>
                <Download className="size-5" /> Download Android
              </Button>
              <Button asChild size="lg" variant="outline" className="h-13 rounded-full border-primary/40 bg-card/40 font-semibold backdrop-blur">
                <Link to="/app"><Apple className="size-5" /> Download iOS</Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="h-13 rounded-full font-semibold">
                <Link to="/signup">Mentor Sign Up</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-13 rounded-full border border-border/70 font-semibold">
                <Link to="/dashboard/reactivate">Reactivate</Link>
              </Button>
            </div>
            {installResult && <p className="mt-4 text-sm font-semibold text-primary">{installResult}</p>}
          </motion.div>
        </section>

        <section className="mx-auto max-w-3xl px-5">
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/50 px-4 py-3 text-sm backdrop-blur sm:flex-row sm:gap-4">
            <span className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-primary" /> 100% EA execution guarantee</span>
            <span className="hidden text-muted-foreground sm:inline">|</span>
            <span className="flex items-center gap-1 font-semibold">
              {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4 fill-primary text-primary" />)}
              <span className="ml-1">4.8/5 from 337+ reviews</span>
            </span>
          </div>
        </section>

        <section className="mx-auto max-w-md px-10 py-16">
          <div className="relative">
            <motion.img
              src={heroApp}
              alt="EA Migrate app running an EA"
              className="mx-auto w-[260px] rounded-[40px] border-4 border-border/80 object-cover glow-ring md:w-[320px]"
              animate={{ y: [0, -12, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />
            {floating.map(({ icon: Icon, text, pos }, i) => (
              <motion.div
                key={text}
                className={`absolute ${pos} flex max-w-[170px] items-center gap-2 rounded-2xl border border-primary/30 bg-card/80 px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-xl`}
                animate={{ y: [0, i % 2 ? 8 : -8, 0] }}
                transition={{ duration: 4 + i, repeat: Infinity, ease: "easeInOut" }}
              >
                <Icon className="size-4 shrink-0 text-primary" /> {text}
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5">
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-primary/40 bg-primary/10 p-6 text-center backdrop-blur sm:flex-row sm:text-left">
            <Smartphone className="size-10 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-xs font-bold tracking-[0.2em] text-primary">NEW UPDATE</p>
              <p className="mt-1 text-lg font-bold">EA Migrate for Android is here</p>
            </div>
            <Button className="rounded-full" onClick={() => void handleAndroidDownload()}><Download className="size-4" /> Download APK</Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Why choose <span className="text-primary">EA Migrate</span></h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {why.map(({ icon: Icon, title, desc }) => (
              <motion.div key={title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-3xl border border-border/60 bg-card/50 p-6 backdrop-blur-xl transition-colors hover:border-primary/50">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Icon className="size-6" /></span>
                <h3 className="mt-4 font-bold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-4xl px-5 pb-20">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Access Fee <span className="text-primary">Plan</span></h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="flex flex-col rounded-3xl border border-border/60 bg-card/50 p-7 backdrop-blur-xl">
              <p className="text-sm font-semibold text-primary">Monthly Subscription (PM)</p>
              <h3 className="mt-2 text-2xl font-bold">Monthly</h3>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> Billed monthly</li>
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> Cancel anytime</li>
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> 24/7 EA hosting</li>
              </ul>
              <Button asChild size="lg" variant="outline" className="mt-6 rounded-full border-primary/50"><a href={MONTHLY_URL}>Get Monthly</a></Button>
            </div>
            <div className="flex flex-col rounded-3xl border-2 border-primary bg-primary/10 p-7 glow-ring backdrop-blur-xl">
              <p className="text-sm font-semibold text-primary">Best value</p>
              <h3 className="mt-2 text-2xl font-bold">Lifetime Access</h3>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> One-time payment</li>
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> Lifetime access</li>
                <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary" /> No recurring fees</li>
              </ul>
              <Button asChild size="lg" className="mt-6 rounded-full"><a href={LIFETIME_URL}>Get Lifetime</a></Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 pb-20">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">How to setup your <span className="text-primary">mobile VPS!</span></h2>
          <ol className="mt-10 space-y-4">
            {setup.map((s) => (
              <li key={s.n} className="flex items-start gap-4 rounded-3xl border border-border/60 bg-card/50 p-5 backdrop-blur-xl">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">{s.n}</span>
                <div>
                  <h3 className="font-bold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto w-full max-w-6xl overflow-hidden px-5">
          <Accordion type="single" collapsible>
            <AccordionItem value="legal" className="border-border/60">
              <AccordionTrigger className="py-6 text-base text-muted-foreground hover:no-underline">
                Terms &amp; Conditions, Refund Policy and Legal
              </AccordionTrigger>
              <AccordionContent className="pb-6 text-sm leading-relaxed text-muted-foreground">
                Trading foreign exchange carries a high level of risk and may not be suitable
                for every investor. Past performance of an Expert Advisor does not guarantee
                future results. Subscriptions renew automatically and may be cancelled at any
                time; refunds are handled case by case within 14 days of purchase. Licence
                keys are locked to one trading account and may not be resold or shared.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div className="py-10">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 glow-ring">
                <BrandLogo alt="EA Migrate" className="size-6 rounded-full object-contain" />
              </span>
              <span className="text-base font-bold uppercase">EA <span className="text-primary">Migrate</span></span>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">© EA Migrate {new Date().getFullYear()}. All rights reserved.</p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <Link to="/support" className="transition hover:text-primary">Support</Link>
            </div>
            <div className="mt-6 flex gap-3">
              {[Youtube, Send, Instagram].map((Icon, i) => (
                <a key={i} href="#" aria-label="Social link" className="flex size-11 items-center justify-center rounded-full border border-border/70 bg-card/50 text-muted-foreground transition-colors hover:text-primary">
                  <Icon className="size-5" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
      <LandingChatbot />
      <BrokerPromoPopup />
      <MaintenancePopup />
    </div>
  );
}
