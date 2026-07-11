import { getUpbitCandles, type UpbitCandleInterval } from "@/lib/crypto-exchange/client";
import { normalizeUpbitMarket } from "@/lib/market-data/upbit";

export const LOCAL_CHART_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d", "1wk"] as const;
export type LocalChartTimeframe = (typeof LOCAL_CHART_TIMEFRAMES)[number];

type ChartCandle = {
  time: number;
  close: number;
};

type ChartIndicatorPoint = {
  time: number;
  value: number;
};

const isLocalChartTimeframe = (value: string | null): value is LocalChartTimeframe =>
  LOCAL_CHART_TIMEFRAMES.includes(value as LocalChartTimeframe);

const fixtureIntervalSeconds: Record<LocalChartTimeframe, number> = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1wk": 7 * 24 * 60 * 60,
};

const movingAverage = (candles: ChartCandle[], period: number): ChartIndicatorPoint[] =>
  candles.flatMap((candle, index) => {
    if (index + 1 < period) return [];
    const window = candles.slice(index + 1 - period, index + 1);
    return [{
      time: candle.time,
      value: window.reduce((sum, item) => sum + item.close, 0) / period,
    }];
  });

const relativeStrengthIndex = (candles: ChartCandle[], period = 14): ChartIndicatorPoint[] => {
  if (candles.length <= period) return [];
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const result: ChartIndicatorPoint[] = [];
  const value = () => averageLoss === 0
    ? averageGain === 0 ? 50 : 100
    : 100 - 100 / (1 + averageGain / averageLoss);
  result.push({ time: candles[period].time, value: value() });
  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result.push({ time: candles[index].time, value: value() });
  }
  return result;
};

export const buildBasicChartIndicators = (candles: ChartCandle[]) => ({
  sma: {
    "5": movingAverage(candles, 5),
    "20": movingAverage(candles, 20),
    "60": movingAverage(candles, 60),
  },
  rsi: relativeStrengthIndex(candles),
});

const fixtureChartResponse = ({ symbol, assetClass, timeframe }: {
  symbol: string;
  assetClass: "stock" | "crypto";
  timeframe: LocalChartTimeframe;
}) => {
  const interval = fixtureIntervalSeconds[timeframe];
  const now = Math.floor(Date.parse("2026-07-11T00:00:00.000Z") / 1_000);
  const base = assetClass === "crypto" ? 150_000_000 : symbol.endsWith(".KS") || /^\d{6}/.test(symbol) ? 88_000 : 200;
  const candles = Array.from({ length: 180 }, (_, index) => {
    const close = base + index * (assetClass === "crypto" ? 12_000 : 0.12);
    return {
      time: now - (180 - index) * interval,
      open: close - base * 0.001,
      high: close + base * 0.002,
      low: close - base * 0.002,
      close,
      volume: 10_000 + index * 10,
    };
  });
  return Response.json({
    symbol,
    market: assetClass === "crypto" ? "CRYPTO" : symbol.endsWith(".KS") || /^\d{6}/.test(symbol) ? "KOSPI" : "US",
    currency: assetClass === "crypto" || symbol.endsWith(".KS") || /^\d{6}/.test(symbol) ? "KRW" : "USD",
    dataSource: "fixture",
    timeframe,
    quoteAt: new Date((candles.at(-1)?.time ?? now) * 1_000).toISOString(),
    stale: false,
    candles,
    indicators: buildBasicChartIndicators(candles),
    signals: [],
    breakoutSignal: null,
  });
};

export const handleLocalCryptoChartRequest = async (url: URL): Promise<Response> => {
  const rawSymbol = url.searchParams.get("symbol")?.trim();
  const timeframe = url.searchParams.get("tf");
  if (!rawSymbol) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!isLocalChartTimeframe(timeframe)) {
    return Response.json({ error: "Unsupported chart timeframe." }, { status: 400 });
  }
  if (process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE === "1") {
    return fixtureChartResponse({ symbol: normalizeUpbitMarket(rawSymbol), assetClass: "crypto", timeframe });
  }

  const symbol = normalizeUpbitMarket(rawSymbol);
  const candles = (await getUpbitCandles(symbol, {
    interval: timeframe as UpbitCandleInterval,
    count: 200,
  })).filter((candle) => candle.isClosed);
  const latest = candles.at(-1) ?? null;
  return Response.json({
    symbol,
    market: "CRYPTO",
    currency: "KRW",
    dataSource: "upbit",
    timeframe,
    quoteAt: latest ? new Date(latest.closeTime * 1_000).toISOString() : null,
    stale: latest === null || Date.now() - latest.closeTime * 1_000 > fixtureIntervalSeconds[timeframe] * 2_000,
    candles: candles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
    indicators: buildBasicChartIndicators(candles),
    signals: [],
    breakoutSignal: null,
  });
};

export const fixtureLocalChartResponse = fixtureChartResponse;
