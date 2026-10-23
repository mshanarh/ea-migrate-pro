import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ChartScanner from "@/components/app/ChartScanner";
import type { ExecutionOutcome, ExecutionPlan } from "@/components/app/ChartScanner";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { TradeExecutionToast } from "@/components/app/TradeExecutionToast";
import { TradeAnalysisPopup } from "@/components/app/TradeAnalysisPopup";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { useAppState } from "@/lib/app-store";
import { getAppState, leaveForCheckout } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { DAILY_LIMIT, getScanCount, isUnlimitedScanner, registerScan } from "@/lib/trading-pairs-store";
import { friendlyRetcode, friendlyTradeError } from "@/lib/trade-errors";
import { BRIDGE_KEY, BRIDGE_URL, bridgeSymbolCandidates } from "@/lib/bridge-client";
import { recordTrade } from "@/lib/trade-history";
import { setExecutionStage, startExecution, updateExecutionPlan } from "@/lib/execution-state";
import { verifyDirectionAgainstTrend } from "@/lib/auto-trade";
import { mt5OrderComment } from "@/lib/utils";

export const Route = createFileRoute("/app/scanner")({
  ssr: false,
  beforeLoad: () => {
    // Cloud-verified gates: no email → app login; a local "paid" record the
    // database does not confirm → Whop checkout.
    //
    // PAINT FIRST. A warm access cache answers synchronously and the cloud is
    // re-asked in the background, so a tap never waits on the network (and
    // never shows the "Loading…" splash) while the verdict is unchanged.
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
      { title: "AI Scanner — EA Migrate" },
      { name: "description", content: "Scan a chart and get an instant signal setup." },
    ],
  }),
  component: AppScanner,
});

function AppScanner() {
  const app = useAppState();
  const { color } = useCustomization();
  const accent = accentColorValue(color);
  const [limitOpen, setLimitOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  // The AI trade analysis card has its OWN open flag: the execution toast
  // closes itself when its sequence ends, but the analysis card stays on
  // screen with the confirmed trade until the trader dismisses it.
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const [toastSymbol, setToastSymbol] = useState("");
  const unlimited = isUnlimitedScanner(app.email);
  const scansLeft = unlimited ? Infinity : DAILY_LIMIT - getScanCount(app.email ?? "guest-device");

  // The active robot — its symbols come from the mentor portal (EA creation).
  const robot = app.robots.find((candidate) => candidate.id === app.activeRobotId) ?? app.robots[0];

  // Register one of the 5 daily SAST scans (unlimited for admins). Returns
  // false (and shows the limit modal) when the user has used all of today's scans.
  const handleScanStart = () => {
    const scan = registerScan(app.email ?? "guest-device");
    if (!scan.allowed) {
      setLimitOpen(true);
      return false;
    }
    return true;
  };

  /**
   * Execute pressed (after the user CONFIRMED in the popup) — the server
   * opens the broker connection ONLY for this order: deploy → verify the
   * live session → send the order(s) with the analyzed SL/TP → ALWAYS
   * undeploy. Statuses stream to the UI as Offline → Connecting → Connected
   * → Executing → Trade Executed / error → Disconnected.
   */
  const handleExecute = async (
    plan: ExecutionPlan,
    onProgress: (message: string) => void,
  ): Promise<ExecutionOutcome> => {
    let { symbol, lot, trades, direction, entry, stopLoss, takeProfit, estimated } = plan;

    if (!app.mt) {
      toast.error("Save your MT5 details first — MetaTrader page.");
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: {
            ok: false,
            message: "No saved MT5 details — save them on the MetaTrader page",
            status: "failed",
          },
        }),
      );
      return { ok: false, message: "No saved MT5 details — save them on the MetaTrader page first." };
    }
    if (!app.email) {
      const message = "Sign in to the portal so your saved MT5 account can be used for execution.";
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message, status: "failed" },
        }),
      );
      return { ok: false, message };
    }

    // Top execution toast + floating bot popup get the REAL analyzed values.
    window.triggerExecutionToast?.(robot?.name, robot?.image, {
      symbol,
      lot_size: lot,
      max_trades: Math.max(1, Math.min(trades, 20)),
      direction,
      ...(stopLoss ? { stopLoss } : {}),
      ...(takeProfit ? { takeProfit } : {}),
    });
    setToastTrades(Math.max(1, Math.min(trades, 20)));
    setToastSymbol(symbol);
    setToastOpen(true);
    // The AI trade analysis card opens with the run's REAL plan — symbol,
    // direction, lot size and trade count as the scanner analysed them.
    setAnalysisOpen(true);
    startExecution({
      symbol,
      direction,
      ...(Number.isFinite(Number(lot)) ? { lotSize: Number(lot) } : {}),
      totalTrades: Math.max(1, Math.min(trades, 20)),
      robotName: robot?.name ?? "",
      ...(typeof entry === "number" ? { entry } : {}),
      ...(typeof stopLoss === "number" ? { stopLoss } : {}),
      ...(typeof takeProfit === "number" ? { takeProfit } : {}),
    });
    onProgress("Connecting to broker...");
    window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message: "CONNECTING TO BROKER..." } }));

    try {
      // Direct browser → bridge execution: the app deploys as a STATIC client
      // site on Vercel, so TanStack server functions (/executeMt5ForUser) 404
      // there. The bridge accepts CORS'd browser requests, and the MT5
      // password lives on this device (stored when the user saves their
      // details on the MetaTrader page).
      const password = window.localStorage.getItem("mt_password") ?? "";
      if (!password) {
        const message =
          "MT5 password not found on this device — re-save your MT5 details on the MetaTrader page.";
        window.dispatchEvent(
          new CustomEvent("eamp:execution-result", {
            detail: { ok: false, message, status: "failed" },
          }),
        );
        return { ok: false, message };
      }
      const loginNumber = Number(app.mt.loginId);
      const credentials = {
        login: Number.isFinite(loginNumber) && loginNumber > 0 ? loginNumber : app.mt.loginId,
        password,
        server: app.mt.server,
      };
      // DIRECTION GUARD — the side about to be sent must agree with the
      // broker's OWN 1h candles (newest close vs the close five bars ago).
      // A mismatch is refused with the real closes instead of sending a
      // wrong-way order; the no-stops fallback never bypasses this.
      const directionGuard = await verifyDirectionAgainstTrend(symbol, direction, credentials);
      if (!directionGuard.ok) {
        onProgress("Direction mismatch — trade blocked");
        window.dispatchEvent(
          new CustomEvent("eamp:execution-result", {
            detail: {
              ok: false,
              status: "blocked",
              symbol,
              side: direction,
              message: directionGuard.reason,
            },
          }),
        );
        return { ok: false, message: directionGuard.reason };
      }
      // The order comment is the CURRENT BOT'S NAME EXACTLY AS CONFIGURED —
      // spaces, version text, plus signs and every other character included
      // ("sniper killer ea v2+" is sent as "sniper killer ea v2+"). Nothing
      // is stripped, collapsed, truncated or appended, and there is no brand
      // fallback: "" only when the robot has no name.
      const orderComment = mt5OrderComment(robot?.name);
      // SL/TP strategy:
      // • Feed-backed symbols — the planned levels are real-price based, send them.
      // • Estimated-price symbols (HW_100…) — planned levels sit on a simulated
      //   price scale the broker always refuses (10016), so pull the LIVE
      //   quote from the bridge (/symbol/price, bridge v0.2+) and anchor the
      //   plan's risk/reward percentages to the real price. No live quote →
      //   fall back to market without stops (still fills).
      const planEntry = Number(entry) || 0;
      const planStop = Number(stopLoss) || 0;
      const planTp = Number(takeProfit) || 0;
      let stopLossValue = estimated ? 0 : planStop;
      let takeProfitValue = estimated ? 0 : planTp;
      // The levels are anchored to the LIVE price before the order goes out.
      setExecutionStage("Setting TP and SL...");
      // The broker's own decimal count for this symbol — used to print the
      // confirmed entry / stop / target exactly as the broker did.
      let brokerDigits: number | null = null;
      if (planStop > 0 || planTp > 0) {
        try {
          const priceResponse = await fetch(`${BRIDGE_URL}/symbol/price`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
            body: JSON.stringify({ credentials, symbol }),
          });
          const pricePayload = (await priceResponse.json().catch(() => ({}))) as Record<string, unknown>;
          const bid = typeof pricePayload["bid"] === "number" ? pricePayload["bid"] : 0;
          const ask = typeof pricePayload["ask"] === "number" ? pricePayload["ask"] : 0;
          const digits = typeof pricePayload["digits"] === "number" ? pricePayload["digits"] : null;
          brokerDigits = digits;
          const point = typeof pricePayload["point"] === "number" && pricePayload["point"] > 0 ? pricePayload["point"] : 10 ** -(digits ?? 2);
          const stopsLevelPoints = typeof pricePayload["stops_level"] === "number" ? pricePayload["stops_level"] : 0;
          if (pricePayload["success"] === true && bid > 0 && ask > 0 && digits !== null && planEntry > 0) {
            const liveEntry = direction === "BUY" ? ask : bid;
            const riskPct = planStop > 0 ? Math.abs(planEntry - planStop) / planEntry : 0;
            const rewardPct = planTp > 0 ? Math.abs(planTp - planEntry) / planEntry : 0;
            // A broker can report a zero/very small stops level while still
            // rejecting levels that fall inside the spread or move by the
            // time order_send runs. Keep a small live-price safety buffer.
            // Generous buffer — brokers reject stops that sit too close to the
            // live price (10016), and the bridge then fills WITHOUT them.
            const minDistance = Math.max(stopsLevelPoints * point * 1.2, Math.abs(ask - bid) * 3, point * 25);
            const round = (value: number) => Number(value.toFixed(digits));
            if (riskPct > 0) {
              const raw = direction === "BUY" ? liveEntry * (1 - riskPct) : liveEntry * (1 + riskPct);
              stopLossValue = round(
                direction === "BUY" ? Math.min(raw, liveEntry - minDistance) : Math.max(raw, liveEntry + minDistance),
              );
            }
            if (rewardPct > 0) {
              const raw = direction === "BUY" ? liveEntry * (1 + rewardPct) : liveEntry * (1 - rewardPct);
              takeProfitValue = round(
                direction === "BUY" ? Math.max(raw, liveEntry + minDistance) : Math.min(raw, liveEntry - minDistance),
              );
            }
          }
        } catch {
          /* no live quote (older bridge) — market order without stops */
        }
      }
      const withStops = stopLossValue > 0 || takeProfitValue > 0;
      const total = Math.max(1, Math.min(trades, 20));
      let useStops = withStops;
      // The card now knows the REAL plan levels the orders will carry.
      updateExecutionPlan({
        ...(stopLossValue > 0 ? { stopLoss: stopLossValue } : {}),
        ...(takeProfitValue > 0 ? { takeProfit: takeProfitValue } : {}),
        ...(brokerDigits !== null ? { digits: brokerDigits } : {}),
      });
      setExecutionStage(`Executing ${total} trades one by one...`);

      const executeOnce = async (symbol: string): Promise<Record<string, unknown>> => {
        const response = await fetch(`${BRIDGE_URL}/trade/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bridge-key": BRIDGE_KEY,
          },
          body: JSON.stringify({
            credentials,
            symbol,
            action: direction,
            volume: Number(lot),
            stop_loss: stopLossValue,
            take_profit: takeProfitValue,
            // The EA name exactly as configured — no client-side rewriting.
            comment: orderComment,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const detail =
            (typeof payload["detail"] === "string" && payload["detail"]) ||
            (typeof payload["message"] === "string" && payload["message"]) ||
            `The bridge rejected the order (HTTP ${response.status}).`;
          const failure = new Error(friendlyTradeError(detail)) as Error & { raw?: string };
          failure.raw = detail; // keep the bridge's original words for symbol-retry detection
          throw failure;
        }
        // HTTP 200 is NOT enough — the broker's verdict lives in the body.
        // The retcode is the source of truth when present (top level or
        // nested in `result`); only 10008/10009/10010 are real fills. The
        // broker's own `comment` (e.g. "Invalid stops") is appended so the
        // user sees exactly why an order was refused.
        const result = (payload["result"] ?? {}) as Record<string, unknown>;
        const rawRetcode = payload["retcode"] ?? result["retcode"];
        const retcode =
          typeof rawRetcode === "number"
            ? rawRetcode
            : typeof rawRetcode === "string" && /^\d+$/.test(rawRetcode)
              ? Number(rawRetcode)
              : null;
        if (retcode !== null) {
          // 10008 PLACED / 10009 DONE / 10010 DONE_PARTIAL — the broker FILLED
          // the order. The `?? fallback` below used to fire on the null
          // "success" marker and reported EXECUTION ERROR on trades that were
          // actually live on the account — success must return, never throw.
          if (retcode === 10008 || retcode === 10009 || retcode === 10010) {
            return payload;
          }
          const message = friendlyRetcode(retcode) ?? `The broker refused the order (MT5 code ${retcode}).`;
          const brokerComment =
            (typeof payload["comment"] === "string" && payload["comment"]) ||
            (typeof result["comment"] === "string" && result["comment"]) ||
            "";
          const refusal = new Error(
            brokerComment && !message.includes(brokerComment) ? `${message} (Broker: ${brokerComment})` : message,
          ) as Error & { raw?: string };
          refusal.raw = message;
          throw refusal;
        } else if (payload["success"] === false) {
          const rawDetail =
            (typeof payload["message"] === "string" && payload["message"]) ||
            (typeof payload["detail"] === "string" && payload["detail"]) ||
            "The broker refused the order.";
          const refusal = new Error(friendlyTradeError(rawDetail)) as Error & { raw?: string };
          refusal.raw = rawDetail;
          throw refusal;
        }
        return payload;
      };

      // ANY-BROKER SYMBOL MATCHING — brokers brand the same market differently
      // (BTCUSDm on Exness, glued XAUUSDM, XAUUSD.i, US30Cash…). When the
      // exact name is refused, retry once through the candidate list (the
      // bridge v0.3+ also resolves names against the broker's own symbol
      // list) and keep the name that actually filled for the remaining trades.
      let symbolRetried = false;
      const isSymbolMismatch = (text: string) =>
        /symbol/i.test(text) &&
        /not found|unknown|invalid|no such|not available|not listed|renamed|rejected that symbol|isn't available|couldn't match/i.test(text);
      const executeWithSymbolFallback = async (): Promise<Record<string, unknown>> => {
        try {
          return await executeOnce(symbol);
        } catch (error) {
          const raw = ((error as Error & { raw?: string }).raw ?? (error instanceof Error ? error.message : "")) as string;
          if (symbolRetried || !(error instanceof Error) || !isSymbolMismatch(raw)) throw error;
          symbolRetried = true;
          let lastCandidateError: unknown = error;
          for (const candidate of bridgeSymbolCandidates(symbol)) {
            if (candidate.toUpperCase() === symbol.trim().toUpperCase()) continue;
            try {
              const payload = await executeOnce(candidate);
              symbol = candidate; // the working name drives the remaining trades and the report
              return payload;
            } catch (candidateError) {
              lastCandidateError = candidateError;
            }
          }
          throw lastCandidateError;
        }
      };

      // SEQUENTIAL EXECUTION — trades fire ONE BY ONE, never in parallel.
      // Each order is announced on the event bus ("TRADE N EXECUTED") the
      // moment its broker confirmation arrives, so the top toast and the
      // floating bot popup narrate the run together, in order.
      //
      // The REAL values of one confirmed order, read from the broker's own
      // response: the price it filled at, the volume that went out and the
      // levels that were really attached to the position. Nothing here is
      // estimated — a value the bridge did not report stays missing.
      const describeFill = (payload: Record<string, unknown>) => {
        const stopsRemoved = payload["stops_removed"] === true;
        const price = typeof payload["price"] === "number" ? payload["price"] : 0;
        const volume = typeof payload["volume"] === "number" ? payload["volume"] : 0;
        const rawOrder = payload["order"] ?? payload["deal"] ?? null;
        return {
          ...(price > 0 ? { entry: price } : {}),
          ...(volume > 0 ? { lotSize: volume } : { lotSize: lot }),
          // A broker that refused the stops filled WITHOUT them — the
          // position really has no stop loss / take profit, so none is shown.
          ...(stopsRemoved ? {} : stopLossValue > 0 ? { stopLoss: stopLossValue } : {}),
          ...(stopsRemoved ? {} : takeProfitValue > 0 ? { takeProfit: takeProfitValue } : {}),
          ...(brokerDigits !== null ? { digits: brokerDigits } : {}),
          ...(rawOrder !== null && rawOrder !== undefined ? { orderId: String(rawOrder) } : {}),
        };
      };
      let opened = 0;
      let firstPayload: Record<string, unknown> | null = null;
      let stopRetried = false;
      let lastError: string | null = null;
      for (let index = 1; index <= total; index += 1) {
        try {
          const payload = await executeWithSymbolFallback();
          opened += 1;
          if (index === 1) firstPayload = payload;
          // Per-trade announcement — toast + popup + native bubble all update,
          // and the card/voice get the broker's OWN numbers for this order.
          const perTrade = `TRADE ${opened}/${total} EXECUTED`;
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", {
              detail: {
                ok: true,
                message: perTrade,
                status: "executed",
                symbol,
                side: direction,
                robotName: robot?.name,
                index: opened,
                total,
                ...describeFill(payload),
              },
            }),
          );
          // Give the broker a beat between orders — avoids rate-limit
          // rejections on fast consecutive market orders.
          if (index < total) await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          // Invalid-stops rejection on a feed-backed symbol: retry ONCE at
          // market without SL/TP — a filled market order beats a refused one.
          const raw = error instanceof Error ? error.message : "";
          // Comment refused by the broker: surface it and say so plainly.
          // There is deliberately NO retry with a stripped/stamped comment —
          // that used to place the order under a name the trader never
          // configured while the log claimed the trade simply "EXECUTED".
          if (/comment/i.test(raw)) {
            console.warn(
              `[scanner] ${symbol}: BROKER REFUSED THE ORDER COMMENT — requested "${orderComment}", no order was placed with a changed comment. Broker said: ${raw}`,
            );
          }
          if (useStops && !stopRetried && /invalid stops|10016/i.test(raw)) {
            stopRetried = true;
            useStops = false;
            stopLossValue = 0;
            takeProfitValue = 0;
            try {
              const payload = await executeWithSymbolFallback();
              opened += 1;
              if (index === 1) firstPayload = payload;
              window.dispatchEvent(
                new CustomEvent("eamp:execution-result", {
                  detail: {
                    ok: true,
                    message: `TRADE ${opened}/${total} EXECUTED`,
                    status: "executed",
                    symbol,
                    side: direction,
                    robotName: robot?.name,
                    index: opened,
                    total,
                    ...describeFill(payload),
                  },
                }),
              );
              if (index < total) await new Promise((resolve) => setTimeout(resolve, 2000));
              continue;
            } catch {
              /* stop-retry also failed — the opened===0 abort below reports it */
            }
          }
          if (opened === 0) {
            // The FIRST trade is the probe — if it never fills, abort with
            // one clear error instead of firing N identical failures.
            lastError =
              error instanceof TypeError
                ? "Could not reach the execution bridge — check your connection and try again."
                : (error instanceof Error ? error.message : "Execution failed.");
            window.dispatchEvent(
              new CustomEvent("eamp:execution-result", {
                detail: {
                  ok: false,
                  message: `${lastError.toUpperCase()} — CONNECTION CLOSED`,
                  status: "failed",
                  symbol,
                  side: direction,
                  lotSize: lot,
                  robotName: robot?.name,
                  index,
                  total,
                },
              }),
            );
            return { ok: false, message: lastError };
          }
          // A later trade refused: announce it, keep executing the rest.
          const refused = error instanceof Error ? error.message : "Order refused.";
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", {
              detail: {
                ok: false,
                message: `TRADE ${index} REFUSED — ${refused.toUpperCase()}`,
                status: "failed",
                symbol,
                side: direction,
                lotSize: lot,
                robotName: robot?.name,
                index,
                total,
              },
            }),
          );
        }
      }
      if (opened === 0 || !firstPayload) {
        recordTrade({
          symbol,
          // The app's trade record keeps the EXACT EA name that was sent.
          eaName: orderComment,
          direction,
          lot,
          trades: total,
          filled: `0/${total}`,
          ok: false,
          ...(plan.strength ? { strength: plan.strength } : {}),
          detail: lastError ?? "No trades were executed.",
        });
        return { ok: false, message: lastError ?? "No trades were executed." };
      }
      const failed = total - opened;

      const rawTicket =
        firstPayload["order"] ?? firstPayload["ticket"] ?? firstPayload["deal"] ?? firstPayload["order_id"] ?? firstPayload["id"];
      const ticketNumber = Number(rawTicket);
      const ticketLabel = rawTicket !== undefined && rawTicket !== null && Number.isFinite(ticketNumber)
        ? ` Ticket #${ticketNumber}.`
        : ".";
      const message =
        failed > 0
          ? `${total - failed}/${total} ${symbol} trades opened on MT5 — EA Migrate.${ticketLabel}`
          : total > 1
            ? `${total}/${total} ${symbol} trades opened on MT5 — EA Migrate.${ticketLabel}`
            : `${symbol} trade opened on MT5 — EA Migrate${ticketLabel}`;
      // The bridge drops SL/TP and fills when the broker refuses the stop
      // levels (10016) — the fill is real, so say so AND flag the missing
      // stops instead of a silent no-SL/TP position.
      const stopsWarning =
        firstPayload["stops_removed"] === true
          ? " ⚠ Broker rejected the SL/TP levels — position opened WITHOUT them. Set stop-loss and take-profit manually in MT5."
          : "";
      // NOTE: the broker's echoed order comment is intentionally NOT compared
      // against the robot name — brokers rewrite the comment all the time, so
      // a mismatch means nothing and must never be surfaced as a warning.
      const finalMessage = `${message}${stopsWarning}`;
      onProgress("Disconnecting...");
      recordTrade({
        symbol,
        // The app's trade record keeps the EXACT EA name that was sent.
        eaName: orderComment,
        direction,
        lot,
        trades: total,
        filled: `${opened}/${total}`,
        ok: failed === 0,
        ...(plan.strength ? { strength: plan.strength } : {}),
        detail: finalMessage,
      });
      // The closing line of the run — a SUMMARY, not another trade. It says
      // how many orders really opened and never repeats a price.
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: {
            ok: true,
            message: finalMessage.toUpperCase(),
            summary: true,
            symbol,
            robotName: robot?.name,
            filled: opened,
            total,
          },
        }),
      );
      return { ok: true, message: finalMessage };
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Could not reach the execution bridge — check your connection and try again."
          : (error instanceof Error ? error.message : "Could not reach the execution service.");
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message, status: "failed" },
        }),
      );
      return { ok: false, message };
    }
  };

  return (
    <div className="app-fullscreen bg-[#07090b] text-white">
      <div className="app-scroll-area">
        <ChartScanner
          symbols={robot?.symbols ?? []}
          pairs={(robot?.pairs ?? []).map((pair) => ({ symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades, ...(pair.direction ? { direction: pair.direction } : {}) }))}
          accent={accent}
          scansLeft={scansLeft}
          onScanStart={handleScanStart}
          onExecute={handleExecute}
        />
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />        <TradeAnalysisPopup
          isOpen={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
          robot={robot}
          scannerMode={true}
          activeRobotId={app.activeRobotId ?? ""}
        />
      <TradeExecutionToast isOpen={toastOpen} onClose={() => setToastOpen(false)} botName={robot?.name ?? "EA"} totalTrades={toastTrades} mode="scanner" symbol={toastSymbol} />
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="max-w-sm rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 text-center text-white sm:max-w-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-amber-400/40 text-amber-300" aria-hidden="true">
            <span className="text-xl font-black">!</span>
          </div>
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Daily Scan Limit</DialogTitle>
            <DialogDescription className="text-sm text-white/55">
              You have used {DAILY_LIMIT}/{DAILY_LIMIT} scans today. Your limit resets at 00:00 SAST.
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            onClick={() => setLimitOpen(false)}
            className="mt-1 flex h-12 w-full items-center justify-center rounded-2xl bg-white/10 text-sm font-black text-white"
          >
            GOT IT
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
