import type { Currency } from "./portfolio";
import type { OrderSide, OrderType } from "./trading";

export type PaperTradingSession = "US" | "KR";
export type PaperTradingMarket = "US" | "KOSPI" | "KOSDAQ" | "CRYPTO";
export type PaperTradingOrderStatus = "filled" | "skipped";
export type PaperTradingRunSource = "manual" | "script" | "codex-automation";

export type PaperAccount = {
  id: string;
  session: PaperTradingSession;
  currency: Currency;
  initialCash: number;
  cash: number;
  realizedPnl: number;
  strategyVersion: string;
  lastRunDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaperPosition = {
  id: string;
  session: PaperTradingSession;
  market: PaperTradingMarket;
  symbol: string;
  name?: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  currency: Currency;
  openedAt: string;
  updatedAt: string;
  completedStages: string[];
};

export type PaperOrder = {
  id: string;
  runId: string;
  session: PaperTradingSession;
  market: PaperTradingMarket;
  symbol: string;
  name?: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price: number;
  currency: Currency;
  status: PaperTradingOrderStatus;
  reason: string;
  strategyVersion: string;
  createdAt: string;
};

export type PaperExecution = {
  id: string;
  runId: string;
  orderId: string;
  session: PaperTradingSession;
  market: PaperTradingMarket;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  currency: Currency;
  realizedPnl: number;
  executedAt: string;
};

export type PaperTradingLog = {
  id: string;
  runId: string;
  session: PaperTradingSession;
  source: PaperTradingRunSource;
  market?: PaperTradingMarket;
  symbol?: string;
  level: "info" | "warning" | "error";
  message: string;
  strategyVersion: string;
  createdAt: string;
};

export type PaperRun = {
  id: string;
  session: PaperTradingSession;
  source: PaperTradingRunSource;
  today: string;
  strategyVersion: string;
  status: "executed" | "skipped";
  candidateCount: number;
  tradableCount: number;
  probeCount: number;
  ordersCount: number;
  executionsCount: number;
  startedAt: string;
  finishedAt: string;
  summary: string;
};

export type PaperTradingState = {
  accounts: Record<PaperTradingSession, PaperAccount>;
  positions: PaperPosition[];
  runs: PaperRun[];
  orders: PaperOrder[];
  executions: PaperExecution[];
  logs: PaperTradingLog[];
  updatedAt: string;
};
