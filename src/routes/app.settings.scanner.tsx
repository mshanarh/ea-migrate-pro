import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Minus, Plus, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";

export const Route = createFileRoute("/app/settings/scanner")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Chart Scanner — EA Migrate Pro" },
      { name: "description", content: "Upload an MT4 or MT5 chart and get an instant trade setup." },
      { property: "og:title", content: "Chart Scanner — EA Migrate Pro" },
      { property: "og:description", content: "Upload an MT4 or MT5 chart and get an instant trade setup." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Scanner,
});

function Scanner() {
  const [file, setFile] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("XAUUSDM");
  const [trades, setTrades] = useState(1);
  const [lot, setLot] = useState("0.01");

  return (
    <AppFrame>
      <div className="flex items-center gap-4">
        <Link
          to="/app/settings"
          aria-label="Back to settings"
          className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-card/60"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Chart Scanner</h1>
          <p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
            ● Live market data
          </p>
        </div>
      </div>

      <div className="panel mt-6 p-6 text-center">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/12">
          <ScanLine className="size-8 text-primary" />
        </span>
        <p className="mt-4 text-lg font-bold">{file ? "Chart ready" : "Upload your chart"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {file ?? "Screenshot any MT4 / MT5 timeframe"}
        </p>
        <div className="mt-5 flex gap-3">
          <label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-border/60 bg-card/70 text-sm font-semibold">
            <Camera className="size-4" /> Camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          <label className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-primary-foreground glow-ring">
            <Upload className="size-4" /> Upload
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
            />
          </label>
        </div>
      </div>

      <div className="panel mt-4 p-5">
        <p className="text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">Symbol</p>
        <div className="mt-3 flex gap-3">
          {["XAUUSDM", "HW_100"].map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`h-11 rounded-full border px-5 text-sm font-semibold ${
                symbol === s ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="panel mt-4 divide-y divide-border/50">
        <div className="flex items-center gap-4 p-5">
          <div className="flex-1">
            <p className="font-semibold">Trades</p>
            <p className="text-sm text-muted-foreground">Max 20 per scan</p>
          </div>
          <button
            onClick={() => setTrades((t) => Math.max(1, t - 1))}
            aria-label="Fewer trades"
            className="flex size-11 items-center justify-center rounded-full border border-border/60"
          >
            <Minus className="size-4" />
          </button>
          <span className="w-6 text-center font-bold">{trades}</span>
          <button
            onClick={() => setTrades((t) => Math.min(20, t + 1))}
            aria-label="More trades"
            className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-4 p-5">
          <div className="flex-1">
            <p className="font-semibold">Lot size</p>
            <p className="text-sm text-muted-foreground">Volume per trade</p>
          </div>
          <input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            className="h-11 w-24 rounded-full border border-border/60 bg-card/70 text-center text-sm"
          />
        </div>
      </div>

      <button
        onClick={() =>
          file
            ? toast.success(`Scanning ${symbol} — ${trades} trade(s) at ${lot} lots`)
            : toast.error("Upload a chart first.")
        }
        className={`mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-full text-base font-bold ${
          file ? "bg-primary text-primary-foreground glow-ring" : "bg-primary/25 text-primary-foreground/60"
        }`}
      >
        <ScanLine className="size-5" /> Scan chart
      </button>
    </AppFrame>
  );
}
