import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Copy, Key, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createEaRecord, useCurrentAccount, type ExpertAdvisor } from "@/lib/auth-store";
import { setEAs } from "@/lib/auth-store";
import { generateRobotKey } from "@/lib/robot-keys";

export const Route = () => {
  const account = useCurrentAccount();
  const [eaName, setEaName] = useState("");
  const [image, setImage] = useState("");
  const [selectedEa, setSelectedEa] = useState<ExpertAdvisor | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentEA = selectedEa ?? null;

  const handleGenerateKey = useCallback(async () => {
    if (!account || !currentEA) {
      toast.error("Save EA first");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateRobotKey(account.email, currentEA.id, account.mentorId ?? undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setGeneratedKey(result.key_code);
      try {
        await navigator.clipboard.writeText(result.key_code);
        setCopied(true);
        toast.success(`Key generated: ${result.key_code}`);
      } catch {
        toast.success(`Key generated: ${result.key_code}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the key");
    } finally {
      setGenerating(false);
    }
  }, [account, currentEA]);

  const copyKey = useCallback(async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      toast.success("Key copied");
    } catch {
      toast.error("Could not copy the key");
    }
  }, [generatedKey]);

  const saveEa = useCallback(() => {
    if (!account || !eaName.trim()) return;
    const ea = createEaRecord(eaName.trim());
    setEAs(account.id, [...account.eas, ea]);
    setSelectedEa(ea);
    toast.success(ea.name + " saved");
  }, [account, eaName]);

  if (!account) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white">
        <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-12 text-center">
          <p className="text-2xl font-black">Mentor portal</p>
          <p className="text-sm text-white/60">Sign in to create an Expert Advisor and generate a robot key.</p>
          <Link to="/signin" className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-black text-primary-foreground">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12">
        <div className="flex items-baseline gap-3">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-primary">Mentor portal</p>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase text-muted-foreground">Create EA</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight">Generate robot key</h1>
        <p className="text-sm leading-6 text-white/60">Create an Expert Advisor, then generate a host robot key for it. The key is copied to your clipboard.</p>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-bold text-white/80">Expert Advisor</p>
          <div className="mt-3 flex flex-col gap-4">
            <input
              value={eaName}
              onChange={(event) => setEaName(event.target.value)}
              placeholder="e.g. Gold Scalper Pro"
              className="h-14 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-base outline-none placeholder:text-white/30 focus:border-primary/60"
            />
            {selectedEa ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm">
                <Key className="size-4 shrink-0 text-emerald-300" />
                <span className="truncate font-semibold">{selectedEa.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedEa(null)}
                  className="ml-auto shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground"
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <input
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  placeholder="Image URL (optional)"
                  className="h-14 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-base outline-none placeholder:text-white/30 focus:border-primary/60"
                />
                <Button
                  disabled={!eaName.trim()}
                  onClick={saveEa}
                  className="h-12 w-full rounded-xl text-sm font-black"
                >
                  <Key className="size-4" /> Save EA
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-bold text-white/80">Host robot key</p>
          <p className="mt-1 text-xs text-white/50">Generate a key only after the EA is saved.</p>

          {!currentEA ? (
            <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-sm text-amber-300">
              <Key className="size-4 shrink-0" /> Save EA first
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
                <span className="text-lg font-black tabular-nums">{generatedKey ?? "—"}</span>
                {generatedKey && (
                  <Button size="sm" variant="secondary" onClick={copyKey} className="shrink-0">
                    <Copy className="size-4" /> {copied ? "Copied" : "Copy"}
                  </Button>
                )}
              </div>
              <Button
                disabled={generating || !currentEA}
                onClick={handleGenerateKey}
                className="h-12 w-full rounded-xl text-base font-black"
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Key className="size-4" /> Generate Key
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        <p className="text-xs text-white/40">This key is stored in host_robot_keys and linked to your EA. Share it only with trusted clients.</p>
      </div>
    </div>
  );
};

export default Route;
