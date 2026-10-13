import { useState, useRef, useEffect } from "react";
import type { Robot, PairSetting } from "@/lib/app-store";
import { executeAutoTrade, type ExecutedTrade } from "@/lib/auto-trade";
import { TradeExecutionToast } from "./TradeExecutionToast";

interface DraggableBotPopupProps {
  robot: Robot;
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
  id: number;
  message: string;
  type: "info" | "success" | "error" | "trade";
  timestamp: number;
}

export function DraggableBotPopup({ robot, isOpen, onClose }: DraggableBotPopupProps) {
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [executing, setExecuting] = useState(false);
  const [executionResults, setExecutionResults] = useState<ExecutedTrade[]>([]);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTrades, setToastTrades] = useState(0);
  const [toastSymbol, setToastSymbol] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (!isOpen) {
      setLogs([]);
      setExecutionResults([]);
      setExecuting(false);
      setToastOpen(false);
    }
  }, [isOpen]);

  const addLog = (message: string, type: LogEntry["type"] = "info") => {
    const id = Date.now() + Math.random();
    setLogs((prev) => [...prev, { id, message, type, timestamp: Date.now() }]);
  };

  const triggerExecutionToast = (pairs: PairSetting[]) => {
    if (!pairs.length) return;

    // Sync log lines with the execution toast steps
    addLog(`Checking selected symbol: ${pairs[0].symbol}`, "info");
    addLog("Analyzing chart trend & technical levels...", "info");
    addLog(`Lot size configured: ${pairs[0].lotSize}`, "info");
    addLog(`Executing ${pairs[0].maxTrades} trades one by one...`, "info");

    // Calculate total trades across all pairs
    const totalTrades = pairs.reduce((sum, p) => {
      const count = parseInt(p.maxTrades, 10) || 0;
      return sum + count;
    }, 0);

    setToastTrades(totalTrades);
    setToastSymbol(pairs[0].symbol);
    setToastOpen(true);
  };

  const handleStartTrading = async () => {
    if (!robot.pairs || robot.pairs.length === 0) {
      addLog("No trading pairs configured", "error");
      return;
    }

    setExecuting(true);
    addLog(`Starting auto-trade for ${robot.name}...`, "info");

    try {
      const results = await executeAutoTrade({
        symbol: robot.pairs[0].symbol,
        lotSize: parseFloat(robot.pairs[0].lotSize) || 0.01,
        maxTrades: parseInt(robot.pairs[0].maxTrades, 10) || 0,
        eaName: robot.name, // Preserve exact EA name with spaces, +, etc.
        onTradeExecute: (trade, index, total) => {
          addLog(`Trade ${index}/${total}: ${trade.status === "executed" ? "✅ Executed" : trade.status === "blocked" ? "⛔ Blocked" : "❌ Failed"} - ${trade.message}`, trade.status === "executed" ? "trade" : "error");
          if (trade.meta?.requestedComment) {
            addLog(`Comment: "${trade.meta.requestedComment}"${trade.meta.actualComment !== trade.meta.requestedComment ? ` (actual: "${trade.meta.actualComment}")` : ""}`, "info");
          }
        },
        emitEvent: (event, data) => {
          addLog(`Event: ${event}`, "info");
        },
        paperTrading: true, // Default to paper trading until verified
      });

      setExecutionResults(results);
      const executed = results.filter((r) => r.status === "executed").length;
      const blocked = results.filter((r) => r.status === "blocked").length;
      const failed = results.filter((r) => r.status === "failed").length;

      addLog(`Completed: ${executed} executed, ${blocked} blocked, ${failed} failed`, "success");

      if (blocked > 0 || failed > 0) {
        addLog("Some trades were blocked or failed. Review the logs above.", "error");
      }
    } catch (error) {
      addLog(`Execution error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  const isDragging = dragRef.current !== null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Draggable Popup */}
      <div
        className="absolute bg-[#111111] rounded-3xl shadow-2xl border border-white/10 overflow-hidden min-w-[380px] max-w-[450px] animate-slide-up"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(e) => {
          if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startPosX: position.x,
            startPosY: position.y,
          };
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          setPosition({
            x: Math.max(0, dragRef.current.startPosX + dx),
            y: Math.max(0, dragRef.current.startPosY + dy),
          });
        }}
        onMouseUp={() => {
          dragRef.current = null;
        }}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 cursor-move">
          <div className="flex items-center gap-3">
            <img
              src={robot.image || "/ea-migrate-platform-robot.jpg"}
              alt={robot.name}
              className="w-12 h-12 rounded-2xl object-cover"
            />
            <div>
              <h2 className="font-black text-white">{robot.name}</h2>
              <p className="text-xs text-white/50">
                {robot.running ? "Trading active" : "Ready"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 px-5 py-4 border-b border-white/5">
          <div className="bg-white/5 rounded-2xl p-3">
            <p className="text-[10px] uppercase text-white/40 tracking-wider">Pairs</p>
            <p className="mt-1 font-black text-white text-lg">{robot.symbols.length}</p>
          </div>
          <div className="bg-white/5 rounded-2xl p-3">
            <p className="text-[10px] uppercase text-white/40 tracking-wider">Lot</p>
            <p className="mt-1 font-black text-white">
              {robot.pairs?.[0]?.lotSize || "0.01"}
            </p>
          </div>
          <div className="bg-white/5 rounded-2xl p-3">
            <p className="text-[10px] uppercase text-white/40 tracking-wider">Status</p>
            <p className={`mt-1 font-black text-lg ${robot.running ? "text-green-400" : "text-white/70"}`}>
              {robot.running ? "Live" : "Idle"}
            </p>
          </div>
        </div>

        {/* Log Window */}
        <div className="px-5 py-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/50">Execution Log</h3>
            <span className="text-[10px] text-white/30">
              {logs.length} events
            </span>
          </div>
          <div className="bg-black/30 rounded-2xl h-[200px] overflow-y-auto p-3 space-y-1.5">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`text-xs leading-relaxed ${
                  log.type === "success"
                    ? "text-green-400"
                    : log.type === "error"
                    ? "text-red-400"
                    : log.type === "trade"
                    ? "text-blue-400"
                    : "text-white/70"
                }`}
              >
                <span className="text-white/30 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                {log.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 space-y-3">
          {robot.pairs && robot.pairs.length > 0 && (
            <div className="bg-white/5 rounded-2xl p-4">
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-white/50 mb-3">
                Configured Pairs
              </h4>
              <div className="space-y-2">
                {robot.pairs.map((pair, index) => (
                  <div key={index} className="flex items-center justify-between bg-black/30 rounded-xl px-3 py-2">
                    <div>
                      <span className="text-sm font-bold text-white">{pair.symbol}</span>
                      <span className="ml-2 text-[10px] text-white/40">{pair.lotSize} lots</span>
                    </div>
                    <span className="text-[10px] text-white/30">
                      {pair.maxTrades} trades
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-2xl border border-white/10 bg-white/5 text-white/70 text-sm font-bold uppercase hover:bg-white/10 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleStartTrading}
              disabled={executing || !robot.pairs?.length}
              className="flex-1 h-12 rounded-2xl bg-[#D32F2F] text-white text-sm font-bold uppercase disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#B71C1C] transition-colors"
            >
              {executing ? "Trading..." : "Start Trading"}
            </button>
          </div>

          {toastOpen && (
            <TradeExecutionToast
              isOpen={toastOpen}
              onClose={() => setToastOpen(false)}
              botName={robot.name}
              totalTrades={toastTrades}
              mode="auto"
              symbol={toastSymbol}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
      `}</style>
    </div>
  );
}
