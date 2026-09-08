import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addLicense, generateKey, useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/licenses")({
  ssr: false,
  component: Licenses,
});

const EXPIRY_OPTIONS = ["Lifetime", "3 Days", "3 Months", "6 Months", "9 Months", "1 Year"];

function Licenses() {
  const account = useCurrentAccount();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [expertAdvisor, setExpertAdvisor] = useState("");
  const [expiry, setExpiry] = useState("Lifetime");
  const [formError, setFormError] = useState("");
  if (!account) return null;

  const licenseLimit = account.licenseLimit;
  const canCreate = licenseLimit > account.licenses.length;

  const resetForm = () => {
    setKeyName("");
    setClientEmail("");
    setExpertAdvisor("");
    setExpiry("Lifetime");
    setFormError("");
  };

  const submitLicense = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!keyName.trim()) {
      setFormError("Key name is required.");
      return;
    }
    const key = generateKey();
    const result = addLicense(account.id, expiry, key, {
      name: keyName.trim(),
      clientEmail: clientEmail.trim() || undefined,
      expertAdvisor: expertAdvisor || undefined,
      expiry,
    });
    if (result.error) {
      setFormError(result.error);
      return;
    }
    setCreateOpen(false);
    resetForm();
    setCopied(false);
    setCreatedKey(key);
    toast.success("License key created");
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast.success("License key copied");
    } catch {
      toast.error("Copy failed — select the key manually.");
    }
  };

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">License Keys</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Create client license keys for your Expert Advisors.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {account.licenses.length} keys generated · {account.licenses.filter((l) => l.active).length} active
      </p>

      <Button
        size="lg"
        className="mt-6 h-12 rounded-full"
        disabled={!canCreate}
        onClick={() => {
          setFormError("");
          setCreateOpen(true);
        }}
      >
        <Plus className="size-4" /> Create license key
      </Button>

      {!canCreate && (
        <p className="mt-3 text-sm text-muted-foreground">
          {licenseLimit === 0
            ? "Ask the admin to set your license allowance."
            : "You have used all licenses allowed for this account."}
        </p>
      )}

      {account.licenses.length === 0 ? (
        <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <KeyRound className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No license keys yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first client key when your allowance is enabled by the admin.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {account.licenses.map((l) => (
            <li key={l.id} className="panel flex items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="font-semibold">{l.name || "Client license key"}</p>
                <p className="break-all font-mono text-sm text-primary">{l.key}</p>
                <p className="text-sm text-muted-foreground">
                  {l.expiry || l.plan} · {l.clientEmail || "No client email"}
                </p>
              </div>
              <span className={l.active ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary" : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"}>
                {l.active ? "Active" : "Paused"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none border-0 bg-background p-6 sm:max-w-md sm:rounded-3xl sm:border sm:border-border/60">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-2xl font-bold">Create License Key</DialogTitle>
              <p className="mt-2 text-base text-muted-foreground">Generate a new key for your client</p>
            </div>
            <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close" className="text-2xl leading-none text-muted-foreground hover:text-foreground">
              <X className="size-5" />
            </button>
          </div>

          <form className="mt-8 space-y-5" onSubmit={submitLicense}>
            <label className="block">
              <span className="text-base font-medium">Key Name</span>
              <input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Client #1 Key"
                className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </label>

            <label className="block">
              <span className="text-base font-medium">Client Email <span className="text-muted-foreground">(optional)</span></span>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@email.com"
                className="mt-2 h-14 w-full rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </label>

            <label className="block">
              <span className="text-base font-medium">Expert Advisor</span>
              <select
                value={expertAdvisor}
                onChange={(e) => setExpertAdvisor(e.target.value)}
                className="mt-2 h-14 w-full appearance-none rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none focus:border-primary"
              >
                <option value="">Choose an EA</option>
                {account.eas.map((ea) => <option key={ea.id} value={ea.name}>{ea.name}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-base font-medium">Expiry Period</span>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="mt-2 h-14 w-full appearance-none rounded-2xl border border-border/70 bg-card/60 px-4 text-base outline-none focus:border-primary"
              >
                {EXPIRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button type="submit" className="h-14 w-full rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring">
              <KeyRound className="size-4" /> Generate Key
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(createdKey)} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md">
          <DialogTitle className="text-center text-2xl font-bold">License key created</DialogTitle>
          <div className="mt-5 rounded-3xl border border-primary/30 bg-background/60 p-6 text-center glow-ring">
            <img src="/botlogic-mascot.png" alt="EA Migrate Pro" className="mx-auto size-20 object-contain" />
            <p className="mt-3 text-lg font-black uppercase tracking-wide">
              EA <span className="text-primary">Migrate</span> Pro
            </p>
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-2">
              <span className="min-w-0 flex-1 break-all px-2 font-mono text-sm font-bold text-primary">{createdKey}</span>
              <Button type="button" size="icon" variant="secondary" onClick={copyKey} aria-label="Copy license key">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button type="button" className="mt-5 h-12 w-full rounded-full" onClick={() => setCreatedKey(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
