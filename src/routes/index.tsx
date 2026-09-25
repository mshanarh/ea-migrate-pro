import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Blocks,
  Cpu,
  Gauge,
  LineChart,
  Lock,
  ShieldCheck,
  Sparkles,
  Workflow,
  Download,
  Bot,
  Youtube,
  Send,
  Instagram,
  Link2,
  TrendingUp,
  CheckCircle2,
  Zap,
  Smartphone,
  Infinity as InfinityIcon,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SiteHeader } from "@/components/SiteHeader";
import { motion } from "framer-motion";
import heroApp from "/ea-migrate-hero.jpg";




export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EA Migrate Pro — Build Custom Forex Expert Advisors" },
      {
        name: "description",
        content:
          "Create, backtest and deploy custom MT4/MT5 Expert Advisors with a visual strategy builder. No coding required.",
      },
      { property: "og:title", content: "EA Migrate Pro — Build Custom Forex EAs" },
      {
        property: "og:description",
        content:
          "Visual strategy builder for MT4 and MT5 Expert Advisors. Build, test and deploy in minutes.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "EA Migrate Pro" },
      { property: "og:image", content: "/logo.png" },
      { property: "og:image:alt", content: "EA Migrate Pro robot logo" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "EA Migrate Pro — Build Custom Forex EAs" },
      { name: "twitter:image", content: "/logo.png" },
    ],
  }),
  component: Home,
});

const features = [
  {
    icon: Blocks,
    title: "Visual EA builder",
    body: "Drag entry rules, filters and exits into place. Your strategy compiles to a clean MT4/MT5 Expert Advisor.",
  },
  {
    icon: Cpu,
    title: "No coding required",
    body: "Everything MQL can do, expressed as blocks. Export the source any time if you want to go deeper.",
  },
  {
    icon: LineChart,
    title: "Backtest instantly",
    body: "Run your strategy over historical data and read equity curve, drawdown and win rate before going live.",
  },
  {
    icon: Gauge,
    title: "Risk controls built in",
    body: "Lot sizing, daily loss caps, spread and session filters ship with every EA you generate.",
  },
  {
    icon: Workflow,
    title: "Migrate existing EAs",
    body: "Bring an EA you already own, remap its inputs and move it onto a hosted terminal without downtime.",
  },
  {
    icon: ShieldCheck,
    title: "Secure hosting",
    body: "Encrypted sessions, licence-locked builds and 24/7 execution on hardened infrastructure.",
  },
];

const steps = [
  {
    n: "01",
    icon: Blocks,
    t: "Describe the strategy",
    d: "Pick pair, timeframe and the indicators your edge relies on.",
  },
  {
    n: "02",
    icon: Workflow,
    t: "Build the logic",
    d: "Compose entry, exit and risk blocks in the builder canvas.",
  },
  {
    n: "03",
    icon: Link2,
    t: "Connect MT4 / MT5",
    d: "Link your broker account in the app. Your EA is hosted on our servers, not on your phone.",
  },
  {
    n: "04",
    icon: TrendingUp,
    t: "Trade on autopilot",
    d: "Your EA reads market structure and executes 24/7, reporting every entry, stop and target.",
  },
];

const badges = [
  { icon: CheckCircle2, t: "Accurate execution" },
  { icon: Zap, t: "99% uptime execution" },
  { icon: Smartphone, t: "MT4 & MT5 supported" },
  { icon: InfinityIcon, t: "Unlimited access" },
];

const why = [
  {
    n: "01",
    icon: Cpu,
    t: "Advanced AI systems",
    d: "Market analysis driven by structure-aware automation that keeps refining its read as price develops — not a fixed set of rules.",
  },
  {
    n: "02",
    icon: Lock,
    t: "Secure infrastructure",
    d: "End-to-end encryption, single-use platform-locked license keys and isolated MT4/MT5 sessions per account.",
  },
  {
    n: "03",
    icon: Gauge,
    t: "Optimised performance",
    d: "Built for speed and stability — 99% uptime execution and continuous hosting, whether your phone is on or off.",
  },
];

const faqs = [
  {
    q: "What is EA Migrate Pro?",
    a: "A platform where you build custom Expert Advisors for MT4 and MT5, then let us host and run them for you around the clock.",
  },
  {
    q: "Do I need to know how to trade?",
    a: "It helps, but it isn't required. You can start from a ready-made strategy template and adjust the risk settings to suit you.",
  },
  {
    q: "Do I need a computer?",
    a: "No. Your EA runs on our servers, so nothing has to stay switched on at your end.",
  },
  {
    q: "Which trading apps does it work with?",
    a: "MetaTrader 4 and MetaTrader 5 accounts with any broker that allows automated trading.",
  },
  { q: "How do I start?", a: "Create an account, open the builder and publish your first EA." },
  {
    q: "Is my money safe?",
    a: "Your funds always stay with your own broker. We never hold or move your money — we only send trade instructions.",
  },
  {
    q: "How do I get support?",
    a: "Reach us through the app or our Telegram channel and we'll help you get set up.",
  },
  {
    q: "Do I need to keep my phone on?",
    a: "No. Hosting is continuous, so your strategy keeps trading with your phone off.",
  },
  {
    q: "Can I use one licence key on more than one account?",
    a: "Each licence key is locked to a single trading account. Extra accounts need their own key.",
  },
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
      return "You can reach the EA Migrate Pro team any time:\n• Email: eamigratepro@gmail.com — we respond within 24 hours\n• WhatsApp: 070 495 0612 — real-time chat with support\n• The /support page has a full contact form too. If it's about your portal (approval, licence keys, MT5 connection), message WhatsApp with your registered email so we can find your account fast.";
    }

    // ── What is the platform ────────────────────────────────────────
    if (text.includes("what is") || text.includes("what's") || text.includes("about") || text.includes("platform") || text.includes("ea migrate") || text.includes("tell me")) {
      return "EA Migrate Pro is a forex robot (EA) hosting platform for MT4 and MT5. Your mentor builds your Expert Advisor, hosts it 24/7 in the cloud, and issues you a licence key. You activate the key, connect your MT5 account, and the robot trades it — no VPS, no coding, no keeping your PC on. There's also an AI chart scanner, a fundamentals economic calendar, and customisable app themes.";
    }

    // ── How it works / getting started ────────────────────────────
    if (text.includes("how") || text.includes("work") || text.includes("start") || text.includes("step") || text.includes("begin")) {
      return "Getting started is 4 steps:\n1. Register on the signup page with your email — your portal is created instantly.\n2. Your mentor approves the portal and issues you a licence key (EMP-XXXX-XXXX-XXXX).\n3. Activate the key in the app and connect your MT5 account on the MetaTrader page.\n4. Turn the robot on — it trades 24/7 in the cloud, even with your phone off.";
    }

    // ── MT4 / MT5 / brokers ─────────────────────────────────────
    if (text.includes("mt4") || text.includes("mt5") || text.includes("broker") || text.includes("metatrader")) {
      return "EA Migrate Pro supports MT4 and MT5 with any broker (Exness, Pepperstone, OctaFX, FBS, Deriv, XM, IC Markets and more). Your account stays with your broker — the platform hosts the EA and sends trade instructions through a secure connection. Demo and cent accounts work too, so you can test safely before going live.";
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
    return "Here's what I know about EA Migrate Pro:\n• WHAT: forex EA hosting for MT4/MT5 — your mentor builds the robot, the cloud runs it 24/7\n• START: register → portal approved → activate your EMP licence key → connect MT5 → robot on\n• AI SCANNER: upload a chart, get a signal setup, execute in one tap\n• FUNDAMENTALS: live economic calendar + market sessions (Settings → Fundamentals)\n• SAFETY: your funds stay at your broker; disconnect any time\n• CUSTOMISE: themes, colours, fonts, music and your own logo\nAsk me about any of these — or for support: eamigratepro@gmail.com / WhatsApp 070 495 0612.";
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
            <img src="/logo.png" alt="EA Migrate Pro" className="size-10 rounded-full border-2 border-primary object-contain shadow-glow" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">EA Migrate assistant</p>
              <p className="text-xs text-emerald-400">Online · Ask anything</p>
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
      <motion.button type="button" aria-label={open ? "Close EA Migrate assistant" : "Open EA Migrate assistant"} onClick={() => setOpen((value) => !value)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="relative flex size-14 items-center justify-center rounded-full border-2 border-primary bg-white/5 p-1.5 shadow-[0_0_28px_rgba(37,99,235,.55)] backdrop-blur-sm">
        <img src="/logo.png" alt="" className="size-full object-contain" />
        <span className="absolute right-0 bottom-0 size-4 rounded-full border-2 border-white bg-[#22C55E]" />
        <MessageCircle className="absolute -right-1 -top-1 size-5 rounded-full bg-primary p-1 text-white" />
      </motion.button>
    </div>
  );
}

function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#0A0A0A] text-white">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden hero-glow">
          <div className="mx-auto max-w-6xl px-5 pt-16 pb-20 text-center">
            <motion.span
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="inline-flex items-center gap-2 rounded-full border border-[#38BDF8]/30 bg-[#1A2332] px-4 py-1.5 text-xs font-semibold tracking-[0.2em] text-[#38BDF8] uppercase"
            >
              <Sparkles className="size-3.5" /> EA HOSTING PLATFORM
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 max-w-full text-4xl leading-[1.05] font-bold break-words text-white sm:text-6xl"
            >
              Your Mentor&apos;s
              <br />
              <span className="text-[#38BDF8]">Robot</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg"
            >
              EA Migrate Pro turns your strategy into a working MT4 or MT5 Expert Advisor —
              built visually, backtested in seconds and hosted around the clock.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button asChild size="lg" className="w-full max-w-full rounded-full sm:w-auto">
                <Link to="/signup">Create your portal</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full max-w-full rounded-full sm:w-auto"
              >

                <a href="#how">
                  <Download className="size-4" /> See how it works
                </a>
              </Button>
            </motion.div>

            <div
              className="relative mx-auto mt-14 w-full max-w-[320px] overflow-hidden rounded-[2.5rem]"
              style={{ perspective: 1200 }}
            >
              <motion.img
                src={heroApp}
                alt="EA Migrate Pro app running the EA Migrate tester bot on a phone"
                className="h-auto w-full object-contain"
                style={{
                  borderRadius: 40,
                  boxShadow: "0 0 60px rgba(37,99,235,0.6)",
                }}
                animate={{ y: [0, -15, 0], rotateY: [0, 15, 0, -15, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>

            <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-4 text-left">
              {[
                ["99.9%", "Uptime"],
                ["24/7", "Execution"],
                ["MT4 / MT5", "Supported"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="text-lg font-bold sm:text-2xl">{v}</dt>
                  <dd className="text-xs text-muted-foreground sm:text-sm">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Everything you need to <span className="text-primary">automate</span>.
          </h2>
          <p className="mt-3 max-w-xl text-muted-foreground">
            From your first idea to a live, risk-managed robot — the whole toolkit sits in
            one platform.
          </p>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, index) => (
              <motion.article
                key={f.title}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: (index % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4 }}
                className="panel w-full max-w-full overflow-hidden p-6 break-words"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 glow-ring">
                  <f.icon className="size-5 text-primary" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </motion.article>
            ))}
          </div>
        </section>

        <section id="how" className="border-y border-border/60 bg-card/30">
          <div className="mx-auto max-w-6xl px-5 py-20 text-center">
            <p className="text-xs font-semibold tracking-[0.25em] text-primary uppercase">
              Get started
            </p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              How it <span className="text-primary">works</span>
            </h2>

            <ol className="mt-14 grid gap-16 sm:grid-cols-2 sm:gap-12 lg:grid-cols-4">
              {steps.map((s, index) => (
                <motion.li
                  key={s.n}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center"
                >
                  <span className="relative flex size-[136px] items-center justify-center rounded-3xl border border-primary/25 bg-card/60 glow-ring">
                    <s.icon className="size-11 text-primary" strokeWidth={1.5} />
                    <span className="absolute -top-4 -right-4 flex size-11 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-glow">
                      {s.n}
                    </span>
                  </span>
                  <h3 className="mt-8 text-2xl font-bold">{s.t}</h3>
                  <p className="mt-3 max-w-xs text-base text-muted-foreground">{s.d}</p>
                </motion.li>
              ))}
            </ol>

            <div className="mt-16 flex flex-col items-center gap-3">
              {badges.map((b) => (
                <span
                  key={b.t}
                  className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-card/50 px-7 py-4 text-base"
                >
                  <b.icon className="size-5 text-primary" /> {b.t}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 text-center">
          <p className="text-xs font-semibold tracking-[0.25em] text-primary uppercase">
            Why choose us
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            Why <span className="text-primary">EA Migrate Pro</span>.
          </h2>

          <div className="mt-12 grid gap-6 text-left lg:grid-cols-3">
            {why.map((w, index) => (
              <motion.article
                key={w.n}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: index * 0.09, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4 }}
                className="panel relative w-full max-w-full overflow-hidden p-7 break-words"
              >
                <span className="pointer-events-none absolute top-4 right-6 text-5xl font-bold text-foreground/5">
                  {w.n}
                </span>
                <span className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 glow-ring">
                  <w.icon className="size-7 text-primary" strokeWidth={1.5} />
                </span>
                <h3 className="mt-7 text-2xl font-bold">{w.t}</h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">{w.d}</p>
              </motion.article>
            ))}
          </div>
        </section>

        <section className="border-t border-border/60">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center">
            <p className="text-xs font-semibold tracking-[0.25em] text-primary uppercase">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Have some <span className="text-primary">questions</span>?
            </h2>

            <Accordion type="single" collapsible className="mt-10 space-y-4 text-left">
              {faqs.map((f, i) => (
                <AccordionItem
                  key={f.q}
                  value={`faq-${i}`}
                  className="panel border-b-0 px-6"
                >
                  <AccordionTrigger className="w-full max-w-full py-6 text-left text-lg font-semibold break-words hover:no-underline">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="pb-6 text-base text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section id="download" className="mx-auto max-w-3xl px-5 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="panel border-primary/30 px-6 py-14 text-center glow-ring"
          >
            <h2 className="text-3xl font-bold sm:text-4xl">Put your EAs on autopilot.</h2>
            <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
              Install the app, link your MT account and let your strategies trade around the
              clock.
            </p>
            <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
              <Button size="lg" className="h-14 rounded-full text-base font-semibold">
                Download Android
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 rounded-full text-base font-semibold"
                onClick={() => navigate({ to: "/app" })}
              >
                Get iOS App
              </Button>
            </div>
          </motion.div>
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
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 glow-ring">
                <img src="/logo.png" alt="" className="size-6 rounded-md object-contain" />
              </span>
              <span className="text-base font-bold uppercase">
                EA <span className="text-primary">Migrate</span> Pro
              </span>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              © EA Migrate Pro {new Date().getFullYear()}. All rights reserved.
            </p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <Link to="/support" className="transition hover:text-primary">Support</Link>
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
      <LandingChatbot />
    </div>
  );
}
