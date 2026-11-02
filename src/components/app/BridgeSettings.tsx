import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  getBridgeUrl,
  normalizeBridgeUrl,
  setBridgeUrl,
  testBridgeConnection,
} from "@/lib/bridge-client";

/**
 * THE TRADING BRIDGE, EDITABLE FROM SETTINGS.
 *
 * The bridge sits behind a cloudflared quick tunnel whose hostname is minted
 * fresh on every restart, so a baked-in address goes stale while the bridge
 * itself is perfectly online. The address is a SETTING now: typed here, saved
 * to localStorage, and read by EVERY bridge call (scalper start/stop/status,
 * analysis, quotes, execution) through `getBridgeUrl()` — no component keeps a
 * copy, so one edit re-points the whole app without a redeploy.
 *
 * TEST BRIDGE calls `GET {bridgeUrl}/scalper/status` with a 10-second bound and
 * reports exactly three things: "Bridge OK", "Bridge answered but returned an
 * error (HTTP <code>)", or "Could not reach bridge (<real reason>)". The
 * reason is the actual failure — a timeout is a timeout, a dead hostname is a
 * DNS/refused/TLS failure, a CORS refusal says so. Nothing generic, and the
 * screen never freezes: the call is async and only this button shows a spinner.
 */
type TestOutcome = { tone: "ok" | "error"; text: string };

export function BridgeSettingsSection({ accent }: { accent: string }) {
  const [value, setValue] = useState(() => getBridgeUrl());
  const [saved, setSaved] = useState(() => getBridgeUrl());
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  /** Persist what is typed (on blur / Enter) so a reload keeps the address. */
  const saveValue = (): string | null => {
    const applied = setBridgeUrl(value);
    if (!applied) {
      setOutcome({ tone: "error", text: "Could not reach bridge (that is not a valid http(s) address)" });
      return null;
    }
    setValue(applied);
    setSaved(applied);
    return applied;
  };

  const runTest = async () => {
    setTesting(true);
    setOutcome(null);
    try {
      // The field is the source of truth for the test: type the tunnel, press
      // Test bridge, and this device is already pointed at it.
      const target = saveValue() ?? normalizeBridgeUrl(value);
      if (!target) return;
      const result = await testBridgeConnection(target);
      if (result.kind === "ok") {
        setOutcome({ tone: "ok", text: "Bridge OK" });
      } else if (result.kind === "http") {
        setOutcome({
          tone: "error",
          text: `Bridge answered but returned an error (HTTP ${result.status})`,
        });
      } else {
        setOutcome({ tone: "error", text: `Could not reach bridge (${result.reason})` });
      }
    } finally {
      // ALWAYS release the button — a failed test must never leave the screen
      // waiting on it.
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-white/45">
          Bridge URL
        </span>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOutcome(null);
          }}
          onBlur={() => {
            saveValue();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveValue();
            }
          }}
          placeholder="https://your-tunnel.trycloudflare.com"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.04] px-4 font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-white/35"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-xs font-black uppercase tracking-[0.12em] text-black transition-transform active:scale-[.98] disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : null}
          {testing ? "Testing…" : "Test bridge"}
        </button>
      </div>

      {outcome && (
        <p
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs font-semibold leading-relaxed ${
            outcome.tone === "ok"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border-red-400/25 bg-red-400/10 text-red-300"
          }`}
          role="status"
          aria-live="polite"
        >
          {outcome.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="min-w-0 break-words">{outcome.text}</span>
        </p>
      )}

      <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 font-mono text-[11px] leading-relaxed text-white/45">
        In use now: <span className="text-white/70">{saved}</span>
      </p>
      <p className="text-[11px] leading-relaxed text-white/35">
        Every scalper start/stop/status, analysis and execution call reads this address. Testing waits at
        most 10 seconds — the button never freezes the app.
      </p>
    </div>
  );
}
