import { useState } from "react";
import { ArrowDown, ArrowUp, RefreshCcw, Waves } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchLiveQuotes, fmtQuotePrice, type LiveQuote } from "@/lib/live-quotes";

/**
 * LIVE QUOTES sheet — real-time prices for the robot's EA symbols.
 *
 * Shared by the robot dashboard's QUOTES button and the scanner (a quotes
 * toggle next to the symbol picker) so both surfaces show exactly the same
 * prices for exactly the same mentor-added symbols. Pure web fetching —
 * identical behavior in the Android WebView and iOS Safari/PWA.
 */
export default function LiveQuotesSheet({
  open,
  onOpenChange,
  symbols,
  robotName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbols: string[];
  robotName?: string;
}) {
  const [quotes, setQuotes] = useState<LiveQuote[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const list = symbols.length > 0 ? symbols : [];
    if (list.length === 0) return;
    setBusy(true);
    try {
      setQuotes(await fetchLiveQuotes(list));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) void load();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0b0d] p-5 pt-safe text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-black">
            <Waves className="size-5 text-primary" /> Live quotes{robotName ? ` — ${robotName}` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {symbols.length > 0
              ? "Real-time prices for your EA's symbols from the public market feed."
              : "No symbols on this EA yet — your mentor adds them on the portal."}
          </DialogDescription>
        </DialogHeader>
        {symbols.length > 0 && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary/15 text-sm font-bold text-primary transition-colors hover:bg-primary/25 disabled:opacity-60"
          >
            <RefreshCcw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Loading prices…" : "Refresh prices"}
          </button>
        )}
        <div className="space-y-2">
          {quotes.length === 0 && !busy && symbols.length > 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Press refresh to load prices.</p>
          )}
          {quotes.map((quote) => (
            <div
              key={quote.symbol}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{quote.symbol.toUpperCase()}</p>
                <p className="text-[11px] text-muted-foreground">
                  {quote.simulated
                    ? "Simulated — no public feed for this symbol"
                    : quote.resolved
                      ? `Feed: ${quote.resolved} · H ${fmtQuotePrice(quote.dayHigh)} · L ${fmtQuotePrice(quote.dayLow)}`
                      : "No public feed"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-base font-black">{fmtQuotePrice(quote.price)}</p>
                <p className={`flex items-center justify-end gap-1 text-xs font-bold ${quote.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {quote.change >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                  {quote.change >= 0 ? "+" : ""}
                  {quote.changePercent.toFixed(2)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
