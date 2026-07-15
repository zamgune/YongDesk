import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCrashMarketContext,
  calculateCrashReversalSignal,
} from "../src/lib/market/crash-reversal-signal.ts";
import {
  aggregateClosedFiveMinuteCandles,
  scanWatchlistSignals,
} from "../src/lib/local-engine/watchlist-signals.ts";
import type { MarketCandle } from "../src/lib/market-data/types.ts";
import type { Candle } from "../src/lib/toss/types.ts";

const baseTime = Math.floor(Date.parse("2026-07-15T09:00:00+09:00") / 1_000);

const baselineCandles = (): MarketCandle[] => Array.from({ length: 30 }, (_, index) => ({
  time: baseTime + index * 300,
  open: 100 + Math.sin(index / 4) * 0.1,
  high: 101,
  low: 99,
  close: 100 + Math.sin(index / 4) * 0.1,
  volume: 1_000,
}));

const confirmedCrashCandles = () => [
  ...baselineCandles(),
  {
    time: baseTime + 30 * 300,
    open: 100,
    high: 100,
    low: 88,
    close: 90,
    volume: 5_000,
  },
  {
    time: baseTime + 31 * 300,
    open: 89,
    high: 97,
    low: 89,
    close: 96,
    volume: 2_500,
  },
];

const marketContext = {
  status: "supportive" as const,
  label: "KOSPI 회복·중립",
  changePct: -0.8,
  recoveryPct: 55,
  quoteAt: "2026-07-15T11:40:00+09:00",
};

test("crash reversal requires panic first and then promotes a closed bullish reclaim", () => {
  const panicOnly = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles().slice(0, -1),
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  assert.equal(panicOnly.stage, "panic-watch");
  assert.equal(panicOnly.exitPlan, null);

  const confirmed = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles(),
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  assert.equal(confirmed.stage, "entry-ready");
  assert.equal(confirmed.label, "매수 검토 가능");
  assert.equal(confirmed.exitPlan?.entryPrice, 96);
  assert.ok((confirmed.exitPlan?.stopPrice ?? 0) < 96);
  assert.equal(confirmed.exitPlan?.firstAllocationPct, 50);
  assert.equal(confirmed.exitPlan?.secondAllocationPct, 50);
  assert.equal(confirmed.exitPlan?.isBrokerStopEligible, false);
  assert.equal(confirmed.orderSubmissionAttempted, false);
});

test("a lower low after panic invalidates the candidate", () => {
  const candles = [
    ...confirmedCrashCandles().slice(0, -1),
    {
      time: baseTime + 31 * 300,
      open: 90,
      high: 91,
      low: 87,
      close: 88,
      volume: 2_000,
    },
  ];
  const signal = calculateCrashReversalSignal({
    candles5m: candles,
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  assert.equal(signal.stage, "invalidated");
  assert.equal(signal.exitPlan, null);
});

test("panic watch expires when six closed bars pass without confirmation", () => {
  const candles = [
    ...confirmedCrashCandles().slice(0, -1),
    ...Array.from({ length: 7 }, (_, index) => ({
      time: baseTime + (31 + index) * 300,
      open: 90,
      high: 92,
      low: 88.5,
      close: 90.5,
      volume: 1_000,
    })),
  ];
  const signal = calculateCrashReversalSignal({
    candles5m: candles,
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  assert.equal(signal.stage, "expired");
  assert.equal(signal.exitPlan, null);
});

test("weak KOSPI context reduces a confirmed signal confidence without blocking it", () => {
  const signal = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles(),
    previousClose: 100,
    dailyAtr14: 5,
    marketContext: { ...marketContext, status: "weak", label: "KOSPI 약세 지속" },
  });
  assert.equal(signal.stage, "entry-ready");
  assert.equal(signal.confidence, "medium");
  assert.ok(signal.reasons.includes("KOSPI 약세 지속"));
});

test("market context marks a deeply weak index that has not recovered from its low", () => {
  const context = assessCrashMarketContext([
    { time: baseTime, open: 100, high: 100, low: 99, close: 99, volume: 1 },
    { time: baseTime + 300, open: 99, high: 99, low: 96, close: 96.5, volume: 1 },
    { time: baseTime + 600, open: 96.5, high: 97, low: 96, close: 96.8, volume: 1 },
  ]);
  assert.equal(context.status, "weak");
  assert.ok((context.changePct ?? 0) <= -1.5);
});

test("minute aggregation excludes the forming five-minute bucket", () => {
  const raw: Candle[] = Array.from({ length: 10 }, (_, index) => ({
    timestamp: new Date((baseTime + index * 60) * 1_000).toISOString(),
    openPrice: String(100 + index),
    highPrice: String(101 + index),
    lowPrice: String(99 + index),
    closePrice: String(100.5 + index),
    volume: "10",
    currency: "KRW",
  }));
  const closed = aggregateClosedFiveMinuteCandles(raw, new Date((baseTime + 7 * 60) * 1_000));
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.open, 100);
  assert.equal(closed[0]?.close, 104.5);
  assert.equal(closed[0]?.volume, 50);
});

test("watchlist scan fails closed when Toss credentials are unavailable", async () => {
  const response = await scanWatchlistSignals({
    now: () => new Date("2026-07-15T11:00:00+09:00"),
    listItems: async () => [{
      id: "watch-1",
      symbol: "000660.KS",
      name: "SK하이닉스",
      assetClass: "stock",
      market: "KR",
      addedAt: "2026-07-15T00:00:00.000Z",
    }],
    loadCredentials: async () => null,
  });
  assert.equal(response.monitoringStatus, "credential-required");
  assert.equal(response.items[0]?.signal.stage, "unavailable");
  assert.equal(response.items[0]?.notificationEligible, false);
  assert.equal(response.orderSubmissionAttempted, false);
});
