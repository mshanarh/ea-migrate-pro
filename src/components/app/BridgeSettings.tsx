import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { testBridgeConnection } from "@/lib/bridge-client";

/**
 * THE TRADING BRIDGE — READ ONLY, WITH A TEST BUTTON.
 *
 * There is no address to type and nothing to save: the bridge URL is hardcoded
 * in `src/lib/bridge-client.ts` and every call (test, scalper start/stop/status,
 * quotes, candles, execution) reads that one constant. A pasted address used to
 * be stored per device, which meant a stale tunnel could point this phone at a
 * dead host while the bridge was online — and no screen ever asks for it now.
 * It is not shown either: not in this card, not in the execution log, not in an
 * error message. Only the bridge's answers and the real failure reasons appear.
 *
 * TEST BRIDGE calls `GET {bridge}/scalper/status` with a 10-second bound and
 * reports exactly three things: "Bridge OK", "Bridge answered but returned an
 * error (HTTP <code>)", or "Could not reach bridge (<real reason>)". The reason
 * is the actual failure — a timeout is a timeout, a dead hostname is a
 * DNS/refused/TLS failure, a CORS refusal says so. The call is async and only
 * this button shows a spinner, so the screen never freezes.
 */
type TestOutcome = { tone: "ok" | "error"; text: string };

export function BridgeSettingsSection({ accent }: { accent: string }) {
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  const runTest = async () => {
    setTesting(true);
    setOutcome(null);
    try {
      const result = await testBridgeConnection();
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
      <button
        type="button"
        onClick={() => void runTest()}
        disabled={testing}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-xs font-black uppercase tracking-[0.12em] text-black transition-transform active:scale-[.98] disabled:opacity-60"
        style={{ backgroundColor: accent }}
      >
        {testing ? <Loader2 className="size-4 animate-spin" /> : null}
        {testing ? "Testing…" : "Test bridge"}
      </button>

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

      <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[11px] leading-relaxed text-white/45">
        Connection: built into the app — nothing to set up, and no address to enter. The server address is never
        displayed; only its answers are.
      </p>
      <p className="text-[11px] leading-relaxed text-white/35">
        Every scalper start/stop/status, analysis and execution call uses the same built-in server. Testing waits at
        most 10 seconds, so the button never freezes the app.
      </p>
    </div>
  );
}
