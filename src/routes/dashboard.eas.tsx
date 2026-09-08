import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Code2, ImageIcon, Plus, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createEaRecord, setEAs, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/eas")({ ssr: false, component: ManageEAs });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 3 * 1024 * 1024;

function readAsDataUrl(file: File, maxBytes: number) {
  return new Promise<string>((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error("That file is too large for this browser prototype."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function ManageEAs() {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);
  if (!account) return null;
  const eas = account.eas;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Expert Advisors</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create and save your EA profile with its briefing, symbols, picture/logo, and optional robot video. These owner assets are never shown in the admin console.</p>
      <Button size="lg" className="mt-6 h-12 rounded-full" onClick={() => setOpen(true)}><Plus className="size-4" /> Create EA</Button>
      <h2 className="mt-8 text-lg font-semibold">Your EAs <span className="text-muted-foreground">({eas.length})</span></h2>
      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center"><span className="flex size-14 items-center justify-center rounded-full bg-primary/12"><Code2 className="size-6 text-primary" /></span><p className="font-semibold">No EAs yet</p><p className="max-w-sm text-sm text-muted-foreground">Create a profile with a codename, briefing, symbols, picture/logo, and optional video.</p></div>
      ) : (
        <ul className="mt-4 space-y-3">{eas.map((ea) => <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5"><div className="flex min-w-0 items-center gap-3">{ea.image ? <img src={ea.image} alt="" className="size-14 rounded-2xl object-cover" /> : <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Code2 className="size-5 text-primary" /></span>}<div className="min-w-0"><p className="font-semibold">{ea.name}</p><p className="truncate text-xs text-muted-foreground">{ea.symbols?.join(", ") || "No symbols"}</p><p className="text-xs text-muted-foreground">{ea.video ? "Logo and video saved" : "Logo saved · No video"}</p></div></div><Button variant="ghost" size="icon" aria-label={"Delete " + ea.name} onClick={() => setEAs(account.id, eas.filter((item) => item.id !== ea.id))}><Trash2 className="size-4" /></Button></li>)}</ul>
      )}
      <CreateEaDialog open={open} onOpenChange={setOpen} onCreate={(ea) => { setEAs(account.id, [...eas, ea]); toast.success(ea.name + " saved privately"); }} />
    </div>
  );
}

function CreateEaDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (value: boolean) => void; onCreate: (ea: ExpertAdvisor) => void }) {
  const [name, setName] = useState("");
  const [briefing, setBriefing] = useState("");
  const [symbol, setSymbol] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [image, setImage] = useState<string>();
  const [video, setVideo] = useState<string>();
  const [imageName, setImageName] = useState("");
  const [videoName, setVideoName] = useState("");
  const [error, setError] = useState("");

  const label = "text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase";
  const field = "mt-2 w-full rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60";
  const reset = () => { setName(""); setBriefing(""); setSymbol(""); setSymbols([]); setImage(undefined); setVideo(undefined); setImageName(""); setVideoName(""); setError(""); };
  const chooseFile = (file: File | undefined, kind: "image" | "video") => {
    if (!file) return;
    setError("");
    readAsDataUrl(file, kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES).then((data) => { if (kind === "image") { setImage(data); setImageName(file.name); } else { setVideo(data); setVideoName(file.name); } }).catch((reason: Error) => setError(reason.message));
  };
  const addSymbol = () => { const clean = symbol.trim().toUpperCase(); if (!clean || symbols.includes(clean)) return; setSymbols((current) => [...current, clean]); setSymbol(""); };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-border/60 bg-card p-6 sm:max-w-md"><div className="flex items-start"><div className="flex-1"><div className="flex items-center gap-3"><img src="/botlogic-mascot.jpg?v=2" alt="EA Migrate Pro" className="size-12 rounded-2xl object-cover" /><DialogTitle className="text-xl font-bold">Create Expert Advisor</DialogTitle></div><p className="mt-2 text-sm text-muted-foreground">Save the profile that your clients will see in the app.</p></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-muted-foreground"><X className="size-5" /></button></div>
    <form className="mt-6 space-y-5" onSubmit={(event) => { event.preventDefault(); setError(""); if (!name.trim()) { setError("Enter a codename for your EA."); return; } if (!image) { setError("Choose a picture/logo before deploying."); return; } onCreate({ ...createEaRecord(name), briefing: briefing.trim(), symbols, image, video }); reset(); onOpenChange(false); }}>
      <label className="block"><span className={label}>Codename</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. SPECTER_V9" className={field + " h-14"} /></label>
      <label className="block"><span className={label}>Briefing</span><textarea value={briefing} onChange={(event) => setBriefing(event.target.value)} placeholder="Operational profile of this unit" rows={4} className={field + " resize-none py-4"} /></label>
      <div><p className={label}>Symbols</p><div className="mt-2 flex gap-3"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSymbol(); } }} placeholder="e.g. XAUUSD" className="h-14 flex-1 rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60" /><button type="button" onClick={addSymbol} className="h-14 rounded-2xl bg-secondary px-6 text-sm font-bold">Add</button></div>{symbols.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{symbols.map((item) => <button type="button" key={item} onClick={() => setSymbols((current) => current.filter((value) => value !== item))} className="flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">{item}<X className="size-3" /></button>)}</div>}</div>
      <div><p className={label}>Image</p><label className="mt-2 flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 text-sm text-muted-foreground"><ImageIcon className="size-6" />{imageName || "Click to upload image (max 5MB)"}<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "image")} /></label></div>
      <div><p className={label}>Robot Video — Optional; shown in the app instead of the image</p><label className="mt-2 flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 text-sm text-muted-foreground"><Video className="size-6" />{videoName || "Click to upload video (optional, max 3MB)"}<input type="file" accept="video/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "video")} /></label></div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button type="submit" className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground glow-ring">Deploy</button>
    </form>
  </DialogContent></Dialog>;
}
