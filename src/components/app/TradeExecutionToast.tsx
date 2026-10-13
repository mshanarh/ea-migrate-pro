import { useEffect, useRef, useState } from "react";

interface TradeExecutionToastProps {
  isOpen: boolean;
  onClose: () => void;
  botName?: string;
  totalTrades?: number;
  mode?: "scanner" | "auto";
  symbol?: string;
}

const AUTO_STEPS = [
  "🔍 Checking the symbol selected...",
  "📊 Analyzing chart signals and market structure...",
  "⚙️ Setting lot size & risk parameters...",
  "🚀 Executing trades to MetaTrader...",
];

const STEP_MS = 2200;
const TRADE_MS = 2500;

export function TradeExecutionToast({
  isOpen,
  onClose,
  botName = "EA",
  totalTrades = 0,
  mode = "auto",
  symbol = "",
}: TradeExecutionToastProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [currentTrade, setCurrentTrade] = useState(0);
  const [finished, setFinished] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (soundRef.current) return;
    const audio = new Audio("/sounds/execute.mp3");
    audio.preload = "auto";
    soundRef.current = audio;
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      setCurrentTrade(0);
      setFinished(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    setCurrentStep(0);
    setCurrentTrade(0);
    setFinished(false);

    if (mode === "auto") {
      runAutoSequence();
    }
  }, [isOpen, mode]);

  const playExecuteSound = () => {
    if (!soundEnabled || !soundRef.current) return;
    const audio = soundRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  const runAutoSequence = () => {
    if (currentStep < AUTO_STEPS.length) {
      timerRef.current = setTimeout(() => {
        setCurrentStep((s) => s + 1);
        if (currentStep + 1 === AUTO_STEPS.length) {
          runTrades();
        } else {
          runAutoSequence();
        }
      }, STEP_MS);
    }
  };

  const runTrades = () => {
    if (currentTrade < totalTrades) {
      timerRef.current = setTimeout(() => {
        setCurrentTrade((t) => t + 1);
        playExecuteSound();
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (currentTrade + 1 < totalTrades) {
            runTrades();
          } else {
            setFinished(true);
            timerRef.current = setTimeout(() => {
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
            }, 3000);
          }
        }, TRADE_MS);
      }, 300);
    }
  };

  const step = mode === "auto" ? AUTO_STEPS[currentStep] : "";
  const isTrading = mode === "auto" && currentStep >= AUTO_STEPS.length && !finished;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-center p-4"
          onClick={onClose}
        >
          <div
            className="bg-gray-900 text-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-700/50 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm font-medium text-gray-300">{botName}</span>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 min-h-[120px]">
              {mode === "auto" && currentStep < AUTO_STEPS.length ? (
                <div className="space-y-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                    {symbol ? `Symbol: ${symbol}` : "Preparing..."}
                  </div>
                  <div className="text-sm text-gray-300">{step}</div>
                </div>
              ) : isTrading ? (
                <div className="space-y-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                    Executing Trades
                  </div>
                  <div className="text-sm text-gray-300">
                    ✅ Trade {currentTrade}/{totalTrades} completed successfully
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                    <div
                      className="bg-green-400 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${(currentTrade / totalTrades) * 100}%` }}
                    />
                  </div>
                </div>
              ) : finished ? (
                <div className="space-y-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                    Complete
                  </div>
                  <div className="text-sm text-green-400">
                    🎉 All {totalTrades} trades executed on MetaTrader!
                  </div>
                </div>
              ) : null}
            </div>

            {finished && (
              <div className="px-5 py-3 bg-gray-800/50 border-t border-gray-700/50">
                <button
                  onClick={onClose}
                  className="w-full py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            )}

            {!finished && (
              <div className="px-5 py-3 bg-gray-800/50 border-t border-gray-700/50 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-green-500 focus:ring-green-500"
                  />
                  Sound
                </label>
                <button
                  onClick={onClose}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }
      `}</style>
    </>
  );
}
