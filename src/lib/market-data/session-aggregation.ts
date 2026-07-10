import type { MarketCandle } from "./types";

export type SessionCandle = MarketCandle & {
  closeTime: number;
  isClosed: boolean;
  isPartialSessionBar: boolean;
  sourceCount: number;
};

export type SessionAggregationPolicy = {
  timeZone: string;
  sessionStartMinutes: number;
  sessionEndMinutes: number;
  bucketMinutes: number;
  alignment?: "session-start" | "session-end";
  nowMs?: number;
};

type ZonedParts = {
  dateKey: string;
  minutes: number;
  seconds: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

const zonedParts = (timestampSeconds: number, timeZone: string): ZonedParts => {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestampSeconds * 1000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);
  if (![hour, minute, second].every(Number.isFinite)) {
    throw new Error(`시간대 변환에 실패했습니다: ${timeZone}`);
  }
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutes: hour * 60 + minute,
    seconds: second,
  };
};

const validCandle = (candle: MarketCandle) =>
  Number.isFinite(candle.time) &&
  Number.isFinite(candle.open) && candle.open > 0 &&
  Number.isFinite(candle.high) && candle.high > 0 &&
  Number.isFinite(candle.low) && candle.low > 0 &&
  Number.isFinite(candle.close) && candle.close > 0 &&
  Number.isFinite(candle.volume) && candle.volume >= 0;

export const aggregateSessionCandles = (
  source: MarketCandle[],
  policy: SessionAggregationPolicy,
): SessionCandle[] => {
  if (
    policy.bucketMinutes <= 0 ||
    policy.sessionStartMinutes < 0 ||
    policy.sessionEndMinutes > 24 * 60 ||
    policy.sessionStartMinutes >= policy.sessionEndMinutes
  ) {
    throw new Error("세션 집계 정책이 유효하지 않습니다.");
  }

  const deduped = new Map<number, MarketCandle>();
  for (const candle of source) {
    if (validCandle(candle)) {
      deduped.set(candle.time, candle);
    }
  }
  const sorted = [...deduped.values()].toSorted((left, right) => left.time - right.time);
  const buckets = new Map<string, SessionCandle>();
  const nowSeconds = Math.floor((policy.nowMs ?? Date.now()) / 1000);

  for (const candle of sorted) {
    const parts = zonedParts(candle.time, policy.timeZone);
    if (parts.minutes < policy.sessionStartMinutes || parts.minutes >= policy.sessionEndMinutes) {
      continue;
    }
    const elapsedMinutes = parts.minutes - policy.sessionStartMinutes;
    const sessionMinutes = policy.sessionEndMinutes - policy.sessionStartMinutes;
    const leadingPartialMinutes = policy.alignment === "session-end"
      ? sessionMinutes % policy.bucketMinutes
      : 0;
    const isLeadingPartial = leadingPartialMinutes > 0 && elapsedMinutes < leadingPartialMinutes;
    const bucketIndex = isLeadingPartial
      ? 0
      : policy.alignment === "session-end" && leadingPartialMinutes > 0
        ? 1 + Math.floor((elapsedMinutes - leadingPartialMinutes) / policy.bucketMinutes)
        : Math.floor(elapsedMinutes / policy.bucketMinutes);
    const bucketStartLocal = isLeadingPartial
      ? policy.sessionStartMinutes
      : policy.alignment === "session-end" && leadingPartialMinutes > 0
        ? policy.sessionStartMinutes + leadingPartialMinutes + (bucketIndex - 1) * policy.bucketMinutes
        : policy.sessionStartMinutes + bucketIndex * policy.bucketMinutes;
    const bucketDuration = isLeadingPartial
      ? leadingPartialMinutes
      : Math.min(policy.bucketMinutes, policy.sessionEndMinutes - bucketStartLocal);
    const secondsFromBucketStart = (parts.minutes - bucketStartLocal) * 60 + parts.seconds;
    const bucketStart = candle.time - secondsFromBucketStart;
    const closeTime = bucketStart + bucketDuration * 60;
    const key = `${parts.dateKey}:${bucketIndex}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        time: bucketStart,
        closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isClosed: closeTime <= nowSeconds,
        isPartialSessionBar: bucketDuration < policy.bucketMinutes,
        sourceCount: 1,
      });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
    existing.sourceCount += 1;
    existing.isClosed = closeTime <= nowSeconds;
  }

  return [...buckets.values()].toSorted((left, right) => left.time - right.time);
};

const mondayKey = (dateKey: string) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
};

export const marketWeekKey = (timestampSeconds: number, timeZone: string) =>
  mondayKey(zonedParts(timestampSeconds, timeZone).dateKey);

export const zonedSessionBoundaryUnix = (
  timestampSeconds: number,
  timeZone: string,
  boundaryMinutes: number,
) => {
  if (boundaryMinutes < 0 || boundaryMinutes > 24 * 60) {
    throw new Error("세션 경계 분 값이 유효하지 않습니다.");
  }
  const [year, month, day] = zonedParts(timestampSeconds, timeZone).dateKey
    .split("-")
    .map(Number);
  const targetAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(boundaryMinutes / 60),
    boundaryMinutes % 60,
  );
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(Math.floor(candidate / 1_000), timeZone);
    const [actualYear, actualMonth, actualDay] = actual.dateKey.split("-").map(Number);
    const actualAsUtc = Date.UTC(
      actualYear,
      actualMonth - 1,
      actualDay,
      Math.floor(actual.minutes / 60),
      actual.minutes % 60,
      actual.seconds,
    );
    candidate += targetAsUtc - actualAsUtc;
  }
  return Math.floor(candidate / 1_000);
};

export const aggregateDailyCandlesToWeeks = (
  source: MarketCandle[],
  timeZone: string,
): MarketCandle[] => {
  const sorted = source.filter(validCandle).toSorted((left, right) => left.time - right.time);
  const buckets = new Map<string, MarketCandle>();
  for (const candle of sorted) {
    const key = marketWeekKey(candle.time, timeZone);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...candle });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }
  return [...buckets.values()].toSorted((left, right) => left.time - right.time);
};
