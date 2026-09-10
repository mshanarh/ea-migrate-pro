import { createFileRoute } from "@tanstack/react-router";
import { Wallet, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/wallet")({
  ssr: false,
  component: WalletPage,
});

function WalletPage() {
  const account = useCurrentAccount();
  if (!account) return null;

  return (
    <div>
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Billing</p>
      <h1 className="mt-1 text-3xl font-bold">Wallet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your balance and payouts. Payments go live once the payment provider is connected.
      </p>

      <div className="panel mt-6 p-6 glow-ring">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/12">
            <Wallet className="size-5 text-primary" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">Available balance</p>
            <p className="text-4xl font-bold text-primary">R 0.00</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="panel p-6">
          <ArrowDownLeft className="size-5 text-primary" />
          <p className="mt-3 font-semibold">Top up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add funds to buy licence keys for your clients.
          </p>
          <button
            disabled
            className="mt-4 h-11 w-full rounded-full bg-secondary text-sm font-semibold text-muted-foreground"
          >
            Coming soon
          </button>
        </div>
        <div className="panel p-6">
          <ArrowUpRight className="size-5 text-primary" />
          <p className="mt-3 font-semibold">Withdraw</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash out mentor earnings once payouts are enabled.
          </p>
          <button
            disabled
            className="mt-4 h-11 w-full rounded-full bg-secondary text-sm font-semibold text-muted-foreground"
          >
            Coming soon
          </button>
        </div>
      </div>

      <div className="panel mt-4 p-6">
        <p className="font-semibold">Transactions</p>
        <p className="mt-1 text-sm text-muted-foreground">No transactions yet.</p>
      </div>
    </div>
  );
}
