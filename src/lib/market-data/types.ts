export type MarketDataInterval = "5m" | "15m" | "30m" | "1h" | "1d" | "1wk";

export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketQuote = {
  symbol: string;
  price: number;
  changePercent?: number;
};

export type MarketExtendedQuote = {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChangePercent?: number;
  marketState?: string;
};

export type MarketScreenerQuote = {
  symbol: string;
  shortName?: string;
  longName?: string;
  sector?: string;
  industry?: string;
  volume?: number;
  averageVolume?: number;
  marketCap?: number;
  changePercent?: number;
  exchange?: string;
};

export type MarketAssetProfile = {
  sector?: string;
  industry?: string;
};

export type MarketScreenerId =
  | "most_actives"
  | "day_gainers"
  | "growth_technology_stocks";

export type GetCandlesOptions = {
  period1: Date;
  period2: Date;
  interval: MarketDataInterval;
  includePrePost?: boolean;
};

export type MarketCandleResponse = {
  candles: MarketCandle[];
  timeZone?: string;
};

export type GetScreenerCandidatesOptions = {
  screenerId: MarketScreenerId;
  count: number;
  region: string;
  lang: string;
};

export type MarketDataProvider = {
  getCandles(symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse>;
  getQuote(symbol: string): Promise<MarketQuote | null>;
  getQuotes(symbols: string[]): Promise<Array<MarketQuote | null>>;
  getExtendedQuote(symbol: string): Promise<MarketExtendedQuote | null>;
  getExtendedQuotes(symbols: string[]): Promise<Array<MarketExtendedQuote | null>>;
  getScreenerCandidates(options: GetScreenerCandidatesOptions): Promise<MarketScreenerQuote[]>;
  getAssetProfile(symbol: string): Promise<MarketAssetProfile | null>;
};
