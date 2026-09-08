import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { connectMt, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/metatrader")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Connect MetaTrader — EA Migrate Pro" },
      { name: "description", content: "Link your MT4 or MT5 trading account to run your EA." },
      { property: "og:title", content: "Connect MetaTrader — EA Migrate Pro" },
      { property: "og:description", content: "Link your MT4 or MT5 trading account to run your EA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MetaTrader,
});

const BROKERS = ["Exness", "IC Markets", "FBS", "XM", "Deriv", "Pepperstone"];

function MetaTrader() {
  const app = useAppState();
  const [platform, setPlatform] = useState<"MT4" | "MT5">(app.mt?.platform ?? "MT5");
  const [broker, setBroker] = useState(app.mt?.broker ?? "");
  const [server, setServer] = useState(app.mt?.server ?? "");
  const [accountType, setAccountType] = useState(app.mt?.accountType ?? "Standard");
  const [loginId, setLoginId] = useState(app.mt?.loginId ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  const field = "h-14 w-full rounded-2xl border border-border/60 bg-card/70 px-5 text-sm outline-none";
  const label = "text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase";

  return (
    <AppFrame>
      <div className="flex rounded-full border border-border/60 bg-card/60 p-1">
        {(["MT4", "MT5"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`h-12 flex-1 rounded-full text-sm font-bold transition-colors ${
              platform === p ? "bg-primary text-primary-foreground glow-ring" : "text-muted-foreground"
            }`}
          >
            {p} Account
          </button>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <span className="flex size-24 items-center justify-center rounded-full bg-primary/15 text-3xl font-bold text-primary glow-ring">
          {platform === "MT5" ? "5" : "4"}
        </span>
      </div>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!broker || !loginId) return toast.error("Pick a broker and enter your login ID.");
          connectMt({ platform, broker, server, accountType, loginId });
          toast.success(`${platform} account connected`);
        }}
      >
        <div className="space-y-2">
          <p className={label}>Broker</p>
          <select value={broker} onChange={(e) => setBroker(e.target.value)} className={field}>
            <option value="">Select your broker</option>
            {BROKERS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <p className={label}>Server</p>
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="e.g. Exness-MT5Real"
            className={field}
          />
        </div>
        <div className="space-y-2">
          <p className={label}>Account type</p>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className={field}
          >
            <option>Standard</option>
            <option>Raw Spread</option>
            <option>Cent</option>
            <option>Demo</option>
          </select>
        </div>
        <div className="space-y-2">
          <p className={label}>Login ID</p>
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="Account number"
            className={field}
          />
        </div>
        <div className="space-y-2">
          <p className={label}>Password</p>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={field}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-5 -translate-y-1/2 text-muted-foreground"
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="h-16 w-full rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring"
        >
          Connect Account
        </button>
      </form>
    </AppFrame>
  );
}
