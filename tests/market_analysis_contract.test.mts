import assert from "node:assert/strict";
import test from "node:test";

import type { MarketCandle, MarketDataProvider } from "@/lib/market-data";
import { analyzeSymbol, calculateCompletedTenMonthAverage } from "@/use-cases/market/analyze-symbol";

const nowSeconds = Math.floor(Date.now() / 1000);

const buildCandles = (count: number, intervalSeconds: number): MarketCandle[] =>
  Array.from({ length: count }, (_, index) => {
    const close = 60_000 + index * 25 + Math.sin(index / 8) * 300;
    return {
      time: nowSeconds - (count - index) * intervalSeconds,
      open: close - 80,
      high: close + 220,
      low: close - 240,
      close,
      volume: 1_000_000 + index * 1_000,
    };
  });

const hourlyCandles = buildCandles(720, 60 * 60);
const dailyCandles = buildCandles(520, 24 * 60 * 60);
const weeklyCandles = buildCandles(220, 7 * 24 * 60 * 60);

const marketData: Pick<MarketDataProvider, "getCandles"> = {
  async getCandles(_symbol, options) {
    return {
      candles: options.interval === "1wk"
        ? weeklyCandles
        : options.interval === "1d"
          ? dailyCandles
          : hourlyCandles,
      timeZone: "Asia/Seoul",
    };
  },
};

test("analysis accepts supported intraday timeframes and rejects unknown values", async () => {
  const response = await analyzeSymbol(
    new Request("http://localhost/api/market/005930.KS?days=30&tf=15m"),
    undefined,
    { marketData },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).timeframe, "15m");

  const unsupported = await analyzeSymbol(
    new Request("http://localhost/api/market/005930.KS?days=30&tf=2m"),
    undefined,
    { marketData },
  );
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json()).error, /Unsupported timeframe/);
});

test("daily analysis exposes a real ten-month close average for long-term plans", async () => {
  const response = await analyzeSymbol(
    new Request("http://localhost/api/market/005930.KS?days=365&tf=1d"),
    undefined,
    {
      marketData,
      metadata: { market: "KOSPI", currency: "KRW", dataSource: "fixture-toss" },
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(typeof payload.analysisBasis.tenMonthAverage, "number");
  assert.notEqual(payload.analysisBasis.tenMonthAverage, payload.analysisBasis.sma200);
  assert.equal(payload.analysisBasis.tenMonthAverageBasis, "completed-months");
});

test("ten-month average excludes the still-forming latest calendar month", () => {
  const monthly = Array.from({ length: 11 }, (_, index) => ({
    time: Math.floor(Date.parse(`2025-${String(index + 1).padStart(2, "0")}-28T06:30:00Z`) / 1_000),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1_000,
  }));
  monthly.push({
    time: Math.floor(Date.parse("2025-11-29T06:30:00Z") / 1_000),
    open: 999,
    high: 1_000,
    low: 998,
    close: 999,
    volume: 1_000,
  });

  assert.equal(calculateCompletedTenMonthAverage(monthly, "Asia/Seoul"), 104.5);
});

test("analysis exposes market, currency, source, timeframe, quote time and horizon inputs", async () => {
  const response = await analyzeSymbol(
    new Request("http://localhost/api/market/005930.KS?days=30&tf=1h"),
    undefined,
    {
      marketData,
      metadata: {
        market: "KOSPI",
        currency: "KRW",
        dataSource: "fixture-toss",
        quoteAt: "2026-07-10T06:30:00.000Z",
        stale: true,
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.symbol, "005930.KS");
  assert.equal(payload.market, "KOSPI");
  assert.equal(payload.currency, "KRW");
  assert.equal(payload.dataSource, "fixture-toss");
  assert.equal(payload.timeframe, "1h");
  assert.equal(payload.quoteAt, "2026-07-10T06:30:00.000Z");
  assert.equal(payload.stale, true);
  assert.equal(payload.chartTimeZone, "Asia/Seoul");
  assert.ok(payload.analysisBasis.closedCandleCount >= 200);
  assert.equal(typeof payload.analysisBasis.atr14, "number");
  assert.equal(typeof payload.analysisBasis.hma20, "number");
  assert.equal(typeof payload.analysisBasis.hma50, "number");
  assert.equal(typeof payload.analysisBasis.sma200, "number");
});

test("pre-aggregated 4 hour providers are not grouped a second time", async () => {
  const response = await analyzeSymbol(
    new Request("http://localhost/api/market/KRW-BTC?days=30&tf=4h"),
    undefined,
    {
      marketData,
      preAggregatedTimeframe: "4h",
      metadata: {
        market: "CRYPTO",
        currency: "KRW",
        dataSource: "fixture-upbit",
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.timeframe, "4h");
  assert.equal(payload.dataSource, "fixture-upbit");
  assert.equal(payload.analysisBasis.closedCandleCount, hourlyCandles.length);
});
