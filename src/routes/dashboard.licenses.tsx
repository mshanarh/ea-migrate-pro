import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addLicense, generateKey, useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/licenses")({ ssr: false, component: Licenses });

const EXPIRY_OPTIONS = ["Lifetime", "1 Year", "6 Months", "1 Month", "3 Months", "1 Week"];

function Licenses() {
  const account = useCurrentAccount();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [eaId, setEaId] = useState("");
  const [expiry, setExpiry] = useState("Lifetime");
  const [formError, setFormError] = useState("");
  if (!account) return null;

  const used = account.licenses.length;
  const allowed = account.licenseLimit;
  const remaining = Math.max(allowed - used, 0);
  const selectedEa = account.eas.find((ea) => ea.id === eaId);
  const resetForm = () => { setKeyName(""); setClientEmail(""); setEaId(""); setExpiry("Lifetime"); setFormError(""); };
  const submitLicense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError("");
    if (!keyName.trim()) { setFormError("Key name is required."); return; }
    if (!selectedEa) { setFormError("Choose an Expert Advisor."); return; }
    const key = generateKey();
    const result = addLicense(account.id, expiry, key, { name: keyName.trim(), clientEmail: clientEmail.trim() || undefined, eaId: selectedEa.id, eaNameHash: selectedEa.eaNameHash, expiry });
    if (result.error) { setFormError(result.error); return; }
    setCreateOpen(false); resetForm(); setCopied(false); setCreatedKey(key); toast.success("License key created");
  };
  const copyKey = async () => { if (!createdKey) return; try { await navigator.clipboard.writeText(createdKey); setCopied(true); toast.success("License key copied"); } catch { toast.error("Copy failed — select the key manually."); } };

  if (createOpen) {
    return <div className="max-w-2xl"><button type="button" onClick={() => setCreateOpen(false)} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back</button>
      <div className="panel mt-6 px-6 py-10">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-28 items-center justify-center rounded-3xl bg-primary/15 text-primary shadow-[0_0_60px_rgba(0,168,255,0.35)]"><KeyRound className="size-14" /></span>
          <h1 className="mt-6 text-4xl font-black">Generate License</h1>
          <p className="mt-2 text-sm font-bold uppercase tracking-[0.24em] text-white/45">Create new license key</p>
        </div>
        <form className="mt-8 space-y-4" onSubmit={submitLicense}>
          <input required value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Client name" className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60" />
          <input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="Client email (optional — key will be linked)" className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60" />
          <select required value={eaId} onChange={(event) => setEaId(event.target.value)} className="h-16 w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none focus:border-primary/60">
            <option value="">Select an EA</option>
            {account.eas.map((ea) => <option key={ea.id} value={ea.id}>{ea.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-3 pt-1">
            {EXPIRY_OPTIONS.map((option) => (
              <button type="button" key={option} onClick={() => setExpiry(option)} className={`h-12 rounded-2xl px-5 text-sm font-bold transition-colors ${expiry === option ? "bg-primary text-primary-foreground glow-ring" : "border border-white/10 bg-white/[0.04] text-white/70 hover:border-primary/40"}`}>{option}</button>
            ))}
          </div>
          {account.eas.length === 0 && <p className="text-sm text-muted-foreground">Create an EA profile first from <Link to="/dashboard/eas" className="font-semibold text-primary">Manage EAs</Link>.</p>}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <button type="submit" disabled={remaining === 0 || account.eas.length === 0} className="h-16 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-lg font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.35)] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">Generate Key</button>
        </form>
        <p className="mt-6 text-center text-sm text-white/55">Total keys generated: <span className="font-bold text-white">{used}</span></p>
      </div>
    </div>;
  }

  return <div>
    <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
    <h1 className="mt-1 text-3xl font-bold">Generate Key</h1>
    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create client keys from the allowance set by your admin. New keys are enabled by default.</p>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-primary/25 bg-primary/5 p-5">
      <div className="flex gap-6">
        <div><p className="text-xs text-muted-foreground">Keys used</p><p className="mt-1 text-2xl font-bold">{used}</p></div>
        <div><p className="text-xs text-muted-foreground">Total allowed</p><p className="mt-1 text-2xl font-bold">{allowed}</p></div>
        <div><p className="text-xs text-muted-foreground">Keys remaining</p><p className="mt-1 text-2xl font-bold text-primary">{remaining}</p></div>
      </div>
      <Button size="lg" className="h-12 rounded-full" disabled={remaining === 0} onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Generate key</Button>
    </div>
    {account.eas.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Create an EA profile before generating a key.</p>}
    {remaining === 0 && allowed > 0 && <p className="mt-3 text-sm text-muted-foreground">You have used all keys allowed for this account.</p>}
    {allowed === 0 && <p className="mt-3 text-sm text-muted-foreground">Your admin has not set a key allowance yet.</p>}
    {account.licenses.length === 0 ? <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center"><span className="flex size-14 items-center justify-center rounded-full bg-primary/12"><KeyRound className="size-6 text-primary" /></span><p className="font-semibold">No license keys yet</p><p className="max-w-sm text-sm text-muted-foreground">Your generated keys will appear here.</p></div> : <ul className="mt-6 space-y-3">{account.licenses.map((license) => <li key={license.id} className="panel flex items-center justify-between gap-3 p-5"><div className="min-w-0"><p className="font-semibold">{license.name || "Client license key"}</p><p className="break-all font-mono text-sm text-primary">{license.key}</p><p className="text-sm text-muted-foreground">{account.eas.find((ea) => ea.id === license.eaId)?.name || "Private EA"} · {license.expiry || license.plan} · {license.clientEmail || "No client email"}</p></div><span className={license.active ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary" : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"}>{license.active ? "Active" : "Paused"}</span></li>)}</ul>}
    <Dialog open={Boolean(createdKey)} onOpenChange={(open) => !open && setCreatedKey(null)}><DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md"><DialogTitle className="text-center text-2xl font-bold">License key created</DialogTitle><div className="mt-5 rounded-3xl border border-primary/30 bg-background/60 p-6 text-center glow-ring"><p className="text-lg font-black uppercase tracking-wide">EA <span className="text-primary">Migrate</span> Pro</p><div className="mt-6 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-2"><span className="min-w-0 flex-1 break-all px-2 font-mono text-sm font-bold text-primary">{createdKey}</span><Button type="button" size="icon" variant="secondary" onClick={copyKey} aria-label="Copy license key">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div><Button type="button" className="mt-5 h-12 w-full rounded-full" onClick={() => setCreatedKey(null)}>Done</Button></div></DialogContent></Dialog>
  </div>;
}
