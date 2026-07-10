import type { MarketDataProvider } from "./types";
import { YahooMarketDataProvider } from "./yahoo";

export type {
  GetCandlesOptions,
  GetScreenerCandidatesOptions,
  MarketCandleResponse,
  MarketAssetProfile,
  MarketCandle,
  MarketDataInterval,
  MarketDataProvider,
  MarketExtendedQuote,
  MarketQuote,
  MarketScreenerId,
  MarketScreenerQuote,
} from "./types";

let provider: MarketDataProvider | null = null;

export const getMarketDataProvider = () => {
  provider ??= new YahooMarketDataProvider();
  return provider;
};
