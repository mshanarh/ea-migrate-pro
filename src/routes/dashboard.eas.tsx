import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ImageIcon, Lock, Pencil, Plus, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createEaRecord, renameEa, setEAs, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/eas")({ ssr: false, component: ManageEAs });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function readAsDataUrl(file: File, maxBytes: number) {
  return new Promise<string>((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`That file is too large — maximum ${Math.round(maxBytes / (1024 * 1024))} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

const labelClass = "text-sm font-bold text-white/80";
const fieldClass = "mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60";

function ManageEAs() {
  const account = useCurrentAccount();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEa, setEditingEa] = useState<ExpertAdvisor | null>(null);
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
          className="h-14 rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] px-7 text-base font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.3)] transition-transform active:scale-[0.98]"
          onClick={() => setCreateOpen(true)}
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
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {eas.map((ea) => (
              <motion.li
                key={ea.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                whileHover={{ y: -3 }}
                className="panel group relative flex items-center gap-4 overflow-hidden p-5"
              >
                <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                {ea.image ? <img src={ea.image} alt="" className="size-14 shrink-0 rounded-2xl object-cover" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10"><Bot className="size-5 text-primary" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{ea.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{ea.symbols?.join(", ") || "No symbols"}</p>
                  <p className="text-xs text-muted-foreground">{ea.video ? "Logo and video saved" : "Logo saved · No video"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" aria-label={"Edit " + ea.name} onClick={() => setEditingEa(ea)} className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20">
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" aria-label={"Delete " + ea.name} onClick={() => { setEAs(account.id, eas.filter((item) => item.id !== ea.id)); toast.success(ea.name + " removed"); }} className="flex size-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-red-400/10 hover:text-red-300">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <CreateEaDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={(ea) => { setEAs(account.id, [...eas, ea]); toast.success(ea.name + " saved privately"); }} />
      <EditEaDialog ea={editingEa} onClose={() => setEditingEa(null)} onSave={(patch) => { if (!editingEa) return; renameEa(account.id, editingEa.id, patch); toast.success("EA updated"); }} />
    </div>
  );
}

function EaFields({ briefing, setBriefing, symbols, setSymbols, image, setImage, video, setVideo }: {
  briefing: string;
  setBriefing: (value: string) => void;
  symbols: string[];
  setSymbols: (update: (current: string[]) => string[]) => void;
  image: string | undefined;
  setImage: (value: string | undefined) => void;
  video: string | undefined;
  setVideo: (value: string | undefined) => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState("");
  const chooseFile = (file: File | undefined, kind: "image" | "video") => {
    if (!file) return;
    setError("");
    readAsDataUrl(file, kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)
      .then((data) => { if (kind === "image") setImage(data); else setVideo(data); })
      .catch((reason: Error) => setError(reason.message));
  };
  const addSymbol = () => {
    const clean = symbol.trim().toUpperCase();
    if (!clean || symbols.includes(clean)) return;
    setSymbols((current) => [...current, clean]);
    setSymbol("");
  };

  return <>
    <div><p className={labelClass}>Briefing</p><textarea value={briefing} onChange={(event) => setBriefing(event.target.value)} placeholder="Operational profile of this EA" rows={3} className={fieldClass + " resize-none py-4"} /></div>
    <div><p className={labelClass}>EA Image</p>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/20 text-white/40">{image ? <img src={image} alt="" className="size-full object-cover" /> : <ImageIcon className="size-6" />}</span>
        <label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20"><ImageIcon className="size-4" /> {image ? "Replace Image" : "Upload Image"}<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "image")} /></label>
      </div>
    </div>
    <div><p className={labelClass}>EA Video / GIF <span className="text-sm font-bold text-primary">Unlocked</span></p>
      <div className="mt-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-center text-sm text-white/40">{video ? <video src={video} className="mx-auto max-h-32 rounded-xl" controls /> : "No video"}</div>
      <label className="mt-3 flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20"><Video className="size-4" /> {video ? "Replace Video / GIF" : "Upload Video / GIF"}<input type="file" accept="video/*,image/gif" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "video")} /></label>
      <p className="mt-2 text-xs text-white/40">Any video type · Max 50 MB. MP4 / WebM / MOV / GIF all work.</p>
    </div>
    <div><p className={labelClass}>Symbols</p>
      <div className="mt-2 flex gap-3">
        <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSymbol(); } }} placeholder="e.g. XAUUSD" className={fieldClass + " h-14 flex-1"} />
        <button type="button" onClick={addSymbol} className="h-14 rounded-2xl bg-primary px-7 text-base font-black text-primary-foreground">Add</button>
      </div>
      {symbols.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{symbols.map((item) => <button type="button" key={item} onClick={() => setSymbols((current) => current.filter((value) => value !== item))} className="flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">{item}<X className="size-3" /></button>)}</div>}
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </>;
}

function CreateEaDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (value: boolean) => void; onCreate: (ea: ExpertAdvisor) => void }) {
  const [name, setName] = useState("");
  const [briefing, setBriefing] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [image, setImage] = useState<string>();
  const [video, setVideo] = useState<string>();
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) { setError("Enter a codename for your EA."); return; }
    if (!image) { setError("Choose a picture/logo before saving."); return; }
    onCreate({ ...createEaRecord(name), briefing: briefing.trim(), symbols, image, video });
    setName(""); setBriefing(""); setSymbols([]); setImage(undefined); setVideo(undefined);
    onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-white/10 bg-[#141414] p-6 sm:max-w-md">
    <div className="flex items-start justify-between"><DialogTitle className="text-2xl font-black">New Expert Advisor</DialogTitle><button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-white/50 hover:text-white"><X className="size-5" /></button></div>
    <form className="mt-6 space-y-5" onSubmit={submit}>
      <div><p className={labelClass}>EA Name</p><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Gold Scalper Pro" className={fieldClass + " h-14"} /></div>
      <EaFields briefing={briefing} setBriefing={setBriefing} symbols={symbols} setSymbols={setSymbols} image={image} setImage={setImage} video={video} setVideo={setVideo} />
      <button type="submit" className="h-14 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-base font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.3)] transition-transform active:scale-[0.99]">Save EA</button>
    </form>
  </DialogContent></Dialog>;
}

function EditEaDialog({ ea, onClose, onSave }: { ea: ExpertAdvisor | null; onClose: () => void; onSave: (patch: { briefing?: string; symbols?: string[]; image?: string; video?: string }) => void }) {
  return <Dialog open={Boolean(ea)} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-white/10 bg-[#141414] p-6 sm:max-w-md">
      {ea && <EditEaForm key={ea.id} ea={ea} onClose={onClose} onSave={onSave} />}
    </DialogContent>
  </Dialog>;
}

function EditEaForm({ ea, onClose, onSave }: { ea: ExpertAdvisor; onClose: () => void; onSave: (patch: { briefing?: string; symbols?: string[]; image?: string; video?: string }) => void }) {
  const [briefing, setBriefing] = useState(ea.briefing ?? "");
  const [symbols, setSymbols] = useState<string[]>(ea.symbols ?? []);
  const [image, setImage] = useState<string | undefined>(ea.image);
  const [video, setVideo] = useState<string | undefined>(ea.video);

  return <>
    <div className="flex items-start justify-between">
      <DialogTitle className="text-2xl font-black">Edit EA</DialogTitle>
      <button type="button" onClick={onClose} aria-label="Close" className="text-white/50 hover:text-white"><X className="size-5" /></button>
    </div>
    <form className="mt-6 space-y-5" onSubmit={(event) => { event.preventDefault(); onSave({ briefing: briefing.trim(), symbols, ...(image ? { image } : {}), ...(video ? { video } : {}) }); onClose(); }}>
      <div>
        <p className={labelClass}>EA Name</p>
        <div className="mt-2 flex h-14 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-5">
          <span className="truncate font-semibold text-white/80">{ea.name}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45"><Lock className="size-3" /> Locked</span>
        </div>
        <p className="mt-1.5 text-xs text-white/40">The EA name is permanent — clients activate licences against it.</p>
      </div>
      <EaFields briefing={briefing} setBriefing={setBriefing} symbols={symbols} setSymbols={setSymbols} image={image} setImage={setImage} video={video} setVideo={setVideo} />
      <button type="submit" className="h-14 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-base font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.3)] transition-transform active:scale-[0.99]">Save Changes</button>
    </form>
  </>;
}
