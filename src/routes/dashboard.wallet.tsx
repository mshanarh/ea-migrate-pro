import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, KeyRound, Wallet } from "lucide-react";
import { useCurrentAccount, useStore } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/wallet")({ ssr: false, component: WalletPage });

function WalletPage() {
  const account = useCurrentAccount();
  const store = useStore();
  if (!account) return null;

  const sales = account.licenses.length;
  const earnings = sales * 2500;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">My Wallet</p>
      <h1 className="mt-1 text-3xl font-bold">Wallet</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Track the keys you have issued and the earnings they represent.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="panel flex items-center gap-4 p-6">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <KeyRound className="size-6" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Keys issued</p>
            <p className="mt-1 text-2xl font-bold">{sales}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-6">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-400/12 text-emerald-300">
            <Wallet className="size-6" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Estimated earnings</p>
            <p className="mt-1 text-2xl font-bold">R {earnings.toLocaleString()}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-6">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/8 text-white/70">
            <Copy className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Platform mentors</p>
            <p className="mt-1 text-2xl font-bold">{store.accounts.filter((a) => a.role === "mentor").length}</p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Payouts and top-ups are managed by the platform admin. Need help?{" "}
        <Link to="/support" className="font-semibold text-primary hover:underline">
          Contact support
        </Link>
        .
      </p>
    </div>
  );
}
