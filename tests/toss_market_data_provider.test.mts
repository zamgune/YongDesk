import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTossSymbol,
  TossMarketDataProvider,
  type TossCandleReader,
} from "../src/lib/market-data/toss.ts";
import type { Candle } from "../src/lib/toss/types.ts";

const tossCandle = (timestamp: string, open: number, close = open, volume = 1): Candle => ({
  timestamp,
  openPrice: String(open),
  highPrice: String(Math.max(open, close) + 1),
  lowPrice: String(Math.min(open, close) - 1),
  closePrice: String(close),
  volume: String(volume),
  currency: "KRW",
});

test("Toss provider normalizes Yahoo-style Korean symbols", () => {
  assert.equal(normalizeTossSymbol("005930.KS"), "005930");
  assert.equal(normalizeTossSymbol(" 263750.kq "), "263750");
  assert.equal(normalizeTossSymbol("AAPL"), "AAPL");
});

test("Toss provider paginates inclusive cursors and creates session-aware hourly candles", async () => {
  const calls: Array<{ symbol: string; before?: string }> = [];
  const pages = [
    {
      candles: [
        tossCandle("2026-07-10T15:29:00+09:00", 111, 112, 6),
        tossCandle("2026-07-10T15:00:00+09:00", 110, 111, 5),
        tossCandle("2026-07-10T09:59:00+09:00", 101, 102, 3),
      ],
      nextBefore: "cursor-2",
    },
    {
      candles: [
        tossCandle("2026-07-10T09:59:00+09:00", 101, 102, 3),
        tossCandle("2026-07-10T09:00:00+09:00", 100, 101, 2),
      ],
      nextBefore: null,
    },
  ];
  const reader: TossCandleReader = {
    getCandles: async (symbol, options) => {
      calls.push({ symbol, before: options.before });
      return pages.shift() ?? { candles: [], nextBefore: null };
    },
  };
  const provider = new TossMarketDataProvider({
    reader,
    now: () => Date.parse("2026-07-10T16:00:00+09:00"),
    pageDelayMs: 0,
    cacheTtlMs: 60_000,
  });
  const period1 = new Date("2026-07-10T08:59:00+09:00");
  const period2 = new Date("2026-07-10T15:31:00+09:00");
  const snapshot = await provider.loadSeries("005930.KS", "1h", { period1, period2 });
  const analysis = await provider.getCandles("005930.KS", { period1, period2, interval: "1h" });

  assert.deepEqual(calls, [
    { symbol: "005930", before: undefined },
    { symbol: "005930", before: "cursor-2" },
  ]);
  assert.equal(snapshot.candles.length, 3);
  assert.equal(snapshot.candles[0]?.open, 100);
  assert.equal(snapshot.candles[0]?.isPartialSessionBar, true);
  assert.equal(snapshot.candles[1]?.close, 102);
  assert.equal(snapshot.candles[1]?.volume, 3);
  assert.equal(snapshot.candles[2]?.isPartialSessionBar, false);
  assert.equal(snapshot.market, "KOSPI");
  assert.equal(snapshot.currency, "KRW");
  assert.equal(snapshot.quoteAt, "2026-07-10T06:30:00.000Z");
  assert.equal(analysis.candles.length, 2);
});

test("Toss provider stops a non-advancing cursor and reports incomplete history", async () => {
  let calls = 0;
  const reader: TossCandleReader = {
    getCandles: async () => {
      calls += 1;
      return {
        candles: [tossCandle("2026-07-10T09:00:00+09:00", 100)],
        nextBefore: "same-cursor",
      };
    },
  };
  const provider = new TossMarketDataProvider({
    reader,
    now: () => Date.parse("2026-07-10T16:00:00+09:00"),
    maxMinutePages: 10,
    pageDelayMs: 0,
  });
  const snapshot = await provider.loadSeries("005930.KS", "1h", {
    period1: new Date("2026-07-01T00:00:00+09:00"),
    period2: new Date("2026-07-11T00:00:00+09:00"),
  });

  assert.equal(calls, 2);
  assert.ok(snapshot.warnings.some((warning) => warning.includes("커서가 진전하지 않아")));
  assert.ok(snapshot.warnings.some((warning) => warning.includes("페이지 제한")));
});

test("Toss daily and weekly candles close at the actual final session, not the next day", async () => {
  const dailyCandles = [
    "2026-06-29T09:00:00+09:00",
    "2026-06-30T09:00:00+09:00",
    "2026-07-01T09:00:00+09:00",
    "2026-07-02T09:00:00+09:00",
    "2026-07-03T09:00:00+09:00",
    "2026-07-06T09:00:00+09:00",
    "2026-07-07T09:00:00+09:00",
    "2026-07-08T09:00:00+09:00",
    "2026-07-09T09:00:00+09:00",
    "2026-07-10T09:00:00+09:00",
  ].map((timestamp, index) => tossCandle(timestamp, 100 + index, 101 + index, index + 1));
  const reader: TossCandleReader = {
    getCandles: async (_symbol, options) => {
      assert.equal(options.interval, "1d");
      return { candles: dailyCandles.toReversed(), nextBefore: null };
    },
  };
  const provider = new TossMarketDataProvider({
    reader,
    now: () => Date.parse("2026-07-10T16:00:00+09:00"),
    pageDelayMs: 0,
  });
  const range = {
    period1: new Date("2026-06-29T00:00:00+09:00"),
    period2: new Date("2026-07-11T00:00:00+09:00"),
  };

  const daily = await provider.loadSeries("005930.KS", "1d", range);
  const weekly = await provider.loadSeries("005930.KS", "1wk", range);

  assert.equal(daily.candles.length, 10);
  assert.equal(daily.candles.at(-1)?.isClosed, true);
  assert.equal(daily.quoteAt, "2026-07-10T06:30:00.000Z");
  assert.equal(weekly.candles.length, 2);
  assert.equal(weekly.candles[0]?.isClosed, true);
  assert.equal(weekly.candles[1]?.isClosed, false);
  assert.equal(weekly.quoteAt, "2026-07-03T06:30:00.000Z");
});

test("Toss excludes a Monday-only current weekly candle after Monday close", async () => {
  const reader: TossCandleReader = {
    getCandles: async () => ({
      candles: [tossCandle("2026-07-06T09:00:00+09:00", 100, 101, 10)],
      nextBefore: null,
    }),
  };
  const provider = new TossMarketDataProvider({
    reader,
    now: () => Date.parse("2026-07-06T16:00:00+09:00"),
    pageDelayMs: 0,
  });
  const weekly = await provider.loadSeries("005930.KS", "1wk", {
    period1: new Date("2026-07-06T00:00:00+09:00"),
    period2: new Date("2026-07-07T00:00:00+09:00"),
  });

  assert.equal(weekly.candles.length, 1);
  assert.equal(weekly.candles[0]?.isClosed, false);
  assert.equal(weekly.quoteAt, null);
});

test("Toss intraday stale follows the next expected regular-session bar", async () => {
  const loadAt = async (now: string) => {
    const provider = new TossMarketDataProvider({
      reader: {
        getCandles: async () => ({
          candles: [tossCandle("2026-07-10T15:29:00+09:00", 100, 101, 10)],
          nextBefore: null,
        }),
      },
      now: () => Date.parse(now),
      pageDelayMs: 0,
    });
    return provider.loadSeries("005930.KS", "1h", {
      period1: new Date("2026-07-10T09:00:00+09:00"),
      period2: new Date(now),
    });
  };

  assert.equal((await loadAt("2026-07-10T18:00:00+09:00")).stale, false, "same-day close is fresh");
  assert.equal((await loadAt("2026-07-11T12:00:00+09:00")).stale, false, "weekend does not invent bars");
  assert.equal((await loadAt("2026-07-13T11:00:00+09:00")).stale, true, "Monday after the first full bar expects Monday data");
});
