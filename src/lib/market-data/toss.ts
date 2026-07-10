import type { Candle as TossCandle, CandlePageResponse, TossCandleInterval } from "@/lib/toss/types";
import {
  aggregateDailyCandlesToWeeks,
  aggregateSessionCandles,
  marketWeekKey,
  zonedSessionBoundaryUnix,
} from "./session-aggregation";
import type { GetCandlesOptions, MarketCandle, MarketCandleResponse } from "./types";
import type { CandleSeriesSnapshot, OfficialMarket, OfficialTimeframe } from "./official-types";

export type TossCandleReader = {
  getCandles: (
    symbol: string,
    options: {
      interval: TossCandleInterval;
      count?: number;
      before?: string;
      adjusted?: boolean;
    },
  ) => Promise<CandlePageResponse>;
};

type TossProviderOptions = {
  reader: TossCandleReader;
  now?: () => number;
  maxMinutePages?: number;
  maxDailyPages?: number;
  pageDelayMs?: number;
  cacheTtlMs?: number;
};

type CachedSnapshot = {
  expiresAt: number;
  value: CandleSeriesSnapshot;
};

export const normalizeTossSymbol = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  const korean = normalized.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);
  return korean?.[1] ?? normalized;
};

const marketForSymbol = (symbol: string): OfficialMarket => {
  const normalized = symbol.trim().toUpperCase();
  if (/^\d{6}\.KQ$/.test(normalized)) return "KOSDAQ";
  if (/^\d{6}(?:\.KS)?$/.test(normalized)) return "KOSPI";
  return "US";
};

const marketPolicy = (market: OfficialMarket) => market === "US"
  ? {
    timeZone: "America/New_York",
    sessionStartMinutes: 9 * 60 + 30,
    sessionEndMinutes: 16 * 60,
    currency: "USD" as const,
  }
  : {
    timeZone: "Asia/Seoul",
    sessionStartMinutes: 9 * 60,
    sessionEndMinutes: 15 * 60 + 30,
    currency: "KRW" as const,
  };

const parseTossCandle = (candle: TossCandle): MarketCandle | null => {
  const timestamp = Date.parse(candle.timestamp);
  const open = Number(candle.openPrice);
  const high = Number(candle.highPrice);
  const low = Number(candle.lowPrice);
  const close = Number(candle.closePrice);
  const volume = Number(candle.volume);
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(open) || open <= 0 ||
    !Number.isFinite(high) || high <= 0 ||
    !Number.isFinite(low) || low <= 0 ||
    !Number.isFinite(close) || close <= 0 ||
    !Number.isFinite(volume) || volume < 0
  ) {
    return null;
  }
  return {
    time: Math.floor(timestamp / 1000),
    open,
    high,
    low,
    close,
    volume,
  };
};

const sleep = (ms: number) => ms > 0
  ? new Promise((resolve) => setTimeout(resolve, ms))
  : Promise.resolve();

const staleThresholdSeconds: Record<OfficialTimeframe, number> = {
  "1h": 4 * 24 * 60 * 60,
  "4h": 4 * 24 * 60 * 60,
  "1d": 3 * 24 * 60 * 60,
  "1wk": 12 * 24 * 60 * 60,
};

const localMarketClock = (timestampSeconds: number, timeZone: string) => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestampSeconds * 1_000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  return {
    dateKey,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekday: new Date(`${dateKey}T00:00:00Z`).getUTCDay(),
  };
};

const isIntradaySeriesStale = ({
  lastCloseTime,
  timeframe,
  policy,
  asOfSeconds,
}: {
  lastCloseTime: number;
  timeframe: "1h" | "4h";
  policy: ReturnType<typeof marketPolicy>;
  asOfSeconds: number;
}) => {
  const nowClock = localMarketClock(asOfSeconds, policy.timeZone);
  const lastClock = localMarketClock(lastCloseTime, policy.timeZone);
  const bucketMinutes = timeframe === "1h" ? 60 : 240;
  const sessionMinutes = policy.sessionEndMinutes - policy.sessionStartMinutes;
  const leadingPartial = timeframe === "1h" ? sessionMinutes % bucketMinutes : 0;
  const firstFullClose = policy.sessionStartMinutes + leadingPartial + bucketMinutes;
  const latestEligibleClose = nowClock.minutes < firstFullClose
    ? null
    : Math.min(
      policy.sessionEndMinutes,
      firstFullClose + Math.floor((Math.min(nowClock.minutes, policy.sessionEndMinutes) - firstFullClose) / bucketMinutes) * bucketMinutes,
    );
  const isWeekday = nowClock.weekday >= 1 && nowClock.weekday <= 5;
  if (isWeekday && latestEligibleClose !== null) {
    return lastClock.dateKey !== nowClock.dateKey || lastClock.minutes < latestEligibleClose;
  }
  return asOfSeconds - lastCloseTime > staleThresholdSeconds[timeframe];
};

export class TossMarketDataProvider {
  private readonly reader: TossCandleReader;
  private readonly now: () => number;
  private readonly maxMinutePages: number;
  private readonly maxDailyPages: number;
  private readonly pageDelayMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly pending = new Map<string, Promise<CandleSeriesSnapshot>>();
  private nextRequestAt = 0;

  constructor(options: TossProviderOptions) {
    this.reader = options.reader;
    this.now = options.now ?? Date.now;
    this.maxMinutePages = Math.max(1, options.maxMinutePages ?? 20);
    this.maxDailyPages = Math.max(1, options.maxDailyPages ?? 10);
    this.pageDelayMs = Math.max(0, options.pageDelayMs ?? 210);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 60_000);
  }

  private async readCandles(
    sourceSymbol: string,
    options: Parameters<TossCandleReader["getCandles"]>[1],
  ) {
    const scheduledAt = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + this.pageDelayMs;
    await sleep(scheduledAt - Date.now());
    return this.reader.getCandles(sourceSymbol, options);
  }

  async loadSeries(
    symbol: string,
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ): Promise<CandleSeriesSnapshot> {
    const sourceSymbol = normalizeTossSymbol(symbol);
    const key = `${sourceSymbol}:${timeframe}:${options.period1.toISOString()}:${options.period2.toISOString()}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const request = this.fetchSeries(symbol, sourceSymbol, timeframe, options);
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
    const snapshot = await this.loadSeries(symbol, options.interval, options);
    return {
      candles: snapshot.candles
        .filter((candle) => candle.isClosed && !candle.isPartialSessionBar)
        .map((candle) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })),
      timeZone: marketPolicy(snapshot.market).timeZone,
    };
  }

  private async loadRaw(
    sourceSymbol: string,
    interval: TossCandleInterval,
    period1: Date,
  ) {
    const maxPages = interval === "1m" ? this.maxMinutePages : this.maxDailyPages;
    const deduped = new Map<number, { candle: MarketCandle; currency: "KRW" | "USD" }>();
    const warnings: string[] = [];
    let before: string | undefined;
    let previousCursor: string | undefined;
    let reachedStart = false;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await this.readCandles(sourceSymbol, {
        interval,
        count: 200,
        before,
        adjusted: true,
      });
      const normalized = response.candles
        .map((item) => ({ candle: parseTossCandle(item), currency: item.currency }))
        .filter((item): item is { candle: MarketCandle; currency: "KRW" | "USD" } => item.candle !== null);
      for (const item of normalized) {
        deduped.set(item.candle.time, item);
      }
      const oldest = normalized.length
        ? Math.min(...normalized.map((item) => item.candle.time))
        : null;
      if (oldest !== null && oldest <= Math.floor(period1.getTime() / 1000)) {
        reachedStart = true;
        break;
      }
      if (!response.nextBefore) break;
      if (response.nextBefore === before || response.nextBefore === previousCursor) {
        warnings.push("Toss 캔들 페이지 커서가 진전하지 않아 추가 조회를 중단했습니다.");
        break;
      }
      previousCursor = before;
      before = response.nextBefore;
    }
    if (!reachedStart && deduped.size > 0) {
      warnings.push(`Toss ${interval} 캔들 페이지 제한 안에서 요청 시작 시각까지 도달하지 못했습니다.`);
    }
    return {
      rows: [...deduped.values()].toSorted((left, right) => left.candle.time - right.candle.time),
      warnings,
    };
  }

  private async fetchSeries(
    symbol: string,
    sourceSymbol: string,
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ): Promise<CandleSeriesSnapshot> {
    const market = marketForSymbol(symbol);
    const policy = marketPolicy(market);
    const rawInterval: TossCandleInterval = timeframe === "1h" || timeframe === "4h" ? "1m" : "1d";
    const raw = await this.loadRaw(sourceSymbol, rawInterval, options.period1);
    const period1 = Math.floor(options.period1.getTime() / 1000);
    const period2 = Math.floor(options.period2.getTime() / 1000);
    const effectiveNowMs = Math.min(this.now(), options.period2.getTime());
    const effectiveNowSeconds = Math.floor(effectiveNowMs / 1000);
    const rawCandles = raw.rows
      .map((row) => row.candle)
      .filter((candle) => candle.time >= period1 && candle.time < period2);
    let candles;
    if (timeframe === "1h" || timeframe === "4h") {
      candles = aggregateSessionCandles(rawCandles, {
        timeZone: policy.timeZone,
        sessionStartMinutes: policy.sessionStartMinutes,
        sessionEndMinutes: policy.sessionEndMinutes,
        bucketMinutes: timeframe === "1h" ? 60 : 240,
        alignment: timeframe === "1h" ? "session-end" : "session-start",
        nowMs: effectiveNowMs,
      });
    } else {
      const daily = timeframe === "1wk"
        ? aggregateDailyCandlesToWeeks(rawCandles, policy.timeZone)
        : rawCandles;
      const weeklyCloseTimes = new Map<string, number>();
      if (timeframe === "1wk") {
        for (const candle of rawCandles) {
          const week = marketWeekKey(candle.time, policy.timeZone);
          const closeTime = zonedSessionBoundaryUnix(
            candle.time,
            policy.timeZone,
            policy.sessionEndMinutes,
          );
          weeklyCloseTimes.set(week, Math.max(weeklyCloseTimes.get(week) ?? 0, closeTime));
        }
      }
      const currentWeek = marketWeekKey(effectiveNowSeconds, policy.timeZone);
      candles = daily.map((candle) => {
        const week = marketWeekKey(candle.time, policy.timeZone);
        const closeTime = timeframe === "1wk"
          ? weeklyCloseTimes.get(week)
            ?? zonedSessionBoundaryUnix(candle.time, policy.timeZone, policy.sessionEndMinutes)
          : zonedSessionBoundaryUnix(candle.time, policy.timeZone, policy.sessionEndMinutes);
        return {
          ...candle,
          closeTime,
          isClosed: timeframe === "1wk"
            ? week < currentWeek && closeTime <= effectiveNowSeconds
            : closeTime <= effectiveNowSeconds,
          isPartialSessionBar: false,
          sourceCount: 1,
        };
      });
    }
    const lastClosed = candles.findLast((candle) => candle.isClosed);
    const quoteAt = lastClosed
      ? new Date(lastClosed.closeTime * 1000).toISOString()
      : null;
    const stale = !lastClosed || (
      (timeframe === "1h" || timeframe === "4h")
        ? isIntradaySeriesStale({
          lastCloseTime: lastClosed.closeTime,
          timeframe,
          policy,
          asOfSeconds: effectiveNowSeconds,
        })
        : effectiveNowSeconds - lastClosed.closeTime > staleThresholdSeconds[timeframe]
    );
    const warnings = [
      ...raw.warnings,
      candles.some((candle) => !candle.isClosed) ? "형성 중인 마지막 봉은 분석 계산에서 제외됩니다." : null,
      candles.some((candle) => candle.isPartialSessionBar)
        ? "정규장이 봉 길이로 나누어떨어지지 않아 부분 세션 봉을 표시하고 분석 계산에서는 제외합니다."
        : null,
    ].filter((warning): warning is string => warning !== null);
    const currency = raw.rows.at(-1)?.currency ?? policy.currency;

    return {
      symbol: symbol.trim().toUpperCase(),
      sourceSymbol,
      market,
      currency,
      dataSource: "toss",
      timeframe,
      sessionPolicy: "regular",
      fetchedAt: new Date(this.now()).toISOString(),
      quoteAt,
      stale,
      candles: candles.map((candle) => ({
        time: candle.time,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isClosed: candle.isClosed,
        isPartialSessionBar: candle.isPartialSessionBar,
      })),
      warnings,
    };
  }
}
