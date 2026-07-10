import {
  getUpbitCandles,
  type UpbitCandle,
  type UpbitCandleInterval,
} from "@/lib/crypto-exchange/client";
import type { GetCandlesOptions, MarketCandleResponse } from "./types";
import type { CandleSeriesSnapshot, OfficialTimeframe } from "./official-types";

type UpbitCandleReader = (
  market: string,
  options: {
    interval: UpbitCandleInterval;
    count?: number;
    to?: string;
    nowMs?: number;
  },
  fetchImpl?: typeof fetch,
) => Promise<UpbitCandle[]>;

type UpbitProviderOptions = {
  fetchImpl?: typeof fetch;
  reader?: UpbitCandleReader;
  now?: () => number;
  maxPages?: number;
  cacheTtlMs?: number;
  pageDelayMs?: number;
};

type CachedSnapshot = {
  expiresAt: number;
  value: CandleSeriesSnapshot;
};

const intervalMap: Record<OfficialTimeframe, UpbitCandleInterval> = {
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1wk": "1wk",
};

export const normalizeUpbitMarket = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.endsWith("-USD")) {
    const base = normalized.slice(0, -4).replace(/[^A-Z0-9]/g, "");
    return `KRW-${base || "BTC"}`;
  }
  if (/^(BTC|USDT)-[A-Z0-9]+$/.test(normalized) || /(?:USDT|USDC)$/.test(normalized)) {
    throw new Error("현재 데스크탑 분석은 Upbit KRW 마켓만 지원합니다.");
  }
  if (/^KRW-[A-Z0-9]+$/.test(normalized)) {
    return normalized;
  }
  const base = normalized
    .replace(/USDT$/, "")
    .replace(/[^A-Z0-9]/g, "");
  return `KRW-${base || "BTC"}`;
};

const staleThresholdSeconds: Record<OfficialTimeframe, number> = {
  "1h": 2 * 60 * 60,
  "4h": 8 * 60 * 60,
  "1d": 2 * 24 * 60 * 60,
  "1wk": 10 * 24 * 60 * 60,
};

const timeframeSeconds: Record<OfficialTimeframe, number> = {
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1wk": 7 * 24 * 60 * 60,
};

const requestKey = (
  market: string,
  timeframe: OfficialTimeframe,
  period1: Date,
  period2: Date,
) => `${market}:${timeframe}:${period1.toISOString()}:${period2.toISOString()}`;

export class UpbitMarketDataProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly reader: UpbitCandleReader;
  private readonly now: () => number;
  private readonly maxPages: number;
  private readonly cacheTtlMs: number;
  private readonly pageDelayMs: number;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly pending = new Map<string, Promise<CandleSeriesSnapshot>>();
  private nextRequestAt = 0;

  constructor(options: UpbitProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reader = options.reader ?? getUpbitCandles;
    this.now = options.now ?? Date.now;
    this.maxPages = Math.max(1, options.maxPages ?? 30);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 30_000);
    this.pageDelayMs = Math.max(0, options.pageDelayMs ?? 120);
  }

  private async readCandles(
    market: string,
    options: Parameters<UpbitCandleReader>[1],
  ) {
    const scheduledAt = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + this.pageDelayMs;
    const waitMs = scheduledAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return this.reader(market, options, this.fetchImpl);
  }

  async loadSeries(
    symbol: string,
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ): Promise<CandleSeriesSnapshot> {
    const market = normalizeUpbitMarket(symbol);
    const key = requestKey(market, timeframe, options.period1, options.period2);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }
    const request = this.fetchSeries(market, timeframe, options);
    this.pending.set(key, request);
    try {
      const value = await request;
      this.cache.set(key, { expiresAt: this.now() + this.cacheTtlMs, value });
      return value;
    } finally {
      this.pending.delete(key);
    }
  }

  async getCandles(symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse> {
    const timeframe: OfficialTimeframe = options.interval;
    const snapshot = await this.loadSeries(symbol, timeframe, options);
    return {
      candles: snapshot.candles
        .filter((candle) => candle.isClosed)
        .map((candle) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
      timeZone: "Asia/Seoul",
    };
  }

  private async fetchSeries(
    market: string,
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ): Promise<CandleSeriesSnapshot> {
    const deduped = new Map<number, UpbitCandle>();
    const period1 = Math.floor(options.period1.getTime() / 1000);
    const period2 = Math.floor(options.period2.getTime() / 1000);
    let to = options.period2.toISOString();
    let previousOldest: number | null = null;
    let reachedStart = false;

    for (let page = 0; page < this.maxPages; page += 1) {
      const candles = await this.readCandles(market, {
        interval: intervalMap[timeframe],
        count: 200,
        to,
        nowMs: this.now(),
      });
      if (!candles.length) {
        break;
      }
      for (const candle of candles) {
        deduped.set(candle.time, candle);
      }
      const oldest = Math.min(...candles.map((candle) => candle.time));
      if (oldest <= period1) {
        reachedStart = true;
        break;
      }
      if (previousOldest !== null && oldest >= previousOldest) {
        break;
      }
      previousOldest = oldest;
      to = new Date(oldest * 1000).toISOString();
    }

    const candles = [...deduped.values()]
      .filter((candle) => candle.time >= period1 && candle.time < period2)
      .toSorted((left, right) => left.time - right.time)
      .map((candle) => ({
        time: candle.time,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isClosed: candle.isClosed && candle.closeTime <= period2 && candle.closeTime <= Math.floor(this.now() / 1000),
        isPartialSessionBar: false,
      }));
    const nowSeconds = Math.floor(Math.min(this.now(), options.period2.getTime()) / 1000);
    const lastClosed = candles.findLast((candle) => candle.isClosed);
    const recentClosed = candles.filter((candle) => candle.isClosed).slice(-60);
    const hasRecentContinuityGap = recentClosed.some((candle, index) => {
      const previous = recentClosed[index - 1];
      return previous
        ? candle.time - previous.time > timeframeSeconds[timeframe] * 1.5
        : false;
    });
    const quoteAt = lastClosed
      ? new Date(lastClosed.closeTime * 1000).toISOString()
      : null;
    const stale = !lastClosed
      || nowSeconds - lastClosed.closeTime > staleThresholdSeconds[timeframe]
      || hasRecentContinuityGap;
    const warnings = [
      !reachedStart && candles.length > 0 ? "요청 시작 시각까지 페이지를 모두 불러오지 못했습니다." : null,
      candles.some((candle) => !candle.isClosed) ? "형성 중인 마지막 봉은 분석 계산에서 제외됩니다." : null,
      hasRecentContinuityGap
        ? "최근 캔들에 거래 공백이 있어 지표가 시간을 압축할 수 있으므로 신규 진입 계획을 대기합니다."
        : null,
    ].filter((warning): warning is string => warning !== null);

    return {
      symbol: market,
      sourceSymbol: market,
      market: "CRYPTO",
      currency: "KRW",
      dataSource: "upbit",
      timeframe,
      sessionPolicy: "continuous",
      fetchedAt: new Date(this.now()).toISOString(),
      quoteAt,
      stale,
      candles,
      warnings,
    };
  }
}
