import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDailyCandlesToWeeks,
  aggregateSessionCandles,
  zonedSessionBoundaryUnix,
} from "../src/lib/market-data/session-aggregation.ts";
import type { MarketCandle } from "../src/lib/market-data/types.ts";

const candle = (localIso: string, open: number, close = open, volume = 1): MarketCandle => ({
  time: Math.floor(Date.parse(localIso) / 1000),
  open,
  high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1,
  close,
  volume,
});

const krPolicy = (bucketMinutes: number) => ({
  timeZone: "Asia/Seoul",
  sessionStartMinutes: 9 * 60,
  sessionEndMinutes: 15 * 60 + 30,
  bucketMinutes,
  nowMs: Date.parse("2026-07-10T07:00:00Z"),
});

test("KR session aggregation excludes outside-session candles and marks the last 1h bar partial", () => {
  const source = [
    candle("2026-07-09T23:30:00Z", 90),
    candle("2026-07-10T00:00:00Z", 100, 101, 2),
    candle("2026-07-10T00:59:00Z", 101, 102, 3),
    candle("2026-07-10T01:00:00Z", 102, 103, 4),
    candle("2026-07-10T06:00:00Z", 110, 111, 5),
    candle("2026-07-10T06:29:00Z", 111, 112, 6),
    candle("2026-07-10T07:00:00Z", 120),
  ];
  const aggregated = aggregateSessionCandles(source, krPolicy(60));

  assert.equal(aggregated.length, 3);
  assert.deepEqual(
    aggregated.map((item) => ({ open: item.open, close: item.close, volume: item.volume })),
    [
      { open: 100, close: 102, volume: 5 },
      { open: 102, close: 103, volume: 4 },
      { open: 110, close: 112, volume: 11 },
    ],
  );
  assert.equal(aggregated[0]?.isPartialSessionBar, false);
  assert.equal(aggregated[2]?.isPartialSessionBar, true);
  assert.equal(aggregated[2]?.closeTime - aggregated[2]!.time, 30 * 60);
  assert.equal(aggregated.every((item) => item.isClosed), true);
});

test("session-end alignment keeps the closing 1h bar full and isolates the opening 30 minutes", () => {
  const source = [
    candle("2026-07-10T00:00:00Z", 100, 101, 2),
    candle("2026-07-10T00:29:00Z", 101, 102, 3),
    candle("2026-07-10T00:30:00Z", 102, 103, 4),
    candle("2026-07-10T01:29:00Z", 103, 104, 5),
    candle("2026-07-10T05:30:00Z", 110, 111, 6),
    candle("2026-07-10T06:29:00Z", 111, 112, 7),
  ];
  const aggregated = aggregateSessionCandles(source, {
    ...krPolicy(60),
    alignment: "session-end" as const,
  });

  assert.equal(aggregated.length, 3);
  assert.equal(aggregated[0]?.isPartialSessionBar, true);
  assert.equal(aggregated[0]?.closeTime - aggregated[0]!.time, 30 * 60);
  assert.equal(aggregated[1]?.isPartialSessionBar, false);
  assert.equal(aggregated[2]?.isPartialSessionBar, false);
  assert.equal(aggregated[2]?.closeTime, Math.floor(Date.parse("2026-07-10T06:30:00Z") / 1_000));
});

test("KR 4h aggregation keeps the 150-minute final session bar explicit", () => {
  const source = [
    candle("2026-07-10T00:00:00Z", 100, 101, 2),
    candle("2026-07-10T03:59:00Z", 105, 106, 3),
    candle("2026-07-10T04:00:00Z", 106, 107, 4),
    candle("2026-07-10T06:29:00Z", 110, 111, 5),
  ];
  const aggregated = aggregateSessionCandles(source, krPolicy(240));

  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[0]?.isPartialSessionBar, false);
  assert.equal(aggregated[1]?.isPartialSessionBar, true);
  assert.equal(aggregated[1]?.closeTime - aggregated[1]!.time, 150 * 60);
});

test("aggregation deduplicates timestamps and never joins separate trading dates", () => {
  const source = [
    candle("2026-07-09T00:00:00Z", 90, 91, 1),
    candle("2026-07-10T00:00:00Z", 100, 101, 2),
    candle("2026-07-10T00:00:00Z", 100, 105, 7),
  ];
  const aggregated = aggregateSessionCandles(source, krPolicy(60));

  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[1]?.close, 105);
  assert.equal(aggregated[1]?.volume, 7);
  assert.equal(aggregated[1]?.sourceCount, 1);
});

test("daily candles aggregate into ISO-style local market weeks", () => {
  const source = [
    candle("2026-07-05T15:00:00Z", 100, 101, 1),
    candle("2026-07-06T15:00:00Z", 101, 103, 2),
    candle("2026-07-09T15:00:00Z", 103, 102, 3),
    candle("2026-07-12T15:00:00Z", 102, 104, 4),
  ];
  const weeks = aggregateDailyCandlesToWeeks(source, "Asia/Seoul");

  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]?.open, 100);
  assert.equal(weeks[0]?.close, 102);
  assert.equal(weeks[0]?.volume, 6);
  assert.equal(weeks[1]?.open, 102);
});

test("session boundary conversion handles Korean time and US daylight saving time", () => {
  const krTimestamp = Math.floor(Date.parse("2026-07-10T00:00:00.000Z") / 1_000);
  const usSummerTimestamp = Math.floor(Date.parse("2026-07-10T13:30:00.000Z") / 1_000);
  const usWinterTimestamp = Math.floor(Date.parse("2026-01-09T14:30:00.000Z") / 1_000);

  assert.equal(
    zonedSessionBoundaryUnix(krTimestamp, "Asia/Seoul", 15 * 60 + 30),
    Math.floor(Date.parse("2026-07-10T06:30:00.000Z") / 1_000),
  );
  assert.equal(
    zonedSessionBoundaryUnix(usSummerTimestamp, "America/New_York", 16 * 60),
    Math.floor(Date.parse("2026-07-10T20:00:00.000Z") / 1_000),
  );
  assert.equal(
    zonedSessionBoundaryUnix(usWinterTimestamp, "America/New_York", 16 * 60),
    Math.floor(Date.parse("2026-01-09T21:00:00.000Z") / 1_000),
  );
});

test("session policies keep holidays empty and close half-days at the configured boundary", () => {
  const holiday = aggregateSessionCandles([], krPolicy(60));
  assert.deepEqual(holiday, []);

  const halfDay = aggregateSessionCandles([
    candle("2026-07-10T00:00:00Z", 100, 101, 2),
    candle("2026-07-10T03:59:00Z", 104, 105, 3),
    candle("2026-07-10T04:00:00Z", 106, 107, 4),
  ], {
    ...krPolicy(60),
    sessionEndMinutes: 13 * 60,
    nowMs: Date.parse("2026-07-10T05:00:00Z"),
  });

  assert.equal(halfDay.length, 2);
  assert.equal(halfDay.at(-1)?.closeTime, Math.floor(Date.parse("2026-07-10T04:00:00Z") / 1_000));
  assert.equal(halfDay.some((item) => item.close === 107), false);
});
