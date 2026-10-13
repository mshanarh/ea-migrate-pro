import { createServerFn } from "@tanstack/react-start";
import { analyzeMarket, type ScannerAnalysis, type ScannerAnalysisRequest } from "@/lib/market-scanner-core";

/**
 * Market Scanner server function — a thin TanStack Start wrapper around the
 * pure analysis engine in market-scanner-core.ts. 100% MetaApi-free and
 * broker-independent: candles come from the public market feed via flexible
 * symbol mapping (HW_100, XAUUSD, FLAME…), and the engine NEVER throws —
 * every failure is a clean, renderable fallback.
 *
 * Trade execution is NOT here: it lives in mt5-bridge.server.ts (the user's
 * own VPS bridge) — scanning and execution never touch.
 */

export type { ScannerAnalysis, ScannerAnalysisRequest };

type ScannerFailure = { ok: false; code: string; message: string };

export const getScannerAnalysis = createServerFn({ method: "POST" })
  .validator((data: ScannerAnalysisRequest) => data)
  .handler(async ({ data }): Promise<{ ok: true; analysis: ScannerAnalysis } | ScannerFailure> =>
    analyzeMarket(data),
  );
