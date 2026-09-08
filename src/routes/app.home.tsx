import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftRight, Pause, Play, Plus, Trash2 } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import robot from "@/assets/app-robot.jpg.asset.json";
import { removeRobot, toggleRobot, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/home")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Robots — EA Migrate Pro" },
      { name: "description", content: "Run and manage your activated trading robots." },
      { property: "og:title", content: "My Robots — EA Migrate Pro" },
      { property: "og:description", content: "Run and manage your activated trading robots." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppHome,
});

function AppHome() {
  const app = useAppState();
  const active = app.robots[0];
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const style = app.settings.interfaceStyle;
  const heroImage = active?.image || robot.url;

  useEffect(() => {
    const handleHomeHold = () => setVideoOpen(Boolean(active?.video));
    window.addEventListener("eamp:home-hold", handleHomeHold);
    return () => window.removeEventListener("eamp:home-hold", handleHomeHold);
  }, [active?.video]);

  useEffect(() => {
    if (videoOpen) videoRef.current?.play().catch(() => undefined);
  }, [videoOpen]);
  const imageStyle = { boxShadow: "0 0 60px " + app.settings.accentColor + "66" };

  return (
    <AppFrame>
      {active ? (
        <>
          {style === "Interface 1" && (
            <div className="flex flex-col items-center text-center">
              <img src={heroImage} alt={active.name} className="size-56 rounded-full border-4 border-primary object-cover" style={imageStyle} />
              <h1 className="mt-6 text-3xl font-bold uppercase">{active.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Fully automated</p>
              <div className="mt-4 rounded-full border border-border/60 bg-card/70 px-5 py-2 text-sm font-semibold">
                Powered By <span className="text-primary">EA Migrate</span>
              </div>
            </div>
          )}

          {style === "Interface 2" && (
            <div className="relative -mx-5 overflow-hidden rounded-b-[2.5rem] border-b border-primary/40">
              <img src={heroImage} alt={active.name} className="h-80 w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" />
              <div className="absolute inset-x-6 bottom-6">
                <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Full-bleed poster</p>
                <h1 className="mt-2 text-3xl font-black uppercase">{active.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">Fully automated</p>
              </div>
            </div>
          )}

          {style === "Interface 3" && (
            <div className="grid grid-cols-[1.15fr_0.85fr] items-center gap-4 rounded-3xl border border-primary/30 bg-card/60 p-4 glow-ring">
              <img src={heroImage} alt={active.name} className="aspect-square w-full rounded-[2rem] border-4 border-primary object-cover" style={imageStyle} />
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Half-screen halo</p>
                <h1 className="mt-3 break-words text-2xl font-bold uppercase">{active.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">Fully automated</p>
              </div>
            </div>
          )}

          {style === "Interface 4" && (
            <div className="rounded-[2rem] bg-gradient-to-br from-sky-100 via-blue-200 to-primary p-5 text-slate-950 shadow-2xl">
              <p className="text-xs font-bold tracking-[0.22em] text-slate-700 uppercase">White-to-blue poster</p>
              <img src={heroImage} alt={active.name} className="mx-auto mt-6 size-52 rounded-full border-8 border-white/80 object-cover shadow-2xl" />
              <h1 className="mt-6 text-center text-3xl font-black uppercase">{active.name}</h1>
              <p className="mt-1 text-center text-sm font-semibold text-slate-700">Fully automated</p>
            </div>
          )}

          {videoOpen && active.video && (
            <div className="mt-6 overflow-hidden rounded-3xl border border-primary/40 bg-card/70 p-3 glow-ring">
              <video ref={videoRef} src={active.video} poster={active.image} controls autoPlay playsInline className="max-h-[28rem] w-full rounded-2xl object-contain" />
              <button type="button" onClick={() => setVideoOpen(false)} className="mt-3 h-11 w-full rounded-full border border-border/70 text-sm font-semibold">Close video</button>
            </div>
          )}

          <div className="mt-8 space-y-3">
            <Link to="/app/metatrader" className="panel flex h-14 items-center gap-4 rounded-full px-6 text-base font-semibold">
              <ArrowLeftRight className="size-5 text-primary" /> Pairs
            </Link>
            <div className="flex items-center gap-3">
              <button onClick={() => toggleRobot(active.id)} className="panel flex h-14 flex-1 items-center gap-4 rounded-full px-6 text-base font-semibold">
                {active.running ? <><Pause className="size-5 text-primary" /> Stop</> : <><Play className="size-5 text-primary" /> Start</>}
              </button>
              <button onClick={() => removeRobot(active.id)} aria-label="Remove robot" className="panel flex size-14 items-center justify-center rounded-full text-primary">
                <Trash2 className="size-5" />
              </button>
            </div>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">Robots List:</p>
          <ul className="mt-3 space-y-3">
            {app.robots.map((r) => (
              <li key={r.id} className="flex items-center gap-4 rounded-full border border-primary/50 bg-primary/5 p-3 pr-6">
                <img src={r.image || robot.url} alt="" className="size-12 rounded-full object-cover" />
                <span className="font-semibold text-primary">{r.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="panel mt-16 p-10 text-center">
          <p className="font-semibold">No robot yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Add a licence key to unlock your first trading robot.</p>
        </div>
      )}

      <Link to="/app/activate" className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-full border border-dashed border-primary/50 text-sm font-semibold text-primary">
        <Plus className="size-4" /> Add Another License
      </Link>
    </AppFrame>
  );
}
