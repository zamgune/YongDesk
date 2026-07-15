import {
  marketCandleCloseTime,
  type MarketCandle,
  type MarketSessionKind,
} from "@/lib/market-data";

export type ConfirmedDailyCandle = MarketCandle & { closeTime: number };

export const confirmedDailyCandles = (
  candles: MarketCandle[],
  market: Exclude<MarketSessionKind, "CRYPTO">,
  now: Date,
): ConfirmedDailyCandle[] => {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return candles
    .map((candle): ConfirmedDailyCandle => ({
      ...candle,
      closeTime: candle.closeTime ?? marketCandleCloseTime(candle.time, "1d", market),
    }))
    .filter((candle) => candle.closeTime <= nowSeconds)
    .toSorted((left, right) => left.time - right.time);
};
