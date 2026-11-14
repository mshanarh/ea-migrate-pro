import { useEffect, useState, type CSSProperties } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Apple,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Gauge,
  Headphones,
  Instagram,
  Lock,
  MessageCircle,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Snowflake,
  Sparkles,
  Star,
  UserPlus,
  Youtube,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { BrandLogo } from "@/components/BrandLogo";
import { SiteHeader } from "@/components/SiteHeader";
import { BrokerPromoPopup } from "@/components/BrokerPromoPopup";
import heroPhone from "/ea-migrate-hero.jpg";

/**
 * PUBLIC LANDING PAGE — EA Migrate's mobile VPS shop window.
 *
 * Layout follows the ea-converter.com reference (hero → phone showcase →
 * update banner → why-us → access fee plans → setup guide → footer), rebuilt
 * on EA Migrate's own brand: obsidian dark by default, electric cyan / ice
 * blue accent, and the dynamic BrandLogo (Settings → App logo) in every logo
 * position, so no hardcoded logo file is ever painted over a custom one.
 */

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EA Migrate — Mobile VPS for your EA" },
      {
        name: "description",
        content:
          "Host your Expert Advisor on the EA Migrate cloud VPS and trade from your phone. MT4 & MT5, 24/7 execution, news event trading and access plans from $39/month.",
      },
      { property: "og:title", content: "EA Migrate — Mobile VPS on the go" },
      {
        property: "og:description",
        content:
          "Seamless VPS hosting for your EA on the go. MT4 & MT5, 24/7 uptime and low-latency execution from your phone.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "EA Migrate" },
      { property: "og:image", content: "/logo.png" },
      { property: "og:image:alt", content: "EA Migrate logo" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "EA Migrate — Mobile VPS on the go" },
    ],
  }),
  component: Home,
});

const MONTHLY_CHECKOUT = "bank-transfer";
const LIFETIME_CHECKOUT = "bank-transfer";
const WHATSAPP_URL = "https://wa.me/27704950612";

const why = [
  {
    icon: Gauge,
    title: "Ultra-Fast Execution",
    body: "Latency as low as 1ms infrastructure capability, with precise market entries on every signal.",
  },
  {
    icon: ShieldCheck,
    title: "Secure Hosting",
    body: "Advanced cybersecurity and isolated terminal sessions keep your data and your account protected.",
  },
  {
    icon: Clock,
    title: "24/7 EA Hosting",
    body: "Keep your EAs running continuously without leaving your PC or phone switched on.",
  },
  {
    icon: CalendarClock,
    title: "News Event Trading",
    body: "Execute automated buy or sell rules around high-impact scheduled economic news.",
  },
  {
    icon: Snowflake,
    title: "Platform Freeze Protection",
    body: "A dedicated cloud buffer prevents terminal freezes during volatile NFP / CPI spikes.",
  },
  {
    icon: Lock,
    title: "Cutting-Edge Cybersecurity",
    body: "Real-time monitoring and anti-DDoS protection for your trading credentials.",
  },
  {
    icon: Headphones,
    title: "24/7 Support",
    body: "WhatsApp 070 495 0612 and eamigratepro@gmail.com are ready around the clock.",
  },
];

const plans = [
  {
    name: "Monthly Subscription",
    badge: "Per Month / PM",
    price: "ZAR 350",
    priceNote: "/ month",
    subtitle: "One recurring payment, 1 month of access. Cancel anytime.",
    features: [
      "Up to 3 EAs",
      "Android & iOS Mobile Access",
      "24/7 Cloud VPS Live",
      "MT4 & MT5 Supported",
      "24/7 Support",
    ],
    cta: "Get Started — Monthly",
    href: "bank-transfer",
    highlight: false,
  },
  {
    name: "Lifetime Access",
    badge: "Most Popular / Best Value",
    price: "ZAR 500",
    priceNote: "one-time",
    subtitle: "One-time payment, lifetime access. No recurring fees ever.",
    features: [
      "Unlimited EAs",
      "Android & iOS Mobile Access",
      "24/7 Cloud VPS Live",
      "MT4 & MT5 Supported",
      "All Strategy Modes (Breakout / Momentum / Scalper)",
      "Priority 24/7 Support",
      "Free Future Updates",
    ],
    cta: "Get Started — Lifetime",
    href: "bank-transfer",
    highlight: true,
  },
];

const chips = [
  { icon: Server, title: "Hosted 24/7", note: "Runs on EA Migrate servers" },
  { icon: Smartphone, title: "Phone locked?", note: "Your EA keeps trading" },
  { icon: CalendarClock, title: "News event trading", note: "Buy or sell around the news" },
  { icon: Gauge, title: "MT4 & MT5", note: "Android and iOS" },
];

const setupSteps = [
  "Choose your access plan above",
  "Get your licence key from your mentor",
  "Link your EA and MT4 / MT5 account in EA Migrate",
];

const checklist = [
  "Accurate Execution",
  "Latency as low as 1ms*",
  "MT4/MT5 Supported",
  "Unlimited Access",
];

type ChatMessage = { from: "bot" | "user"; text: string };

function LandingChatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      from: "bot",
      text: "Hi — I’m the EA Migrate bot. Ask me anything about the platform: what it is, hosting your EA, the AI scanner, licences & activation, the fundamentals calendar, payments, your trading account, support — I know it all.",
    },
  ]);

  const answer = (question: string) => {
    const text = question.toLowerCase();

    // ── Support & contact ────────────────────────────────────────────
    if (
      text.includes("support") ||
      text.includes("contact") ||
      text.includes("email") ||
      text.includes("help me") ||
      text.includes("reach") ||
      text.includes("whatsapp") ||
      text.includes("phone") ||
      text.includes("talk to")
    ) {
      return "You can reach the EA Migrate team any time:\n• Email: eamigratepro@gmail.com — we respond within 24 hours\n• WhatsApp: 070 495 0612 — real-time chat with support\n• The /support page has a full contact form too. If it's about your portal (approval, licence keys, MT5 connection), message WhatsApp with your registered email so we can find your account fast.";
    }

    // ── What is the platform ────────────────────────────────────────
    if (
      text.includes("what is") ||
      text.includes("what's") ||
      text.includes("about") ||
      text.includes("platform") ||
      text.includes("ea migrate") ||
      text.includes("tell me")
    ) {
      return "EA Migrate is a forex robot (EA) hosting platform for MT4 and MT5. Your mentor builds your Expert Advisor, hosts it 24/7 in the cloud, and issues you a licence key. You activate the key, connect your MT5 account, and the robot trades it — no VPS to rent, no coding, no keeping your PC on. There's also an AI chart scanner, a fundamentals economic calendar, and customisable app themes.";
    }

    // ── How it works / getting started ────────────────────────────
    if (
      text.includes("how") ||
      text.includes("work") ||
      text.includes("start") ||
      text.includes("step") ||
      text.includes("begin")
    ) {
      return "Getting started is 4 steps:\n1. Register on the signup page with your email — your portal is created instantly.\n2. Your mentor approves the portal and issues you a licence key (EMP-XXXX-XXXX-XXXX).\n3. Activate the key in the app and connect your MT5 account on the MetaTrader page.\n4. Turn the robot on — it trades 24/7 in the cloud, even with your phone off.";
    }

    // ── MT4 / MT5 / brokers ─────────────────────────────────────
    if (
      text.includes("mt4") ||
      text.includes("mt5") ||
      text.includes("broker") ||
      text.includes("metatrader")
    ) {
      return "EA Migrate supports MT4 and MT5 with any broker (Exness, Pepperstone, OctaFX, FBS, Deriv, XM, IC Markets and more). Your account stays with your broker — the platform hosts the EA and sends trade instructions through a secure connection. Demo and cent accounts work too, so you can test safely before going live.";
    }

    // ── AI Scanner ──────────────────────────────────────────────
    if (text.includes("scan") || text.includes("chart") || text.includes("signal")) {
      return "The AI Scanner: upload or snap a chart, pick one of your EA's configured pairs, and get an instant signal setup — direction (BUY/SELL), lot size and max trades. One tap executes: the platform opens the broker connection, sends the trades, then closes the connection automatically.";
    }

    // ── Fundamentals / calendar ─────────────────────────────────
    if (
      text.includes("fundamental") ||
      text.includes("calendar") ||
      text.includes("news") ||
      text.includes("economic") ||
      text.includes("session")
    ) {
      return "The FUNDAMENTALS page (Settings → Fundamentals) shows this week's real economic calendar from ForexFactory: every event with time, currency, impact level (bulls), forecast (FC) and previous (PREV) values. It also shows the four market sessions — Sydney, Tokyo, London and New York — glowing live with open/close countdowns. Tap a session to filter events to that region's currencies, or use the HIGH IMPACT and TODAY/TOMORROW/ALL WEEK filters.";
    }

    // ── Licences & activation ───────────────────────────────────
    if (
      text.includes("licen") ||
      text.includes("key") ||
      text.includes("activat") ||
      text.includes("emp-")
    ) {
      return "Licence keys look like EMP-XXXX-XXXX-XXXX and are issued by your mentor after your portal is approved. Activate one on the Activate page in the app: enter the key exactly as you received it (no spaces). Each key is locked to a single trading account and can be paused or expired by your mentor. Lost your key? Ask your mentor or contact support at eamigratepro@gmail.com.";
    }

    // ── Payments ────────────────────────────────────────────────
    if (
      text.includes("price") ||
      text.includes("cost") ||
      text.includes("payment") ||
      text.includes("pay") ||
      text.includes("subscription") ||
      text.includes("free") ||
      text.includes("refund") ||
      text.includes("plan")
    ) {
      return "Two access plans:\n• Monthly — $39 per month for up to 3 EAs, cancel anytime.\n• Lifetime — one payment for unlimited EAs, every strategy mode, priority support and free future updates.\nBoth include Android & iOS access, 24/7 cloud VPS and MT4/MT5. Pick one from the Access Fee Plan section, then your mentor issues your licence key. Questions about a specific plan or a refund? eamigratepro@gmail.com.";
    }

    // ── Trading account safety ──────────────────────────────────
    if (
      text.includes("safe") ||
      text.includes("secure") ||
      text.includes("password") ||
      text.includes("withdraw") ||
      text.includes("risk") ||
      text.includes("scam")
    ) {
      return "Your funds stay in YOUR broker account — the platform never withdraws and never holds your money. The hosted robot only sends trade instructions through an encrypted connection, and you can disconnect your MT5 account any time from the MetaTrader page. As with any trading, losses are possible — trade responsibly and start on a demo account.";
    }

    // ── Robot / hosting behaviour ───────────────────────────────
    if (
      text.includes("host") ||
      text.includes("vps") ||
      text.includes("cloud") ||
      text.includes("phone") ||
      text.includes("offline") ||
      text.includes("24") ||
      text.includes("robot") ||
      text.includes("ea ") ||
      text.includes("build")
    ) {
      return "Your EA is hosted in the cloud 24/7 — no VPS to rent and no need to keep your phone or PC on. Your mentor builds the robot from your strategy, you activate it with your licence key, and it executes trades on your MT4/MT5 account around the clock. You can watch it live from the app and stop it whenever you like.";
    }

    // ── App customisation ───────────────────────────────────────
    if (
      text.includes("theme") ||
      text.includes("custom") ||
      text.includes("colour") ||
      text.includes("color") ||
      text.includes("font") ||
      text.includes("music") ||
      text.includes("background") ||
      text.includes("settings")
    ) {
      return "Open Settings in the app to make it yours: accent colours, interface themes, fonts, background animations, music (even your own uploads or a Spotify link), your own logo, and the Fundamentals calendar. Everything applies instantly and is saved on your device.";
    }

    // ── Portal approval / account issues ────────────────────────
    if (
      text.includes("pending") ||
      text.includes("approv") ||
      text.includes("register") ||
      text.includes("sign up") ||
      text.includes("signup") ||
      text.includes("account") ||
      text.includes("login") ||
      text.includes("password")
    ) {
      return "Register with your email on the signup page and your portal is created instantly — it just needs a quick approval before your mentor issues keys. Already registered? Sign in with the same email on any device. Waiting too long on approval, or trouble signing in? Message WhatsApp (070 495 0612) or email eamigratepro@gmail.com with your registered email.";
    }

    // ── Fallback: full summary ──────────────────────────────────
    return "Here's what I know about EA Migrate:\n• WHAT: forex EA hosting for MT4/MT5 — your mentor builds the robot, the cloud runs it 24/7\n• START: pick a plan → get your licence key → activate it → connect MT5 → robot on\n• PLANS: $39/month (3 EAs) or lifetime (unlimited EAs)\n• AI SCANNER: upload a chart, get a signal setup, execute in one tap\n• FUNDAMENTALS: live economic calendar + market sessions\n• SAFETY: your funds stay at your broker; disconnect any time\n• CUSTOMISE: themes, colours, fonts, music and your own logo\nAsk me about any of these — or for support: eamigratepro@gmail.com / WhatsApp 070 495 0612.";
  };

  const send = (value = input) => {
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { from: "user", text: question },
      { from: "bot", text: answer(question) },
    ]);
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
            <button
              type="button"
              aria-label="Close chatbot"
              onClick={() => setOpen(false)}
              className="text-xl text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.from === "user"
                    ? "ml-8 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-8 rounded-2xl rounded-bl-md bg-card px-3 py-2 text-sm whitespace-pre-line text-foreground"
                }
              >
                {message.text}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {["How does it work?", "Access plans", "Support email", "Is it safe?"].map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => send(question)}
                className="rounded-full border border-primary/30 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                {question}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-border/60 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about EA Migrate..."
              aria-label="Message the EA Migrate assistant"
              className="min-w-0 flex-1 rounded-full border border-border/70 bg-card/60 px-4 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              aria-label="Send message"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
      <motion.button
        type="button"
        aria-label={open ? "Close EA Migrate assistant" : "Open EA Migrate assistant"}
        onClick={() => setOpen((value) => !value)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative flex size-14 items-center justify-center rounded-full border-2 border-[#00F5A0] bg-background/80 p-1.5 shadow-[0_0_28px_rgba(0,245,160,.55)] backdrop-blur-sm"
      >
        <BrandLogo alt="" className="size-full object-contain" />
        <span className="absolute right-0 bottom-0 size-4 rounded-full border-2 border-background bg-[#10B981]" />
        <MessageCircle className="absolute -top-1 -right-1 size-5 rounded-full bg-primary p-1 text-primary-foreground" />
      </motion.button>
    </div>
  );
}

function Home() {
  const [installResult, setInstallResult] = useState<string | null>(null);

  // Register the pass-through service worker (no caching) — best-effort.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* the buttons still work without it */
    });
  }, []);

  /** Android download: the REAL APK file — built and signed by GitHub Actions. */
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
    /* PUBLIC PAGE — `data-eamp-no-cycle` keeps the app-wide tap gesture
       (Settings → colour cycle) from ever running here. The landing page is
       marketing: no bot cycle, no theme mutation, no app logic of any kind. */
    <div
      data-eamp-no-cycle
      className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-background text-foreground"
      /* THE MARKETING ACCENT — Cyber Mint / Neon Profit Emerald. Publishing it
         as the primary + glow tokens themes every text-primary / bg-primary /
         glow-ring / hero-glow / text-brand utility below in one place, so the
         page cannot drift back to the old electric blue. */
      style={
        {
          /* `@theme inline` means text-primary / bg-primary read --primary
             directly, so the accent is overridden here, not --color-primary. */
          "--primary": "#00F5A0",
          "--primary-foreground": "#021810",
          "--ring": "#10B981",
          "--glow": "0 0 50px rgba(0,245,160,.32), 0 0 100px rgba(16,185,129,.18)",
          "--glow-soft": "0 0 30px rgba(0,245,160,.3), 0 0 70px rgba(16,185,129,.16)",
          "--gradient-hero":
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,245,160,.18), transparent 70%)",
          "--gradient-brand": "linear-gradient(100deg, #00F5A0, #10B981)",
        } as CSSProperties
      }
    >
      <SiteHeader />

      <main>
        {/* ── HERO ──────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden hero-glow">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-[radial-gradient(ellipse_at_50%_0%,rgba(0,245,160,.26),transparent_70%)]"
          />
          <div className="relative mx-auto max-w-5xl px-5 pt-12 pb-16 text-center sm:pt-16">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="flex items-center justify-center gap-3"
            >
              <BrandLogo alt="EA Migrate" className="size-10 object-contain" />
              <span className="text-sm font-black tracking-[0.28em] text-white uppercase sm:text-base">
                EA Migrate
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="mt-7 text-[2.55rem] leading-[0.95] font-black tracking-tight text-white uppercase sm:text-6xl lg:text-7xl"
            >
              Mobile VPS
              <br />
              <span className="text-[#00F5A0] [text-shadow:0_0_38px_rgba(0,245,160,.45)]">
                on the go
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-lg"
            >
              Seamless VPS hosting for your EA on the go. Convert your Expert Advisor into a
              mobile trading bot while it remains hosted securely on our servers for
              uninterrupted trading, low-latency execution, and 24/7 uptime.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-8 flex w-full max-w-sm flex-col gap-3"
            >
              <button
                type="button"
                onClick={() => void handleAndroidDownload()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] text-base font-bold text-[#021810] shadow-[0_12px_40px_rgba(0,245,160,.4)] transition hover:brightness-110 active:scale-[0.99]"
              >
                <Smartphone className="size-5" /> Download Android
              </button>
              <a
                href="/app"
                className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#0d1117] text-base font-bold text-white ring-1 ring-white/10 transition hover:bg-[#151b23] active:scale-[0.99]"
              >
                <Apple className="size-5" /> Download iOS
              </a>
              {installResult && (
                <p className="text-center text-sm font-semibold text-primary">{installResult}</p>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-5 flex w-full max-w-sm flex-col items-stretch gap-2.5"
            >
              <Link
                to="/signup"
                className="relative flex h-12 items-center justify-center gap-2 rounded-full bg-[#0d1117] text-sm font-bold text-white ring-1 ring-white/10 transition hover:bg-[#151b23]"
              >
                <UserPlus className="size-4 text-primary" />
                Mentor Sign Up [FREE]
                <span className="absolute -top-2 right-3 rounded-full bg-[#00F5A0] px-2 py-0.5 text-[10px] font-black tracking-wide text-[#021810] uppercase shadow-[0_0_18px_rgba(0,245,160,.5)]">
                  Free
                </span>
              </Link>
              <Link
                to="/app/activate"
                className="flex h-12 items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary/5 text-sm font-semibold text-primary transition hover:bg-primary/10"
              >
                <RotateCcw className="size-4" /> Reactivate
              </Link>
            </motion.div>

            <div className="mt-9 flex flex-col items-center gap-2 text-sm text-muted-foreground sm:flex-row sm:justify-center sm:gap-3">
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <ShieldCheck className="size-4 text-primary" /> 100% EA execution guarantee
              </span>
              <span aria-hidden className="hidden text-border sm:inline">
                |
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} className="size-3.5 fill-[#00F5A0] text-[#00F5A0]" />
                  ))}
                </span>
                4.8/5 from 337+ reviews
              </span>
            </div>
          </div>

          {/* ── INTERACTIVE PHONE SHOWCASE ─────────────────────────── */}
          <div className="relative mx-auto max-w-4xl px-5 pb-20">
            <div className="relative mx-auto mt-2 w-full max-w-[340px] sm:max-w-[360px]">
              {/* glow behind the device */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 scale-125 rounded-[50%] bg-[radial-gradient(circle_at_50%_50%,rgba(0,245,160,.28),transparent_65%)] blur-2xl"
              />
              {/* side screenshots — desktop only, they read as depth */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-8 -left-24 hidden h-[86%] w-[150px] rotate-[-8deg] overflow-hidden rounded-[2rem] opacity-40 ring-1 ring-white/10 lg:block"
              >
                <img src={heroPhone} alt="" className="size-full object-cover" />
              </div>
              <div
                aria-hidden
                className="pointer-events-none absolute top-8 -right-24 hidden h-[86%] w-[150px] rotate-[8deg] overflow-hidden rounded-[2rem] opacity-40 ring-1 ring-white/10 lg:block"
              >
                <img src={heroPhone} alt="" className="size-full object-cover" />
              </div>

              <motion.div
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="relative overflow-hidden rounded-[2.6rem] border border-white/10 bg-[#0d1117] p-2.5 shadow-[0_0_80px_rgba(0,245,160,.32)]"
              >
                <div className="absolute top-3.5 left-1/2 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/20" />
                <img
                  src={heroPhone}
                  alt="EA Migrate app hosting an Expert Advisor on a phone"
                  className="w-full rounded-[2.1rem] object-cover"
                  loading="eager"
                  decoding="async"
                />
              </motion.div>

              {/* floating feature chips */}
              {chips.map((chip, index) => {
                const positions = [
                  "top-14 -left-3 sm:-left-10",
                  "top-[38%] -right-3 sm:-right-10",
                  "bottom-24 -left-3 sm:-left-10",
                  "bottom-6 -right-3 sm:-right-10",
                ];
                return (
                  <motion.div
                    key={chip.title}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.35 + index * 0.1 }}
                    className={`pointer-events-none absolute ${positions[index]} w-[152px] rounded-2xl border border-border/70 bg-card/95 p-2.5 shadow-[0_10px_30px_rgba(0,0,0,.35)] backdrop-blur sm:w-[186px] sm:p-3`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <chip.icon className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] leading-tight font-bold text-foreground sm:text-xs">
                          {chip.title}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
                          {chip.note}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── UPDATE BANNER ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-5 pb-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="panel p-6 sm:p-8"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#00F5A0]/20 to-[#10B981]/20 px-3 py-1 text-[11px] font-black tracking-[0.16em] text-[#00F5A0] uppercase ring-1 ring-[#00F5A0]/30">
              <Sparkles className="size-3.5" /> New Update
            </span>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">
              EA Migrate for Android is here
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The full mobile VPS in your pocket — hosted terminals, news-event trading, live
              scanner and 24/7 execution.
            </p>
            <button
              type="button"
              onClick={() => void handleAndroidDownload()}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] text-sm font-bold text-[#021810] shadow-[0_10px_30px_rgba(0,245,160,.4)] transition hover:brightness-110"
            >
              <Smartphone className="size-4" /> Download Android
            </button>
          </motion.div>
        </section>

        {/* ── WHY CHOOSE ────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center text-3xl font-black tracking-tight text-white uppercase sm:text-4xl">
            Why choose <span className="text-primary">EA Migrate</span>?
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-sm text-muted-foreground sm:text-base">
            One platform for hosting, execution and news trading — built so your robot never
            needs your PC again.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {why.map((item, index) => (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.45, delay: (index % 3) * 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="panel p-6 text-center"
              >
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
                  <item.icon className="size-6" strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 text-base font-bold text-white sm:text-lg">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </motion.article>
            ))}
          </div>

          <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground/80">
            *Latency as low as 1ms describes our infrastructure capability. Actual execution
            speed depends on your broker, network and market conditions, and is not guaranteed.
          </p>
        </section>

        {/* ── ACCESS FEE PLANS ──────────────────────────────────────── */}
        <section
          id="plans"
          className="border-y border-border/60 bg-[linear-gradient(180deg,rgba(0,245,160,.07),transparent_60%)]"
        >
          <div className="mx-auto max-w-5xl px-5 py-16">
            <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
              Access Fee Plan
            </h2>
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
              Pick the access that suits you. Both plans include the mobile app, cloud VPS and
              MT4 / MT5 support.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {plans.map((plan, index) => (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className={`panel relative flex flex-col p-6 sm:p-8 ${
                    plan.highlight
                      ? "border-[#00F5A0]/50 shadow-[0_0_50px_rgba(0,245,160,.25)]"
                      : ""
                  }`}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] px-3 py-1 text-[10px] font-black tracking-[0.14em] whitespace-nowrap text-[#021810] uppercase shadow-[0_0_24px_rgba(0,245,160,.45)]">
                      Most Popular · Best Value
                    </span>
                  )}

                  <p className="text-center text-xl font-bold text-white">{plan.name}</p>
                  <p className="mt-1 text-center text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
                    {plan.badge}
                  </p>

                  <div className="mt-4 text-center">
                    <span className="text-4xl font-black tracking-tight text-white sm:text-5xl">
                      {plan.price}
                    </span>
                    {plan.priceNote && (
                      <span className="ml-1 text-sm font-medium text-muted-foreground">
                        {plan.priceNote}
                      </span>
                    )}
                    <p className="mx-auto mt-3 max-w-[18rem] text-[11px] leading-relaxed tracking-wide text-muted-foreground uppercase">
                      {plan.subtitle}
                    </p>
                  </div>

                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={3} />
                        <span className="text-foreground/90">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <a
                    href={plan.href}
                    target="_blank"
                    rel="noreferrer sponsored"
                    className="mt-7 flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] text-sm font-bold text-[#021810] shadow-[0_10px_30px_rgba(0,245,160,.35)] transition hover:brightness-110"
                  >
                    {plan.cta} <ArrowRight className="size-4" />
                  </a>
                </motion.div>
              ))}
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Already have a key?{" "}
              <Link to="/app/activate" className="font-semibold text-primary hover:underline">
                Activate it here
              </Link>{" "}
              or{" "}
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                create your portal
              </Link>
              .
            </p>
          </div>
        </section>

        {/* ── SETUP GUIDE ───────────────────────────────────────────── */}
        <section className="mx-auto max-w-4xl px-5 py-16">
          <h2 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">
            How to setup
            <br className="sm:hidden" /> your <span className="text-primary">mobile VPS!</span>
          </h2>

          <ol className="mx-auto mt-10 max-w-md space-y-8">
            {setupSteps.map((step, index) => (
              <motion.li
                key={step}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="relative flex items-start gap-4"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00F5A0] to-[#10B981] text-base font-black text-[#021810] shadow-[0_0_24px_rgba(0,245,160,.45)]">
                  {index + 1}
                </span>
                <p className="pt-2 text-base leading-snug text-foreground">{step}</p>
              </motion.li>
            ))}
          </ol>

          <div className="panel mx-auto mt-12 max-w-md p-6">
            <ul className="grid gap-3 sm:grid-cols-2">
              {checklist.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  <span className="text-foreground/90">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="h-12 w-full rounded-full px-7 text-sm font-bold sm:w-auto">
              <a href="#plans">Choose your plan</a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full rounded-full px-7 text-sm font-semibold sm:w-auto"
            >
              <Link to="/support">Talk to support</Link>
            </Button>
          </div>
        </section>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="border-t border-border/60 bg-[#07090c]">
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
                time; refunds are handled case by case within 14 days of purchase. Licence keys
                are locked to one trading account and may not be resold or shared. EA Migrate
                never holds your funds and never withdraws from your broker account.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="py-10">
            <div className="flex items-center gap-2.5">
              <BrandLogo alt="EA Migrate" className="size-9 object-contain" />
              <span className="text-base font-black tracking-tight text-white uppercase">
                EA <span className="text-primary">Migrate</span>
              </span>
            </div>
            <p className="mt-5 max-w-md text-sm text-muted-foreground">
              Hosted EA execution for MT4 &amp; MT5 — on your phone, around the clock.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              © EA Migrate {new Date().getFullYear()}. All rights reserved.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <Link to="/support" className="transition hover:text-primary">
                Support
              </Link>
              <Link to="/signin" className="transition hover:text-primary">
                Mentor Sign In
              </Link>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="transition hover:text-primary">
                WhatsApp 070 495 0612
              </a>
              <a href="mailto:eamigratepro@gmail.com" className="transition hover:text-primary">
                eamigratepro@gmail.com
              </a>
            </div>
            <div className="mt-6 flex gap-3">
              {[Youtube, Send, Instagram].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social link"
                  className="flex size-11 items-center justify-center rounded-full border border-border/70 bg-card/50 text-muted-foreground transition-colors hover:text-primary"
                >
                  <Icon className="size-5" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp contact — the always-on support line. */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat to EA Migrate support on WhatsApp"
        className="fixed bottom-5 left-4 z-[9998] flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#00F5A0] to-[#10B981] text-[#021810] shadow-[0_10px_30px_rgba(0,245,160,.45)] transition hover:brightness-110"
      >
        <MessageCircle className="size-7 fill-[#021810]" />
      </a>

      <LandingChatbot />
      <BrokerPromoPopup />
    </div>
  );
}
