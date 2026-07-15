import type { MarketDataInterval } from "./types";

export type MarketSessionKind = "KOSPI" | "KOSDAQ" | "US" | "CRYPTO";

const intervalSeconds: Record<MarketDataInterval, number> = {
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
  "1wk": 7 * 24 * 60 * 60,
};

const sessionPolicy = (market: MarketSessionKind) => market === "US"
  ? { timeZone: "America/New_York", closeMinutes: 16 * 60 }
  : { timeZone: "Asia/Seoul", closeMinutes: 15 * 60 + 30 };

const zonedDateParts = (timestampSeconds: number, timeZone: string) => {
  const parts = Object.fromEntries(
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
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
};

const zonedDateTimeToUnix = ({
  year,
  month,
  day,
  hour,
  minute,
  timeZone,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) => {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedDateParts(Math.floor(candidate / 1_000), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate += targetAsUtc - actualAsUtc;
  }
  return Math.floor(candidate / 1_000);
};

export const marketCandleCloseTime = (
  candleTime: number,
  interval: MarketDataInterval,
  market: MarketSessionKind,
) => {
  const nominalClose = candleTime + intervalSeconds[interval];
  if (market === "CRYPTO" || interval === "1wk") return nominalClose;
  const policy = sessionPolicy(market);
  const localDate = zonedDateParts(candleTime, policy.timeZone);
  const regularSessionClose = zonedDateTimeToUnix({
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour: Math.floor(policy.closeMinutes / 60),
    minute: policy.closeMinutes % 60,
    timeZone: policy.timeZone,
  });
  if (interval === "1d") {
    // Some providers label a completed daily bar at UTC midnight, which can be
    // later than the exchange close represented by that date. Keep the label
    // itself as the conservative confirmation time in that case.
    return Math.max(candleTime, regularSessionClose);
  }
  return regularSessionClose > candleTime
    ? Math.min(nominalClose, regularSessionClose)
    : nominalClose;
};
