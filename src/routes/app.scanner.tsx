import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FixedBottomNav } from "@/components/app/FixedBottomNav";
import ChartScanner from "@/components/app/ChartScanner";
import type { ExecutionOutcome, ExecutionPlan } from "@/components/app/ChartScanner";
import DraggableBotPopup from "@/components/app/DraggableBotPopup";
import TradeExecutionToast from "@/components/app/TradeExecutionToast";
import { accentColorValue, useCustomization } from "@/lib/app-customization";
import { WHOP_CHECKOUT_URL, useAppState } from "@/lib/app-store";
import { getAppState, requireAppAccess } from "@/lib/app-store";
import { requireVerifiedAccess } from "@/lib/payment-gate";
import { DAILY_LIMIT, getScanCount, isUnlimitedScanner, registerScan } from "@/lib/trading-pairs-store";
import { friendlyRetcode, friendlyTradeError } from "@/lib/trade-errors";
import { BRIDGE_KEY, BRIDGE_URL } from "@/lib/bridge-client";
import { recordTrade } from "@/lib/trade-history";

export const Route = createFileRoute("/app/scanner")({
  ssr: false,
  beforeLoad: async () => {
    // Cloud-verified gates: no email → app login; a local "paid" record the
    // database does not confirm → Whop checkout.
    const access = await requireVerifiedAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "pay") throw redirect({ href: WHOP_CHECKOUT_URL });
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
  const [toastTrades, setToastTrades] = useState(0);
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
    const { symbol, lot, trades, direction, entry, stopLoss, takeProfit, estimated } = plan;

    if (!app.mt) {
      toast.error("Save your MT5 details first — MetaTrader page.");
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: false, message: "No saved MT5 details — save them on the MetaTrader page" },
        }),
      );
      return { ok: false, message: "No saved MT5 details — save them on the MetaTrader page first." };
    }
    if (!app.email) {
      const message = "Sign in to the portal so your saved MT5 account can be used for execution.";
      window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message } }));
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
    setToastOpen(true);
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
        window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message } }));
        return { ok: false, message };
      }
      const loginNumber = Number(app.mt.loginId);
      const credentials = {
        login: Number.isFinite(loginNumber) && loginNumber > 0 ? loginNumber : app.mt.loginId,
        password,
        server: app.mt.server,
      };
      // MT5 order comments accept only a small character set — emoji AND
      // special characters like "/" make order_send fail with 'Invalid
      // "comment" argument'. The comment is JUST the bot's name, sanitized
      // to the safe character set and capped at MT5's 31-char limit.
      const botName = (robot?.name ?? "")
        .replace(/[^A-Za-z0-9 .,_()-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const orderComment = botName.slice(0, 31).replace(/[\s.,_()-]+$/, "") || "EA Migrate";
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
      if (estimated && (planStop > 0 || planTp > 0)) {
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
          const point = typeof pricePayload["point"] === "number" && pricePayload["point"] > 0 ? pricePayload["point"] : 10 ** -(digits ?? 2);
          const stopsLevelPoints = typeof pricePayload["stops_level"] === "number" ? pricePayload["stops_level"] : 0;
          if (pricePayload["success"] === true && bid > 0 && ask > 0 && digits !== null && planEntry > 0) {
            const liveEntry = direction === "BUY" ? ask : bid;
            const riskPct = planStop > 0 ? Math.abs(planEntry - planStop) / planEntry : 0;
            const rewardPct = planTp > 0 ? Math.abs(planTp - planEntry) / planEntry : 0;
            const minDistance = stopsLevelPoints * point;
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
      const executeOnce = async (): Promise<Record<string, unknown>> => {
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
            comment: orderComment,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const detail =
            (typeof payload["detail"] === "string" && payload["detail"]) ||
            (typeof payload["message"] === "string" && payload["message"]) ||
            `The bridge rejected the order (HTTP ${response.status}).`;
          throw new Error(friendlyTradeError(detail));
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
          const message = friendlyRetcode(retcode) ?? `The broker refused the order (MT5 code ${retcode}).`;
          if (message) {
            const brokerComment =
              (typeof payload["comment"] === "string" && payload["comment"]) ||
              (typeof result["comment"] === "string" && result["comment"]) ||
              "";
            throw new Error(brokerComment && !message.includes(brokerComment) ? `${message} (Broker: ${brokerComment})` : message);
          }
        } else if (payload["success"] === false) {
          const rawDetail =
            (typeof payload["message"] === "string" && payload["message"]) ||
            (typeof payload["detail"] === "string" && payload["detail"]) ||
            "The broker refused the order.";
          throw new Error(friendlyTradeError(rawDetail));
        }
        return payload;
      };

      // SEQUENTIAL EXECUTION — trades fire ONE BY ONE, never in parallel.
      // Each order is announced on the event bus ("TRADE N EXECUTED") the
      // moment its broker confirmation arrives, so the top toast and the
      // floating bot popup narrate the run together, in order.
      let opened = 0;
      let firstPayload: Record<string, unknown> | null = null;
      let stopRetried = false;
      let lastError: string | null = null;
      for (let index = 1; index <= total; index += 1) {
        try {
          const payload = await executeOnce();
          opened += 1;
          if (index === 1) firstPayload = payload;
          // Per-trade announcement — toast + popup + native bubble all update.
          const perTrade = `TRADE ${opened} EXECUTED — EA MIGRATE ✓`;
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", { detail: { ok: true, message: perTrade } }),
          );
          // Give the broker a beat between orders — avoids rate-limit
          // rejections on fast consecutive market orders.
          if (index < total) await new Promise((resolve) => setTimeout(resolve, 350));
        } catch (error) {
          // Invalid-stops rejection on a feed-backed symbol: retry ONCE at
          // market without SL/TP — a filled market order beats a refused one.
          const raw = error instanceof Error ? error.message : "";
          if (useStops && !stopRetried && /invalid stops|10016/i.test(raw)) {
            stopRetried = true;
            useStops = false;
            stopLossValue = 0;
            takeProfitValue = 0;
            try {
              const payload = await executeOnce();
              opened += 1;
              if (index === 1) firstPayload = payload;
              window.dispatchEvent(
                new CustomEvent("eamp:execution-result", {
                  detail: { ok: true, message: `TRADE ${opened} EXECUTED — EA MIGRATE ✓` },
                }),
              );
              if (index < total) await new Promise((resolve) => setTimeout(resolve, 350));
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
                detail: { ok: false, message: `${lastError.toUpperCase()} — CONNECTION CLOSED` },
              }),
            );
            return { ok: false, message: lastError };
          }
          // A later trade refused: announce it, keep executing the rest.
          const refused = error instanceof Error ? error.message : "Order refused.";
          window.dispatchEvent(
            new CustomEvent("eamp:execution-result", {
              detail: { ok: false, message: `TRADE ${index} REFUSED — ${refused.toUpperCase()}` },
            }),
          );
        }
      }
      if (opened === 0 || !firstPayload) {
        recordTrade({
          symbol,
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
      onProgress("Disconnecting...");
      recordTrade({
        symbol,
        direction,
        lot,
        trades: total,
        filled: `${opened}/${total}`,
        ok: failed === 0,
        ...(plan.strength ? { strength: plan.strength } : {}),
        detail: message,
      });
      window.dispatchEvent(
        new CustomEvent("eamp:execution-result", {
          detail: { ok: true, message: message.toUpperCase() },
        }),
      );
      return { ok: true, message };
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Could not reach the execution bridge — check your connection and try again."
          : (error instanceof Error ? error.message : "Could not reach the execution service.");
      window.dispatchEvent(new CustomEvent("eamp:execution-result", { detail: { ok: false, message } }));
      return { ok: false, message };
    }
  };

  return (
    <div className="app-fullscreen bg-[#07090b] text-white">
      <div className="app-scroll-area">
        <ChartScanner
          symbols={robot?.symbols ?? []}
          pairs={(robot?.pairs ?? []).map((pair) => ({ symbol: pair.symbol, lotSize: pair.lotSize, maxTrades: pair.maxTrades }))}
          accent={accent}
          scansLeft={scansLeft}
          onScanStart={handleScanStart}
          onExecute={handleExecute}
        />
      </div>
      <FixedBottomNav />
      <DraggableBotPopup />
      <TradeExecutionToast isOpen={toastOpen} onClose={() => setToastOpen(false)} botName={robot?.name ?? "EA"} totalTrades={toastTrades} />
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
