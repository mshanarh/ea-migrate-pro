import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Apple,
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Globe2,
  ImagePlus,
  Link2,
  MessageCircle,
  Monitor,
  Palette,
  Phone,
  Save,
  Smartphone,
  Trash2,
  WandSparkles,
} from "lucide-react";
import type { CSSProperties } from "react";
import { saveWebsite, useCurrentAccount } from "@/lib/auth-store";
import type { MentorWebsite } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/website")({
  ssr: false,
  component: WebsiteBuilder,
});

const THEMES = [
  { id: "inferno", name: "Inferno", accent: "#ff4051", surface: "#220b0f", glow: "rgba(255, 64, 81, .38)" },
  { id: "titan", name: "Titan", accent: "#22c968", surface: "#061b12", glow: "rgba(34, 201, 104, .34)" },
  { id: "cortex", name: "Cortex", accent: "#21b8f5", surface: "#061a26", glow: "rgba(33, 184, 245, .34)" },
  { id: "phantom", name: "Phantom", accent: "#a14dff", surface: "#190a2e", glow: "rgba(161, 77, 255, .34)" },
  { id: "old-school", name: "Old School", accent: "#ffab08", surface: "#221705", glow: "rgba(255, 171, 8, .34)" },
  { id: "royal", name: "Royal", accent: "#6568ff", surface: "#0d0e2d", glow: "rgba(101, 104, 255, .34)" },
  { id: "ocean", name: "Ocean", accent: "#14bed5", surface: "#061b23", glow: "rgba(20, 190, 213, .34)" },
  { id: "sunset", name: "Sunset", accent: "#ff4365", surface: "#260a13", glow: "rgba(255, 67, 101, .34)" },
  { id: "emerald", name: "Emerald", accent: "#00b986", surface: "#051f17", glow: "rgba(0, 185, 134, .34)" },
  { id: "gold", name: "Gold", accent: "#ffc20a", surface: "#201804", glow: "rgba(255, 194, 10, .34)" },
  { id: "crimson", name: "Crimson", accent: "#f0262f", surface: "#26080a", glow: "rgba(240, 38, 47, .34)" },
  { id: "mono", name: "Mono", accent: "#f4f5f7", surface: "#17191d", glow: "rgba(244, 245, 247, .25)" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

type WebsiteDraft = Omit<MentorWebsite, "updatedAt">;

const emptyWebsite: WebsiteDraft = {
  eaId: "",
  robotName: "",
  tagline: "",
  theme: "inferno",
  currency: "ZAR",
  androidPrice: "",
  androidLink: "",
  iosPrice: "",
  iosLink: "",
  pcPrice: "",
  pcLink: "",
  description: "",
  whatsapp: "",
  resultImages: [],
};

const fieldClass = "mt-2 h-13 w-full rounded-2xl border border-border/70 bg-background/70 px-4 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/15";
const sectionClass = "panel p-5 sm:p-6";

function WebsiteBuilder() {
  const account = useCurrentAccount();
  const [website, setWebsite] = useState<WebsiteDraft>(() => account?.website ?? emptyWebsite);
  const [saved, setSaved] = useState<MentorWebsite | null>(() => account?.website ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const typingRef = useRef<number | null>(null);

  useEffect(() => {
    if (account?.website) {
      setWebsite(account.website);
      setSaved(account.website);
    }
  }, [account]);

  useEffect(() => () => {
    if (typingRef.current) window.clearInterval(typingRef.current);
  }, []);

  const theme = useMemo(
    () => THEMES.find((item) => item.id === website.theme) ?? THEMES[0],
    [website.theme],
  );
  const selectedEa = account?.eas.find((ea) => ea.id === website.eaId);
  const publicLink = saved && account ? buildPublicLink(account.username, saved.robotName) : "";

  const update = <K extends keyof WebsiteDraft>(key: K, value: WebsiteDraft[K]) => {
    setWebsite((current) => ({ ...current, [key]: value }));
    setNotice("");
  };

  const selectEa = (eaId: string) => {
    const ea = account?.eas.find((item) => item.id === eaId);
    setWebsite((current) => ({
      ...current,
      eaId,
      robotName: current.robotName || ea?.name || "",
      description: current.description || ea?.briefing || "",
    }));
    setNotice("");
  };

  const createAiText = () => {
    if (!website.robotName.trim()) {
      setError("Add your robot name first so the AI can write relevant copy.");
      return;
    }
    setError("");
    setNotice("");
    if (typingRef.current) window.clearInterval(typingRef.current);
    const name = website.robotName.trim();
    const focus = website.tagline.trim() || "a disciplined approach to the markets";
    const copy = [
      "Meet " + name + " — an automated trading bot built for traders who value clarity, consistency, and a repeatable process.",
      "Designed around " + focus.toLowerCase() + ", it scans the market for its setup, manages entries with defined rules, and keeps every decision systematic.",
      "Use the live results and choose the version that fits your trading journey. As with every strategy, review the details and trade responsibly.",
    ].join("\n\n");
    setIsGenerating(true);
    setWebsite((current) => ({ ...current, description: "" }));
    let position = 0;
    typingRef.current = window.setInterval(() => {
      position = Math.min(copy.length, position + Math.max(2, Math.round(copy.length / 110)));
      setWebsite((current) => ({ ...current, description: copy.slice(0, position) }));
      if (position >= copy.length) {
        if (typingRef.current) window.clearInterval(typingRef.current);
        typingRef.current = null;
        setIsGenerating(false);
      }
    }, 24);
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account) return;
    if (!website.eaId) {
      setError(account.eas.length ? "Choose the EA this website will promote." : "Create an EA first, then choose it here.");
      return;
    }
    if (!website.robotName.trim()) {
      setError("Add a robot name for your website.");
      return;
    }
    if (!website.androidPrice.trim() || !website.androidLink.trim()) {
      setError("Android price and payment link are required to publish the website.");
      return;
    }
    if (!website.whatsapp.trim()) {
      setError("Add a WhatsApp number so clients can reach you.");
      return;
    }
    const next = { ...website, updatedAt: new Date().toISOString() };
    saveWebsite(account.id, next);
    setSaved(next);
    setWebsite(next);
    setError("");
    setNotice("Your website overview has been updated and the link is ready to share.");
  };

  const addResultImages = (files: FileList | null) => {
    if (!files) return;
    const remaining = Math.max(0, 4 - website.resultImages.length);
    const selected = Array.from(files).slice(0, remaining);
    Promise.all(selected.map(readFileAsDataUrl)).then((images) => {
      setWebsite((current) => ({ ...current, resultImages: [...current.resultImages, ...images] }));
    });
  };

  if (!account) return null;

  return (
    <div className="mx-auto max-w-6xl pb-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.22em] text-primary uppercase"><Globe2 className="size-4" /> Mentor website</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Build your public sales page</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Create a polished page for your robot, preview it as you go, and share one link with clients on WhatsApp.</p>
        </div>
        {saved && <span className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 sm:self-auto"><Check className="size-4" /> Published overview ready</span>}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)]">
        <form className="space-y-5" onSubmit={save}>
          <section className={sectionClass}>
            <SectionTitle icon={<Bot className="size-4" />} title="Robot" subtitle="Choose the EA and give this sales page a clear identity." />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><FieldLabel>Pick from your EAs</FieldLabel><div className="relative"><select value={website.eaId} onChange={(event) => selectEa(event.target.value)} className={fieldClass + " appearance-none pr-11"}><option value="">{account.eas.length ? "Pick from your EAs..." : "No EAs created yet"}</option>{account.eas.map((ea) => <option key={ea.id} value={ea.id}>{ea.name}</option>)}</select><ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground" /></div></label>
              <label><FieldLabel>Robot name</FieldLabel><input value={website.robotName} onChange={(event) => update("robotName", event.target.value)} placeholder="e.g. Titan Gold Sniper" className={fieldClass} /></label>
              <label><FieldLabel>Optional tagline</FieldLabel><input value={website.tagline} onChange={(event) => update("tagline", event.target.value)} placeholder="e.g. High-precision gold scalper" className={fieldClass} /></label>
            </div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<Palette className="size-4" />} title="Colour theme" subtitle="This controls the public sales page buttons, glows, and highlights." />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {THEMES.map((item) => {
                const active = website.theme === item.id;
                return <button type="button" key={item.id} onClick={() => update("theme", item.id as ThemeId)} className="group rounded-2xl border p-3 text-left transition hover:-translate-y-0.5" style={{ borderColor: active ? item.accent : "rgba(255,255,255,.08)", background: "linear-gradient(135deg, " + item.surface + ", #0d1118)", boxShadow: active ? "0 0 22px " + item.glow : "none" }}><span className="flex items-center gap-3"><span className="size-4 rounded-full" style={{ backgroundColor: item.accent, boxShadow: "0 0 16px " + item.accent }} /><span className="text-sm font-bold">{item.name}</span></span><span className="mt-2 block text-[11px] text-muted-foreground">{active ? "Selected" : "Use this look"}</span></button>;
              })}
            </div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<Smartphone className="size-4" />} title="Android version" subtitle="Price and payment link are required for the Android button to appear." />
            <div className="mt-5 grid gap-4 sm:grid-cols-[100px_1fr]">
              <label><FieldLabel>Currency</FieldLabel><select value={website.currency} onChange={(event) => update("currency", event.target.value)} className={fieldClass + " appearance-none"}><option>ZAR</option><option>USD</option><option>GBP</option><option>EUR</option></select></label>
              <label><FieldLabel>Price</FieldLabel><input value={website.androidPrice} onChange={(event) => update("androidPrice", event.target.value)} placeholder="e.g. 1500.00" className={fieldClass} /></label>
              <label className="sm:col-span-2"><FieldLabel>Payment link</FieldLabel><input value={website.androidLink} onChange={(event) => update("androidLink", event.target.value)} placeholder="https://pay.yoco.com/... payment link" className={fieldClass} /></label>
            </div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<Apple className="size-4" />} title="iOS version" suffix="optional" subtitle="The iOS button shows once both the price and link are filled in." />
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label><FieldLabel>iOS price</FieldLabel><input value={website.iosPrice} onChange={(event) => update("iosPrice", event.target.value)} placeholder="iOS price" className={fieldClass} /></label><label><FieldLabel>iOS payment link</FieldLabel><input value={website.iosLink} onChange={(event) => update("iosLink", event.target.value)} placeholder="https://... iOS payment link" className={fieldClass} /></label></div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<Monitor className="size-4" />} title="PC version" suffix="optional" subtitle="Add both fields when you want clients to see the PC option." />
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label><FieldLabel>PC bot price</FieldLabel><input value={website.pcPrice} onChange={(event) => update("pcPrice", event.target.value)} placeholder="PC bot price" className={fieldClass} /></label><label><FieldLabel>PC payment link</FieldLabel><input value={website.pcLink} onChange={(event) => update("pcLink", event.target.value)} placeholder="https://... PC payment link" className={fieldClass} /></label></div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<FileText className="size-4" />} title="About your bot" subtitle="Explain what makes it useful and how its process works." />
            <div className="mt-5"><textarea value={website.description} onChange={(event) => update("description", event.target.value)} rows={7} placeholder="Tell clients how your bot works, what it looks for, and who it is designed for..." className="w-full resize-y rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm leading-6 outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/15" /><button type="button" onClick={createAiText} disabled={isGenerating} className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:cursor-wait disabled:opacity-70"><WandSparkles className="size-4" />{isGenerating ? "AI is writing..." : "Create text with AI"}</button><p className="mt-2 text-xs text-muted-foreground">AI creates a first draft from your robot name and tagline. You can edit it before publishing.</p></div>
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<ImagePlus className="size-4" />} title="Client results" suffix="optional" subtitle="Upload up to four screenshots. They will appear in a results gallery on your public page." />
            <div className="mt-5 flex flex-wrap gap-3"><label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-bold text-primary hover:bg-primary/20"><ImagePlus className="size-4" /> Add result images<input type="file" accept="image/*" multiple className="hidden" onChange={(event) => addResultImages(event.target.files)} /></label><span className="self-center text-xs text-muted-foreground">{website.resultImages.length}/4 added</span></div>
            {website.resultImages.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{website.resultImages.map((image, index) => <div key={image.slice(-24) + index} className="group relative aspect-video overflow-hidden rounded-xl border border-border/60"><img src={image} alt={"Client result " + (index + 1)} className="size-full object-cover" /><button type="button" aria-label="Remove result image" onClick={() => update("resultImages", website.resultImages.filter((_, imageIndex) => imageIndex !== index))} className="absolute top-2 right-2 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition group-hover:opacity-100"><Trash2 className="size-3.5" /></button></div>)}</div>}
          </section>

          <section className={sectionClass}>
            <SectionTitle icon={<MessageCircle className="size-4" />} title="WhatsApp number" subtitle="Include the country code so clients can contact you directly." />
            <label className="mt-5 block"><FieldLabel>Contact number</FieldLabel><div className="relative"><Phone className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" /><input value={website.whatsapp} onChange={(event) => update("whatsapp", event.target.value.replace(/[^0-9+]/g, ""))} placeholder="+27 82 123 4567" className={fieldClass + " pl-11"} /></div></label>
          </section>

          {error && <p className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          {notice && <p className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
          <button type="submit" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"><Save className="size-5" /> Save &amp; Generate Link</button>
        </form>

        <div className="space-y-5">
          <LivePreview website={website} theme={theme} publicLink={publicLink} />
          {saved && <section className={sectionClass + " border-primary/30 bg-primary/5"}><p className="text-xs font-bold tracking-[0.2em] text-primary uppercase">Website overview</p><h2 className="mt-2 text-xl font-bold">{saved.robotName} is ready to share</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your public sales page will use the {theme.name} theme and show the payment options you completed.</p><div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-3"><Link2 className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{publicLink}</span><button type="button" onClick={() => navigator.clipboard?.writeText(publicLink)} className="shrink-0 rounded-lg bg-secondary p-2 hover:bg-secondary/80" aria-label="Copy website link"><Check className="size-4" /></button></div><a href={publicLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline">Open generated link <ExternalLink className="size-4" /></a></section>}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, subtitle, suffix }: { icon: React.ReactNode; title: string; subtitle: string; suffix?: string }) {
  return <div><div className="flex items-center gap-2 text-sm font-bold tracking-[0.14em] text-foreground uppercase">{icon}{title}{suffix && <span className="text-xs font-medium tracking-normal text-muted-foreground normal-case">({suffix})</span>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{subtitle}</p></div>;
}

function FieldLabel({ children }: { children: React.ReactNode }) { return <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">{children}</span>; }

function LivePreview({ website, theme, publicLink }: { website: WebsiteDraft; theme: (typeof THEMES)[number]; publicLink: string }) {
  const whatsapp = website.whatsapp || "+27 82 123 4567";
  const hasIos = Boolean(website.iosPrice && website.iosLink);
  const hasPc = Boolean(website.pcPrice && website.pcLink);
  const previewStyle = { "--preview-accent": theme.accent, "--preview-surface": theme.surface, "--preview-glow": theme.glow } as CSSProperties;
  return <section className="panel overflow-hidden p-4 sm:p-5 xl:sticky xl:top-24" style={previewStyle}><div className="flex items-center gap-2 px-1 text-sm font-bold tracking-[0.14em] uppercase"><Smartphone className="size-4 text-primary" /> Live preview</div><div className="mt-4 overflow-hidden rounded-[2rem] border-8 border-zinc-800 bg-[#06090d] shadow-2xl" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,.08), 0 0 55px " + theme.glow }}><div className="min-h-[600px] p-5 sm:p-7" style={{ background: "radial-gradient(circle at 50% 0%, " + theme.glow + ", transparent 35%), linear-gradient(160deg, " + theme.surface + ", #06090d 65%)" }}><div className="text-center text-[11px] font-bold tracking-[0.24em] uppercase" style={{ color: theme.accent }}>{theme.name}</div><div className="mx-auto mt-12 flex size-28 items-center justify-center rounded-[2rem] border" style={{ color: theme.accent, borderColor: theme.accent + "66", backgroundColor: theme.surface, boxShadow: "0 0 38px " + theme.glow }}><Bot className="size-14" /></div><h3 className="mt-5 text-center text-2xl font-bold text-white">{website.robotName || "Your Robot"}</h3><p className="mt-2 text-center text-sm text-zinc-300">{website.tagline || "Your high-precision trading companion"}</p><div className="mt-6 space-y-3 text-sm leading-6 text-zinc-300">{website.description ? website.description.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="text-center italic text-zinc-500">Your bot description will appear here as you write it.</p>}</div><div className="mt-7 grid gap-2">{website.androidPrice && <PreviewButton icon={<Smartphone className="size-4" />} label="Android" value={website.currency + " " + website.androidPrice} accent={theme.accent} />}{hasIos && <PreviewButton icon={<Apple className="size-4" />} label="iOS" value={website.currency + " " + website.iosPrice} accent={theme.accent} />}{hasPc && <PreviewButton icon={<Monitor className="size-4" />} label="PC" value={website.currency + " " + website.pcPrice} accent={theme.accent} />}</div>{website.resultImages.length > 0 && <div className="mt-6 grid grid-cols-2 gap-2">{website.resultImages.map((image, index) => <img key={image.slice(-18) + index} src={image} alt="" className="aspect-video rounded-xl object-cover opacity-90" />)}</div>}<div className="mt-8 flex items-center justify-center"><span className="flex size-12 items-center justify-center rounded-full text-white" style={{ backgroundColor: "#20d866", boxShadow: "0 0 22px rgba(32,216,102,.45)" }}><MessageCircle className="size-6 fill-white" /></span></div><div className="mt-5 rounded-xl py-3 text-center text-sm font-bold text-white" style={{ background: "linear-gradient(90deg, " + theme.accent + ", #ff8a26)" }}>Buy Now</div></div></div><p className="mt-3 text-center text-xs text-muted-foreground">Preview updates instantly. Save to generate the share link.</p>{publicLink && <p className="mt-1 truncate text-center text-[11px] text-primary">{publicLink}</p>}</section>;
}

function PreviewButton({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) { return <div className="flex items-center justify-between rounded-xl border px-4 py-3 text-white" style={{ borderColor: accent + "55", backgroundColor: accent + "18" }}><span className="flex items-center gap-2 text-sm font-bold">{icon}{label}</span><span className="text-xs font-bold" style={{ color: accent }}>{value}</span></div>; }

function buildPublicLink(username: string, robotName: string) { const slug = (username + "-" + robotName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return "https://ea-migrate-pro.com/mentor/" + (slug || "your-robot"); }

function readFileAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
