import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUpbitMarket,
  UpbitMarketDataProvider,
} from "../src/lib/market-data/upbit.ts";
import type { UpbitCandle } from "../src/lib/crypto-exchange/client.ts";

const makeCandle = (time: number, isClosed = true): UpbitCandle => ({
  market: "KRW-BTC",
  time,
  closeTime: time + 60 * 60,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 10,
  quoteVolume: 1_000,
  isClosed,
});

test("Upbit provider normalizes common crypto symbols", () => {
  assert.equal(normalizeUpbitMarket("KRW-BTC"), "KRW-BTC");
  assert.equal(normalizeUpbitMarket("BTC-USD"), "KRW-BTC");
  assert.throws(() => normalizeUpbitMarket("ethusdt"), /KRW 마켓/);
  assert.throws(() => normalizeUpbitMarket("BTC-ETH"), /KRW 마켓/);
  assert.throws(() => normalizeUpbitMarket("USDT-ETH"), /KRW 마켓/);
});

test("Upbit does not expose a candle that closes after a historical period2", async () => {
  const base = Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000);
  const provider = new UpbitMarketDataProvider({
    reader: (async () => [makeCandle(base, true)]) as never,
    now: () => Date.parse("2026-07-10T03:00:00Z"),
    maxPages: 1,
    pageDelayMs: 0,
  });
  const snapshot = await provider.loadSeries("KRW-BTC", "1h", {
    period1: new Date("2026-07-09T23:00:00Z"),
    period2: new Date("2026-07-10T00:30:00Z"),
  });

  assert.equal(snapshot.candles.length, 1);
  assert.equal(snapshot.candles[0]?.isClosed, false);
  assert.equal(snapshot.quoteAt, null);
});

test("Upbit provider paginates, deduplicates, and excludes forming candles from analysis", async () => {
  const calls: Array<{ market: string; interval: string; to?: string }> = [];
  const base = Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000);
  const reader = async (_market: string, options: { interval: string; to?: string }) => {
    calls.push({ market: _market, interval: options.interval, to: options.to });
    if (calls.length === 1) {
      return [makeCandle(base + 3_600, false), makeCandle(base)];
    }
    return [makeCandle(base), makeCandle(base - 3_600)];
  };
  const provider = new UpbitMarketDataProvider({
    reader: reader as never,
    now: () => Date.parse("2026-07-10T02:30:00Z"),
    cacheTtlMs: 60_000,
    maxPages: 3,
    pageDelayMs: 0,
  });
  const period1 = new Date("2026-07-09T23:00:00Z");
  const period2 = new Date("2026-07-10T02:00:00Z");
  const snapshot = await provider.loadSeries("BTC-USD", "1h", { period1, period2 });
  const analysis = await provider.getCandles("BTC-USD", { period1, period2, interval: "1h" });

  assert.equal(calls.length, 2, "the second request must reuse the cached snapshot");
  assert.deepEqual(snapshot.candles.map((candle) => candle.time), [base - 3_600, base, base + 3_600]);
  assert.equal(snapshot.candles.at(-1)?.isClosed, false);
  assert.equal(analysis.candles.length, 2);
  assert.equal(snapshot.currency, "KRW");
  assert.equal(snapshot.dataSource, "upbit");
  assert.equal(snapshot.quoteAt, new Date((base + 3_600) * 1000).toISOString());
  assert.ok(snapshot.warnings.some((warning) => warning.includes("형성 중")));
});

test("Upbit provider shares identical in-flight requests", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const base = Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000);
  const provider = new UpbitMarketDataProvider({
    reader: (async () => {
      calls += 1;
      await wait;
      return [makeCandle(base)];
    }) as never,
    now: () => Date.parse("2026-07-10T02:30:00Z"),
    pageDelayMs: 0,
  });
  const request = {
    period1: new Date("2026-07-10T00:00:00Z"),
    period2: new Date("2026-07-10T01:00:00Z"),
  };
  const first = provider.loadSeries("KRW-BTC", "1h", request);
  const second = provider.loadSeries("KRW-BTC", "1h", request);
  release?.();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(left, right);
});

test("Upbit flags recent no-trade candle gaps instead of compressing them silently", async () => {
  const base = Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000);
  const provider = new UpbitMarketDataProvider({
    reader: (async () => [makeCandle(base + 3 * 3_600), makeCandle(base)]) as never,
    now: () => Date.parse("2026-07-10T04:30:00Z"),
    maxPages: 1,
    pageDelayMs: 0,
  });
  const snapshot = await provider.loadSeries("KRW-BTC", "1h", {
    period1: new Date("2026-07-09T23:00:00Z"),
    period2: new Date("2026-07-10T04:00:00Z"),
  });

  assert.equal(snapshot.stale, true);
  assert.ok(snapshot.warnings.some((warning) => warning.includes("거래 공백")));
});
