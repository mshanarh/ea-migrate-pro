import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addLicense, generateKey, useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/licenses")({ ssr: false, component: Licenses });
const EXPIRY_OPTIONS = ["Lifetime", "1 Week", "1 Month", "3 Months", "6 Months", "1 Year"];

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
    return <div className="max-w-2xl"><button type="button" onClick={() => setCreateOpen(false)} className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to Generate Key</button><p className="mt-8 text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace / Generate Key</p><h1 className="mt-1 text-3xl font-bold">Generate Key</h1><p className="mt-2 text-sm text-muted-foreground">Create an enabled key for one client and bind it to one of your private Expert Advisors.</p><div className="mt-6 grid grid-cols-3 gap-3"><div className="panel p-4"><p className="text-xs text-muted-foreground">Keys used</p><p className="mt-1 text-2xl font-bold">{used}</p></div><div className="panel p-4"><p className="text-xs text-muted-foreground">Allowed</p><p className="mt-1 text-2xl font-bold">{allowed}</p></div><div className="panel p-4"><p className="text-xs text-muted-foreground">Remaining</p><p className="mt-1 text-2xl font-bold text-primary">{remaining}</p></div></div><form className="panel mt-6 space-y-5 p-6" onSubmit={submitLicense}><label className="block"><span className="text-sm font-semibold">Client Name <span className="text-destructive">*</span></span><input required value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="e.g. Client #1" className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none placeholder:text-muted-foreground focus:border-primary" /></label><label className="block"><span className="text-sm font-semibold">Client Email <span className="text-muted-foreground">(optional)</span></span><input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="client@email.com" className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none placeholder:text-muted-foreground focus:border-primary" /></label><label className="block"><span className="text-sm font-semibold">Expert Advisor</span><select required value={eaId} onChange={(event) => setEaId(event.target.value)} className="mt-2 h-14 w-full appearance-none rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none focus:border-primary"><option value="">Choose an EA</option>{account.eas.map((ea) => <option key={ea.id} value={ea.id}>{ea.name}</option>)}</select></label><label className="block"><span className="text-sm font-semibold">Expiry Period</span><select value={expiry} onChange={(event) => setExpiry(event.target.value)} className="mt-2 h-14 w-full appearance-none rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none focus:border-primary">{EXPIRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>{account.eas.length === 0 && <p className="text-sm text-muted-foreground">Create an EA profile first from <Link to="/dashboard/eas" className="font-semibold text-primary">Manage EAs</Link>.</p>}{formError && <p className="text-sm text-destructive">{formError}</p>}<Button type="submit" disabled={remaining === 0 || account.eas.length === 0} className="h-14 w-full rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring"><KeyRound className="size-4" /> Generate Key</Button></form></div>;
  }

   return <div><p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p><h1 className="mt-1 text-3xl font-bold">Generate Key</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Create client keys from the allowance set by your admin. New keys are enabled by default.</p><div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-primary/25 bg-primary/5 p-5"><div className="flex gap-6"><div><p className="text-xs text-muted-foreground">Keys used</p><p className="mt-1 text-2xl font-bold">{used}</p></div><div><p className="text-xs text-muted-foreground">Total allowed</p><p className="mt-1 text-2xl font-bold">{allowed}</p></div><div><p className="text-xs text-muted-foreground">Keys remaining</p><p className="mt-1 text-2xl font-bold text-primary">{remaining}</p></div></div><Button size="lg" className="h-12 rounded-full" disabled={remaining === 0} onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Generate key</Button></div>{account.eas.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Create an EA profile before generating a key.</p>}{remaining === 0 && allowed > 0 && <p className="mt-3 text-sm text-muted-foreground">You have used all keys allowed for this account.</p>}{allowed === 0 && <p className="mt-3 text-sm text-muted-foreground">Your admin has not set a key allowance yet.</p>}{account.licenses.length === 0 ? <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center"><span className="flex size-14 items-center justify-center rounded-full bg-primary/12"><KeyRound className="size-6 text-primary" /></span><p className="font-semibold">No license keys yet</p><p className="max-w-sm text-sm text-muted-foreground">Your generated keys will appear here.</p></div> : <ul className="mt-6 space-y-3">{account.licenses.map((license) => <li key={license.id} className="panel flex items-center justify-between gap-3 p-5"><div className="min-w-0"><p className="font-semibold">{license.name || "Client license key"}</p><p className="break-all font-mono text-sm text-primary">{license.key}</p><p className="text-sm text-muted-foreground">{account.eas.find((ea) => ea.id === license.eaId)?.name || "Private EA"} · {license.expiry || license.plan} · {license.clientEmail || "No client email"}</p></div><span className={license.active ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary" : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"}>{license.active ? "Active" : "Paused"}</span></li>)}</ul>}
    <Dialog open={Boolean(createdKey)} onOpenChange={(open) => !open && setCreatedKey(null)}><DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md"><DialogTitle className="text-center text-2xl font-bold">License key created</DialogTitle><div className="mt-5 rounded-3xl border border-primary/30 bg-background/60 p-6 text-center glow-ring"><p className="text-lg font-black uppercase tracking-wide">EA <span className="text-primary">Migrate</span> Pro</p><div className="mt-6 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-2"><span className="min-w-0 flex-1 break-all px-2 font-mono text-sm font-bold text-primary">{createdKey}</span><Button type="button" size="icon" variant="secondary" onClick={copyKey} aria-label="Copy license key">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button></div><Button type="button" className="mt-5 h-12 w-full rounded-full" onClick={() => setCreatedKey(null)}>Done</Button></div></DialogContent></Dialog>
  </div>;
}
