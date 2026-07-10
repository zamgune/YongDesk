import type { MarketCandle } from "./types";

export type OfficialMarket = "KOSPI" | "KOSDAQ" | "US" | "CRYPTO";
export type OfficialDataSource = "toss" | "upbit";
export type OfficialTimeframe = "1h" | "4h" | "1d" | "1wk";

export type OfficialMarketCandle = MarketCandle & {
  closeTime: number;
  isClosed: boolean;
  isPartialSessionBar: boolean;
};

export type CandleSeriesSnapshot = {
  symbol: string;
  sourceSymbol: string;
  market: OfficialMarket;
  currency: "KRW" | "USD";
  dataSource: OfficialDataSource;
  timeframe: OfficialTimeframe;
  sessionPolicy: "regular" | "continuous";
  fetchedAt: string;
  quoteAt: string | null;
  stale: boolean;
  candles: OfficialMarketCandle[];
  warnings: string[];
};
