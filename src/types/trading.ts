// Trading Types
export interface Position {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  lotSize: number;
  entry: number;
  sl: number;
  tp: number;
  currentState: string;
  currentPrice: number;
  profit: number;
  swaps: number;
  commission: number;
  maturity: string | null;
}

export interface TradeSignal {
  symbol: string;
  direction: "BUY" | "SELL" | "WAIT";
  strength: number;
  reason: string;
  timestamp: number;
}
