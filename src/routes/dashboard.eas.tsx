import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Code2, ImageIcon, Plus, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createEaRecord, setEAs, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/eas")({ ssr: false, component: ManageEAs });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

function readAsDataUrl(file: File, maxBytes: number) {
  return new Promise<string>((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error("That file is too large for this local prototype."));
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
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create a private EA with a display name, picture, and video. These owner assets are never shown in the admin console.</p>
      <Button size="lg" className="mt-6 h-12 rounded-full" onClick={() => setOpen(true)}><Plus className="size-4" /> Create EA</Button>
      <h2 className="mt-8 text-lg font-semibold">Your EAs <span className="text-muted-foreground">({eas.length})</span></h2>
      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center"><span className="flex size-14 items-center justify-center rounded-full bg-primary/12"><Code2 className="size-6 text-primary" /></span><p className="font-semibold">No EAs yet</p><p className="max-w-sm text-sm text-muted-foreground">Add your EA name, picture, and video to create a private identity.</p></div>
      ) : (
        <ul className="mt-4 space-y-3">{eas.map((ea) => <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5"><div className="flex min-w-0 items-center gap-3">{ea.image ? <img src={ea.image} alt="" className="size-14 rounded-2xl object-cover" /> : <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Code2 className="size-5 text-primary" /></span>}<div className="min-w-0"><p className="font-semibold">{ea.name}</p><p className="font-mono text-xs text-muted-foreground">{ea.id}</p><p className="text-xs text-muted-foreground">Picture and video saved</p></div></div><Button variant="ghost" size="icon" aria-label={"Delete " + ea.name} onClick={() => setEAs(account.id, eas.filter((item) => item.id !== ea.id))}><Trash2 className="size-4" /></Button></li>)}</ul>
      )}
      <CreateEaDialog open={open} onOpenChange={setOpen} onCreate={(ea) => { setEAs(account.id, [...eas, ea]); toast.success(ea.name + " saved privately"); }} />
    </div>
  );
}

function CreateEaDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (value: boolean) => void; onCreate: (ea: ExpertAdvisor) => void }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState<string>();
  const [video, setVideo] = useState<string>();
  const [imageName, setImageName] = useState("");
  const [videoName, setVideoName] = useState("");
  const [error, setError] = useState("");

  const reset = () => { setName(""); setImage(undefined); setVideo(undefined); setImageName(""); setVideoName(""); setError(""); };
  const chooseFile = (file: File | undefined, kind: "image" | "video") => {
    if (!file) return;
    setError("");
    readAsDataUrl(file, kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES).then((data) => { if (kind === "image") { setImage(data); setImageName(file.name); } else { setVideo(data); setVideoName(file.name); } }).catch((reason: Error) => setError(reason.message));
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-border/60 bg-card p-6 sm:max-w-md"><div className="flex items-start"><div className="flex-1"><DialogTitle className="text-xl font-bold">Create EA</DialogTitle><p className="mt-2 text-sm text-muted-foreground">Add a name, picture, and video. The admin sees only a masked EA ID.</p></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-muted-foreground"><X className="size-5" /></button></div>
    <form className="mt-6 space-y-5" onSubmit={(event) => { event.preventDefault(); setError(""); if (!name.trim()) { setError("Enter a display name for your EA."); return; } if (!image || !video) { setError("Choose both a picture and a video before saving."); return; } onCreate({ ...createEaRecord(name), image, video }); reset(); onOpenChange(false); }}>
      <label className="block"><span className="text-sm font-semibold">EA Display Name</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Scalper" className="mt-2 h-14 w-full rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60" /></label>
      <label className="block"><span className="text-sm font-semibold">Picture</span><span className="mt-2 flex h-28 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border/70 px-4 text-sm text-muted-foreground"><ImageIcon className="size-6 text-primary" />{imageName || "Choose an EA picture (max 5 MB)"}<input type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "image")} /></span></label>
      <label className="block"><span className="text-sm font-semibold">Video</span><span className="mt-2 flex h-28 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border/70 px-4 text-sm text-muted-foreground"><Video className="size-6 text-primary" />{videoName || "Choose an EA video (max 20 MB)"}<input type="file" accept="video/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0], "video")} /></span></label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button type="submit" className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground glow-ring">Save EA</button>
    </form>
  </DialogContent></Dialog>;
}
