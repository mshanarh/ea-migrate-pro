import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { connectMt, useAppState, type MtAccount } from "@/lib/app-store";

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
  const [broker, setBroker] = useState(mt?.broker ?? "");
  const [server, setServer] = useState(mt?.server ?? "");
  const [loginId, setLoginId] = useState(mt?.loginId ?? "");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!broker.trim() || !server.trim() || !loginId.trim()) {
      toast.error("Fill in broker, server and login ID.");
      return;
    }
    const account: MtAccount = { platform: "MT5", broker: broker.trim(), server: server.trim(), accountType: "Live", loginId: loginId.trim() };
    connectMt(account);
    toast.success("MT5 account linked to your robot.");
  };

  return (
    <div className="app-fullscreen bg-black text-white">
      <div className="app-scroll-area">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-5 pt-10 pb-36">
        <div>
          <h1 className="text-3xl font-black tracking-tight">MetaTrader</h1>
          <p className="mt-2 text-sm text-white/55">
            Your robot trades through your own MT5 account. Funds never leave your broker.
          </p>
        </div>

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
            <p className="mt-4 rounded-2xl bg-black/40 px-4 py-3 text-xs font-semibold text-emerald-300">● Live link active</p>
          </motion.div>
        ) : null}

        <form onSubmit={submit} className="space-y-4">
          <input value={broker} onChange={(event) => setBroker(event.target.value)} placeholder="Broker name" aria-label="Broker name" className={fieldClass} />
          <input value={server} onChange={(event) => setServer(event.target.value)} placeholder="Server (e.g. ICMarkets-Live07)" aria-label="Server" className={fieldClass} />
          <input value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="Login ID" aria-label="Login ID" className={fieldClass} />
          <button
            type="submit"
            className="h-16 w-full rounded-[28px] bg-gradient-to-b from-[#FFA500] to-[#CC7A00] text-base font-black text-black shadow-[0_12px_40px_rgba(255,165,0,0.35)] transition-transform active:scale-[0.98]"
          >
            {mt ? "UPDATE LINK" : "LINK MT5 ACCOUNT"}
          </button>
        </form>
      </main>
      </div>
      <FixedBottomNav />
    </div>
  );
}
