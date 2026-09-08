import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Code2, ImageIcon, Plus, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { setEAs, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/eas")({
  ssr: false,
  component: ManageEAs,
});

const LEGACY_EAS_STORAGE_PREFIX = "eamp.portal.eas.v1";

function legacyEasStorageKey(accountId: string) {
  return LEGACY_EAS_STORAGE_PREFIX + "." + accountId;
}

function readLegacyEAs(accountId: string): ExpertAdvisor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(legacyEasStorageKey(accountId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((ea) => ({
      ...ea,
      createdAt: typeof ea.createdAt === "string" ? ea.createdAt : new Date().toISOString(),
    })) as ExpertAdvisor[];
  } catch {
    return [];
  }
}

function ManageEAs() {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!account || account.eas.length > 0) return;
    const legacyEAs = readLegacyEAs(account.id);
    if (legacyEAs.length > 0) setEAs(account.id, legacyEAs);
  }, [account?.id, account?.eas.length]);

  if (!account) return null;
  const eas = account.eas;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Expert Advisors</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Build, deploy and manage your trading bots. Your EAs are saved to your mentor account.
      </p>

      <Button size="lg" className="mt-6 h-12 rounded-full" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Create EA
      </Button>

      <h2 className="mt-8 text-lg font-semibold">
        Your EAs <span className="text-muted-foreground">({eas.length})</span>
      </h2>

      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <Code2 className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No EAs yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first Expert Advisor to start deploying it to your trading terminals.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {eas.map((ea) => (
            <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-semibold">{ea.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {ea.symbols.join(", ") || "No symbols"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete EA"
                onClick={() => setEAs(account.id, eas.filter((x) => x.id !== ea.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateEaDialog
        open={open}
        onOpenChange={setOpen}
        onCreate={(ea) => {
          setEAs(account.id, [...eas, ea]);
          toast.success(ea.name + " saved");
        }}
      />
    </div>
  );
}

function CreateEaDialog
  const account = useCurrentAccount();
  const accountId = account?.id ?? "";
  const [eas, setEas] = useState<EA[]>([]);
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setEas([]);
      setLoadedAccountId(null);
      return;
    }
    setEas(readEAs(accountId));
    setLoadedAccountId(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || loadedAccountId !== accountId || typeof window === "undefined") return;
    window.localStorage.setItem(easStorageKey(accountId), JSON.stringify(eas));
  }, [accountId, eas, loadedAccountId]);

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Expert Advisors</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Build, deploy and manage your trading bots.
      </p>

      <Button size="lg" className="mt-6 h-12 rounded-full" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Create EA
      </Button>

      <h2 className="mt-8 text-lg font-semibold">
        Your EAs <span className="text-muted-foreground">({eas.length})</span>
      </h2>

      {eas.length === 0 ? (
        <div className="panel mt-4 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <Code2 className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No EAs yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first Expert Advisor to start deploying it to your trading terminals.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {eas.map((ea) => (
            <li key={ea.id} className="panel flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="font-semibold">{ea.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {ea.symbols.join(", ") || "No symbols"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${ea.name}`}
                onClick={() => setEas((v) => v.filter((x) => x.id !== ea.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateEaDialog
        open={open}
        onOpenChange={setOpen}
        onCreate={(ea) => {
          setEas((v) => [...v, ea]);
          toast.success(`${ea.name} saved`);
        }}
      />
    </div>
  );
}

function CreateEaDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (ea: ExpertAdvisor) => void;
}) {
  const [name, setName] = useState("");
  const [briefing, setBriefing] = useState("");
  const [symbol, setSymbol] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [image, setImage] = useState<string | undefined>();
  const [video, setVideo] = useState<string | undefined>();

  const label = "text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase";
  const field =
    "mt-2 w-full rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60";

  const reset = () => {
    setName("");
    setBriefing("");
    setSymbol("");
    setSymbols([]);
    setImage(undefined);
    setVideo(undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto rounded-3xl border-border/60 bg-card p-6 sm:max-w-md"
      >
        <div className="flex items-start">
          <DialogTitle className="flex-1 text-center text-xl font-bold">
            Create Expert Advisor
          </DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <form
          className="mt-4 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              toast.error("Give your EA a codename.");
              return;
            }
            onCreate({
              id: `${Date.now()}`,
              name: name.trim(),
              briefing: briefing.trim(),
              symbols,
              createdAt: new Date().toISOString(),
              ...(image ? { image } : {}),
              ...(video ? { video } : {}),
            });
            reset();
            onOpenChange(false);
          }}
        >
          <div>
            <p className={label}>Codename</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SPECTER_V9"
              className={`${field} h-14`}
            />
          </div>

          <div>
            <p className={label}>Briefing</p>
            <textarea
              value={briefing}
              onChange={(e) => setBriefing(e.target.value)}
              placeholder="Operational profile of this unit"
              rows={4}
              className={`${field} resize-none py-4`}
            />
          </div>

          <div>
            <p className={label}>Symbols</p>
            <div className="mt-2 flex gap-3">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. XAUUSD"
                className="h-14 flex-1 rounded-2xl border border-border/60 bg-background/60 px-5 text-sm outline-none focus:border-primary/60"
              />
              <button
                type="button"
                onClick={() => {
                  const s = symbol.trim();
                  if (!s || symbols.includes(s)) return;
                  setSymbols((v) => [...v, s]);
                  setSymbol("");
                }}
                className="h-14 rounded-2xl bg-secondary px-6 text-sm font-bold"
              >
                Add
              </button>
            </div>
            {symbols.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {symbols.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setSymbols((v) => v.filter((x) => x !== s))}
                    className="flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary"
                  >
                    {s} <X className="size-3" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className={label}>Image</p>
            <label className="mt-2 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 text-sm text-muted-foreground">
              <ImageIcon className="size-6" />
              {image ?? "Click to upload image (max 5MB)"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setImage(e.target.files?.[0]?.name)}
              />
            </label>
          </div>

          <div>
            <p className={label}>Robot video — shown in the app instead of the image</p>
            <label className="mt-2 flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 text-sm text-muted-foreground">
              <Video className="size-6" />
              {video ?? "Click to upload video (max 50MB)"}
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => setVideo(e.target.files?.[0]?.name)}
              />
            </label>
          </div>

          <button
            type="submit"
            className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground glow-ring"
          >
            Deploy
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
