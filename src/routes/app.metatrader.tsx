import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Eye, EyeOff, ShieldCheck, TrendingUp } from "lucide-react";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import { WHOP_CHECKOUT_URL, connectMt, disconnectMt, getAppState, requireAppAccess, useAppState, type MtAccount } from "@/lib/app-store";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { saveMt5Connection, setMtAccountConnection, disconnectMt5Account } from "@/lib/metaapi";
import { syncDeleteMt5Account, syncGetMt5Account, syncSaveMt5Account } from "@/lib/account-sync.server";

export const Route = createFileRoute("/app/metatrader")({
  ssr: false,
  beforeLoad: () => {
    // Same gates the /app login view enforces: no email → app login,
    // unpaid → Whop checkout. Paid/admin emails pass through.
    const access = requireAppAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app" });
    if (access.action === "pay") throw redirect({ href: WHOP_CHECKOUT_URL });
  },
  head: () => ({
    meta: [
      { title: "MetaTrader — EA Migrate Pro" },
      { name: "description", content: "Save your MT5 account for on-demand trading." },
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

/** Local, instant UI mirror of the SAVED connection (cloud keeps the durable copy). */
const MT5_UI_KEY = "mt5_saved_state";

type Mt5UiState = { login: string; server: string; saved: boolean };

function readMt5Ui(): Mt5UiState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MT5_UI_KEY);
    return raw ? (JSON.parse(raw) as Mt5UiState) : null;
  } catch {
    return null;
  }
}

function writeMt5Ui(state: Mt5UiState | null) {
  if (typeof window === "undefined") return;
  try {
    if (state) window.localStorage.setItem(MT5_UI_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(MT5_UI_KEY);
  } catch {
    /* ignore */
  }
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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyNotice, setKeyNotice] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const servers = broker ? (BROKER_SERVERS[broker] ?? []) : Object.values(BROKER_SERVERS).flat();

  // Any edit to the form clears the previous error banner — the user should
  // never stare at a stale "not configured" box while re-entering details.
  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
    if (keyNotice) setKeyNotice(false);
    if (testResult) setTestResult(null);
  };

  // On page load: if this user already has a saved connection in the cloud
  // store (and this device lost its local copy), restore the metadata and
  // show the SAVED/OFFLINE card. No deploy happens on load — ever.
  useEffect(() => {
    if (!app.email || mt) return;
    let cancelled = false;
    void (async () => {
      try {
        const cloud = await syncGetMt5Account({ data: { userId: app.email! } });
        if (cancelled || !cloud.enabled || !cloud.record) return;
        const record = cloud.record;
        const account: MtAccount = {
          platform: "MT5",
          broker: record.broker || record.server,
          server: record.server,
          accountType: record.accountType || "Standard",
          loginId: record.loginId,
          mcAccountId: record.mcAccountId,
          ...(record.environment ? { environment: record.environment } : {}),
          ...(record.kind === "demo" || record.kind === "live" ? { kind: record.kind } : {}),
        };
        connectMt(account);
        setBroker(account.broker);
        setServer(account.server);
        setAccountType(account.accountType);
        setLoginId(account.loginId);
      } catch {
        /* cloud not configured — the device-local store is the source of truth */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.email]);

  /**
   * SAVE DETAILS — stores the credentials ONLY. The server creates (or
   * reuses) MetaApi's hosted copy of the account WITHOUT deploying it, so no
   * broker connection is opened. The saved status shows Disconnected/Offline.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!loginId.trim() || !password.trim() || !server.trim()) {
      toast.error("Fill in server, login ID and password.");
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setKeyNotice(false);
    try {
      // The server validates the details with the provider and keeps the
      // hosted copy UNDEPLOYED — saving never connects to the broker.
      const result = await saveMt5Connection({
        data: {
          login: loginId.trim(),
          password: password.trim(),
          server: server.trim(),
          alias: app.email ?? loginId.trim(),
          accountType,
        },
      });
      if (!result.ok) {
        setKeyNotice(result.code === "key_missing");
        setErrorMessage(result.message);
        toast.error(result.message);
        return;
      }
      const derivedBroker = broker.trim() || (server.includes("-") ? (server.split("-")[0]?.trim() ?? server.trim()) : server.trim());
      const account: MtAccount = {
        platform: "MT5",
        broker: derivedBroker,
        server: server.trim(),
        accountType,
        loginId: loginId.trim(),
        mcAccountId: result.accountId,
        ...(result.environment ? { environment: result.environment } : {}),
        ...(result.kind ? { kind: result.kind } : {}),
      };
      connectMt(account);
      writeMt5Ui({ login: account.loginId, server: account.server, saved: true });
      // Durable cloud copy — credentials live ONLY in the server-side store.
      if (app.email) {
        void syncSaveMt5Account({
          data: {
            record: {
              userId: app.email,
              loginId: account.loginId,
              server: account.server,
              accountType: account.accountType,
              broker: account.broker,
              mcAccountId: result.accountId,
              environment: result.environment,
              ...(result.kind ? { kind: result.kind } : {}),
              isConnected: false,
              connectedAt: "",
              mtPassword: password.trim(),
            },
          },
        }).catch(() => {});
      }
      toast.success(`Saved ✓ — Account ${account.loginId} · ${account.server} (offline until a trade executes)`);
      setPassword("");
    } catch {
      const message = "Could not reach the connection provider. Check your internet connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * TEST CONNECTION — the ONLY manual connect path: temporarily opens the
   * broker connection, verifies it, then ALWAYS disconnects again.
   */
  const checkStatus = async () => {
    if (!mt?.mcAccountId || testing) return;
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const open = await setMtAccountConnection({ data: { accountId: mt.mcAccountId, connected: true } });
      if (!open.ok) {
        setErrorMessage(open.message);
        toast.error(open.message);
        return;
      }
      // Verified — now disconnect so nothing stays running in the background.
      const close = await setMtAccountConnection({ data: { accountId: mt.mcAccountId, connected: false } });
      toast.success(
        `Connection verified ✓ — ${open.currency ?? ""} ${open.balance?.toFixed(2) ?? "?"} balance${close.ok ? " · disconnected again" : ""}`,
      );
      setTestResult(
        `Verified: ${open.currency ?? ""} ${open.balance?.toFixed(2) ?? "?"} balance — connection closed again.`,
      );
    } finally {
      setTesting(false);
    }
  };

  const removeConnection = async () => {
    if (!mt) return;
    if (!window.confirm(`Delete the saved details for ${mt.loginId} on this device and the hosting platform?`)) return;
    if (mt.mcAccountId) {
      // Best-effort undeploy (offline anyway), then remove the hosted copy.
      const result = await disconnectMt5Account({ data: { accountId: mt.mcAccountId } });
      if (!result.ok) toast.warning(result.message);
    }
    disconnectMt();
    writeMt5Ui(null);
    if (app.email) void syncDeleteMt5Account({ data: { userId: app.email } }).catch(() => {});
    toast.success("Saved MT5 details removed.");
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

          {/* Saved card — always OFFLINE until a trade executes */}
          {mt ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 rounded-[24px] border p-5"
              style={{ borderColor: `${accent}59`, background: `linear-gradient(180deg, ${accent}14, rgba(0,0,0,0.5))` }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: accent }}>Saved details</p>
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold ${
                    mt.kind === "demo" ? "bg-sky-400/10 text-sky-300" : "bg-white/10 text-white/70"
                  }`}
                >
                  {mt.kind === "demo" ? "DEMO" : "SAVED"}
                </span>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xl font-black">
                <span className="inline-block size-2.5 rounded-full bg-white/25" aria-hidden="true" />
                Disconnected / Offline
              </p>
              <p className="mt-1 text-sm text-white/60">Account {mt.loginId} · {mt.server}</p>
              <p className="mt-1 text-xs text-white/40">
                {mt.accountType}{mt.environment ? ` · region ${mt.environment}` : ""}{mt.kind ? ` · ${mt.kind === "demo" ? "DEMO" : "LIVE"} account` : ""}
              </p>
              <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-[12px] leading-relaxed text-white/55">
                The broker connection opens automatically ONLY while a trade executes, and closes right afterwards. Nothing
                connects in the background.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void checkStatus()}
                  disabled={testing}
                  className="h-11 flex-1 rounded-2xl bg-white/[0.05] text-xs font-bold text-emerald-300 transition-transform active:scale-[0.97] disabled:opacity-60"
                >
                  {testing ? "TESTING..." : "TEST CONNECTION"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeConnection()}
                  className="h-11 flex-1 rounded-2xl bg-white/[0.05] text-xs font-bold text-white/60 transition-transform active:scale-[0.97] hover:text-red-300"
                >
                  REMOVE DETAILS
                </button>
              </div>
              {testResult && (
                <p className="mt-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-[12px] text-emerald-200">
                  {testResult}
                </p>
              )}
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
                  onChange={(event) => {
                    clearError();
                    setBroker(event.target.value);
                  }}
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
                  onChange={(event) => {
                    clearError();
                    setServer(event.target.value);
                  }}
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
                  onChange={(event) => {
                    clearError();
                    setLoginId(event.target.value);
                  }}
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
                  onChange={(event) => {
                    clearError();
                    setPassword(event.target.value);
                  }}
                  placeholder="••••••••"
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
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
              {errorMessage && (
                <div
                  role={keyNotice ? "status" : "alert"}
                  className={`mb-4 flex items-start gap-3 rounded-2xl border p-4 ${
                    keyNotice ? "border-amber-400/25 bg-amber-400/10" : "border-red-400/30 bg-red-400/10"
                  }`}
                >
                  {keyNotice ? (
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-300" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" />
                  )}
                  <p className={`text-sm leading-relaxed ${keyNotice ? "text-amber-200/90" : "text-red-200/90"}`}>{errorMessage}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={saving}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-[28px] text-lg font-black text-black transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
                style={{ background: `linear-gradient(180deg, ${accent}, ${accent}cc)`, boxShadow: `0 14px 44px ${accent}66` }}
              >
                {saving ? (
                  <span className="flex items-center gap-3">
                    <span className="size-5 animate-spin rounded-full border-[3px] border-black/70 border-t-transparent" />
                    SAVING...
                  </span>
                ) : (
                  "Save Details"
                )}
              </button>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-white/30">
                Saving does NOT connect to the broker. Your credentials are stored securely on the server and are used only
                to open a verified connection at the moment a trade executes — the connection closes immediately afterwards.
                Passwords are never displayed, logged, or stored on this device.
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
