import assert from "node:assert/strict";
import test from "node:test";

import { ATR } from "technicalindicators";

import {
  assessCrashMarketContext,
  calculateCrashReversalSignal,
} from "../src/lib/market/crash-reversal-signal.ts";
import {
  aggregateClosedFiveMinuteCandles,
  failCloseStoredWatchlistSignals,
  isWatchlistTradePlanEntryEligible,
  krSessionWindowsFromCalendar,
  partitionClosedFiveMinuteCandles,
  retainVolumeReferenceCandles,
  selectPriorVolumeReferenceCandles,
  type WatchlistSignalScanResponse,
  type WatchlistVolumeReferenceStore,
  scanWatchlistSignals,
} from "../src/lib/local-engine/watchlist-signals.ts";
import { buildCrashReversalTradePlan } from "../src/lib/market/trade-playbook.ts";
import type { TradePlaybookPlan } from "../src/domain/market-playbook.ts";
import type { MarketCandle } from "../src/lib/market-data/types.ts";
import type { Candle } from "../src/lib/toss/types.ts";
import type { KrMarketCalendarResponse } from "../src/lib/toss/types.ts";

const baseTime = Math.floor(Date.parse("2026-07-15T09:00:00+09:00") / 1_000);

const krCalendar = (
  date = "2026-07-15",
  endTime = "15:30:00",
  open = true,
): KrMarketCalendarResponse => {
  const day = (value: string) => ({
    date: value,
    integrated: open || value !== date
      ? {
          preMarket: null,
          regularMarket: {
            startTime: `${value}T09:00:00+09:00`,
            endTime: `${value}T${value === date ? endTime : "15:30:00"}+09:00`,
          },
          afterMarket: null,
        }
      : null,
  });
  return {
    today: day(date),
    previousBusinessDay: day("2026-07-14"),
    nextBusinessDay: day("2026-07-16"),
  };
};

const baselineCandles = (): MarketCandle[] => Array.from({ length: 30 }, (_, index) => ({
    time: baseTime + index * 300,
    open: 100 + Math.sin(index / 4) * 0.1,
    high: 102,
    low: 98,
  close: 100 + Math.sin(index / 4) * 0.1,
  volume: 1_000,
}));

const confirmedCrashCandles = () => [
  ...baselineCandles(),
  {
    time: baseTime + 30 * 300,
    open: 100,
    high: 100,
    low: 90,
    close: 90,
    volume: 5_000,
  },
  {
    time: baseTime + 31 * 300,
    open: 92,
    high: 97,
    low: 91,
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

const calibratedEntryPlan = (
  signal: ReturnType<typeof calculateCrashReversalSignal>,
): TradePlaybookPlan => {
  const shadow = buildCrashReversalTradePlan(signal, "2026-07-15T02:42:00.000Z");
  return {
    ...shadow,
    stage: "calibrated",
    action: "entry-ready",
    gates: shadow.gates.map((item) => ({
      ...item,
      status: "pass",
      blocking: false,
    })),
    calibration: {
      status: "calibrated",
      sampleSize: 240,
      holdoutSampleSize: 60,
      targetBeforeStopRate: 0.58,
      averageNetR: 0.21,
      confidence95: { lower: 0.05, upper: 0.37 },
      costModel: "reviewed base and stress costs",
      validationStart: "2022-01-01T00:00:00.000Z",
      validationEnd: "2026-06-30T00:00:00.000Z",
      note: "Reviewed fixture.",
    },
    blockers: [],
  };
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
  assert.equal(confirmed.confirmationAt, confirmedCrashCandles().at(-1)!.time + 300);
  assert.equal(confirmed.quoteAt, confirmedCrashCandles().at(-1)!.time + 300);

  const panicPlan = buildCrashReversalTradePlan(
    panicOnly,
    "2026-07-15T02:35:00.000Z",
  );
  assert.equal(panicPlan.events[0]?.occurredAt, panicOnly.panicAt);
  assert.equal(panicPlan.events[0]?.confirmedAt, (panicOnly.panicAt ?? 0) + 300);
});

test("watchlist entry eligibility requires a calibrated current plan with every gate nonblocking", () => {
  const signal = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles(),
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  const plan = calibratedEntryPlan(signal);

  assert.equal(isWatchlistTradePlanEntryEligible(plan), true);
  assert.equal(isWatchlistTradePlanEntryEligible({ ...plan, stage: "shadow" }), false);
  assert.equal(isWatchlistTradePlanEntryEligible({ ...plan, action: "watch" }), false);
  assert.equal(isWatchlistTradePlanEntryEligible({
    ...plan,
    gates: plan.gates.map((item, index) => index === 0
      ? { ...item, status: "fail", blocking: true }
      : item),
  }), false);
  assert.equal(isWatchlistTradePlanEntryEligible({
    ...plan,
    orderSubmissionAttempted: true,
  } as unknown as TradePlaybookPlan), false);
});

test("stored watchlist results discard prior approval and expire stale quote context", () => {
  const signal = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles(),
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });
  const stored: WatchlistSignalScanResponse = {
    generatedAt: "2026-07-15T02:42:00.000Z",
    monitoringStatus: "ready",
    monitoringMessage: "매수 검토 가능 신호가 있습니다. 주문은 전송하지 않았습니다.",
    marketContext,
    items: [{
      id: "watch-stored",
      symbol: "005930.KS",
      name: "삼성전자",
      market: "KR",
      currency: "KRW",
      dataSource: "toss",
      generatedAt: "2026-07-15T02:42:00.000Z",
      quoteAt: "2026-07-15T02:40:00.000Z",
      stale: false,
      notificationEligible: true,
      notificationId: "005930.KS:1:2",
      error: null,
      signal,
      tradePlan: calibratedEntryPlan(signal),
    }],
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };

  const fresh = failCloseStoredWatchlistSignals(
    stored,
    new Date("2026-07-15T02:44:00.000Z"),
  );
  assert.equal(fresh.items[0]?.stale, false);
  assert.equal(fresh.items[0]?.notificationEligible, false);
  assert.equal(fresh.items[0]?.notificationId, null);
  assert.equal(fresh.items[0]?.tradePlan.stage, "shadow");
  assert.equal(fresh.items[0]?.tradePlan.action, "unavailable");
  assert.equal(isWatchlistTradePlanEntryEligible(fresh.items[0]?.tradePlan), false);
  assert.equal(fresh.marketContext.status, "unavailable");

  const expired = failCloseStoredWatchlistSignals(
    stored,
    new Date("2026-07-15T03:00:00.000Z"),
  );
  assert.equal(expired.items[0]?.stale, true);
  assert.equal(expired.items[0]?.signal.stage, "unavailable");
  assert.equal(expired.items[0]?.tradePlan.stage, "shadow");
  assert.equal(expired.items[0]?.tradePlan.action, "unavailable");
  assert.equal(expired.isBrokerStopEligible, false);
  assert.equal(expired.orderSubmissionAttempted, false);
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
      low: 90,
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

test("a wide structural crash stop is preserved and blocks entry instead of clamping inward", () => {
  const candles = confirmedCrashCandles();
  candles[30] = {
    ...candles[30],
    low: 70,
  };
  const atr = ATR.calculate({
    high: candles.map((candle) => candle.high),
    low: candles.map((candle) => candle.low),
    close: candles.map((candle) => candle.close),
    period: 14,
  }).at(-1)!;
  const expectedStructureStop = Math.round((70 - atr * 0.2) * 100) / 100;
  const clampedStop = Math.round((96 - atr * 1.8) * 100) / 100;

  const signal = calculateCrashReversalSignal({
    candles5m: candles,
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });

  assert.equal(signal.stage, "insufficient-reward");
  assert.equal(signal.exitPlan?.stopPrice, expectedStructureStop);
  assert.notEqual(signal.exitPlan?.stopPrice, clampedStop);
  assert.ok(signal.blockers.some((blocker) => blocker.includes("안쪽으로 당기지 않고")));
  assert.equal(signal.orderSubmissionAttempted, false);
});

test("a narrow structural crash stop is preserved and blocks entry instead of moving outward", () => {
  const candles = confirmedCrashCandles().map((candle, index) => index < 30
    ? { ...candle, high: 110, low: 90 }
    : candle);
  const atr = ATR.calculate({
    high: candles.map((candle) => candle.high),
    low: candles.map((candle) => candle.low),
    close: candles.map((candle) => candle.close),
    period: 14,
  }).at(-1)!;
  const expectedStructureStop = Math.round((90 - atr * 0.2) * 100) / 100;

  const signal = calculateCrashReversalSignal({
    candles5m: candles,
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });

  assert.equal(signal.stage, "insufficient-reward");
  assert.equal(signal.exitPlan?.stopPrice, expectedStructureStop);
  assert.ok(signal.blockers.some((blocker) => blocker.includes("0.8 ATR")));
  assert.equal(signal.orderSubmissionAttempted, false);
});

test("twenty same-time prior sessions support an opening crash signal without current-bar volume fallback", () => {
  const referenceCandles = Array.from({ length: 20 }, (_, index) => {
    const sessionStart = baseTime + 30 * 300 - (index + 1) * 86_400;
    return [
      { time: sessionStart, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
      { time: sessionStart + 300, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
    ];
  }).flat();
  const signal = calculateCrashReversalSignal({
    candles5m: confirmedCrashCandles().slice(-2),
    priorSessionReferenceCandles5m: referenceCandles,
    requireTimeOfDayVolumeReference: true,
    previousClose: 100,
    dailyAtr14: 5,
    marketContext,
  });

  assert.equal(signal.stage, "entry-ready");
  assert.ok(signal.reasons.some((reason) => reason.includes("과거 20거래일")));
  assert.equal(signal.volumeRatio, 2.5);
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
  assert.equal(closed[0]?.closeTime, baseTime + 300);
});

test("minute aggregation deduplicates timestamps and rejects incomplete buckets", () => {
  const raw: Candle[] = Array.from({ length: 5 }, (_, index) => ({
    timestamp: new Date((baseTime + index * 60) * 1_000).toISOString(),
    openPrice: String(100 + index),
    highPrice: String(101 + index),
    lowPrice: String(99 + index),
    closePrice: String(100.5 + index),
    volume: "10",
    currency: "KRW",
  }));
  const duplicateLast = {
    ...raw[4],
    closePrice: "777",
    highPrice: "778",
  };
  const now = new Date("2026-07-15T09:06:00+09:00");

  const deduped = aggregateClosedFiveMinuteCandles([...raw, duplicateLast], now);
  const incomplete = aggregateClosedFiveMinuteCandles(raw.filter((_, index) => index !== 2), now);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.close, 777);
  assert.deepEqual(incomplete, []);
});

test("watcher aggregation obeys Toss holidays and shortened regular sessions", () => {
  const candle = (timestamp: string): Candle => ({
    timestamp: new Date(timestamp).toISOString(),
    openPrice: "100",
    highPrice: "101",
    lowPrice: "99",
    closePrice: "100",
    volume: "10",
    currency: "KRW",
  });
  const halfDayRaw = [
    ...Array.from({ length: 5 }, (_, index) =>
      candle(`2026-07-15T12:${String(55 + index).padStart(2, "0")}:00+09:00`)),
    ...Array.from({ length: 5 }, (_, index) =>
      candle(`2026-07-15T13:0${index}:00+09:00`)),
  ];
  const now = new Date("2026-07-15T13:10:00+09:00");
  const halfDay = partitionClosedFiveMinuteCandles(
    halfDayRaw,
    now,
    krSessionWindowsFromCalendar(krCalendar("2026-07-15", "13:00:00")),
  );
  const holiday = partitionClosedFiveMinuteCandles(
    halfDayRaw,
    now,
    krSessionWindowsFromCalendar(krCalendar("2026-07-15", "13:00:00", false)),
  );

  assert.equal(halfDay.currentSessionCandles.length, 1);
  assert.equal(halfDay.currentSessionCandles[0]?.time, Math.floor(Date.parse("2026-07-15T12:55:00+09:00") / 1_000));
  assert.deepEqual(holiday.currentSessionCandles, []);
});

test("minute aggregation isolates the current KST session from prior references", () => {
  const candle = (time: string, price: number): Candle => ({
    timestamp: new Date(time).toISOString(),
    openPrice: String(price),
    highPrice: String(price + 1),
    lowPrice: String(price - 1),
    closePrice: String(price + 0.5),
    volume: "10",
    currency: "KRW",
  });
  const prior = Array.from({ length: 5 }, (_, index) =>
    candle(`2026-07-14T09:0${index}:00+09:00`, 80 + index));
  const current = Array.from({ length: 10 }, (_, index) =>
    candle(`2026-07-15T09:${String(index).padStart(2, "0")}:00+09:00`, 100 + index));
  const outsideSession = [
    candle("2026-07-15T08:59:00+09:00", 50),
    candle("2026-07-14T15:30:00+09:00", 60),
  ];
  const now = new Date("2026-07-15T09:07:00+09:00");
  const partitioned = partitionClosedFiveMinuteCandles(
    [...prior, ...current, ...outsideSession],
    now,
  );

  assert.equal(partitioned.currentSessionCandles.length, 1);
  assert.equal(partitioned.currentSessionCandles[0]?.open, 100);
  assert.equal(partitioned.priorSessionReferenceCandles.length, 1);
  assert.equal(partitioned.priorSessionReferenceCandles[0]?.open, 80);
  assert.deepEqual(
    aggregateClosedFiveMinuteCandles([...prior, ...current, ...outsideSession], now),
    partitioned.currentSessionCandles,
  );
});

test("watchlist scan persists closed sessions but never uses today as prior RVOL reference", async () => {
  const symbol = "111111.KS";
  const priorCandles = Array.from({ length: 19 }, (_, index) => {
    const sessionStart = baseTime - (index + 1) * 86_400;
    return [
      { time: sessionStart, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
      { time: sessionStart + 300, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
    ];
  }).flat();
  let referenceStore: WatchlistVolumeReferenceStore | null = {
    version: 1,
    updatedAt: "2026-07-14T00:00:00.000Z",
    candlesBySymbol: { [symbol]: priorCandles },
  };
  const minuteCandles: Candle[] = Array.from({ length: 10 }, (_, index) => {
    const confirmation = index >= 5;
    return {
      timestamp: new Date((baseTime + index * 60) * 1_000).toISOString(),
      openPrice: confirmation ? "92" : "100",
      highPrice: confirmation ? "97" : "100",
      lowPrice: confirmation ? "91" : "90",
      closePrice: confirmation ? "96" : "90",
      volume: confirmation ? "500" : "1000",
      currency: "KRW",
    };
  });
  const dailyCandles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
    timestamp: new Date((baseTime - (index + 1) * 86_400) * 1_000).toISOString(),
    openPrice: "100",
    highPrice: "102",
    lowPrice: "98",
    closePrice: "100",
    volume: "1000",
    currency: "KRW",
  }));

  const response = await scanWatchlistSignals({
    now: () => new Date("2026-07-15T09:12:00+09:00"),
    listItems: async () => [{
      id: "watch-rvol",
      symbol,
      name: "RVOL 테스트",
      assetClass: "stock",
      market: "KR",
      addedAt: "2026-07-14T00:00:00.000Z",
    }],
    loadCredentials: async () => ({ clientId: "test", clientSecret: "test" }),
    createReader: () => ({
      getCandles: async (_symbol, options) => options.interval === "1m"
        ? { candles: minuteCandles, nextBefore: null }
        : { candles: dailyCandles, nextBefore: null },
      getMarketIndicatorCandles: async () => ({ candles: [], nextBefore: null }),
      getKrMarketCalendar: async () => krCalendar(),
    }),
    readStore: async () => null,
    writeStore: async () => undefined,
    readVolumeReferenceStore: async () => referenceStore,
    writeVolumeReferenceStore: async (value) => {
      referenceStore = value;
    },
    requestSpacingMs: 0,
  });

  assert.equal(response.items[0]?.signal.stage, "unavailable");
  assert.equal(response.items[0]?.tradePlan.id, "kr-intraday-crash-reversal");
  assert.equal(response.items[0]?.tradePlan.isBrokerStopEligible, false);
  assert.equal(response.items[0]?.tradePlan.orderSubmissionAttempted, false);
  assert.ok(response.items[0]?.signal.blockers.some((blocker) => blocker.includes("과거 20거래일")));
  const persisted = referenceStore?.candlesBySymbol[symbol] ?? [];
  assert.equal(new Set(persisted.map((candle) =>
    new Date((candle.time + 9 * 60 * 60) * 1_000).toISOString().slice(0, 10))).size, 20);
  assert.ok(persisted.some((candle) => candle.time === baseTime));
});

test("watchlist scan does not notify from a legacy entry-ready stage before calibration", async () => {
  const symbol = "222222.KS";
  const priorCandles = Array.from({ length: 20 }, (_, index) => {
    const sessionStart = baseTime - (index + 1) * 86_400;
    return [
      { time: sessionStart, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
      { time: sessionStart + 300, open: 100, high: 102, low: 98, close: 100, volume: 1_000 },
    ];
  }).flat();
  const minuteCandles: Candle[] = Array.from({ length: 10 }, (_, index) => ({
    timestamp: new Date((baseTime + index * 60) * 1_000).toISOString(),
    openPrice: index >= 5 ? "92" : "100",
    highPrice: index >= 5 ? "97" : "100",
    lowPrice: index >= 5 ? "91" : "90",
    closePrice: index >= 5 ? "96" : "90",
    volume: index >= 5 ? "500" : "1000",
    currency: "KRW",
  }));
  const dailyCandles: Candle[] = Array.from({ length: 20 }, (_, index) => ({
    timestamp: new Date((baseTime - (index + 1) * 86_400) * 1_000).toISOString(),
    openPrice: "100",
    highPrice: "102",
    lowPrice: "98",
    closePrice: "100",
    volume: "1000",
    currency: "KRW",
  }));
  const generatedAt = "2026-07-15T00:12:00.000Z";
  const passExternalGate = (label: string) => ({
    status: "pass" as const,
    label,
    reason: `${label} 조건 통과`,
    source: "fixture",
    asOf: generatedAt,
  });

  const response = await scanWatchlistSignals({
    now: () => new Date(generatedAt),
    listItems: async () => [{
      id: "watch-shadow",
      symbol,
      name: "Shadow 테스트",
      assetClass: "stock",
      market: "KR",
      addedAt: "2026-07-14T00:00:00.000Z",
    }],
    loadCredentials: async () => ({ clientId: "test", clientSecret: "test" }),
    createReader: () => ({
      getCandles: async (_symbol, options) => options.interval === "1m"
        ? { candles: minuteCandles, nextBefore: null }
        : { candles: dailyCandles, nextBefore: null },
      getMarketIndicatorCandles: async () => ({ candles: [], nextBefore: null }),
      getKrMarketCalendar: async () => krCalendar(),
    }),
    readStore: async () => null,
    writeStore: async () => undefined,
    readVolumeReferenceStore: async () => ({
      version: 1,
      updatedAt: "2026-07-14T00:00:00.000Z",
      candlesBySymbol: { [symbol]: priorCandles },
    }),
    writeVolumeReferenceStore: async () => undefined,
    loadPlaybookExternalContext: async () => ({
      market: passExternalGate("시장 breadth"),
      sector: passExternalGate("섹터 상대강도"),
      leader50: passExternalGate("50일 leader"),
    }),
    requestSpacingMs: 0,
  });

  assert.equal(response.items[0]?.signal.stage, "entry-ready");
  assert.equal(response.items[0]?.tradePlan.stage, "shadow");
  assert.equal(response.items[0]?.tradePlan.action, "watch");
  assert.equal(response.items[0]?.notificationEligible, false);
  assert.notEqual(
    response.monitoringMessage,
    "매수 검토 가능 신호가 있습니다. 주문은 전송하지 않았습니다.",
  );
});

test("volume reference retention deduplicates timestamps and keeps the latest thirty KST sessions", () => {
  const sessions = Array.from({ length: 35 }, (_, index) => ({
    time: baseTime - (index + 1) * 86_400,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1_000,
  }));
  const duplicate = { ...sessions[0], volume: 2_000 };
  const retained = retainVolumeReferenceCandles([...sessions, duplicate]);

  assert.equal(retained.length, 30);
  assert.equal(new Set(retained.map((candle) => candle.time)).size, 30);
  assert.equal(retained.at(-1)?.volume, 2_000);
  assert.ok(retained.every((candle) => candle.time > baseTime - 31 * 86_400));
});

test("persisted current-session candles never become same-day RVOL references", () => {
  const current = {
    time: baseTime,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 9_999,
  };
  const prior = Array.from({ length: 19 }, (_, index) => ({
    ...current,
    time: baseTime - (index + 1) * 86_400,
    volume: 1_000,
  }));
  const selected = selectPriorVolumeReferenceCandles(
    [...prior, current],
    new Date("2026-07-15T11:00:00+09:00"),
  );

  assert.equal(selected.length, 19);
  assert.equal(selected.some((candle) => candle.time === baseTime), false);
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
  assert.equal(response.items[0]?.tradePlan.action, "unavailable");
  assert.equal(response.isBrokerStopEligible, false);
  assert.equal(response.items[0]?.notificationEligible, false);
  assert.equal(response.orderSubmissionAttempted, false);
});
