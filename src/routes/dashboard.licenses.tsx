import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { addLicense, generateKey, useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/licenses")({
  ssr: false,
  component: Licenses,
});

function Licenses() {
  const account = useCurrentAccount();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!account) return null;

  const licenseLimit = account.licenseLimit;
  const canCreate = licenseLimit > account.licenses.length;

  const createLicense = () => {
    const key = generateKey();
    const result = addLicense(account.id, "Pro", key);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setCopied(false);
    setCreatedKey(key);
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
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Access</p>
      <h1 className="mt-1 text-3xl font-bold">Licenses</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Licence keys issued to your portal by the EA Migrate Pro admin team.
      </p>

      <div className="panel mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">Your license allowance</p>
          <p className="mt-1 text-2xl font-bold text-primary">
            {account.licenses.length} <span className="text-base text-muted-foreground">/ {licenseLimit}</span>
          </p>
        </div>
        <p className="max-w-xs text-right text-xs text-muted-foreground">
          The admin controls how many keys this mentor account can create.
        </p>
      </div>

      <Button size="lg" className="mt-6 h-12 rounded-full" disabled={!canCreate} onClick={createLicense}>
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
          <p className="font-semibold">No licences yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create a key when your allowance is enabled by the admin.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {account.licenses.map((l) => (
            <li key={l.id} className="panel flex items-center justify-between gap-3 p-5">
              <div>
                <p className="font-mono text-sm font-semibold text-primary">{l.key}</p>
                <p className="text-sm text-muted-foreground">
                  {l.plan} · issued {new Date(l.issuedAt).toLocaleDateString()}
                </p>
              </div>
              <span className={l.active ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary" : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"}>
                {l.active ? "Active" : "Paused"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(createdKey)} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md">
          <DialogTitle className="text-center text-2xl font-bold">License key created</DialogTitle>
          <div className="mt-5 rounded-3xl border border-primary/30 bg-background/60 p-6 text-center glow-ring">
            <img src="/botlogic-mascot.png" alt="Razor Market Broker" className="mx-auto size-20 object-contain" />
            <p className="mt-3 text-lg font-black uppercase tracking-wide">
              Razor <span className="text-primary">Market Broker</span>
            </p>
            <p className="mt-1 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              EA Migrate Pro license
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
