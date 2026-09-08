import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addLicense, generateKey, useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/licenses")({
  ssr: false,
  component: Licenses,
});

function Licenses() {
  const account = useCurrentAccount();
  if (!account) return null;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Access</p>
      <h1 className="mt-1 text-3xl font-bold">Licenses</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Licence keys issued to your portal by the EA Migrate Pro admin team.
      </p>

      <Button
        size="lg"
        className="mt-6 h-12 rounded-full"
        onClick={() => {
          const key = generateKey();
          addLicense(account.id, "Pro", key);
          toast.success("License key created");
        }}
      >
        <Plus className="size-4" /> Create license key
      </Button>

      {account.licenses.length === 0 ? (
        <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <KeyRound className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No licences yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Once an admin adds licences to your portal they'll appear here, ready to hand to clients.
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
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                  l.active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                }`}
              >
                {l.active ? "Active" : "Paused"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
