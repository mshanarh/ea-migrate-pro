import { useState } from "react";
import { Eye, EyeOff, Copy, Check, AlertCircle, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { saveMetacopierApiKey, getMetacopierSettings, removeMetacopierApiKey } from "@/lib/metacopier-store";
import { metacopierService, getMetacopierApiUrl } from "@/lib/metacopier";

type Props = {
  accountId: string;
  onSaved?: () => void;
};

export function MetacopierSetup({ accountId, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const settings = getMetacopierSettings(accountId);
  const hasConfig = !!settings?.apiKey;

  const handleSave = async () => {
    setError("");
    if (!apiKey.trim()) {
      setError("Please enter your Metacopier API key");
      return;
    }

    setValidating(true);
    try {
      const apiUrl = getMetacopierApiUrl();
      const isValid = await metacopierService.validateApiKey(apiKey.trim(), apiUrl);

      if (!isValid) {
        setError("Invalid API key. Please check and try again.");
        setValidating(false);
        return;
      }

      const result = saveMetacopierApiKey(accountId, apiKey.trim(), apiUrl);
      if (result.error) {
        setError(result.error);
        setValidating(false);
        return;
      }

      toast.success("Metacopier API key saved successfully");
      setApiKey("");
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError("Failed to validate API key");
    } finally {
      setValidating(false);
    }
  };

  const handleRemove = () => {
    removeMetacopierApiKey(accountId);
    toast.success("Metacopier configuration removed");
    onSaved?.();
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText("https://app.metacopier.com/settings/api");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (hasConfig) {
    return (
      <div className="panel space-y-4 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Metacopier Integration</h3>
            <p className="mt-1 text-sm text-muted-foreground">Live trade execution is enabled</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-700">
            <span className="size-2 rounded-full bg-green-500" /> Active
          </span>
        </div>

        <div className="text-sm text-muted-foreground">
          API Key: ***...{settings.apiKey.slice(-4)}
          <br />
          Added: {new Date(settings.addedAt).toLocaleDateString()}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setApiKey("");
              setError("");
              setOpen(true);
            }}
          >
            Update Key
          </Button>
          <Button size="sm" variant="destructive" onClick={handleRemove}>
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="panel w-full p-6 text-left transition-colors hover:bg-card/70"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Connect Metacopier</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Enable live trade execution on your MT4/MT5 account
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground">Setup</span>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl border-border/60 bg-card p-6 sm:max-w-md">
          <div>
            <DialogTitle className="text-xl font-bold">Connect Metacopier</DialogTitle>
            <DialogDescription className="mt-2 text-sm">
              Add your Metacopier API key to enable live trade execution
            </DialogDescription>
          </div>

          <div className="mt-6 space-y-4">
            {error && (
              <div className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Metacopier API Key</label>
              <div className="relative mt-2">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_live_..."
                  className="pr-10"
                  disabled={validating}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Get your API key from{" "}
                <button
                  onClick={copyToClipboard}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Metacopier Settings
                  {copied ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </button>
              </p>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium">Security note:</p>
              <ul className="space-y-1">
                <li>• Your API key is stored securely and never shared</li>
                <li>• Only used to execute trades from your EA</li>
                <li>• You can revoke access anytime</li>
              </ul>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={validating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={validating || !apiKey.trim()}
              >
                {validating && <Loader className="mr-2 size-4 animate-spin" />}
                {validating ? "Validating..." : "Connect"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
