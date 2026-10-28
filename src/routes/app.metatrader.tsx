import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronsRight, Clock, Database, Eye, EyeOff, Fingerprint, Lock, RefreshCw, ShieldCheck, User } from "lucide-react";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { EaConfigNote } from "@/components/app/EaConfigNote";
import { ScalperStatusStrip } from "@/components/app/ScalperStatusStrip";
import { useScalperDaemonStatus } from "@/lib/use-scalper-status";
import { connectMt, disconnectMt, getAppState, leaveForCheckout, useAppState, type MtAccount } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { usePlatform } from "@/lib/platform";
import { saveMt5Credentials } from "@/lib/mt5-bridge.server";
import { friendlyTradeError } from "@/lib/trade-errors";
import { BRIDGE_KEY, bridgeUnreachableMessage, getBridgeUrl } from "@/lib/bridge-client";
import { syncDeleteMt5Account, syncGetMt5Account } from "@/lib/account-sync.server";
import { brokerLogoUrl, companyFromBridgeReply, serverFromBridgeReply } from "@/lib/broker-identity";

export const Route = createFileRoute("/app/metatrader")({
  ssr: false,
  beforeLoad: () => {
    // Cloud-verified gates: no email → app login; a local "paid" record the
    // database does not confirm → Whop checkout.
    //
    // PAINT FIRST — the cached verdict renders synchronously and the cloud is
    // re-asked behind the screen (see peekAccessVerdict).
    const apply = (access: AppAccessCheck) => {
      if (access.action === "signin") throw redirect({ href: "/app/login" });
      // Access revoked by the owner (Set unpaid) — the gate signed the session
      // out; hand them the first page with the notice.
      if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
      if (access.action === "pay") {
        leaveForCheckout();
        throw redirect({ href: "/app/login?pay=1" });
      }
    };
    const email = getAppState().email;
    const cached = peekAccessVerdict(email);
    if (cached) {
      apply(cached);
      return;
    }
    return requireVerifiedAccess(email).then(apply);
  },
  head: () => ({
    meta: [
      { title: "MetaTrader — EA Migrate" },
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

const labelClass = "plat-uppercase-label text-[11px] font-bold tracking-[0.28em] text-white/40 uppercase";
/**
 * Platform-adaptive field: height and corner radius come from the platform
 * tokens (Material 16px/54px vs iOS 14px/50px). The dark surface, focus ring
 * and typography are shared — this is the same input on both platforms.
 */
const fieldClass =
  "if-field plat-field w-full border px-5 text-base outline-none transition-all duration-200 placeholder:text-white/25 focus:border-white/25";

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
      <text x="48" y="47" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="900" fill="#3c4350" stroke="#ffffff" strokeWidth="0.6">5</text>
    </svg>
  );
}

/**
 * THE BROKER'S OWN LOGO, WITH A GUARANTEED FALLBACK.
 *
 * The domain is derived from the company name the bridge reported (see
 * broker-identity.ts) and the image comes from logo.dev with the publishable
 * key from the environment. An unknown broker, a missing key or an image that
 * fails to load all fall back to the existing MetaTrader mark — a broken
 * image is never shown.
 */
function BrokerLogo({ company, server, accent }: { company: string; server: string; accent: string }) {
  const [failed, setFailed] = useState(false);
  const url = company ? brokerLogoUrl(company, server) : null;
  if (!url || failed) {
    return <span className="block scale-75"><Mt5Logo /></span>;
  }
  return (
    <img
      src={url}
      alt={company}
      onError={() => setFailed(true)}
      className="size-32 rounded-[28px] bg-white object-contain p-2"
      style={{ boxShadow: `0 10px 30px rgba(0,0,0,0.6), 0 0 0 1px ${accent}44` }}
    />
  );
}

/** The four steps the connect overlay narrates, in order. */
const SYNC_STEP_LABELS = [
  "Checking broker details",
  "Logging in",
  "Checking password",
  "Syncing account",
] as const;

type SyncStepState = "idle" | "active" | "done" | "failed";
type SyncPhase = "syncing" | "connected" | "failed";
type SyncState = {
  /**
   * The broker's OWN name — MT5's `company`, known only after the bridge
   * answers. Empty until then: the overlay shows nothing rather than guessing.
   */
  brokerLabel: string;
  /** The account login and server from the real reply/form. */
  login: string;
  server: string;
  phase: SyncPhase;
  steps: SyncStepState[];
  detail: string | null;
};

const SYNC_CAPTION: Record<SyncPhase, string> = {
  syncing: "SYNCING ACCOUNT…",
  connected: "ACCOUNT CONNECTED ✓",
  failed: "CONNECTION FAILED",
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * FULL-SCREEN SYNC OVERLAY — the broker-style "verifying your account"
 * experience on CONNECT ACCOUNT. The forced save already happened (the
 * details live on this device); this overlay makes the REAL bridge
 * verification visible step by step instead of a silent background toast.
 * Dark dimmed backdrop over the form, pulsing accent ring around the MT5
 * mark, the broker name large, letterspaced caption, and the step list with
 * spinner / tick / cross per row.
 */
function Mt5SyncOverlay({
  state,
  accent,
  onRetry,
  onContinue,
}: {
  state: SyncState;
  accent: string;
  onRetry: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      data-testid="overlay-mt5-sync"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 px-8 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Verifying MT5 account"
      style={{ boxShadow: `inset 0 0 160px ${accent}22` }}
    >
      {/* Pulsing accent ring with the MT5 mark glowing in the middle */}
      <div className="relative flex size-40 items-center justify-center">
        {state.phase === "syncing" && (
          <span
            aria-hidden
            className="absolute inset-0 animate-spin rounded-full border-[3px] border-white/10"
            style={{ borderTopColor: accent, animationDuration: "1.6s", boxShadow: `0 0 30px ${accent}55` }}
          />
        )}
        <span
          aria-hidden
          className={state.phase === "syncing" ? "animate-pulse" : ""}
          style={{ filter: `drop-shadow(0 0 26px ${accent}88)` }}
        >
          <BrokerLogo
            key={`${state.brokerLabel}|${state.server}`}
            company={state.brokerLabel}
            server={state.server}
            accent={accent}
          />
        </span>
      </div>

      {/* Broker name — the bridge's `company`, never a guess. Until it answers,
          the space is reserved but empty. */}
      {state.brokerLabel ? (
        <p
          data-testid="text-sync-broker"
          className="mt-5 max-w-[20rem] text-center text-3xl font-black tracking-tight text-white"
        >
          {state.brokerLabel}
        </p>
      ) : (
        <div aria-hidden className="mt-5 h-9" />
      )}
      <p data-testid="text-sync-account" className="mt-1 text-center text-[12px] font-semibold text-white/45">
        {state.login ? `Account ${state.login}` : ""}
        {state.login && state.server ? " · " : ""}
        {state.server}
      </p>
      <p
        className="mt-2 text-center text-[13px] font-black uppercase tracking-[0.35em]"
        style={{
          color:
            state.phase === "connected" ? "#4ade80" : state.phase === "failed" ? "#f87171" : accent,
        }}
        data-testid="text-sync-caption"
      >
        {SYNC_CAPTION[state.phase]}
      </p>
      {state.phase !== "failed" && (
        <p className="mt-2 max-w-[19rem] text-center text-[12px] leading-relaxed text-white/50">
          This can take a few seconds while your broker terminal starts up.
        </p>
      )}
      {state.phase === "failed" && state.detail && (
        <p className="mt-3 max-w-[20rem] text-center text-[13px] leading-relaxed text-red-200/90" data-testid="text-sync-error">
          {state.detail}
        </p>
      )}

      {/* The step list — spinner while active, green tick once passed, red
          cross on failure, dimmed before it starts. */}
      <ul className="mt-6 w-full max-w-[19rem] space-y-2.5">
        {SYNC_STEP_LABELS.map((label, index) => {
          const step = state.steps[index] ?? "idle";
          return (
            <li key={label} className="flex items-center gap-3 text-[13px] font-semibold">
              <span
                className="flex size-5 shrink-0 items-center justify-center"
                aria-hidden
                style={{
                  color: step === "done" ? "#4ade80" : step === "failed" ? "#f87171" : "rgba(255,255,255,0.45)",
                }}
              >
                {step === "active" ? (
                  <span
                    className="size-4 animate-spin rounded-full border-2 border-white/15"
                    style={{ borderTopColor: accent }}
                  />
                ) : step === "done" ? (
                  <span className="text-[15px] font-black">✓</span>
                ) : step === "failed" ? (
                  <span className="text-[15px] font-black">✗</span>
                ) : (
                  <span className="size-1.5 rounded-full bg-white/30" />
                )}
              </span>
              <span
                className={
                  step === "idle"
                    ? "text-white/40"
                    : step === "failed"
                      ? "text-red-200"
                      : step === "done"
                        ? "text-white/85"
                        : "text-white"
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>

      {state.phase === "failed" && (
        <div className="mt-7 flex w-full max-w-[19rem] flex-col gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            data-testid="button-sync-retry"
            className="h-12 w-full rounded-full text-[13px] font-black tracking-[0.2em] text-white transition-transform active:scale-[0.98]"
            style={{ background: accent, boxShadow: `0 0 24px ${accent}55` }}
          >
            TRY AGAIN
          </button>
          <button
            type="button"
            onClick={onContinue}
            data-testid="button-sync-continue"
            className="h-12 w-full rounded-full border border-white/20 text-[13px] font-black tracking-[0.2em] text-white/70"
          >
            CONTINUE ANYWAY
          </button>
        </div>
      )}
    </div>
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
  const platform = usePlatform();
  const isIos = platform === "ios";
  const mt = app.mt;
  const navigate = useNavigate();
  // The full scalper-daemon detail lives HERE now (the home screen keeps only a
  // tiny pill): the same GET /scalper/status poll, the STATUS button and the
  // daemon's last line. The symbols strip's REFRESH reads the server config by
  // licence key, exactly as it did on the home screen.
  const { status: daemonStatus, error: daemonError, refresh: refreshDaemon } = useScalperDaemonStatus();

  // Full-screen staged verification overlay (CONNECT ACCOUNT → syncing…).
  const [sync, setSync] = useState<SyncState | null>(null);
  /** Monotonic attempt id — a superseded overlay run must stop updating UI. */
  const syncAttemptRef = useRef(0);
  /** The details of the run currently shown, so TRY AGAIN can re-verify. */
  const syncDetailsRef = useRef<{ login: string; password: string; server: string; brokerLabel: string } | null>(null);

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
   * THE ONE REAL VERIFICATION behind the overlay's steps 2–4 — the same
   * direct browser → bridge call the TEST CONNECTION button uses, with an
   * overall 15s timeout so the overlay can never hang.
   */
  const verifyViaBridge = async (login: string, pass: string, srv: string): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${getBridgeUrl()}/account/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
        body: JSON.stringify({ login: Number(login) || login, password: pass, server: srv }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ...payload, __httpOk: response.ok, __status: response.status };
    } finally {
      clearTimeout(timer);
    }
  };

  /** The balance/equity summary line from the bridge's account_info. */
  const accountSummary = (accountInfo: unknown): string => {
    const account = (accountInfo ?? {}) as Record<string, unknown>;
    const num = (key: string): number | null => {
      const value = account[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const currency = typeof account["currency"] === "string" && account["currency"] ? `${account["currency"]} ` : "";
    const fmt = (value: number | null) =>
      value === null ? "" : currency + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const marginFree = num("margin_free") ?? num("equity") ?? num("balance");
    const balance = num("balance");
    const equity = num("equity");
    if (marginFree === null && balance === null && equity === null) {
      return "Account ready — trades will execute on demand.";
    }
    return (
      `Free margin: ${fmt(marginFree) || "—"}` +
      (balance !== null ? ` · Balance: ${fmt(balance)}` : "") +
      (equity !== null ? ` · Equity: ${fmt(equity)}` : "")
    );
  };

  /**
   * RUN THE STAGED VERIFICATION the overlay narrates. Step 1 (broker details)
   * passes on the validated form; steps 2–4 (login / password / syncing) are
   * driven by ONE real bridge call. Every exit path is covered: success closes
   * the overlay and navigates home; failure shows TRY AGAIN / CONTINUE
   * ANYWAY (the account stays saved); an unexpected crash closes the overlay
   * and falls back to today's behavior — the account is always saved.
   */
  const runSync = async (details: { login: string; password: string; server: string; brokerLabel: string }) => {
    const attempt = ++syncAttemptRef.current;
    syncDetailsRef.current = details;
    const stale = () => syncAttemptRef.current !== attempt;
    const patch = (next: Partial<SyncState>) =>
      setSync((prev) => (prev ? { ...prev, ...next } : prev));

    setSync({
      // NOTHING IS GUESSED: the broker name arrives with the bridge answer.
      brokerLabel: "",
      login: details.login,
      server: details.server,
      phase: "syncing",
      steps: ["active", "idle", "idle", "idle"],
      detail: null,
    });
    try {
      // Step 1 — broker details: the form already validated them; a brief
      // pause so the sequence reads as a check, not a flash.
      await pause(750);
      if (stale()) return;
      patch({ steps: ["done", "active", "idle", "idle"] });

      // ONE real verification drives login → password → syncing.
      let ok = false;
      let summary = "";
      let failure = "";
      let company = "";
      let liveServer = details.server;
      try {
        const payload = await verifyViaBridge(details.login, details.password, details.server);
        if (payload["__httpOk"] === true && payload["success"] === true) {
          ok = true;
          summary = accountSummary(payload["account"]);
          // THE REAL BROKER IDENTITY — `company` from MT5, `server` beside it.
          company = companyFromBridgeReply(payload);
          liveServer = serverFromBridgeReply(payload) || details.server;
        } else {
          const raw =
            (typeof payload["detail"] === "string" && payload["detail"]) ||
            (typeof payload["message"] === "string" && payload["message"]) ||
            `Verification failed (HTTP ${Number(payload["__status"]) || "network"}).`;
          failure = friendlyTradeError(raw);
        }
      } catch (error) {
        failure =
          (error as Error)?.name === "AbortError"
            ? "The broker did not answer within 15 seconds — check the server name and try again."
            : "Could not reach the trading bridge — check your connection and try again.";
      }
      if (stale()) return;

      if (!ok) {
        patch({ phase: "failed", steps: ["done", "failed", "idle", "idle"], detail: failure });
        return;
      }

      // The bridge has answered — show the broker it named (or nothing).
      patch({ brokerLabel: company, server: liveServer });
      if (company) {
        const saved = getAppState().mt;
        if (saved) connectMt({ ...saved, company });
      }

      // Success — tick the remaining steps one at a time so the sequence is
      // visible, then hold the connected state with the balance line.
      patch({ steps: ["done", "done", "active", "idle"] });
      await pause(700);
      if (stale()) return;
      patch({ steps: ["done", "done", "done", "active"] });
      await pause(700);
      if (stale()) return;
      patch({ phase: "connected", steps: ["done", "done", "done", "done"], detail: summary });
      try { window.localStorage.setItem("mt5_last_verified", new Date().toLocaleTimeString()); } catch { /* ignore */ }
      await pause(1200);
      if (stale()) return;
      setSync(null);
      toast.success(`Connected ✓ — Account ${details.login} · ${details.server}`);
      void navigate({ to: "/app/home" });
    } catch {
      // The overlay must never block the save — fall back to the old flow.
      setSync(null);
      toast.success(`Saved ✓ — Account ${details.login} · ${details.server}`);
    }
  };

  /** CONTINUE ANYWAY — close the overlay; the details stay saved on device. */
  const dismissSync = () => {
    syncAttemptRef.current += 1; // cancel any in-flight overlay run
    setSync(null);
    const details = syncDetailsRef.current;
    toast.success(
      details ? `Saved ✓ — Account ${details.login} · ${details.server}` : "Saved ✓ — verify later from TEST CONNECTION.",
    );
  };

  /**
   * SAVE DETAILS — FORCED SAVE. The details are stored on this device right
   * away (nothing can block that), then the staged overlay runs the REAL
   * bridge verification while a best-effort cloud copy is stored in the
   * background. A bridge outage or wrong password NEVER blocks or fails the
   * save — the account is simply verified later, when a trade executes.
   */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || sync) return;
    if (!loginId.trim() || !password.trim() || !server.trim()) {
      toast.error("Fill in server, login ID and password.");
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setKeyNotice(false);

    // 1. Save NOW on this device — instant, cannot fail.
    const derivedBroker = broker.trim() || (server.includes("-") ? (server.split("-")[0]?.trim() ?? server.trim()) : server.trim());
    const account: MtAccount = {
      platform: "MT5",
      broker: derivedBroker,
      server: server.trim(),
      accountType,
      loginId: loginId.trim(),
    };
    connectMt(account);
    writeMt5Ui({ login: account.loginId, server: account.server, saved: true });
    try { window.localStorage.setItem("mt5_last_verified", new Date().toLocaleTimeString()); } catch { /* ignore */ }
    const typedPassword = password.trim();
    // Keep the password ON THIS DEVICE ONLY so the scanner can execute trades
    // directly against the bridge from the browser (the deployed app is a
    // static client site — there is no server to hold the secret).
    try {
      window.localStorage.setItem("mt_password", typedPassword);
    } catch {
      /* storage unavailable — execution will ask the user to re-save */
    }
    setPassword("");
    setSaving(false);

    // 2. Staged verification overlay — REAL bridge work, visible step by
    //    step. On success it toasts and navigates home; on failure it offers
    //    TRY AGAIN / CONTINUE ANYWAY and the save above always stands.
    void runSync({
      login: account.loginId,
      password: typedPassword,
      server: account.server,
      // Deliberately empty: the overlay names the broker only after the
      // bridge reports its `company`.
      brokerLabel: "",
    });

    // 3. Cloud copy in the background — persisted best-effort; its own
    //    verification result is announced only by the overlay (no duplicate
    //    "Connected ✓" toast).
    void (async () => {
      try {
        await saveMt5Credentials({
          data: {
            userId: app.email ?? "device-local",
            login: account.loginId,
            password: typedPassword,
            server: account.server,
            broker: derivedBroker,
            accountType,
          },
        });
        // An unverified result is NOT a rejection — it can be a slow bridge.
        // The device keeps the password so execution still works; wrong
        // credentials surface as a clear error on the next Execute attempt.
      } catch {
        /* cloud/bridge unreachable — details are still saved on this device */
      }
    })();
  };

  /**
   * TEST CONNECTION — verifies the saved account through the bridge and
   * shows the money available on the MT5 account. Uses the freshly typed
   * password when present, otherwise the password stored on this device at
   * save time — so testing needs NO typing at all.
   */
  const checkStatus = async () => {
    if (!mt || testing) return;
    let activePassword = password.trim();
    if (!activePassword) {
      try {
        activePassword = window.localStorage.getItem("mt_password") ?? "";
      } catch {
        activePassword = "";
      }
    }
    if (!activePassword) {
      setTestResult(null);
      setErrorMessage(
        "No password on this device yet — type it once and tap SAVE, then TEST CONNECTION will check your account automatically.",
      );
      return;
    }
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      // Direct browser → bridge verification: the static production build has
      // no server functions, so this goes to the bridge exactly like trade
      // execution does.
      const response = await fetch(`${getBridgeUrl()}/account/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
        body: JSON.stringify({
          login: Number(mt.loginId) || mt.loginId,
          password: activePassword,
          server: mt.server,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const rawDetail =
        (typeof payload["detail"] === "string" && payload["detail"]) ||
        (typeof payload["message"] === "string" && payload["message"]) ||
        "";
      if (!response.ok || payload["success"] !== true) {
        const message = friendlyTradeError(rawDetail || `Verification failed (HTTP ${response.status}).`);
        setErrorMessage(message);
        toast.error(message);
        return;
      }
      // The bridge returns the live MT5 account_info on success — lead with
      // the money available to trade (free margin), then balance and equity.
      const account = (payload["account"] ?? {}) as Record<string, unknown>;
      const num = (key: string): number | null => {
        const value = account[key];
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      };
      const currency = typeof account["currency"] === "string" && account["currency"] ? account["currency"] : "";
      const cur = currency ? `${currency} ` : "";
      const fmt = (value: number | null) =>
        value === null ? "—" : cur + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const marginFree = num("margin_free") ?? num("equity") ?? num("balance");
      const balance = num("balance");
      const equity = num("equity");
      // Persist the broker's real company name from this verification.
      const company = companyFromBridgeReply(payload);
      if (company) {
        const saved = getAppState().mt;
        if (saved) connectMt({ ...saved, company });
      }
      try { window.localStorage.setItem("mt5_last_verified", new Date().toLocaleTimeString()); } catch { /* ignore */ }
      toast.success(`Connected ✓ — ${company ? `${company} · ` : ""}Account ${mt.loginId} · ${mt.server}`);
      if (marginFree === null && balance === null && equity === null) {
        setTestResult(
          `Connected ✓ — ${company ? `${company} · ` : ""}Account ${mt.loginId} on ${mt.server} is ready — trades will execute on demand.`,
        );
        return;
      }
      setTestResult(
        `Connected ✓ — ${company ? `${company} · ` : ""}Free margin available: ${fmt(marginFree)}` +
          (balance !== null ? ` · Balance: ${fmt(balance)}` : "") +
          (equity !== null ? ` · Equity: ${fmt(equity)}` : "") +
          " — ready to execute.",
      );
    } catch (error) {
      // The address being called is part of the message — "Failed to fetch"
      // alone cannot tell a dead tunnel from a network problem.
      console.warn(`[metatrader] bridge verify failed at ${getBridgeUrl()}/account/verify`, error);
      const message = bridgeUnreachableMessage(error instanceof Error ? error.message : undefined);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  const removeConnection = async () => {
    if (!mt) return;
    if (!window.confirm(`Delete the saved details for ${mt.loginId} on this device and the hosting platform?`)) return;
    disconnectMt();
    writeMt5Ui(null);
    if (app.email) void syncDeleteMt5Account({ data: { userId: app.email } }).catch(() => {});
    toast.success("Saved MT5 details removed.");
  };

  const stagger = {
    hidden: { opacity: 0, y: 18 },
    show: (index: number) => ({ opacity: 1, y: 0, transition: { delay: index * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } }),
  };

  const online = Boolean(mt);
  const lastVerified = (() => {
    try { return window.localStorage.getItem("mt5_last_verified"); } catch { return null; }
  })();
  const field = "if-field flex h-16 items-center gap-4 rounded-full border px-6 focus-within:border-white/30";

  return (
    <div className="app-fullscreen if-screen relative bg-[#070d10] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px]" style={{ background: `radial-gradient(ellipse 70% 55% at 50% -8%, ${accent}22, transparent 70%)` }} />
      <div className="app-scroll-area relative">
        <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pt-safe pb-safe-nav">
          <motion.header initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="if-muted text-xs font-bold tracking-[0.35em] uppercase">EA Migrate</p>
              <h1 className="if-header if-header-rule if-text mt-1 text-3xl font-black tracking-tight">Connect Account</h1>
            </div>
            <span className={`if-chip flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black tracking-[0.15em] ${online ? "text-emerald-300" : "text-red-300"}`}>
              <span className={`size-2 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              {online ? "ONLINE" : "OFFLINE"}
            </span>
          </motion.header>

          {/* THE SCALPER DAEMON — moved off the home screen: its symbols strip,
              STATUS button and last log line live here, unchanged. */}
          <motion.section custom={0} variants={stagger} initial="hidden" animate="show" className="if-card rounded-[32px] border border-white/10 bg-white/[0.03] p-4">
            <p className="if-muted text-xs font-bold tracking-[0.3em] uppercase">Scalper &amp; robot config</p>
            <div className="mt-2 flex flex-col gap-3">
              <EaConfigNote />
              <ScalperStatusStrip
                status={daemonStatus}
                error={daemonError}
                busy={false}
                onRefresh={refreshDaemon}
              />
            </div>
          </motion.section>

          <motion.section custom={0} variants={stagger} initial="hidden" animate="show" className="if-card rounded-[32px] border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between">
              <p className="if-muted text-xs font-bold tracking-[0.3em] uppercase">MT5 Status</p>
              {mt && (
                <button type="button" onClick={() => void checkStatus()} disabled={testing} className="flex items-center gap-1.5 text-sm text-white/60 disabled:opacity-50">
                  <RefreshCw className={`size-4 ${testing ? "animate-spin" : ""}`} /> {testing ? "testing" : "test"}
                </button>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="if-well rounded-3xl border p-4">
                <p className="if-muted flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] uppercase"><ShieldCheck className="size-3.5" /> Connection</p>
                <p className={`mt-1 text-lg font-black ${online ? "text-emerald-300" : "if-text"}`}>{online ? "Linked" : "Not linked"}</p>
              </div>
              <div className="if-well rounded-3xl border p-4">
                <p className="if-muted flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] uppercase"><Clock className="size-3.5" /> Last verified</p>
                <p className="if-num if-text mt-1 text-lg font-black">{lastVerified ?? "—"}</p>
              </div>
            </div>
            {mt && (
              <div className="if-well mt-3 flex items-center justify-between gap-3 rounded-full border px-5 py-3 text-sm">
                {/* The broker's own name comes from MT5's `company`; until a
                    verification has reported it, only the real login/server show. */}
                <span className="if-text truncate">
                  {mt.company ? `${mt.company} · ${mt.loginId}` : mt.loginId} · {mt.server}
                </span>
                <button type="button" onClick={() => void removeConnection()} className="shrink-0 text-xs font-bold text-white/50 hover:text-red-300">REMOVE</button>
              </div>
            )}
            {testResult && <p className="mt-3 rounded-3xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-200">{testResult}</p>}
            {errorMessage && (
              <div role="alert" className="mt-3 flex items-start gap-3 rounded-3xl border border-red-400/30 bg-red-500/10 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
                <p className="text-sm text-red-200/90">{errorMessage}</p>
              </div>
            )}
          </motion.section>

          <motion.form custom={1} variants={stagger} initial="hidden" animate="show" onSubmit={(event) => void submit(event)} className="if-card space-y-4 rounded-[32px] border border-white/10 bg-white/[0.03] p-5" style={{ boxShadow: `0 0 40px ${accent}14` }}>
            <label className={field}>
              <User className="size-5 shrink-0 text-white/60" />
              <input value={loginId} onChange={(e) => { clearError(); setLoginId(e.target.value); }} placeholder="Account ID" inputMode="numeric" aria-label="Account ID" className="h-full w-full bg-transparent text-lg outline-none placeholder:text-white/40" />
            </label>
            <label className={field}>
              <Lock className="size-5 shrink-0 text-white/60" />
              <input value={password} onChange={(e) => { clearError(); setPassword(e.target.value); }} placeholder="Password" type={showPassword ? "text" : "password"} autoComplete="new-password" aria-label="Password" className="h-full w-full bg-transparent text-lg outline-none placeholder:text-white/40" />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((v) => !v)} className="text-white/60">
                {showPassword ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
              </button>
            </label>
            <label className={field}>
              <Database className="size-5 shrink-0 text-white/60" />
              <input value={server} onChange={(e) => { clearError(); setServer(e.target.value); }} placeholder="Broker server only MT5" aria-label="Broker server" list="mt5-server-suggestions" className="h-full w-full bg-transparent text-lg outline-none placeholder:text-white/40" />
              <datalist id="mt5-server-suggestions">{servers.map((item) => <option key={item} value={item} />)}</datalist>
            </label>
            <p className="if-muted px-1 text-sm leading-relaxed">
              Tip: find your server name in your broker's welcome email or your MT5 terminal under <span className="if-text">File → Login to Trade Account</span>.
            </p>
            <button type="submit" disabled={saving} className="if-control flex h-16 w-full items-center justify-between rounded-full border px-6 font-black tracking-[0.25em] transition-transform active:scale-[0.98] disabled:opacity-60" style={{ borderColor: `${accent}66`, background: `linear-gradient(180deg, ${accent}33, ${accent}14)`, boxShadow: `0 0 30px ${accent}33` }}>
              <Fingerprint className="size-7" style={{ color: accent }} />
              <span>{saving ? "CONNECTING..." : "CONNECT ACCOUNT"}</span>
              <ChevronsRight className="size-6" style={{ color: accent }} />
            </button>
          </motion.form>
        </main>
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
      {/* Staged broker verification — shown while CONNECT ACCOUNT verifies
          through the bridge; failure offers TRY AGAIN / CONTINUE ANYWAY. */}
      {sync && (
        <Mt5SyncOverlay
          state={sync}
          accent={accent}
          onRetry={() => {
            const details = syncDetailsRef.current;
            if (details) void runSync(details);
            else dismissSync();
          }}
          onContinue={dismissSync}
        />
      )}
    </div>
  );
}
