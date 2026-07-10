export type Market = "US" | "KOSPI" | "KOSDAQ" | "CRYPTO";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SignalDecision = "enter" | "hold" | "watch" | "avoid";

export type SignalStatus =
  | "watch"
  | "triggered"
  | "confirmed"
  | "retest"
  | "extended"
  | "failed";

export type SignalReliabilityGrade =
  | "high"
  | "medium"
  | "low"
  | "insufficient-data";

export type SignalReliability = {
  pattern: string;
  grade: SignalReliabilityGrade;
  score: number;
  sampleSize: number;
  successRate: number | null;
  stopHitRate: number | null;
  averageMaxGainPct: number | null;
  averageMaxDrawdownPct: number | null;
  averageBarsHeld: number | null;
  riskReward: number | null;
  reasons: string[];
};

export type PriceLevel = {
  label: string;
  price: number | null;
  role: "entry" | "support" | "resistance" | "stop" | "target" | "trail";
};

export type SignalResult = {
  strategy: string;
  decision: SignalDecision;
  status?: SignalStatus;
  score?: number;
  levels: PriceLevel[];
  reasons: string[];
  risk: {
    entryPrice: number | null;
    stopPrice: number | null;
    stopPct: number | null;
    targetPrice?: number | null;
  };
};
