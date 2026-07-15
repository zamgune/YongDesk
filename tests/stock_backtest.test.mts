import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHolmBonferroni,
  blockBootstrapAverageR95,
  createBacktestConfig,
  createChronologicalFolds,
  createDatasetManifest,
  evaluatePromotion,
  evaluatePromotionWithStatistics,
  resolvePinnedStockDatasetPath,
  runStockBacktest,
  stockCostScenariosFor,
  targetBeforeStopRateFromTrades,
  validateCalibrationDesign,
  validateDatasetForCalibration,
  verifyDatasetIdentity,
  type StockBacktestBar,
  type StockBacktestConfig,
  type StockDatasetManifestSeed,
  type StockBacktestSignal,
  type StockBacktestTrade,
} from "../src/lib/market/backtest/index.ts";

const DAY = 24 * 60 * 60;

const bar = (
  index: number,
  values: Partial<StockBacktestBar> = {},
): StockBacktestBar => ({
  symbol: "AAPL",
  market: "US",
  timeframe: "1d",
  openTime: index * DAY,
  closeTime: index * DAY + DAY - 1,
  sessionDate: new Date(index * DAY * 1_000).toISOString().slice(0, 10),
  open: 100,
  high: 102,
  low: 98,
  close: 101,
  volume: 1_000_000,
  ...values,
});

const datasetSeed = (
  bars: StockBacktestBar[],
  values: Partial<StockDatasetManifestSeed> = {},
): StockDatasetManifestSeed => {
  const symbols = [...new Set(bars.map((item) => item.symbol))];
  const markets = [...new Set(bars.map((item) => item.market))];
  const startTime = Math.min(...bars.map((item) => item.openTime));
  const endTime = Math.max(...bars.map((item) => item.closeTime));
  return {
    schemaVersion: 1,
    provider: "fixture",
    retrievedAt: "2026-07-15T00:00:00.000Z",
    timeframe: bars[0]?.timeframe ?? "1d",
    markets,
    symbols,
    startTime,
    endTime,
    priceAdjustment: "split-adjusted",
    sessionPolicy: "regular-session",
    missingBarPolicy: "reject",
    pointInTimeUniverse: true,
    delistingsIncluded: true,
    symbolEvidence: symbols.map((symbol) => {
      const symbolBars = bars.filter((item) => item.symbol === symbol);
      return {
        symbol,
        market: symbolBars[0].market,
        validFrom: Math.min(...symbolBars.map((item) => item.openTime)),
        validTo: null,
        universeMemberships: [
          {
            from: Math.min(...symbolBars.map((item) => item.openTime)),
            to: null,
          },
        ],
        delisting: { status: "active" as const, effectiveTime: null },
        source: "fixture-security-master",
        recordedAt: "2026-07-15T00:00:00.000Z",
      };
    }),
    ...values,
  };
};

const config = (
  values: Partial<Parameters<typeof createBacktestConfig>[0]> = {},
): StockBacktestConfig =>
  createBacktestConfig({
    schemaVersion: 1,
    playbookId: "swing-trend",
    horizon: "swing",
    market: "US",
    timeframe: "1d",
    startingEquity: 100_000,
    riskPerTradeFraction: 0.01,
    maxPositionFraction: 1,
    maxHoldBars: null,
    forceSessionEndExit: false,
    cost: {
      id: "zero",
      commissionRate: 0,
      sellTaxRate: 0,
      adverseSlippageBps: 0,
    },
    ...values,
  });

const signal = (
  signalBar: StockBacktestBar,
  values: Partial<StockBacktestSignal> = {},
): StockBacktestSignal => ({
  id: "signal-1",
  symbol: "AAPL",
  playbookId: "swing-trend",
  direction: "long",
  occurredAt: signalBar.closeTime,
  confirmedAt: signalBar.closeTime,
  sessionDate: signalBar.sessionDate,
  stopPrice: 95,
  targets: [{ id: "2R", allocationFraction: 1, rMultiple: 2 }],
  ...values,
});

const run = ({
  bars,
  signals,
  backtestConfig = config(),
}: {
  bars: StockBacktestBar[];
  signals: StockBacktestSignal[];
  backtestConfig?: StockBacktestConfig;
}) =>
  runStockBacktest({
    datasetId: "fixture-dataset",
    config: backtestConfig,
    symbol: "AAPL",
    bars,
    signals,
  });

test("dataset and config identities are canonical and detect content changes", () => {
  const bars = [bar(0), bar(1)];
  const seed = datasetSeed(bars);
  const manifest = createDatasetManifest({ seed, bars });
  const repeated = createDatasetManifest({ seed, bars: structuredClone(bars) });
  assert.deepEqual(manifest, repeated);
  assert.equal(verifyDatasetIdentity({ manifest, bars }).valid, true);
  assert.equal(
    verifyDatasetIdentity({
      manifest,
      bars: [bars[0], { ...bars[1], close: 101.5 }],
    }).valid,
    false,
  );
  assert.equal(config().configId, config().configId);
});

test("dataset runner accepts only its manifest-matched pinned cache directory", () => {
  const repoPath = "/tmp/yongstockdesk";
  const datasetId = "fixture-1d-abc123";
  assert.equal(
    resolvePinnedStockDatasetPath({
      repoPath,
      requestedPath: `.cache/stock-analysis/backtests/datasets/${datasetId}/dataset.json`,
      datasetId,
    }),
    `/tmp/yongstockdesk/.cache/stock-analysis/backtests/datasets/${datasetId}/dataset.json`,
  );
  assert.throws(
    () => resolvePinnedStockDatasetPath({
      repoPath,
      requestedPath: `/tmp/${datasetId}.json`,
      datasetId,
    }),
    /must be pinned/,
  );
  assert.throws(
    () => resolvePinnedStockDatasetPath({
      repoPath,
      requestedPath: ".cache/stock-analysis/backtests/datasets/other/dataset.json",
      datasetId,
    }),
    /manifest\.datasetId/,
  );
});

test("market timestamps reject milliseconds and stay in UNIX seconds", () => {
  const bars = [bar(0), bar(1, { openTime: Date.now(), closeTime: Date.now() + 1 })];
  assert.throws(
    () => run({ bars, signals: [] }),
    /UNIX|timestamps/,
  );
  assert.throws(
    () =>
      createDatasetManifest({
        seed: datasetSeed(bars),
        bars,
      }),
    /UNIX timestamp in seconds/,
  );
});

test("dataset calibration uses actual bars and rejects a one-bar eight-year claim", () => {
  const oneBar = bar(Math.floor(Date.UTC(2026, 0, 2) / 1_000 / DAY));
  const claimedStart = Date.UTC(2018, 0, 1) / 1_000;
  assert.throws(
    () =>
      createDatasetManifest({
        seed: datasetSeed([oneBar], { startTime: claimedStart }),
        bars: [oneBar],
      }),
    /declared-extents/,
  );

  const manifest = createDatasetManifest({
    seed: datasetSeed([oneBar]),
    bars: [oneBar],
  });
  const validation = validateDatasetForCalibration({
    dataset: { manifest, bars: [oneBar] },
    horizon: "swing",
    candidateCount: 1,
    holdoutStartTime: oneBar.openTime + 1,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.dataset.actualStartTime, oneBar.openTime);
  assert.equal(validation.dataset.actualEndTime, oneBar.closeTime);
  assert.ok(validation.blockers.includes("history-period"));
  assert.ok(validation.blockers.includes("holdout-period"));
});

test("dataset validation rejects malformed bars and missing symbol evidence", () => {
  const bars = [bar(0), bar(1)];
  const manifest = createDatasetManifest({ seed: datasetSeed(bars), bars });
  const duplicate = verifyDatasetIdentity({
    manifest,
    bars: [bars[0], bars[0]],
  });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.contentValidation.blockers.includes("duplicate-bars"));
  assert.ok(duplicate.contentValidation.blockers.includes("chronological"));

  const malformed = verifyDatasetIdentity({
    manifest: { ...manifest, symbolEvidence: [] },
    bars: [
      bars[0],
      {
        ...bars[1],
        symbol: "MSFT",
        market: "KR",
        timeframe: "1h",
        low: 110,
        high: 90,
        sessionDate: "2026-02-30",
      },
    ],
  });
  assert.equal(malformed.valid, false);
  for (const blocker of [
    "symbols",
    "markets",
    "timeframe",
    "price-shape",
    "session-shape",
    "symbol-evidence",
    "symbol-validity",
    "point-in-time-universe-evidence",
    "delisting-evidence",
  ] as const) {
    assert.ok(malformed.contentValidation.blockers.includes(blocker));
  }
});

test("dataset creation requires per-symbol universe and delisting evidence", () => {
  const bars = [bar(0), bar(1)];
  const seed = datasetSeed(bars);
  assert.throws(
    () =>
      createDatasetManifest({
        seed: {
          ...seed,
          symbolEvidence: seed.symbolEvidence.map((item) => ({
            ...item,
            universeMemberships: [{ from: bars[1].openTime, to: null }],
          })),
        },
        bars,
      }),
    /point-in-time-universe-evidence/,
  );
  assert.throws(
    () =>
      createDatasetManifest({
        seed: {
          ...seed,
          symbolEvidence: seed.symbolEvidence.map((item) => ({
            ...item,
            validTo: bars[1].closeTime,
            delisting: {
              status: "delisted" as const,
              effectiveTime: bars[0].closeTime,
            },
          })),
        },
        bars,
      }),
    /delisting-evidence/,
  );
});

test("entry uses the next bar open and applies adverse slippage", () => {
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 102, low: 99, close: 101 }),
    bar(2, { open: 101, high: 102, low: 100, close: 101, isSessionEnd: true }),
  ];
  const result = run({
    bars,
    signals: [signal(bars[0], { targets: [] })],
    backtestConfig: config({
      maxHoldBars: 1,
      cost: {
        id: "10bp",
        commissionRate: 0,
        sellTaxRate: 0,
        adverseSlippageBps: 10,
      },
    }),
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryIndex, 1);
  assert.equal(result.trades[0].entryTime, bars[1].openTime);
  assert.equal(result.trades[0].entryPrice, 100.1);
  assert.equal(result.trades[0].exitReason, "time");
});

test("next-open entry includes a bar whose open equals the confirmation close", () => {
  const bars = [
    bar(0, {
      timeframe: "5m",
      openTime: 0,
      closeTime: 300,
      sessionDate: "2026-07-15",
    }),
    bar(1, {
      timeframe: "5m",
      openTime: 300,
      closeTime: 600,
      sessionDate: "2026-07-15",
    }),
    bar(2, {
      timeframe: "5m",
      openTime: 600,
      closeTime: 900,
      sessionDate: "2026-07-15",
    }),
  ];
  const result = run({
    bars,
    signals: [signal(bars[0], { targets: [] })],
    backtestConfig: config({ timeframe: "5m", maxHoldBars: 1 }),
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryIndex, 1);
  assert.equal(result.trades[0].entryTime, 300);
});

test("gap stops fill at the worse open with adverse slippage", () => {
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 102, low: 98, close: 101 }),
    bar(2, { open: 90, high: 92, low: 88, close: 89 }),
  ];
  const result = run({
    bars,
    signals: [signal(bars[0], { targets: [] })],
    backtestConfig: config({
      cost: {
        id: "10bp",
        commissionRate: 0,
        sellTaxRate: 0,
        adverseSlippageBps: 10,
      },
    }),
  });
  const exit = result.trades[0].fills.at(-1)!;
  assert.equal(result.trades[0].exitReason, "stop");
  assert.equal(exit.referencePrice, 90);
  assert.equal(exit.executionPrice, 89.91);
  assert.equal(result.trades[0].exitTime, bars[2].openTime);
});

test("same-bar stop has priority over targets and target gaps fill at target", () => {
  const stopFirstBars = [
    bar(0),
    bar(1, { open: 100, high: 112, low: 94, close: 108 }),
  ];
  const stopped = run({
    bars: stopFirstBars,
    signals: [signal(stopFirstBars[0], { targets: [{ id: "1R", allocationFraction: 1, rMultiple: 1 }] })],
  });
  assert.equal(stopped.trades[0].exitReason, "stop");
  assert.equal(stopped.trades[0].fills.some((fill) => fill.reason === "target"), false);

  const targetGapBars = [
    bar(0),
    bar(1, { open: 100, high: 102, low: 98, close: 101 }),
    bar(2, { open: 110, high: 111, low: 106, close: 109 }),
  ];
  const targeted = run({
    bars: targetGapBars,
    signals: [signal(targetGapBars[0], { targets: [{ id: "1R", allocationFraction: 1, rMultiple: 1 }] })],
  });
  const targetFill = targeted.trades[0].fills.at(-1)!;
  assert.equal(targetFill.reason, "target");
  assert.equal(targetFill.referencePrice, 105);
  assert.equal(targetFill.executionPrice, 105);
});

test("partial exits charge costs on every fill", () => {
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 106, low: 96, close: 105 }),
    bar(2, { open: 106, high: 111, low: 101, close: 110 }),
  ];
  const result = run({
    bars,
    signals: [
      signal(bars[0], {
        targets: [
          { id: "1R", allocationFraction: 0.5, rMultiple: 1 },
          { id: "2R", allocationFraction: 0.5, rMultiple: 2 },
        ],
      }),
    ],
    backtestConfig: config({
      cost: {
        id: "one-percent",
        commissionRate: 0.01,
        sellTaxRate: 0,
        adverseSlippageBps: 0,
      },
    }),
  });
  const trade = result.trades[0];
  assert.equal(trade.fills.length, 3);
  assert.deepEqual(trade.fills.map((fill) => fill.reason), ["entry", "target", "target"]);
  assert.equal(trade.quantity, 200);
  assert.equal(trade.grossPnl, 1_500);
  assert.equal(trade.totalCosts, 415);
  assert.equal(trade.netPnl, 1_085);
});

test("a close-triggered trail exits at the next open", () => {
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 102, low: 98, close: 99 }),
    bar(2, { open: 97, high: 98, low: 96, close: 97 }),
  ];
  const result = run({
    bars,
    signals: [
      signal(bars[0], {
        targets: [],
        trailingLevels: [
          { observedAtCloseTime: bars[1].closeTime, price: 100 },
        ],
      }),
    ],
  });
  const trade = result.trades[0];
  assert.equal(trade.exitReason, "trail");
  assert.equal(trade.exitTime, bars[2].openTime);
  assert.equal(trade.fills.at(-1)?.executionPrice, 97);
});

test("intraday positions exit at the session close without carrying overnight", () => {
  const bars = [
    bar(0, { timeframe: "5m", sessionDate: "2026-07-15" }),
    bar(1, {
      timeframe: "5m",
      sessionDate: "2026-07-15",
      open: 100,
      high: 103,
      low: 98,
      close: 102,
      isSessionEnd: true,
    }),
  ];
  const intradayConfig = config({
    playbookId: "intraday-crash-reversal",
    horizon: "intraday",
    timeframe: "5m",
    forceSessionEndExit: true,
  });
  const result = run({
    bars,
    signals: [
      signal(bars[0], {
        playbookId: "intraday-crash-reversal",
        sessionDate: "2026-07-15",
        targets: [],
      }),
    ],
    backtestConfig: intradayConfig,
  });
  assert.equal(result.trades[0].exitReason, "session-end");
  assert.equal(result.trades[0].exitTime, bars[1].closeTime);
  assert.equal(result.equityCurve.at(-1)?.openSignalId, null);
});

test("engine reports causal rejections and MAE/MFE/equity", () => {
  const bars = [
    bar(0),
    bar(1, { open: 100, high: 104, low: 97, close: 103 }),
    bar(2, { open: 103, high: 104, low: 101, close: 102 }),
  ];
  const result = run({
    bars,
    signals: [
      signal(bars[0], { id: "valid", targets: [] }),
      signal(bars[0], { id: "overlap", confirmedAt: bars[1].closeTime, targets: [] }),
      signal(bars[2], { id: "no-next", targets: [] }),
    ],
    backtestConfig: config({ maxHoldBars: 2 }),
  });
  assert.equal(result.trades.length, 1);
  assert.ok(result.trades[0].maxAdverseExcursionFraction < 0);
  assert.ok(result.trades[0].maxFavorableExcursionFraction > 0);
  assert.equal(result.equityCurve.length, bars.length);
  assert.deepEqual(
    result.rejections.map((item) => item.reason).toSorted(),
    ["missing-next-bar", "position-open"],
  );
});

test("chronological folds are expanding, isolated, and reserve the holdout", () => {
  const timestamps = Array.from({ length: 12 }, (_, index) => index + 1);
  const result = createChronologicalFolds({
    timestamps,
    initialTrainingSize: 4,
    validationSize: 2,
    stepSize: 2,
    holdoutSize: 2,
  });
  assert.equal(result.folds.length, 3);
  assert.deepEqual(result.folds[0].train, {
    startIndex: 0,
    endIndex: 3,
    startTime: 1,
    endTime: 4,
  });
  assert.equal(result.folds[2].validation.endIndex, 9);
  assert.deepEqual(result.holdout, {
    startIndex: 10,
    endIndex: 11,
    startTime: 11,
    endTime: 12,
  });
  for (const fold of result.folds) {
    assert.ok(fold.train.endTime < fold.validation.startTime);
    assert.ok(fold.validation.endTime < result.holdout!.startTime);
  }
});

test("block bootstrap is seeded, deterministic, and returns a 95% average-R interval", () => {
  const input = {
    values: [1.2, -0.8, 0.5, 1.8, -0.3, 0.9, 0.2, 1.1],
    blockSize: 2,
    samples: 2_000,
    seed: 42,
  };
  const first = blockBootstrapAverageR95(input);
  const second = blockBootstrapAverageR95(input);
  assert.deepEqual(first, second);
  assert.equal(first.sampleSize, input.values.length);
  assert.ok(Math.abs(first.mean - 0.575) < 1e-12);
  assert.ok(first.lower95 < first.mean);
  assert.ok(first.upper95 > first.mean);
  assert.notDeepEqual(
    first,
    blockBootstrapAverageR95({ ...input, seed: 43 }),
  );
});

test("Holm correction stops rejecting after the first failed ordered hypothesis", () => {
  const result = applyHolmBonferroni({
    comparisons: [
      { id: "candidate-c", pValue: 0.04 },
      { id: "candidate-a", pValue: 0.005 },
      { id: "candidate-b", pValue: 0.03 },
    ],
  });
  assert.deepEqual(
    result.comparisons.map(({ id, rank, rejected }) => ({ id, rank, rejected })),
    [
      { id: "candidate-a", rank: 1, rejected: true },
      { id: "candidate-b", rank: 2, rejected: false },
      { id: "candidate-c", rank: 3, rejected: false },
    ],
  );
  assert.deepEqual(result.rejectedIds, ["candidate-a"]);
  assert.equal(result.comparisons[0].threshold, 0.05 / 3);
});

test("calibration policy fixes cost stress, candidate cap, history, and holdout", () => {
  const intradayCosts = stockCostScenariosFor({
    market: "KR",
    horizon: "intraday",
    scheduleId: "2026-07-15",
    commissionRate: 0.00015,
    sellTaxRate: 0.0018,
  });
  const swingCosts = stockCostScenariosFor({
    market: "US",
    horizon: "swing",
    scheduleId: "2026-07-15",
    commissionRate: 0.0007,
    sellTaxRate: 0,
  });
  assert.deepEqual(
    [
      intradayCosts.base.adverseSlippageBps,
      intradayCosts.stress.adverseSlippageBps,
      swingCosts.base.adverseSlippageBps,
      swingCosts.stress.adverseSlippageBps,
    ],
    [10, 30, 5, 15],
  );

  const seconds = (year: number, month: number, day = 1) =>
    Date.UTC(year, month, day) / 1_000;
  const validSwing = validateCalibrationDesign({
    horizon: "swing",
    candidateCount: 12,
    dataStartTime: seconds(2018, 0),
    dataEndTime: seconds(2026, 0),
    holdoutStartTime: seconds(2024, 0),
  });
  assert.equal(validSwing.valid, true);
  assert.equal(validSwing.policy.minimumHistoryMonths, 96);
  assert.equal(validSwing.policy.minimumHoldoutMonths, 24);

  const validShortHold = validateCalibrationDesign({
    horizon: "short-hold",
    candidateCount: 1,
    dataStartTime: seconds(2024, 0),
    dataEndTime: seconds(2026, 0),
    holdoutStartTime: seconds(2025, 6),
  });
  assert.equal(validShortHold.valid, true);
  assert.equal(validShortHold.policy.minimumHistoryMonths, 24);
  assert.equal(validShortHold.policy.minimumHoldoutMonths, 6);

  const invalidIntraday = validateCalibrationDesign({
    horizon: "intraday",
    candidateCount: 13,
    dataStartTime: seconds(2023, 1),
    dataEndTime: seconds(2026, 0),
    holdoutStartTime: seconds(2025, 8),
  });
  assert.equal(invalidIntraday.valid, false);
  assert.deepEqual(invalidIntraday.blockers.toSorted(), [
    "candidate-count",
    "history-period",
    "holdout-period",
  ]);
});

const promotionTrade = ({
  id,
  symbol,
  year,
  netPnl = 100,
  rMultiple = 1,
}: {
  id: string;
  symbol: string;
  year: number;
  netPnl?: number;
  rMultiple?: number;
}): StockBacktestTrade => ({
  signalId: id,
  symbol,
  playbookId: "swing-trend",
  direction: "long",
  signalTime: Date.UTC(year, 0, 1) / 1_000,
  confirmedAt: Date.UTC(year, 0, 1) / 1_000,
  entryTime: Date.UTC(year, 0, 2) / 1_000,
  exitTime: Date.UTC(year, 0, 3) / 1_000,
  entryIndex: 1,
  exitIndex: 2,
  entryPrice: 100,
  initialStopPrice: 95,
  quantity: 10,
  riskPerUnit: 5,
  riskCapital: 50,
  grossPnl: netPnl,
  totalCosts: 0,
  netPnl,
  rMultiple,
  holdBars: 2,
  maxAdverseExcursionFraction: -0.01,
  maxFavorableExcursionFraction: 0.02,
  maxAdverseExcursionR: -0.2,
  maxFavorableExcursionR: 0.4,
  exitReason: "target",
  fills: [],
});

test("target-before-stop counts a partial target even when the runner trails out", () => {
  const partialThenTrail = promotionTrade({
    id: "partial",
    symbol: "AAPL",
    year: 2025,
  });
  partialThenTrail.exitReason = "trail";
  partialThenTrail.fills = [{
    time: partialThenTrail.exitTime - 1,
    barIndex: 1,
    side: "sell",
    reason: "target",
    targetId: "1R",
    referencePrice: 105,
    executionPrice: 105,
    quantity: 5,
    commission: 0,
    tax: 0,
    grossPnl: 25,
  }];
  const stopped = promotionTrade({
    id: "stopped",
    symbol: "MSFT",
    year: 2025,
    netPnl: -50,
    rMultiple: -1,
  });

  assert.equal(
    targetBeforeStopRateFromTrades([partialThenTrail, stopped]),
    0.5,
  );
});

test("promotion evaluation exposes all planned gates", () => {
  const trades = [
    promotionTrade({ id: "1", symbol: "A", year: 2022 }),
    promotionTrade({ id: "2", symbol: "B", year: 2023 }),
    promotionTrade({ id: "3", symbol: "C", year: 2024 }),
    promotionTrade({ id: "4", symbol: "D", year: 2025 }),
  ];
  const evaluation = evaluatePromotion({
    horizon: "swing",
    oosTrades: trades,
    holdoutTrades: trades.slice(0, 2),
    stressTrades: trades,
    averageRLower95: 0.1,
    foldNetReturns: [0.1, 0.2, 0.05],
    maxDrawdown: -0.1,
    baselineMaxDrawdown: -0.2,
    pointInTimeUniverse: true,
    delistingsIncluded: true,
    holmAdjustedPassed: true,
    thresholds: {
      minimumOosTrades: 4,
      minimumHoldoutTrades: 2,
    },
  });
  assert.equal(evaluation.status, "calibrated");
  assert.equal(evaluation.blockers.length, 0);
  assert.equal(evaluation.metrics.maximumSymbolContribution, 0.25);
  assert.equal(evaluation.metrics.maximumYearContribution, 0.25);
  assert.deepEqual(
    evaluation.checks.map((check) => check.id),
    [
      "oos-sample",
      "holdout-sample",
      "average-r-ci",
      "base-profit-factor",
      "stress-profit-factor",
      "positive-fold-ratio",
      "top-one-percent",
      "symbol-concentration",
      "year-concentration",
      "drawdown",
      "point-in-time-universe",
      "delistings",
      "holm-adjustment",
    ],
  );
});

test("profit concentration uses total net profit including losing groups", () => {
  const trades = [
    promotionTrade({ id: "1", symbol: "A", year: 2022, netPnl: 30 }),
    promotionTrade({ id: "2", symbol: "B", year: 2023, netPnl: 30 }),
    promotionTrade({ id: "3", symbol: "C", year: 2024, netPnl: 30 }),
    promotionTrade({ id: "4", symbol: "D", year: 2025, netPnl: 30 }),
    promotionTrade({ id: "5", symbol: "E", year: 2026, netPnl: -80 }),
  ];
  const evaluation = evaluatePromotion({
    horizon: "swing",
    oosTrades: trades,
    holdoutTrades: trades,
    stressTrades: trades,
    averageRLower95: 0.1,
    foldNetReturns: [0.1],
    maxDrawdown: -0.1,
    baselineMaxDrawdown: -0.2,
    pointInTimeUniverse: true,
    delistingsIncluded: true,
    holmAdjustedPassed: true,
    thresholds: {
      minimumOosTrades: 5,
      minimumHoldoutTrades: 5,
    },
  });

  assert.equal(evaluation.metrics.maximumSymbolContribution, 0.75);
  assert.equal(evaluation.metrics.maximumYearContribution, 0.75);
  assert.ok(evaluation.blockers.includes("symbol-concentration"));
  assert.ok(evaluation.blockers.includes("year-concentration"));
});

test("statistical promotion helper derives CI and Holm status from raw trials", () => {
  const trades = Array.from({ length: 40 }, (_, index) =>
    promotionTrade({
      id: String(index),
      symbol: `S${index % 4}`,
      year: 2022 + (index % 4),
      netPnl: 100 + index,
      rMultiple: 0.4 + (index % 5) * 0.1,
    }),
  );
  const result = evaluatePromotionWithStatistics({
    horizon: "swing",
    oosTrades: trades,
    holdoutTrades: trades.slice(0, 20),
    stressTrades: trades,
    foldNetReturns: [0.1, 0.05, 0.2],
    maxDrawdown: -0.1,
    baselineMaxDrawdown: -0.2,
    pointInTimeUniverse: true,
    delistingsIncluded: true,
    bootstrap: { blockSize: 4, samples: 1_000, seed: 7 },
    candidatePValues: [
      { id: "selected", pValue: 0.001 },
      { id: "other", pValue: 0.5 },
    ],
    selectedCandidateId: "selected",
    thresholds: {
      minimumOosTrades: 40,
      minimumHoldoutTrades: 20,
      maximumSymbolContribution: 0.3,
      maximumYearContribution: 0.3,
    },
  });
  assert.equal(result.evaluation.status, "calibrated");
  assert.ok((result.bootstrap?.lower95 ?? 0) > 0);
  assert.deepEqual(result.holm.rejectedIds, ["selected"]);
  assert.equal(result.evaluation.metrics.averageRLower95, result.bootstrap?.lower95);
});

test("promotion remains provisional or insufficient when evidence is incomplete", () => {
  const trades = Array.from({ length: 30 }, (_, index) =>
    promotionTrade({
      id: String(index),
      symbol: "A",
      year: 2025,
      netPnl: index % 2 === 0 ? 100 : -100,
      rMultiple: index % 2 === 0 ? 1 : -1,
    }),
  );
  const inputs = {
    horizon: "swing" as const,
    oosTrades: trades,
    holdoutTrades: [],
    stressTrades: trades,
    averageRLower95: null,
    foldNetReturns: [],
    maxDrawdown: -0.3,
    baselineMaxDrawdown: -0.2,
    pointInTimeUniverse: false,
    delistingsIncluded: false,
    holmAdjustedPassed: false,
  };
  assert.equal(evaluatePromotion(inputs).status, "provisional");
  assert.equal(
    evaluatePromotion({ ...inputs, oosTrades: trades.slice(0, 29) }).status,
    "insufficient-data",
  );
});
