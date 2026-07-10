import type { Market, SignalResult } from "./market";

export type StrategyKind =
  | "trend-following"
  | "breakout"
  | "split-investing"
  | "portfolio-risk"
  | "crypto-buy";

export type StrategyStatus = "draft" | "active" | "paused" | "archived";

export type StrategyTemplate = {
  id: string;
  kind: StrategyKind;
  name: string;
  description: string;
  supportedMarkets: Market[];
  defaultParameters: Record<string, string | number | boolean | null>;
  version: number;
};

export type StrategyInstance = {
  id: string;
  userId: string;
  templateId: string;
  kind: StrategyKind;
  name: string;
  status: StrategyStatus;
  market: Market;
  symbols: string[];
  parameters: Record<string, string | number | boolean | null>;
  lastSignal?: SignalResult;
  createdAt: string;
  updatedAt: string;
};
