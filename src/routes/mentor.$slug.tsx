import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Apple, Bot, Check, MessageCircle, Monitor, Smartphone, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useStore } from "@/lib/auth-store";
import type { MentorWebsite } from "@/lib/auth-store";
import { decodeWebsiteFromLink, websiteSlug } from "@/lib/website-share";

export const Route = createFileRoute("/mentor/$slug")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Trading Bot Website — EA Migrate Pro" },
      { name: "description", content: "A mentor trading bot sales page powered by EA Migrate Pro." },
    ],
  }),
  component: PublicMentorWebsite,
});

const THEMES: Record<string, { name: string; accent: string; surface: string; glow: string }> = {
  inferno: { name: "Inferno", accent: "#ff4051", surface: "#220b0f", glow: "rgba(255,64,81,.4)" },
  titan: { name: "Titan", accent: "#22c968", surface: "#061b12", glow: "rgba(34,201,104,.36)" },
  cortex: { name: "Cortex", accent: "#21b8f5", surface: "#061a26", glow: "rgba(33,184,245,.36)" },
  phantom: { name: "Phantom", accent: "#a14dff", surface: "#190a2e", glow: "rgba(161,77,255,.36)" },
  "old-school": { name: "Old School", accent: "#ffab08", surface: "#221705", glow: "rgba(255,171,8,.36)" },
  royal: { name: "Royal", accent: "#6568ff", surface: "#0d0e2d", glow: "rgba(101,104,255,.36)" },
  ocean: { name: "Ocean", accent: "#14bed5", surface: "#061b23", glow: "rgba(20,190,213,.36)" },
  sunset: { name: "Sunset", accent: "#ff4365", surface: "#260a13", glow: "rgba(255,67,101,.36)" },
  emerald: { name: "Emerald", accent: "#00b986", surface: "#051f17", glow: "rgba(0,185,134,.36)" },
  gold: { name: "Gold", accent: "#ffc20a", surface: "#201804", glow: "rgba(255,194,10,.36)" },
  crimson: { name: "Crimson", accent: "#f0262f", surface: "#26080a", glow: "rgba(240,38,47,.36)" },
  mono: { name: "Mono", accent: "#f4f5f7", surface: "#17191d", glow: "rgba(244,245,247,.26)" },
};

function PublicMentorWebsite() {
  const { slug } = Route.useParams();
  const store = useStore();
  const sharedWebsite = useMemo(() => {
    if (typeof window === "undefined") return null;
    return decodeWebsiteFromLink(new URLSearchParams(window.location.search).get("data"));
  }, [slug]);
  const localAccount = store.accounts.find((account) => account.website && websiteSlug(account.username, account.website.robotName) === slug);
  const website = sharedWebsite ?? localAccount?.website ?? null;

  if (!website) return <NotFound />;
  return <WebsitePage website={website} />;
}

function WebsitePage({ website }: { website: MentorWebsite }) {
  const theme = THEMES[website.theme] ?? THEMES["inferno"]!;
  const hasIos = Boolean(website.iosPrice && website.iosLink);
  const hasPc = Boolean(website.pcPrice && website.pcLink);
  const backgroundImage = website.botImage
    ? "linear-gradient(rgba(4,7,11,.45), rgba(4,7,11,.92)), url(\"" + website.botImage + "\")"
    : "radial-gradient(circle at 50% 0%, " + theme.glow + ", transparent 42%)";
  const whatsapp = website.whatsapp.replace(/[^0-9]/g, "");
  const paragraphs = website.description ? website.description.split("\\n\\n") : ["A focused automated trading companion built around a clear, repeatable process."];
  const results = Array.isArray(website.resultImages) ? website.resultImages : [];

  return <main className="relative min-h-screen overflow-hidden bg-[#04070b] text-white" style={{ "--public-accent": theme.accent } as CSSProperties}>
    <div className="fixed inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage, filter: "saturate(1.05)" }} />
    <div className="fixed inset-0 bg-[linear-gradient(180deg,rgba(4,7,11,.35),#04070b_76%)]" />
    <div className="relative mx-auto max-w-5xl px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 backdrop-blur"><Bot className="size-5" style={{ color: theme.accent }} /></span><span className="text-sm font-bold tracking-[.18em] uppercase">{theme.name}</span></div><a href="#buy" className="rounded-full border border-white/15 bg-black/25 px-4 py-2 text-xs font-bold backdrop-blur transition hover:border-white/30">Get access</a></header>
      <section className="mx-auto max-w-3xl pt-16 text-center sm:pt-24"><div className="mx-auto flex size-32 items-center justify-center overflow-hidden rounded-[2rem] border bg-black/35 backdrop-blur" style={{ borderColor: theme.accent + "99", boxShadow: "0 0 60px " + theme.glow }}>{website.botImage ? <img src={website.botImage} alt={website.robotName} className="size-full object-cover" /> : <Bot className="size-16" style={{ color: theme.accent }} />}</div><p className="mt-8 text-xs font-bold tracking-[.32em] uppercase" style={{ color: theme.accent }}>{theme.name}</p><h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">{website.robotName || "Your Robot"}</h1><p className="mx-auto mt-4 max-w-xl text-lg text-white/70">{website.tagline || "Your high-precision trading companion"}</p></section>
      <section className="mx-auto mt-12 max-w-3xl rounded-[2rem] border border-white/10 bg-black/35 p-6 shadow-2xl backdrop-blur-xl sm:p-10"><div className="flex items-center gap-2 text-xs font-bold tracking-[.2em] uppercase" style={{ color: theme.accent }}><Sparkles className="size-4" /> How it works</div><div className="mt-5 space-y-5 text-base leading-8 text-white/75">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></section>
      {results.length > 0 && <section className="mx-auto mt-6 max-w-3xl rounded-[2rem] border border-white/10 bg-black/30 p-6 backdrop-blur-xl sm:p-8"><h2 className="text-lg font-bold">Client results</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{results.map((image, index) => <img key={image.slice(-20) + index} src={image} alt="Client result" className="aspect-video w-full rounded-2xl object-cover" />)}</div></section>}
      <section id="buy" className="mx-auto mt-6 max-w-3xl rounded-[2rem] border border-white/10 bg-black/35 p-6 backdrop-blur-xl sm:p-8"><h2 className="text-lg font-bold">Choose your version</h2><div className="mt-5 grid gap-3 sm:grid-cols-3">{website.androidPrice && website.androidLink && <BuyButton href={website.androidLink} icon={<Smartphone className="size-5" />} label="Android" price={website.currency + " " + website.androidPrice} accent={theme.accent} />}{hasIos && <BuyButton href={website.iosLink} icon={<Apple className="size-5" />} label="iOS" price={website.currency + " " + website.iosPrice} accent={theme.accent} />}{hasPc && <BuyButton href={website.pcLink} icon={<Monitor className="size-5" />} label="PC" price={website.currency + " " + website.pcPrice} accent={theme.accent} />}</div></section>
      <div className="mx-auto mt-8 flex max-w-3xl items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur"><p className="text-xs text-white/50">Trade responsibly. Past results do not guarantee future performance.</p>{whatsapp && <a href={"https://wa.me/" + whatsapp} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: "#20d866", boxShadow: "0 0 24px rgba(32,216,102,.35)" }}><MessageCircle className="size-4 fill-white" /> WhatsApp</a>}</div>
      <p className="pt-8 text-center text-xs text-white/35">Powered by EA Migrate Pro</p>
    </div>
  </main>;
}

function BuyButton({ href, icon, label, price, accent }: { href: string; icon: React.ReactNode; label: string; price: string; accent: string }) { return <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-2xl border p-4 transition hover:-translate-y-0.5" style={{ borderColor: accent + "66", backgroundColor: accent + "18" }}><span className="flex items-center gap-3 font-bold">{icon}{label}</span><span className="text-sm font-bold" style={{ color: accent }}>{price}</span></a>; }

function NotFound() { return <main className="flex min-h-screen items-center justify-center bg-[#04070b] px-6 text-center text-white"><div><Bot className="mx-auto size-12 text-primary" /><h1 className="mt-5 text-3xl font-bold">Website not found</h1><p className="mt-2 text-sm text-white/60">This mentor link is invalid or has not been published yet.</p></div></main>; }
