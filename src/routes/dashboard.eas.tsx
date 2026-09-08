import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Code2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createEaRecord, setEAs, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/eas")({ ssr: false, component: ManageEAs });

function ManageEAs() {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);
  if (!account) return null;
  const eas = account.eas;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Expert Advisors</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create private EA records by display name. No strategy files are uploaded or stored here.</p>
      <Button size="lg" className="mt-6 h-12 rounded-full" onClick={() => setOpen(true)}><Plus className="size-4" /> Create EA</Button>
      <h2 className="mt-8 text-lg font-semibold">Your EAs <span className="text-muted-foreground">({eas.length})</span></h2>
      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12"><Code2 className="size-6 text-primary" /></span>
          <p className="font-semibold">No EAs yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Add a display name to create your first private EA identity.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {eas.map((ea) => (
            <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5">
              <div className="min-w-0"><p className="font-semibold">{ea.name}</p><p className="font-mono text-xs text-muted-foreground">{ea.id}</p></div>
              <Button variant="ghost" size="icon" aria-label={"Delete " + ea.name} onClick={() => setEAs(account.id, eas.filter((item) => item.id !== ea.id))}><Trash2 className="size-4" /></Button>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md">
        <div className="flex items-start"><div className="flex-1"><DialogTitle className="text-xl font-bold">Create EA</DialogTitle><p className="mt-2 text-sm text-muted-foreground">Use a display name only. No EX4, EX5, image, video, or strategy upload is accepted.</p></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="text-muted-foreground"><X className="size-5" /></button></div>
        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) { toast.error("Enter a display name for your EA."); return; } onCreate(createEaRecord(name)); setName(""); onOpenChange(false); }}>
          <label className="block"><span className="text-sm font-semibold">EA Display Name</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Scalper" className="mt-2 h-14 w-full rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60" /></label>
          <button type="submit" className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground glow-ring">Create private EA</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
