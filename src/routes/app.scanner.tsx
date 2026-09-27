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
import { DAILY_LIMIT, getScanCount, isUnlimitedScanner, registerScan } from "@/lib/trading-pairs-store";
import { friendlyRetcode, friendlyTradeError } from "@/lib/trade-errors";

export const Route = createFileRoute("/app/scanner")({
  ssr: false,
  beforeLoad: () => {
    // Same gates the /app login view enforces: no email → app login,
    // unpaid → Whop checkout. Paid/admin emails pass through.
    const access = requireAppAccess(getAppState().email);
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
    const { symbol, lot, trades, direction, stopLoss, takeProfit } = plan;

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
      const total = Math.max(1, Math.min(trades, 20));
      const executeOnce = async (): Promise<Record<string, unknown>> => {
        const response = await fetch("https://bidding-horizontal-calgary-cups.trycloudflare.com/trade/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bridge-key": "my_secret_bridge_key_2026",
          },
          body: JSON.stringify({
            credentials,
            symbol,
            action: direction,
            volume: Number(lot),
            stop_loss: Number(stopLoss) || 0,
            take_profit: Number(takeProfit) || 0,
            comment: "EA Migrate Live",
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

      // Fire the FIRST order alone — one clear error beats N identical
      // failures (and 20 simultaneous broker logins). Only when the first
      // order reaches the bridge do the rest fire in parallel.
      let firstPayload: Record<string, unknown>;
      try {
        firstPayload = await executeOnce();
      } catch (error) {
        const message =
          error instanceof TypeError
            ? "Could not reach the execution bridge — check your connection and try again."
            : (error instanceof Error ? error.message : "Execution failed.");
        window.dispatchEvent(
          new CustomEvent("eamp:execution-result", {
            detail: { ok: false, message: `${message.toUpperCase()} — CONNECTION CLOSED` },
          }),
        );
        return { ok: false, message };
      }
      const rest =
        total > 1
          ? await Promise.allSettled(Array.from({ length: total - 1 }, () => executeOnce()))
          : [];
      const failed = rest.filter((item) => item.status === "rejected").length;

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
