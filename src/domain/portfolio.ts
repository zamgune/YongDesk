import type { Market } from "./market";

export type Currency = "KRW" | "USD";

export type PortfolioPosition = {
  id: string;
  userId: string;
  symbol: string;
  name?: string;
  market: Market;
  currency: Currency;
  averagePrice: number;
  quantity: number;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioSnapshot = {
  userId: string;
  positions: PortfolioPosition[];
  baseCurrency: Currency;
  generatedAt: string;
};

export type PortfolioDailyActionType =
  | "hold"
  | "support-check"
  | "add-wait"
  | "take-profit"
  | "near-stop"
  | "avoid-new-entry"
  | "insufficient-data";

export type PortfolioDailyAction = {
  type: PortfolioDailyActionType;
  label: string;
  priority: number;
  headline: string;
  criteria: string[];
  riskLevel: "normal" | "watch" | "danger";
};
