import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Check, ChevronDown, Eye, EyeOff, TrendingUp } from "lucide-react";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { connectMt, disconnectMt, useAppState, type MtAccount } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
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

const ACCOUNT_TYPES = ["Standard", "Pro", "ECN", "Raw", "Cent", "Demo"] as const;

const BROKER_SERVERS: Record<string, string[]> = {
  Exness: ["Exness-MT5Real", "Exness-MT5Real8", "Exness-MT5Trial7"],
  "IC Markets": ["ICMarketsSC-MT5", "ICMarketsSC-MT5-4"],
  Pepperstone: ["Pepperstone-Live09", "Pepperstone-Demo"],
  XM: ["XMGlobal-MT5 2", "XMGlobal-MT5TRIAL 3"],
  OctaFX: ["OctaFX-Real", "OctaFX-Demo"],
  FBS: ["FBS-Real", "FBS-Demo"],
  Deriv: ["Deriv-Real", "Deriv-Demo"],
  HFM: ["HFMarkets-Live", "HFMarkets-Demo"],
  "Tickmill": ["Tickmill-Live", "Tickmill-Demo"],
  Vantage: ["VantageInternational-Live", "VantageInternational-Demo"],
  "Fusion Markets": ["FusionMarkets-MT5-Live01", "FusionMarkets-MT5-Demo"],
  FTMO: ["FTMO-Server", "FTMO-Demo"],
};

/** Popular brokers offered as suggestions — any broker is accepted. */
const POPULAR_BROKERS = Object.keys(BROKER_SERVERS);

const labelClass = "text-[11px] font-bold tracking-[0.28em] text-white/40 uppercase";
const fieldClass =
  "h-14 w-full rounded-2xl border border-white/[0.07] bg-[#141414] px-5 text-base text-white outline-none transition-all duration-200 placeholder:text-white/25 focus:border-white/25 focus:bg-[#181818] focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]";

/** Select styled like the screenshot's dark dropdowns (native = reliable on mobile). */
function DarkSelect({ value, onChange, placeholder, options, ariaLabel, hint }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: readonly string[];
  ariaLabel: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className={`${fieldClass} appearance-none ${value ? "text-white" : "text-white/30"}`}
      >
        <option value="" disabled className="bg-[#141414]">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#141414] text-white">{option}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-white/30">{hint ?? <ChevronDown className="size-5" />}</span>
    </div>
  );
}

/** MT5-style mark: three glossy interlocking spheres around a silver "5". */
function Mt5Logo() {
  return (
    <svg viewBox="0 0 96 96" className="size-[104px] drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]" role="img" aria-label="MetaTrader 5">
      <defs>
        <radialGradient id="mt5-green" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#7dff8a" /><stop offset="55%" stopColor="#18b422" /><stop offset="100%" stopColor="#0a5c12" />
        </radialGradient>
        <radialGradient id="mt5-gold" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffe98a" /><stop offset="55%" stopColor="#e8a713" /><stop offset="100%" stopColor="#8a5f06" />
        </radialGradient>
        <radialGradient id="mt5-blue" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#8ad4ff" /><stop offset="55%" stopColor="#1482d8" /><stop offset="100%" stopColor="#084a7e" />
        </radialGradient>
        <radialGradient id="mt5-silver" cx="35%" cy="28%" r="85%">
          <stop offset="0%" stopColor="#ffffff" /><stop offset="60%" stopColor="#d8dde6" /><stop offset="100%" stopColor="#8b93a3" />
        </radialGradient>
      </defs>
      <circle cx="48" cy="26" r="19" fill="url(#mt5-green)" />
      <circle cx="33" cy="57" r="19" fill="url(#mt5-gold)" />
      <circle cx="63" cy="57" r="19" fill="url(#mt5-blue)" />
      <circle cx="48" cy="46" r="21" fill="url(#mt5-silver)" />
      <text x="48" y="47" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="900" fontFamily="Arial, sans-serif" fill="#3c4350" stroke="#ffffff" strokeWidth="0.6">5</text>
    </svg>
  );
}

function AppMetatrader() {
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const mt = app.mt;

  const [broker, setBroker] = useState(mt?.broker ?? "");
  const [server, setServer] = useState(mt?.server ?? "");
  const [accountType, setAccountType] = useState(mt?.accountType ?? "Standard");
  const [loginId, setLoginId] = useState(mt?.loginId ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);

  const servers = broker ? (BROKER_SERVERS[broker] ?? []) : Object.values(BROKER_SERVERS).flat();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connecting) return;
    if (!loginId.trim() || !password.trim() || !server.trim()) {
      toast.error("Fill in server, login ID and password.");
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
        broker: broker.trim() || (server.includes("-") ? (server.split("-")[0]?.trim() ?? server.trim()) : server.trim()),
        server: server.trim(),
        accountType,
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

  const stagger = {
    hidden: { opacity: 0, y: 18 },
    show: (index: number) => ({ opacity: 1, y: 0, transition: { delay: index * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } }),
  };

  return (
    <div className="app-fullscreen relative bg-black text-white">
      {/* Ambient accent glow — soft "4K" studio light from the top */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px]" style={{ background: `radial-gradient(ellipse 70% 55% at 50% -8%, ${accent}2e, transparent 70%)` }} />

      <div className="app-scroll-area relative">
        <main className="mx-auto flex w-full max-w-md flex-col px-5 pt-8 pb-36">
          {/* MT5 badge */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex justify-center"
          >
            <span
              className="inline-flex h-12 items-center justify-center rounded-full px-10 text-base font-black tracking-wide text-black"
              style={{ background: `linear-gradient(180deg, ${accent}, ${accent}cc)`, boxShadow: `0 10px 34px ${accent}66` }}
            >
              MT5 Account
            </span>
          </motion.div>

          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex justify-center"
          >
            <Mt5Logo />
          </motion.div>

          {/* Connected card */}
          {mt ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 rounded-[24px] border p-5"
              style={{ borderColor: `${accent}59`, background: `linear-gradient(180deg, ${accent}14, rgba(0,0,0,0.5))` }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: accent }}>Connected</p>
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-300">
                  <Check className="size-3" strokeWidth={3} /> LIVE LINK
                </span>
              </div>
              <p className="mt-3 text-xl font-black">{mt.broker}</p>
              <p className="mt-1 text-sm text-white/60">{mt.server} · {mt.loginId}</p>
              <p className="mt-1 text-xs text-white/40">{mt.accountType}{mt.environment ? ` · detected ${mt.environment.toLowerCase()}` : ""}</p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void checkStatus()}
                  disabled={checking}
                  className="h-11 flex-1 rounded-2xl bg-white/[0.05] text-xs font-bold text-emerald-300 transition-transform active:scale-[0.97] disabled:opacity-60"
                >
                  {checking ? "CHECKING..." : "CHECK STATUS"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeConnection()}
                  className="h-11 flex-1 rounded-2xl bg-white/[0.05] text-xs font-bold text-white/60 transition-transform active:scale-[0.97] hover:text-red-300"
                >
                  DISCONNECT
                </button>
              </div>
            </motion.div>
          ) : null}

          {/* Form */}
          <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-5">
            <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
              <label className={labelClass} htmlFor="mt5-broker">Broker</label>
              <div className="mt-2.5">
                <input
                  id="mt5-broker"
                  value={broker}
                  onChange={(event) => setBroker(event.target.value)}
                  placeholder="Any broker — e.g. Exness"
                  aria-label="Broker"
                  autoComplete="off"
                  className={fieldClass}
                  list="mt5-broker-suggestions"
                />
                <datalist id="mt5-broker-suggestions">
                  {POPULAR_BROKERS.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
            </motion.div>

            <motion.div custom={1} variants={stagger} initial="hidden" animate="show">
              <label className={labelClass} htmlFor="mt5-server">Server</label>
              <div className="mt-2.5">
                <input
                  id="mt5-server"
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                  placeholder={broker ? `e.g. ${BROKER_SERVERS[broker]?.[0] ?? "Exness-MT5Real"}` : "e.g. Exness-MT5Real"}
                  aria-label="Server"
                  className={fieldClass}
                  list="mt5-server-suggestions"
                />
                <datalist id="mt5-server-suggestions">
                  {servers.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
            </motion.div>

            <motion.div custom={2} variants={stagger} initial="hidden" animate="show">
              <label className={labelClass} htmlFor="mt5-type">Account Type</label>
              <div className="mt-2.5">
                <DarkSelect value={accountType} onChange={setAccountType} placeholder="Account type" options={ACCOUNT_TYPES} ariaLabel="Account type" />
              </div>
            </motion.div>

            <motion.div custom={3} variants={stagger} initial="hidden" animate="show">
              <label className={labelClass} htmlFor="mt5-login">Login ID</label>
              <div className="mt-2.5">
                <input
                  id="mt5-login"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="Account number"
                  aria-label="Login ID"
                  inputMode="numeric"
                  className={fieldClass}
                />
              </div>
            </motion.div>

            <motion.div custom={4} variants={stagger} initial="hidden" animate="show">
              <label className={labelClass} htmlFor="mt5-password">Password</label>
              <div className="relative mt-2.5">
                <input
                  id="mt5-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  className={`${fieldClass} pr-14`}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/35 transition-colors hover:text-white/70"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </motion.div>

            <motion.div custom={5} variants={stagger} initial="hidden" animate="show" className="pt-1">
              <button
                type="submit"
                disabled={connecting}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-[28px] text-lg font-black text-black transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                style={{ background: `linear-gradient(180deg, ${accent}, ${accent}cc)`, boxShadow: `0 14px 44px ${accent}66` }}
              >
                {connecting ? (
                  <span className="flex items-center gap-3">
                    <span className="size-5 animate-spin rounded-full border-[3px] border-black/70 border-t-transparent" />
                    CONNECTING...
                  </span>
                ) : (
                  "Connect Account"
                )}
              </button>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-white/30">
                MT5 only. Your credentials go straight to the hosting provider over an encrypted connection and are never stored on this device.
              </p>
            </motion.div>
          </form>

          {/* Trading pairs shortcut */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link
              to="/app/trading-pairs"
              className="mt-8 flex items-center justify-between rounded-[24px] border p-5 transition-transform active:scale-[0.99]"
              style={{ borderColor: `${accent}40`, background: `${accent}0d` }}
            >
              <span className="flex items-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: accent }}>
                  <TrendingUp className="size-5 text-black" strokeWidth={2.4} />
                </span>
                <span>
                  <span className="block text-base font-black">Trading Pairs</span>
                  <span className="mt-0.5 block text-xs text-white/50">Choose pairs, lot size &amp; max trades</span>
                </span>
              </span>
              <span className="text-xl" style={{ color: accent }}>→</span>
            </Link>
          </motion.div>
        </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
    </div>
  );
}
