import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SiteHeader } from "@/components/SiteHeader";
import heroBot from "@/assets/hero-bot.jpg";

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
      { name: "twitter:card", content: "summary_large_image" },
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

function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden hero-glow">
          <div className="mx-auto max-w-6xl px-5 pt-16 pb-20 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              <Sparkles className="size-3.5" /> Custom EA platform
            </span>

            <h1 className="mt-8 text-4xl leading-[1.05] font-bold sm:text-6xl">
              Build your own
              <br />
              <span className="text-brand">trading robot.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              EA Migrate Pro turns your strategy into a working MT4 or MT5 Expert Advisor —
              built visually, backtested in seconds and hosted around the clock.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
                <Link to="/builder">Open the EA builder</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full rounded-full sm:w-auto"
              >
                <a href="#how">
                  <Download className="size-4" /> See how it works
                </a>
              </Button>
            </div>

            <div className="relative mx-auto mt-14 max-w-2xl">
              <div className="panel overflow-hidden glow-ring">
                <img
                  src={heroBot}
                  alt="EA Migrate Pro automated trading robot beside a live forex chart"
                  width={1280}
                  height={1280}
                  className="w-full object-cover"
                />
              </div>
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
            {features.map((f) => (
              <article key={f.title} className="panel p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 glow-ring">
                  <f.icon className="size-5 text-primary" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </article>
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
              {steps.map((s) => (
                <li key={s.n} className="flex flex-col items-center">
                  <span className="relative flex size-[136px] items-center justify-center rounded-3xl border border-primary/25 bg-card/60 glow-ring">
                    <s.icon className="size-11 text-primary" strokeWidth={1.5} />
                    <span className="absolute -top-4 -right-4 flex size-11 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-glow">
                      {s.n}
                    </span>
                  </span>
                  <h3 className="mt-8 text-2xl font-bold">{s.t}</h3>
                  <p className="mt-3 max-w-xs text-base text-muted-foreground">{s.d}</p>
                </li>
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
            {why.map((w) => (
              <article key={w.n} className="panel relative overflow-hidden p-7">
                <span className="pointer-events-none absolute top-4 right-6 text-5xl font-bold text-foreground/5">
                  {w.n}
                </span>
                <span className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 glow-ring">
                  <w.icon className="size-7 text-primary" strokeWidth={1.5} />
                </span>
                <h3 className="mt-7 text-2xl font-bold">{w.t}</h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">{w.d}</p>
              </article>
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
                  <AccordionTrigger className="py-6 text-left text-lg font-semibold hover:no-underline">
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
          <div className="panel border-primary/30 px-6 py-14 text-center glow-ring">
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
              >
                Get iOS App
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5">
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
                <Bot className="size-4 text-primary" />
              </span>
              <span className="text-base font-bold uppercase">
                EA <span className="text-primary">Migrate</span> Pro
              </span>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              © EA Migrate Pro {new Date().getFullYear()}. All rights reserved.
            </p>
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
    </div>
  );
}
