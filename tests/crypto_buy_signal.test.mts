import assert from "node:assert/strict";
import test from "node:test";

import { runCryptoBacktest } from "../src/lib/crypto-buy/backtest.mts";
import {
  calculateCryptoFeatures,
  calculateLowerTfConfirmations,
  evaluateDailySignalLanes,
  evaluateSellSignalLanes,
  evaluateSellWarning,
  forwardFillHigherTimeframe,
} from "../src/lib/crypto-buy/features.mts";
import {
  PARENT_TIMEFRAME_REQUIREMENTS,
  buildSellWarningEvents,
} from "../src/lib/crypto-buy/service.mts";
import { generateCryptoSignals } from "../src/lib/crypto-buy/signals.mts";
import {
  COST_CONFIGS,
  DEFAULT_BACKTEST_CONFIG,
} from "../src/lib/crypto-buy/types.mts";
import {
  CRYPTO_BACKTEST_MAX_DAYS,
  parseBoundedDateRange,
} from "../src/lib/security/request-bounds.ts";

const intervalSeconds = {
  "30m": 1_800,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

const createBar = (index, overrides = {}) => {
  const interval = overrides.interval ?? "1d";
  const openTime = index * intervalSeconds[interval];
  return {
    symbol: "BTCUSDT",
    interval,
    openTime,
    closeTime: openTime + intervalSeconds[interval] - 1,
    time: openTime,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
    quoteVolume: 100_000,
    tradeCount: 100,
    ...overrides,
  };
};

const createRow = (index, overrides = {}) => ({
  index,
  bar: createBar(index),
  timeframe: "1d",
  side: "buy",
  return3: -0.09,
  return5: -0.1,
  volumeRatio20: 2.5,
  rsi7: 18,
  rsi14: 28,
  zScore20: -2.4,
  bbUpper20_2: 102,
  bbLower20_2: 98,
  priorRangeLow20: 99,
  breakdownDepth20: 0.004,
  rangeReentry: true,
  breakdownHold: false,
  priorRangeHigh20: 101,
  breakoutDepth20: 0,
  rangeReject: true,
  breakoutHold: false,
  recoveryRatio: 0.68,
  rejectionRatio: 0.12,
  wickBodyRatio: 0.4,
  upperWickBodyRatio: 0.2,
  panicClose: false,
  weakLowerWick: true,
  tightUpperWick: true,
  panicUpPassed: false,
  overboughtCount: 0,
  sellWarningLevel: 0,
  sellWarningReasons: [],
  flushSignal: false,
  reboundSignal: true,
  capitulationSignal: false,
  rejectionSignal: false,
  upthrustSignal: false,
  blowoffSignal: false,
  signalFamily: "rebound",
  signalLane: "clean-rebound",
  atr14: 2,
  volatilityExpansion: 1.3,
  ema5: 100,
  htfClose: 105,
  htfEma50: 100,
  htfRsi14: 50,
  htfPassed: true,
  liquidityAverage20d: 20_000_000,
  liquidityPassed: true,
  oversoldCount: 3,
  panicPassed: true,
  reversalPassed: true,
  primaryLowerTf: {
    interval: "4h",
    required: true,
    direction: "long",
    passed: true,
    triggeredBreak: true,
    lastRecovery: true,
    lastReentry: true,
    triggerTime: 1,
    priorRangeLevel20: 95,
    priorRangeLow20: 95,
    lastChildClose: 96,
    excursionDepth20: 0.02,
    breakdownDepth20: 0.02,
  },
  secondaryLowerTf: {
    interval: "1h",
    required: false,
    direction: "long",
    passed: false,
    triggeredBreak: false,
    lastRecovery: false,
    lastReentry: false,
    triggerTime: null,
    priorRangeLevel20: 95,
    priorRangeLow20: 95,
    lastChildClose: 94,
    excursionDepth20: null,
    breakdownDepth20: null,
  },
  panicBuySetup: true,
  score: 12,
  notes: ["panic", "oversold:3", "reversal", "htf"],
  ...overrides,
});

test("crypto backtest date range rejects oversized requests", () => {
  const range = parseBoundedDateRange({
    startRaw: "2024-01-01",
    endRaw: "2026-01-05",
    fallbackDays: 30,
    maxDays: CRYPTO_BACKTEST_MAX_DAYS,
  });

  assert.equal(range.ok, false);
  if (!range.ok) {
    assert.equal(range.response.status, 400);
  }
});

test("timeframe requirement mapping matches the spec", () => {
  assert.deepEqual(PARENT_TIMEFRAME_REQUIREMENTS["1d"], {
    warmupMs: 180 * 24 * 60 * 60 * 1000,
    primary: "4h",
    secondary: "1h",
  });
  assert.deepEqual(PARENT_TIMEFRAME_REQUIREMENTS["4h"], {
    warmupMs: 60 * 24 * 60 * 60 * 1000,
    primary: "1h",
    secondary: "30m",
  });
});

test("mode A enters at t+1 and mode B enters at t+2 after confirmation", () => {
  const rows = [
    createRow(0, { panicBuySetup: false }),
    createRow(1, {
      bar: createBar(1, { high: 100, low: 95, close: 98 }),
    }),
    createRow(2, {
      bar: createBar(2, { close: 101, low: 96 }),
      ema5: 99,
      htfPassed: true,
      panicBuySetup: false,
    }),
    createRow(3),
  ];

  const { signalsByMode } = generateCryptoSignals({
    symbol: "BTCUSDT",
    featureRows: rows,
  });

  assert.equal(signalsByMode.A.length, 1);
  assert.equal(signalsByMode.A[0].entryIndex, 2);
  assert.equal(signalsByMode.B.length, 1);
  assert.equal(signalsByMode.B[0].entryIndex, 3);
});

test("mode B does not emit without confirmation", () => {
  const rows = [
    createRow(0),
    createRow(1, {
      bar: createBar(1, { high: 110, low: 95, close: 99 }),
      htfPassed: true,
    }),
    createRow(2, {
      bar: createBar(2, { close: 100, low: 94 }),
      ema5: 101,
      htfPassed: true,
    }),
    createRow(3),
  ];

  const { signalsByMode } = generateCryptoSignals({
    symbol: "BTCUSDT",
    featureRows: rows,
  });

  assert.equal(signalsByMode.B.length, 0);
});

test("forward fill uses only closed higher timeframe bars", () => {
  const lowerBars = [
    createBar(0, { closeTime: 3_599 }),
    createBar(1, { closeTime: 7_199 }),
    createBar(2, { closeTime: 14_399 }),
  ];
  const higherBars = [
    {
      ...createBar(0),
      interval: "4h",
      openTime: 0,
      closeTime: 14_399,
      close: 200,
    },
    {
      ...createBar(1),
      interval: "4h",
      openTime: 14_400,
      closeTime: 28_799,
      close: 210,
    },
  ];

  const filled = forwardFillHigherTimeframe({
    lowerTimeframeBars: lowerBars,
    higherTimeframeBars: higherBars,
    higherCloseValues: [200, 210],
    higherEma50Values: [190, 195],
    higherRsi14Values: [46, 50],
  });

  assert.equal(filled[0].close, null);
  assert.equal(filled[1].close, null);
  assert.equal(filled[2].close, 200);
});

test("backtest gives stop priority when stop and target are both touched in the same bar", () => {
  const bars = [
    createBar(0, { open: 100, high: 100, low: 100, close: 100 }),
    createBar(1, { open: 100, high: 111, low: 94, close: 108 }),
  ];
  const signal = {
    symbol: "BTCUSDT",
    timeframe: "1d",
    mode: "A",
    signalFamily: null,
    signalIndex: 0,
    signalTime: bars[0].closeTime,
    entryIndex: 1,
    entryTime: bars[1].openTime,
    score: 12,
    reasons: ["test"],
    stopLevel: 95,
    signalLow: 95,
    atr14: 2,
    confirmPassed: true,
    htfPassed: true,
  };

  const result = runCryptoBacktest({
    symbol: "BTCUSDT",
    mode: "A",
    bars,
    signals: [signal],
    cost: COST_CONFIGS.zero,
    config: DEFAULT_BACKTEST_CONFIG,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, "stop");
  assert.equal(result.trades[0].tp1Hit, false);
});

test("backtest enforces cooldown after stop and skips invalid risk entries", () => {
  const bars = Array.from({ length: 12 }, (_, index) =>
    createBar(index, {
      open: 100,
      high: 101,
      low: index === 1 ? 94 : 99,
      close: 100,
    }),
  );
  const signals = [
    {
      symbol: "BTCUSDT",
      timeframe: "1d",
      mode: "A",
      signalFamily: null,
      signalIndex: 0,
      signalTime: bars[0].closeTime,
      entryIndex: 1,
      entryTime: bars[1].openTime,
      score: 12,
      reasons: ["stop-first"],
      stopLevel: 95,
      signalLow: 95,
      atr14: 2,
      confirmPassed: true,
      htfPassed: true,
    },
    {
      symbol: "BTCUSDT",
      timeframe: "1d",
      mode: "A",
      signalFamily: null,
      signalIndex: 1,
      signalTime: bars[1].closeTime,
      entryIndex: 2,
      entryTime: bars[2].openTime,
      score: 10,
      reasons: ["cooldown-skip"],
      stopLevel: 95,
      signalLow: 95,
      atr14: 2,
      confirmPassed: true,
      htfPassed: true,
    },
    {
      symbol: "BTCUSDT",
      timeframe: "1d",
      mode: "A",
      signalFamily: null,
      signalIndex: 9,
      signalTime: bars[9].closeTime,
      entryIndex: 10,
      entryTime: bars[10].openTime,
      score: 10,
      reasons: ["invalid-risk"],
      stopLevel: 101,
      signalLow: 101,
      atr14: 2,
      confirmPassed: true,
      htfPassed: true,
    },
  ];

  const result = runCryptoBacktest({
    symbol: "BTCUSDT",
    mode: "A",
    bars,
    signals,
    cost: COST_CONFIGS.zero,
    config: DEFAULT_BACKTEST_CONFIG,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.skippedSignals, 2);
});

test("backtest time-exits after 16 bars when no stop or target is hit", () => {
  const bars = Array.from({ length: 20 }, (_, index) =>
    createBar(index, {
      open: 100,
      high: 100.4,
      low: 99.7,
      close: 100.1,
    }),
  );
  const signal = {
    symbol: "BTCUSDT",
    timeframe: "1d",
    mode: "A",
    signalFamily: null,
    signalIndex: 0,
    signalTime: bars[0].closeTime,
    entryIndex: 1,
    entryTime: bars[1].openTime,
    score: 12,
    reasons: ["time-exit"],
    stopLevel: 95,
    signalLow: 95,
    atr14: 2,
    confirmPassed: true,
    htfPassed: true,
  };

  const result = runCryptoBacktest({
    symbol: "BTCUSDT",
    mode: "A",
    bars,
    signals: [signal],
    cost: COST_CONFIGS.zero,
    config: DEFAULT_BACKTEST_CONFIG,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, "time");
  assert.equal(result.trades[0].exitIndex, 16);
});

test("clustered daily signals keep the latest panic day instead of emitting duplicates", () => {
  const rows = [
    createRow(0, { panicBuySetup: false }),
    createRow(1, { score: 8, flushSignal: true, reboundSignal: false }),
    createRow(2, { score: 9, flushSignal: true, reboundSignal: false }),
    createRow(3, { score: 10, flushSignal: false, reboundSignal: true }),
    createRow(4, { panicBuySetup: false }),
    createRow(8, { score: 9, flushSignal: true, reboundSignal: false }),
    createRow(9, { panicBuySetup: false }),
    createRow(10, { panicBuySetup: false }),
  ];

  const { signalsByMode } = generateCryptoSignals({
    symbol: "BTCUSDT",
    featureRows: rows,
  });

  assert.equal(signalsByMode.A.length, 2);
  assert.equal(signalsByMode.A[0].signalIndex, 3);
  assert.equal(signalsByMode.A[1].signalIndex, 8);
});

test("lower timeframe reclaim fails without a final re-entry above the rolling range low", () => {
  const parentBars = [createBar(0, { interval: "1d" })];
  const childBars = Array.from({ length: 24 }, (_, index) =>
    createBar(index, {
      interval: "1h",
      open: 100,
      high: 101,
      low: index === 22 ? 87 : index === 23 ? 86 : 99,
      close: index === 22 ? 87 : index === 23 ? 86 : 100,
    }),
  );

  const confirmations = calculateLowerTfConfirmations({
    parentBars,
    childBars,
    interval: "1h",
    required: true,
  });

  assert.equal(confirmations[0].triggeredBreak, true);
  assert.equal(confirmations[0].lastReentry, false);
  assert.equal(confirmations[0].passed, false);
});

test("lower timeframe reclaim passes once the last closed child bar re-enters the rolling range", () => {
  const parentBars = [createBar(0, { interval: "4h" })];
  const childBars = Array.from({ length: 8 }, (_, index) =>
    createBar(index, {
      interval: "30m",
      open: 100,
      high: 101,
      low: index === 5 ? 89 : 99,
      close: index === 7 ? 100 : 99,
    }),
  );
  const warmupBars = Array.from({ length: 20 }, (_, index) =>
    createBar(index - 20, {
      interval: "30m",
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }),
  );

  const confirmations = calculateLowerTfConfirmations({
    parentBars,
    childBars: [...warmupBars, ...childBars],
    interval: "30m",
    required: false,
  });

  assert.equal(confirmations[0].triggeredBreak, true);
  assert.equal(confirmations[0].lastReentry, true);
  assert.equal(confirmations[0].passed, true);
});

test("secondary lower timeframe pass adds score but does not create a signal without the required primary pass", () => {
  const bars = Array.from({ length: 25 }, (_, index) =>
    createBar(index, {
      interval: "4h",
      open: 100,
      high: 101,
      low: 99,
      close: index >= 20 ? 90 : 100,
      volume: index === 24 ? 4_000 : 1_000,
      quoteVolume: index === 24 ? 400_000_000 : 100_000_000,
    }),
  );
  const baseConfirmations = bars.map(() => ({
    interval: "1h",
    required: true,
    passed: false,
    triggeredBreak: false,
    lastReentry: false,
    triggerTime: null,
    priorRangeLow20: 95,
    lastChildClose: 94,
    breakdownDepth20: null,
  }));
  const bonusConfirmations = bars.map((_, index) => ({
    interval: "30m",
    required: false,
    passed: index === 24,
    triggeredBreak: index === 24,
    lastReentry: index === 24,
    triggerTime: index === 24 ? 1 : null,
    priorRangeLow20: 95,
    lastChildClose: index === 24 ? 96 : 94,
    breakdownDepth20: index === 24 ? 0.01 : null,
  }));

  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "4h",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: baseConfirmations,
    secondaryLowerTfConfirmations: bonusConfirmations,
  });

  assert.equal(features[24].secondaryLowerTf?.passed, true);
  assert.equal(features[24].panicBuySetup, false);
  assert.equal(features[24].score > features[23].score, true);

  const { signalsByMode } = generateCryptoSignals({
    symbol: "BTCUSDT",
    featureRows: features.map((feature, index) => ({ ...feature, index })),
  });

  assert.equal(signalsByMode.A.length, 0);
});

const createDailyFeatureBars = ({
  lastBar,
}: {
  lastBar: Partial<ReturnType<typeof createBar>>;
}) => {
  const closes = [110, 110, 110, 108, 103, 97, 91, lastBar.close ?? 92];
  return Array.from({ length: 25 }, (_, index) => {
    if (index < 17) {
      return createBar(index, {
        interval: "1d",
        open: 110,
        high: 111,
        low: 109,
        close: 110,
        volume: 1_000,
        quoteVolume: 110_000_000,
      });
    }

    const mappedClose = closes[index - 17];
    return createBar(index, {
      interval: "1d",
      open: index === 24 ? lastBar.open ?? mappedClose + 2 : mappedClose + 2,
      high: index === 24 ? lastBar.high ?? mappedClose + 8 : mappedClose + 3,
      low: index === 24 ? lastBar.low ?? mappedClose - 4 : mappedClose - 3,
      close: mappedClose,
      volume: index === 24 ? lastBar.volume ?? 2_000 : 1_000,
      quoteVolume:
        index === 24
          ? lastBar.quoteVolume ?? mappedClose * (lastBar.volume ?? 2_000) * 1_000
          : mappedClose * 1_000 * 1_000,
    });
  });
};

const createLowerTfConfirmations = ({
  bars,
  interval,
  passed,
  breakdownDepth20,
}: {
  bars: ReturnType<typeof createBar>[];
  interval: "4h" | "1h";
  passed: boolean;
  breakdownDepth20: number | null;
}) =>
  bars.map(() => ({
    interval,
    required: interval === "4h",
    passed,
    triggeredBreak: passed || typeof breakdownDepth20 === "number",
    lastReentry: passed,
    triggerTime: passed ? 1 : null,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20,
  }));

test("daily clean rebound requires a range re-entry", () => {
  const lane = evaluateDailySignalLanes({
    panicPassed: true,
    oversoldCount: 3,
    rangeReentry: false,
    recoveryRatio: 0.86,
    wickBodyRatio: 0.25,
    upperWickBodyRatio: 0.2,
    flushSignalBase: false,
    volumeRatio20: 2.4,
    breakdownDepth20: 0.1,
    primaryLowerTfPassed: true,
    primaryLowerTfBreakdownDepth20: 0.03,
    return3: -0.18,
    return5: -0.23,
    rsi14: 28,
  });

  assert.equal(lane.reboundSignal, false);
  assert.equal(lane.signalFamily, null);
  assert.equal(lane.lowerTfGate, true);
});

test("daily extreme reversal passes with a primary breakdown depth override", () => {
  const lane = evaluateDailySignalLanes({
    panicPassed: true,
    oversoldCount: 3,
    rangeReentry: false,
    recoveryRatio: 0.96,
    wickBodyRatio: 0.25,
    upperWickBodyRatio: 0.05,
    flushSignalBase: false,
    volumeRatio20: 2.6,
    breakdownDepth20: 0.1,
    primaryLowerTfPassed: false,
    primaryLowerTfBreakdownDepth20: 0.09,
    return3: -0.18,
    return5: -0.23,
    rsi14: 28,
  });

  assert.equal(lane.reboundSignal, true);
  assert.equal(lane.signalFamily, "rebound");
  assert.equal(lane.signalLane, "extreme-reversal");
  assert.equal(lane.lowerTfGate, true);
  assert.equal(lane.lowerTfMode, "depth-override");
});

test("daily extreme reversal rejects loose upper wicks", () => {
  const lane = evaluateDailySignalLanes({
    panicPassed: true,
    oversoldCount: 3,
    rangeReentry: false,
    recoveryRatio: 0.85,
    wickBodyRatio: 0.25,
    upperWickBodyRatio: 0.22,
    flushSignalBase: false,
    volumeRatio20: 2.6,
    breakdownDepth20: 0.1,
    primaryLowerTfPassed: false,
    primaryLowerTfBreakdownDepth20: 0.09,
    return3: -0.18,
    return5: -0.23,
    rsi14: 28,
  });

  assert.equal(lane.reboundSignal, false);
  assert.equal(lane.signalFamily, null);
  assert.equal(lane.lowerTfGate, false);
});

test("daily alt capitulation rejects low-volume candidates", () => {
  const lane = evaluateDailySignalLanes({
    panicPassed: false,
    oversoldCount: 3,
    rangeReentry: true,
    recoveryRatio: 0.36,
    wickBodyRatio: 1.33,
    upperWickBodyRatio: 1.33,
    flushSignalBase: false,
    volumeRatio20: 3.9,
    breakdownDepth20: 0.13,
    primaryLowerTfPassed: true,
    primaryLowerTfBreakdownDepth20: 0.09,
    return3: -0.14,
    return5: -0.16,
    rsi14: 34.5,
  });

  assert.equal(lane.capitulationSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("daily alt capitulation still requires the primary lower timeframe pass", () => {
  const lane = evaluateDailySignalLanes({
    panicPassed: false,
    oversoldCount: 3,
    rangeReentry: true,
    recoveryRatio: 0.36,
    wickBodyRatio: 1.33,
    upperWickBodyRatio: 1.33,
    flushSignalBase: false,
    volumeRatio20: 4.5,
    breakdownDepth20: 0.13,
    primaryLowerTfPassed: false,
    primaryLowerTfBreakdownDepth20: 0.09,
    return3: -0.14,
    return5: -0.16,
    rsi14: 34.5,
  });

  assert.equal(lane.capitulationSignal, false);
  assert.equal(lane.signalFamily, null);
  assert.equal(lane.lowerTfGate, false);
});

test("daily flush rejects candidates with only two oversold conditions", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 94,
      high: 95,
      low: 83,
      close: 84,
      volume: 2_400,
      quoteVolume: 201_600_000,
    },
  });
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "4h",
      passed: true,
      breakdownDepth20: 0.03,
    }),
    secondaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "1h",
      passed: false,
      breakdownDepth20: null,
    }),
  });

  const last = features[features.length - 1];
  assert.equal(last.flushSignal, false);
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("daily flush rejects low-volume panic closes", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 94,
      high: 95,
      low: 83,
      close: 84,
      volume: 1_600,
      quoteVolume: 134_400_000,
    },
  });
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "4h",
      passed: true,
      breakdownDepth20: 0.03,
    }),
    secondaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "1h",
      passed: false,
      breakdownDepth20: null,
    }),
  });

  const last = features[features.length - 1];
  assert.equal(last.oversoldCount, 3);
  assert.equal(last.flushSignal, false);
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("daily flush rejects candidates without enough parent breakdown depth", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 94,
      high: 95,
      low: 87.2,
      close: 88,
      volume: 2_400,
      quoteVolume: 211_200_000,
    },
  });
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "4h",
      passed: true,
      breakdownDepth20: 0.03,
    }),
    secondaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "1h",
      passed: false,
      breakdownDepth20: null,
    }),
  });

  const last = features[features.length - 1];
  assert.equal(last.breakdownDepth20 !== null && last.breakdownDepth20 < 0.02, true);
  assert.equal(last.flushSignal, false);
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("daily flush rejects candidates without enough primary breakdown depth", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 94,
      high: 95,
      low: 83,
      close: 84,
      volume: 2_400,
      quoteVolume: 201_600_000,
    },
  });
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "4h",
      passed: true,
      breakdownDepth20: 0.01,
    }),
    secondaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "1h",
      passed: false,
      breakdownDepth20: null,
    }),
  });

  const last = features[features.length - 1];
  assert.equal(last.flushSignal, false);
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("daily flush still passes strong panic closes after the tighter gate", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 94,
      high: 94.5,
      low: 86,
      close: 88,
      volume: 2_400,
      quoteVolume: 211_200_000,
    },
  });
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "4h",
      passed: true,
      breakdownDepth20: 0.03,
    }),
    secondaryLowerTfConfirmations: createLowerTfConfirmations({
      bars,
      interval: "1h",
      passed: false,
      breakdownDepth20: null,
    }),
  });

  const last = features[features.length - 1];
  assert.equal(last.oversoldCount, 3);
  assert.equal(last.flushSignal, true);
  assert.equal(last.signalFamily, "flush");
  assert.equal(last.panicBuySetup, true);
});

test("daily clean rebound rejects loose upper wick rebound bars", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 86,
      high: 100,
      low: 80,
      close: 92,
      volume: 2_000,
      quoteVolume: 184_000_000,
    },
  });
  const confirmations = bars.map(() => ({
    interval: "4h",
    required: true,
    passed: true,
    triggeredBreak: true,
    lastReentry: true,
    triggerTime: 1,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20: 0.02,
  }));
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: confirmations,
    secondaryLowerTfConfirmations: bars.map(() => ({
      interval: "1h",
      required: false,
      passed: false,
      triggeredBreak: false,
      lastReentry: false,
      triggerTime: null,
      priorRangeLow20: 85,
      lastChildClose: 92,
      breakdownDepth20: null,
    })),
  });

  const last = features[features.length - 1];
  assert.equal(last.panicPassed, true);
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("daily capitulation override creates a setup even without flush or rebound shape", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 98,
      high: 106,
      low: 84,
      close: 92,
      volume: 5_000,
      quoteVolume: 460_000_000,
    },
  });
  const primary = bars.map(() => ({
    interval: "4h",
    required: true,
    passed: true,
    triggeredBreak: true,
    lastReentry: true,
    triggerTime: 1,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20: 0.07,
  }));
  const secondary = bars.map(() => ({
    interval: "1h",
    required: false,
    passed: false,
    triggeredBreak: false,
    lastReentry: false,
    triggerTime: null,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20: null,
  }));
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: primary,
    secondaryLowerTfConfirmations: secondary,
  });

  const last = features[features.length - 1];
  assert.equal(last.flushSignal, false);
  assert.equal(last.reboundSignal, false);
  assert.equal(last.signalFamily, "capitulation");
  assert.equal(last.panicBuySetup, true);
});

test("daily capitulation override still requires the primary lower timeframe pass", () => {
  const bars = createDailyFeatureBars({
    lastBar: {
      open: 98,
      high: 106,
      low: 84,
      close: 92,
      volume: 5_000,
      quoteVolume: 460_000_000,
    },
  });
  const primary = bars.map(() => ({
    interval: "4h",
    required: true,
    passed: false,
    triggeredBreak: true,
    lastReentry: true,
    triggerTime: 1,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20: 0.07,
  }));
  const secondary = bars.map(() => ({
    interval: "1h",
    required: false,
    passed: false,
    triggeredBreak: false,
    lastReentry: false,
    triggerTime: null,
    priorRangeLow20: 85,
    lastChildClose: 92,
    breakdownDepth20: null,
  }));
  const features = calculateCryptoFeatures({
    bars,
    parentTimeframe: "1d",
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations: primary,
    secondaryLowerTfConfirmations: secondary,
  });

  const last = features[features.length - 1];
  assert.equal(last.signalFamily, null);
  assert.equal(last.panicBuySetup, false);
});

test("sell clean rejection rejects bars without a range reject", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: true,
    overboughtCount: 3,
    return5: 0.12,
    rangeReject: false,
    rejectionRatio: 0.62,
    recoveryRatio: 0.38,
    wickBodyRatio: 0.2,
    upperWickBodyRatio: 1.1,
    volumeRatio20: 2.6,
    breakoutDepth20: 0.06,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.09,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: true,
  });

  assert.equal(lane.rejectionSignal, false);
  assert.equal(lane.upthrustSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell rejection confirm passes without panic-up when recent sell context exists", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 1,
    return5: 0.05,
    rangeReject: true,
    rejectionRatio: 0.48,
    recoveryRatio: 0.52,
    wickBodyRatio: 1.8,
    upperWickBodyRatio: 2.4,
    volumeRatio20: 1.1,
    breakoutDepth20: 0.004,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: false,
  });

  assert.equal(lane.rejectionSignal, true);
  assert.equal(lane.signalFamily, "rejection");
  assert.equal(lane.signalLane, "rejection-confirm");
});

test("sell rejection confirm rejects when the primary lower timeframe does not pass", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 1,
    return5: 0.05,
    rangeReject: true,
    rejectionRatio: 0.48,
    recoveryRatio: 0.52,
    wickBodyRatio: 1.8,
    upperWickBodyRatio: 2.4,
    volumeRatio20: 1.1,
    breakoutDepth20: 0.004,
    primaryLowerTfPassed: false,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: false,
  });

  assert.equal(lane.rejectionSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell upthrust reversal allows a primary lower timeframe depth override", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: true,
    overboughtCount: 3,
    return5: 0.12,
    rangeReject: true,
    rejectionRatio: 0.52,
    recoveryRatio: 0.48,
    wickBodyRatio: 0.25,
    upperWickBodyRatio: 1.4,
    volumeRatio20: 2.4,
    breakoutDepth20: 0.07,
    primaryLowerTfPassed: false,
    primaryLowerTfExcursionDepth20: 0.09,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: true,
  });

  assert.equal(lane.upthrustSignal, true);
  assert.equal(lane.signalFamily, "upthrust");
  assert.equal(lane.signalLane, "upthrust-reversal");
  assert.equal(lane.lowerTfMode, "depth-override");
  assert.equal(lane.lowerTfGate, true);
});

test("sell blowoff capitulation rejects low-volume breakouts", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: true,
    overboughtCount: 3,
    return5: 0.12,
    rangeReject: false,
    rejectionRatio: 0.58,
    recoveryRatio: 0.42,
    wickBodyRatio: 0.2,
    upperWickBodyRatio: 0.5,
    volumeRatio20: 3.4,
    breakoutDepth20: 0.09,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.09,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: true,
  });

  assert.equal(lane.blowoffSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell rejection confirm allows extreme rejection doji bars with strong prior breakout", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 1,
    return5: 0.17,
    rangeReject: true,
    rejectionRatio: 0.74,
    recoveryRatio: 0.26,
    wickBodyRatio: 12,
    upperWickBodyRatio: 25,
    volumeRatio20: 1.2,
    breakoutDepth20: 0.01,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: false,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: true,
  });

  assert.equal(lane.rejectionSignal, true);
  assert.equal(lane.signalLane, "rejection-confirm");
});

test("sell rejection confirm rejects when only recent return context exists", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 1,
    return5: 0.12,
    rangeReject: true,
    rejectionRatio: 0.52,
    recoveryRatio: 0.48,
    wickBodyRatio: 1.4,
    upperWickBodyRatio: 2.2,
    volumeRatio20: 1.1,
    breakoutDepth20: 0.002,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: false,
    recentBreakoutSeenWithin2: false,
    previousBreakoutHold: false,
    previousStrongBreakoutSeenWithin2: false,
    currentBreakoutConfirm: false,
    currentStrongBreakout: false,
  });

  assert.equal(lane.rejectionSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell rejection confirm rejects without previous breakout context", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 2,
    return5: 0.05,
    rangeReject: true,
    rejectionRatio: 0.52,
    recoveryRatio: 0.48,
    wickBodyRatio: 1.4,
    upperWickBodyRatio: 2.2,
    volumeRatio20: 1.1,
    breakoutDepth20: 0.009,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: false,
    previousBreakoutHold: false,
    previousStrongBreakoutSeenWithin2: false,
    currentBreakoutConfirm: false,
    currentStrongBreakout: false,
  });

  assert.equal(lane.rejectionSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell rejection confirm rejects high-volume euphoric failures", () => {
  const lane = evaluateSellSignalLanes({
    panicUpPassed: false,
    overboughtCount: 2,
    return5: 0.05,
    rangeReject: true,
    rejectionRatio: 0.5,
    recoveryRatio: 0.5,
    wickBodyRatio: 1.2,
    upperWickBodyRatio: 2.0,
    volumeRatio20: 1.9,
    breakoutDepth20: 0.005,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: false,
  });

  assert.equal(lane.rejectionSignal, false);
  assert.equal(lane.signalFamily, null);
});

test("sell warning levels build progressively as exhaustion pressure rises", () => {
  const level1 = evaluateSellWarning({
    side: "sell",
    liquidityPassed: true,
    overboughtCount: 1,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: false,
    currentBreakoutConfirm: false,
    currentStrongBreakout: false,
    breakoutDepth20: 0.004,
    upperWickBodyRatio: 1.5,
    rejectionRatio: 0.52,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.01,
  });
  const level2 = evaluateSellWarning({
    side: "sell",
    liquidityPassed: true,
    overboughtCount: 2,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: false,
    currentBreakoutConfirm: false,
    currentStrongBreakout: false,
    breakoutDepth20: 0.013,
    upperWickBodyRatio: 1.5,
    rejectionRatio: 0.6,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.03,
  });
  const level3 = evaluateSellWarning({
    side: "sell",
    liquidityPassed: true,
    overboughtCount: 3,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: true,
    currentBreakoutConfirm: true,
    currentStrongBreakout: true,
    breakoutDepth20: 0.014,
    upperWickBodyRatio: 2.1,
    rejectionRatio: 0.7,
    primaryLowerTfPassed: true,
    primaryLowerTfExcursionDepth20: 0.06,
  });

  assert.equal(level1.level, 1);
  assert.ok(level1.reasons.includes("prior-breakout-pressure"));
  assert.equal(level2.level, 2);
  assert.ok(level2.reasons.includes("lower-tf-pass"));
  assert.equal(level3.level, 3);
  assert.ok(level3.reasons.includes("strong-breakout"));
});

test("sell warning stays off for mild overbought bars without rejection pressure", () => {
  const warning = evaluateSellWarning({
    side: "sell",
    liquidityPassed: true,
    overboughtCount: 1,
    recentOverboughtWithin2: true,
    recentBreakoutSeenWithin2: true,
    previousBreakoutHold: true,
    previousStrongBreakoutSeenWithin2: false,
    currentBreakoutConfirm: true,
    currentStrongBreakout: false,
    breakoutDepth20: 0.004,
    upperWickBodyRatio: 0.3,
    rejectionRatio: 0.2,
    primaryLowerTfPassed: false,
    primaryLowerTfExcursionDepth20: 0.01,
  });

  assert.equal(warning.level, 0);
});

test("sell warnings do not create entry signals without setup activation", () => {
  const rows = [
    createRow(0, {
      side: "sell",
      signalFamily: null,
      signalLane: null,
      rejectionSignal: false,
      upthrustSignal: false,
      blowoffSignal: false,
      setupActive: false,
      panicBuySetup: false,
      sellWarningLevel: 3,
      sellWarningReasons: ["overbought-pressure", "breakout-pressure"],
    }),
    createRow(1, {
      side: "sell",
      signalFamily: null,
      signalLane: null,
      rejectionSignal: false,
      upthrustSignal: false,
      blowoffSignal: false,
      setupActive: false,
      panicBuySetup: false,
      sellWarningLevel: 2,
      sellWarningReasons: ["overbought-pressure"],
    }),
    createRow(2, {
      side: "sell",
      signalFamily: null,
      signalLane: null,
      rejectionSignal: false,
      upthrustSignal: false,
      blowoffSignal: false,
      setupActive: false,
      panicBuySetup: false,
      sellWarningLevel: 1,
      sellWarningReasons: ["breakout-pressure"],
    }),
  ];

  const { signalsByMode } = generateCryptoSignals({
    symbol: "BTCUSDT",
    side: "sell",
    featureRows: rows,
  });

  assert.equal(signalsByMode.A.length, 0);
  assert.equal(signalsByMode.B.length, 0);
});

test("sell warning events emit only when warning level rises", () => {
  const events = buildSellWarningEvents([
    createRow(0, { side: "sell", sellWarningLevel: 0 }),
    createRow(1, { side: "sell", sellWarningLevel: 2, sellWarningReasons: ["warning-a"] }),
    createRow(2, { side: "sell", sellWarningLevel: 2, sellWarningReasons: ["warning-b"] }),
    createRow(3, { side: "sell", sellWarningLevel: 1, sellWarningReasons: ["warning-c"] }),
    createRow(4, { side: "sell", sellWarningLevel: 3, sellWarningReasons: ["warning-d"] }),
  ]);

  assert.deepEqual(
    events.map((event) => ({ time: event.time, level: event.level })),
    [
      { time: createRow(1).bar.time, level: 2 },
      { time: createRow(4).bar.time, level: 3 },
    ],
  );
});

test("short backtest keeps stop priority when stop and target are both touched", () => {
  const bars = [
    createBar(0, { open: 100, high: 100, low: 100, close: 100 }),
    createBar(1, { open: 100, high: 106, low: 94, close: 96 }),
  ];
  const signal = {
    symbol: "BTCUSDT",
    side: "sell",
    direction: "short",
    timeframe: "1d",
    mode: "A",
    signalFamily: "upthrust",
    signalLane: "upthrust-reversal",
    signalIndex: 0,
    signalTime: bars[0].closeTime,
    entryIndex: 1,
    entryTime: bars[1].openTime,
    score: 12,
    reasons: ["test"],
    stopLevel: 105,
    signalLow: 95,
    signalHigh: 105,
    atr14: 2,
    confirmPassed: true,
    htfPassed: false,
  };

  const result = runCryptoBacktest({
    symbol: "BTCUSDT",
    side: "sell",
    timeframe: "1d",
    mode: "A",
    bars,
    signals: [signal],
    cost: COST_CONFIGS.zero,
    config: DEFAULT_BACKTEST_CONFIG,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].direction, "short");
  assert.equal(result.trades[0].exitReason, "stop");
});

test("short backtest moves stop to break-even after tp1", () => {
  const bars = [
    createBar(0, { open: 100, high: 100, low: 100, close: 100 }),
    createBar(1, { open: 100, high: 100, low: 95, close: 96 }),
    createBar(2, { open: 96, high: 100, low: 96, close: 99 }),
  ];
  const signal = {
    symbol: "BTCUSDT",
    side: "sell",
    direction: "short",
    timeframe: "1d",
    mode: "A",
    signalFamily: "rejection",
    signalLane: "clean-rejection",
    signalIndex: 0,
    signalTime: bars[0].closeTime,
    entryIndex: 1,
    entryTime: bars[1].openTime,
    score: 12,
    reasons: ["test"],
    stopLevel: 105,
    signalLow: 95,
    signalHigh: 105,
    atr14: 2,
    confirmPassed: true,
    htfPassed: false,
  };

  const result = runCryptoBacktest({
    symbol: "BTCUSDT",
    side: "sell",
    timeframe: "1d",
    mode: "A",
    bars,
    signals: [signal],
    cost: COST_CONFIGS.zero,
    config: DEFAULT_BACKTEST_CONFIG,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].tp1Hit, true);
  assert.equal(result.trades[0].exitReason, "breakeven_stop");
});
