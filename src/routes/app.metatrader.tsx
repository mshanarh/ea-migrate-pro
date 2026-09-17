import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { connectMt, disconnectMt, useAppState, type MtAccount } from "@/lib/app-store";
import { connectMt5Account, disconnectMt5Account, getMtAccountStatus } from "@/lib/metacopier";

export const Route = createFileRoute("/app/metatrader")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "MetaTrader — EA Migrate Pro" },
      { name: "description", content: "Link your MT5 account to your hosted robot." },
    ],
  }),
  component: AppMetatrader,
});

const fieldClass =
  "h-14 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-base text-white outline-none placeholder:text-white/30 focus:border-[#FFA500]/70";

function AppMetatrader() {
  const app = useAppState();
  const mt = app.mt;
  const [loginId, setLoginId] = useState(mt?.loginId ?? "");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(mt?.server ?? "");
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connecting) return;
    if (!loginId.trim() || !password.trim() || !server.trim()) {
      toast.error("Fill in login, password and server.");
      return;
    }
    setConnecting(true);
    try {
      // Creates the user's account under the platform's MetaCopier key —
      // credentials are validated by MetaCopier before returning.
      const result = await connectMt5Account({
        data: {
          login: loginId.trim(),
          password: password.trim(),
          server: server.trim(),
          alias: app.email ?? loginId.trim(),
        },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const account: MtAccount = {
        platform: "MT5",
        broker: server.includes("-") ? (server.split("-")[0]?.trim() ?? server.trim()) : server.trim(),
        server: server.trim(),
        accountType: result.environment === "DEMO" ? "Demo" : "Live",
        loginId: loginId.trim(),
        mcAccountId: result.accountId,
        ...(result.environment ? { environment: result.environment } : {}),
      };
      connectMt(account);
      toast.success(`MT5 ${account.accountType.toLowerCase()} account connected`);
      setPassword("");
    } catch {
      toast.error("Could not reach the execution provider.");
    } finally {
      setConnecting(false);
    }
  };

  const checkStatus = async () => {
    if (!mt?.mcAccountId || checking) return;
    setChecking(true);
    try {
      const status = await getMtAccountStatus({ data: { accountId: mt.mcAccountId } });
      if (!status.ok) {
        toast.error(status.message);
        return;
      }
      if (status.connected) {
        toast.success(`Connected · ${status.currency ?? ""} ${status.balance?.toFixed(2) ?? "?"} balance`);
      } else {
        toast.warning(status.statusMessage ? `Not connected — ${status.statusMessage}` : "Not connected yet — retry in a moment");
      }
    } finally {
      setChecking(false);
    }
  };

  const removeConnection = async () => {
    if (!mt) return;
    if (!window.confirm(`Disconnect ${mt.loginId} from this device and the hosting platform?`)) return;
    if (mt.mcAccountId) {
      const result = await disconnectMt5Account({ data: { accountId: mt.mcAccountId } });
      if (!result.ok) toast.warning(result.message);
    }
    disconnectMt();
    toast.success("MT5 account disconnected.");
  };

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pt-10 pb-36">
        <div>
          <h1 className="text-3xl font-black tracking-tight">MetaTrader</h1>
          <p className="mt-2 text-sm text-white/55">
            Connect your own MT5 account — your robot trades through it. Funds never leave your broker.
          </p>
        </div>

        <Link
          to="/app/trading-pairs"
          className="flex items-center justify-between rounded-[24px] border border-[#FFA500]/30 bg-[#FFA500]/[0.06] p-5 transition-transform active:scale-[0.99]"
        >
          <span>
            <span className="block text-base font-black">Trading Pairs</span>
            <span className="mt-0.5 block text-xs text-white/50">Choose pairs, lot size &amp; max trades</span>
          </span>
          <span className="text-xl text-[#FFA500]">→</span>
        </Link>

        {mt ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[32px] border border-[#FFA500]/30 bg-[#FFA500]/[0.06] p-6"
          >
            <p className="text-xs font-bold tracking-[0.22em] text-[#FFA500] uppercase">Connected</p>
            <p className="mt-3 text-xl font-black">{mt.broker}</p>
            <p className="mt-1 text-sm text-white/60">{mt.server} · {mt.loginId}</p>
            <p className="mt-1 text-xs text-white/40">
              {mt.accountType} {mt.environment ? `· detected ${mt.environment.toLowerCase()}` : ""}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void checkStatus()}
                disabled={checking}
                className="h-12 flex-1 rounded-2xl bg-black/40 text-xs font-bold text-emerald-300 transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {checking ? "CHECKING..." : "● CHECK STATUS"}
              </button>
              <button
                type="button"
                onClick={() => void removeConnection()}
                className="h-12 flex-1 rounded-2xl bg-black/40 text-xs font-bold text-white/60 transition-transform active:scale-[0.98] hover:text-red-300"
              >
                DISCONNECT
              </button>
            </div>
          </motion.div>
        ) : null}

        {!mt || true ? (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <p className="text-xs font-bold tracking-[0.22em] text-white/40 uppercase">
              {mt ? "Replace connected account" : "Connect your MT5 account"}
            </p>
            <input value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="MT5 Login number" aria-label="MT5 login number" inputMode="numeric" className={fieldClass} />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="MT5 password" aria-label="MT5 password" type="password" autoComplete="off" className={fieldClass} />
            <input value={server} onChange={(event) => setServer(event.target.value)} placeholder="Server (e.g. ICMarketsSC-MT5-4)" aria-label="Server" className={fieldClass} />
            <button
              type="submit"
              disabled={connecting}
              className="h-16 w-full rounded-[28px] bg-gradient-to-b from-[#FFA500] to-[#CC7A00] text-base font-black text-black shadow-[0_12px_40px_rgba(255,165,0,0.35)] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {connecting ? "CONNECTING..." : mt ? "UPDATE LINK" : "CONNECT MT5 ACCOUNT"}
            </button>
            <p className="text-center text-[11px] text-white/30">
              Your credentials are sent directly to the hosting provider over an encrypted connection and are never stored on this device.
            </p>
          </form>
        ) : null}
      </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
    </div>
  );
}
