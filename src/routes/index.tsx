import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Blocks,
  Cpu,
  Gauge,
  LineChart,
  ShieldCheck,
  Sparkles,
  Workflow,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { n: "01", t: "Describe the strategy", d: "Pick pair, timeframe and the indicators your edge relies on." },
  { n: "02", t: "Build the logic", d: "Compose entry, exit and risk blocks in the builder canvas." },
  { n: "03", t: "Backtest & tune", d: "Iterate on results until the curve looks the way you want it." },
  { n: "04", t: "Deploy live", d: "Push the EA to your MT4/MT5 account and let it run 24/7." },
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
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="text-xs font-semibold tracking-[0.25em] text-primary uppercase">
              Get started
            </p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              How it <span className="text-primary">works</span>
            </h2>

            <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s) => (
                <li key={s.n} className="panel p-6">
                  <span className="text-sm font-bold text-primary">{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Your strategy, running <span className="text-brand">without you.</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Start with the builder — no install, no licence key needed to try it out.
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full">
            <Link to="/builder">Build my EA</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t border-border/60 py-10">
        <p className="text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} EA Migrate Pro. Trading involves risk.
        </p>
      </footer>
    </div>
  );
}
