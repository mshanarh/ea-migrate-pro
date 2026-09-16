import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, ImageIcon, Plus, Trash2, Video, X } from "lucide-react";
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
  const tierLabel = account.role === "admin" ? "Admin" : "Tier 1";

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Manage EAs</h1>
          <p className="mt-2 max-w-md text-base text-white/60">Create and manage your Expert Advisors</p>
          <p className="mt-1 text-sm font-bold text-primary">{tierLabel} — {eas.length} EA{eas.length === 1 ? "" : "s"} created</p>
        </div>
        <Button
          size="lg"
          className="h-14 rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] px-7 text-base font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.3)]"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-5" /> Create EA
        </Button>
      </div>

      {eas.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-14 text-center">
          <Bot className="size-14 text-white/25" />
          <p className="text-lg text-white/55">No EAs created yet. Click "Create EA" to get started.</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {eas.map((ea) => (
            <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5">
              <div className="flex min-w-0 items-center gap-3">
                {ea.image ? <img src={ea.image} alt="" className="size-14 rounded-2xl object-cover" /> : <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Bot className="size-5 text-primary" /></span>}
                <div className="min-w-0">
                  <p className="font-semibold">{ea.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{ea.symbols?.join(", ") || "No symbols"}</p>
                  <p className="text-xs text-muted-foreground">{ea.video ? "Logo and video saved" : "Logo saved · No video"}</p>
                </div>
              </div>
              <button type="button" aria-label={"Delete " + ea.name} onClick={() => setEAs(account.id, eas.filter((item) => item.id !== ea.id))} className="flex size-10 items-center justify-center rounded-full bg-white/5 text-white/60 hover:text-red-300">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
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

  const label = "text-sm font-bold text-white/80";
  const field = "mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60";
  const reset = () => { setName(""); setBriefing(""); setSymbol(""); setSymbols([]); setImage(undefined); setVideo(undefined); setImageName(""); setVideoName(""); setError(""); };
  const chooseFile = (file: File | undefined, kind: "image" | "video") => {
    if (!file) return;
    setError("");
    readAsDataUrl(file, kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES).then((data) => { if (kind === "image") { setImage(data); setImageName(file.name); } else { setVideo(data); setVideoName(file.name); } }).catch((reason: Error) => setError(reason.message));
  };
  const addSymbol = () => { const clean = symbol.trim().toUpperCase(); if (!clean || symbols.includes(clean)) return; setSymbols((current) => [...current, clean]); setSymbol(""); };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-white/10 bg-[#141414] p-6 sm:max-w-md"><div className="flex items-start justify-between"><DialogTitle className="text-2xl font-black">New Expert Advisor</DialogTitle><button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-white/50 hover:text-white"><X className="size-5" /></button></div>
    <form className="mt-6 space-y-5" onSubmit={(event) => { event.preventDefault(); setError(""); if (!name.trim()) { setError("Enter a codename for your EA."); return; } if (!image) { setError("Choose a picture/logo before saving."); return; } onCreate({ ...createEaRecord(name), briefing: briefing.trim(), symbols, image, video }); reset(); onOpenChange(false); }}>
      <div><p className={label}>EA Name</p><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Gold Scalper Pro" className={field + " h-14"} /></div>
      <div><p className={label}>Briefing</p><textarea value={briefing} onChange={(event) => setBriefing(event.target.value)} placeholder="Operational profile of this EA" rows={3} className={field + " resize-none py-4"} /></div>
      <div><p className={label}>EA Image</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex size-20 items-center justify-center rounded-2xl border border-dashed border-white/20 text-white/40">{image ? <img src={image} alt="" className="size-full rounded-2xl object-cover" /> : <ImageIcon className="size-6" />}</span>
          <label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20"><ImageIcon className="size-4" /> Upload Image<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "image")} /></label>
        </div>
      </div>
      <div><p className={label}>EA Video / GIF <span className="text-sm font-bold text-primary">Unlocked</span></p>
        <div className="mt-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-center text-sm text-white/40">{video ? <video src={video} className="mx-auto max-h-32 rounded-xl" controls /> : videoName || "No video"}</div>
        <label className="mt-3 flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20"><Video className="size-4" /> Upload Video / GIF<input type="file" accept="video/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "video")} /></label>
        <p className="mt-2 text-xs text-white/40">Max 25 MB. MP4 / WebM / GIF recommended.</p>
      </div>
      <div><p className={label}>Symbols</p><div className="mt-2 flex gap-3"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSymbol(); } }} placeholder="e.g. XAUUSD" className={field + " h-14 flex-1"} /><button type="button" onClick={addSymbol} className="h-14 rounded-2xl bg-primary px-7 text-base font-black text-primary-foreground">Add</button></div>{symbols.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{symbols.map((item) => <button type="button" key={item} onClick={() => setSymbols((current) => current.filter((value) => value !== item))} className="flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">{item}<X className="size-3" /></button>)}</div>}</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button type="submit" className="h-14 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-base font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.3)] transition-transform active:scale-[0.99]">Save EA</button>
    </form>
  </DialogContent></Dialog>;
}
