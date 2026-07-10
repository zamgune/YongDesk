import {
  ADX,
  ATR,
  BollingerBands,
  CCI,
  EMA,
  MACD,
  MFI,
  OBV,
  PSAR,
  RSI,
  SMA,
  WMA,
  Stochastic,
  WilliamsR,
} from "technicalindicators";
import { getMarketDataProvider, type MarketCandle, type MarketDataInterval } from "@/lib/market-data";
import { calculateBreakoutRule } from "@/lib/market/breakout-rule";
import { calculatePatternSignals } from "@/lib/market/pattern-signals";
import { calculateSignalReliability } from "@/lib/market/signal-reliability";
import { buildTradeSetup } from "@/lib/market/trade-setup";
import { calculateTrendFollowingSignals } from "@/lib/market/trend-following";
import { GENERAL_ANALYSIS_MAX_DAYS, parseBoundedDays } from "@/lib/security/request-bounds";
import type { UserContext } from "@/domain/user";

type Candle = MarketCandle;

type MarketSignal = {
  time: number;
  type: "buy" | "sell";
  label: string;
  reason: string;
  stopLevel?: number;
};

const DAILY_TRIGGER_REASON_PREFIX = "Oversold setup +";

const DEFAULT_DAYS = 365;

const toUnix = (value: Date) => Math.floor(value.getTime() / 1000);

const getWarmupDays = (timeframe: string) => {
  switch (timeframe) {
    case "1h":
      return 21;
    case "4h":
      return 90;
    case "1wk":
      return 365 * 3;
    case "1d":
    default:
      return 365;
  }
};

const alignSeries = (candles: Candle[], values: number[]) => {
  const offset = Math.max(candles.length - values.length, 0);
  return values.map((value, index) => ({
    time: candles[index + offset].time,
    value,
  }));
};

const resampleCandles = (
  candles: Candle[],
  groupSize: number,
  timeZone: string,
) => {
  if (groupSize <= 1) {
    return candles;
  }
  const resampled: Candle[] = [];
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let bucket: Candle[] = [];
  let currentDay = "";

  const flushBucket = () => {
    if (!bucket.length) {
      return;
    }
    const open = bucket[0].open;
    const close = bucket[bucket.length - 1].close;
    const high = Math.max(...bucket.map((candle) => candle.high));
    const low = Math.min(...bucket.map((candle) => candle.low));
    const volume = bucket.reduce((sum, candle) => sum + candle.volume, 0);
    resampled.push({
      time: bucket[0].time,
      open,
      high,
      low,
      close,
      volume,
    });
    bucket = [];
  };

  for (const candle of candles) {
    const dayKey = formatter.format(new Date(candle.time * 1000));
    if (currentDay && dayKey !== currentDay) {
      flushBucket();
    }
    currentDay = dayKey;
    bucket.push(candle);
    if (bucket.length === groupSize) {
      flushBucket();
    }
  }
  flushBucket();

  return resampled;
};

const alignValues = <T>(length: number, values: T[]) => {
  const offset = Math.max(length - values.length, 0);
  return Array.from({ length }, (_, index) =>
    index < offset ? null : values[index - offset],
  );
};

const filterTimedSeries = <T extends { time: number }>(
  values: T[],
  minTime: number,
) => values.filter((value) => value.time >= minTime);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const calculateRollingMedian = (
  values: Array<number | null>,
  period: number,
) => {
  const result = new Array<number | null>(values.length).fill(null);

  for (let i = period - 1; i < values.length; i += 1) {
    const window = values.slice(i - period + 1, i + 1);
    if (!window.every((value) => isNumber(value))) {
      continue;
    }
    result[i] = median(window as number[]);
  }

  return result;
};

const isCryptoSymbol = (symbol: string) =>
  /-(USD|USDT|USDC)$/i.test(symbol);

// V2.2: Candlestick Pattern Detection Functions
type CandlePatterns = {
  isHammer: boolean;
  isInvertedHammer: boolean;
  isShootingStar: boolean;
  isDoji: boolean;
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
  isMorningStar: boolean;
  isEveningStar: boolean;
  isBullish: boolean;
  isBearish: boolean;
  hasLongUpperWick: boolean;
  hasLongLowerWick: boolean;
};

const detectCandlePatterns = (
  candles: Candle[],
  index: number,
): CandlePatterns => {
  const result: CandlePatterns = {
    isHammer: false,
    isInvertedHammer: false,
    isShootingStar: false,
    isDoji: false,
    isBullishEngulfing: false,
    isBearishEngulfing: false,
    isMorningStar: false,
    isEveningStar: false,
    isBullish: false,
    isBearish: false,
    hasLongUpperWick: false,
    hasLongLowerWick: false,
  };

  const candle = candles[index];
  if (!candle) return result;

  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  result.isBullish = candle.close > candle.open;
  result.isBearish = candle.close < candle.open;

  // Doji: Very small body relative to range
  if (range > 0 && body / range < 0.1) {
    result.isDoji = true;
  }

  // Long wick detection (>60% of range)
  if (range > 0) {
    result.hasLongUpperWick = upperWick / range > 0.6;
    result.hasLongLowerWick = lowerWick / range > 0.6;
  }

  // Hammer: Small body at top, long lower wick (>2x body)
  if (range > 0 && body / range < 0.35 && lowerWick > body * 2 && upperWick < body) {
    result.isHammer = true;
  }

  // Inverted Hammer: Small body at bottom, long upper wick
  if (range > 0 && body / range < 0.35 && upperWick > body * 2 && lowerWick < body) {
    result.isInvertedHammer = true;
  }

  // Shooting Star: Small body at bottom, long upper wick (bearish context)
  if (range > 0 && body / range < 0.35 && upperWick > body * 2 && lowerWick < body && result.isBearish) {
    result.isShootingStar = true;
  }

  // Engulfing patterns require previous candle
  if (index > 0) {
    const prev = candles[index - 1];
    const prevBody = Math.abs(prev.close - prev.open);
    const prevBullish = prev.close > prev.open;

    // Bullish Engulfing: Current green engulfs previous red
    if (result.isBullish && !prevBullish && body > prevBody * 0.8 &&
      candle.close > prev.open && candle.open < prev.close) {
      result.isBullishEngulfing = true;
    }

    // Bearish Engulfing: Current red engulfs previous green
    if (result.isBearish && prevBullish && body > prevBody * 0.8 &&
      candle.open > prev.close && candle.close < prev.open) {
      result.isBearishEngulfing = true;
    }
  }

  // Morning/Evening Star require 3 candles
  if (index >= 2) {
    const prev1 = candles[index - 1]; // Middle candle (small)
    const prev2 = candles[index - 2]; // First candle
    const prev1Body = Math.abs(prev1.close - prev1.open);
    const prev2Body = Math.abs(prev2.close - prev2.open);
    const prev1Range = prev1.high - prev1.low;
    const prev2Bullish = prev2.close > prev2.open;
    const isSmallMiddle = prev1Range > 0 && prev1Body / prev1Range < 0.3;

    // Morning Star: Big Red -> Small -> Big Green
    if (!prev2Bullish && isSmallMiddle && result.isBullish &&
      prev2Body > body * 0.5 && body > prev1Body * 1.5) {
      result.isMorningStar = true;
    }

    // Evening Star: Big Green -> Small -> Big Red
    if (prev2Bullish && isSmallMiddle && result.isBearish &&
      prev2Body > body * 0.5 && body > prev1Body * 1.5) {
      result.isEveningStar = true;
    }
  }

  return result;
};

const getMinWickPct = (timeframe: string) => {
  if (timeframe === "1h") {
    return 0.12;
  }
  if (timeframe === "4h") {
    return 0.18;
  }
  if (timeframe === "1wk") {
    return 0.25;
  }
  return 0.25;
};

const getLookbackLevel = (
  candles: Candle[],
  endExclusive: number,
  lookback: number,
  mode: "low" | "high",
) => {
  const start = Math.max(0, endExclusive - lookback);
  if (start >= endExclusive) {
    return null;
  }
  let chosenIndex = start;
  let chosenValue =
    mode === "low" ? candles[start].low : candles[start].high;

  for (let i = start + 1; i < endExclusive; i += 1) {
    const candidate = mode === "low" ? candles[i].low : candles[i].high;
    const isBetter =
      mode === "low" ? candidate < chosenValue : candidate > chosenValue;
    if (isBetter) {
      chosenValue = candidate;
      chosenIndex = i;
    }
  }

  return { index: chosenIndex, value: chosenValue };
};

const getLocalBottomIndices = (candles: Candle[], lookaroundBars = 3) => {
  const localBottomIndices: number[] = [];
  for (
    let i = lookaroundBars;
    i < candles.length - lookaroundBars;
    i += 1
  ) {
    const currentLow = candles[i].low;
    let isLocalBottom = true;

    for (let j = i - lookaroundBars; j <= i + lookaroundBars; j += 1) {
      if (j === i) {
        continue;
      }
      const compareLow = candles[j].low;
      if (compareLow < currentLow) {
        isLocalBottom = false;
        break;
      }
      if (compareLow === currentLow && j < i) {
        isLocalBottom = false;
        break;
      }
    }

    if (isLocalBottom) {
      localBottomIndices.push(i);
    }
  }

  return localBottomIndices;
};

const calculateBottomCapture = (
  candles: Candle[],
  emittedBuyMask: boolean[],
  lookaroundBars = 3,
) => {
  const localBottomIndices = getLocalBottomIndices(candles, lookaroundBars);
  const totalBars = candles.length;

  let bottomHit0 = 0;
  let bottomHitLe3 = 0;
  let bottomHitLe5 = 0;

  for (const bottomIndex of localBottomIndices) {
    if (emittedBuyMask[bottomIndex]) {
      bottomHit0 += 1;
    }

    let hitWithin3 = false;
    let hitWithin5 = false;
    const lastIndex = Math.min(totalBars - 1, bottomIndex + 5);
    for (let i = bottomIndex; i <= lastIndex; i += 1) {
      if (!emittedBuyMask[i]) {
        continue;
      }
      hitWithin5 = true;
      if (i <= bottomIndex + 3) {
        hitWithin3 = true;
      }
      break;
    }

    if (hitWithin3) {
      bottomHitLe3 += 1;
    }
    if (hitWithin5) {
      bottomHitLe5 += 1;
    }
  }

  const totalBottoms = localBottomIndices.length;
  const safeDiv = (value: number) => (totalBottoms > 0 ? value / totalBottoms : 0);

  return {
    lookaroundBars,
    totalBottoms,
    bottomHit0,
    bottomHitLe3,
    bottomHitLe5,
    "bottomHit@0": bottomHit0,
    "bottomHit<=3": bottomHitLe3,
    "bottomHit<=5": bottomHitLe5,
    hitRate0: safeDiv(bottomHit0),
    hitRateLe3: safeDiv(bottomHitLe3),
    hitRateLe5: safeDiv(bottomHitLe5),
  };
};

const buildCoverageStats = (count: number, hit: number) => ({
  count,
  hit,
  miss: count - hit,
  hitRate: count > 0 ? hit / count : 0,
});

const getIndexedBuySignals = (
  candles: Candle[],
  signals: MarketSignal[],
  predicate?: (signal: MarketSignal) => boolean,
) => {
  const timeToIndex = new Map(candles.map((candle, index) => [candle.time, index]));

  return signals
    .filter(
      (signal) =>
        signal.type === "buy" && (predicate ? predicate(signal) : true),
    )
    .map((signal) => {
      const index = timeToIndex.get(signal.time);
      if (typeof index !== "number") {
        return null;
      }
      return { index, signal };
    })
    .filter((value): value is { index: number; signal: MarketSignal } => value !== null);
};

const summarizeBuyOutcomes = (
  candles: Candle[],
  indexedBuySignals: Array<{ index: number; signal: MarketSignal }>,
  lookaheadBars = 10,
) => {
  const totalBars = candles.length;
  const outcomes = indexedBuySignals.map(({ index, signal }) => {
    const entry = candles[index].close;
    const end = Math.min(totalBars - 1, index + lookaheadBars);
    let maxHigh = entry;
    let minLow = entry;
    for (let i = index + 1; i <= end; i += 1) {
      maxHigh = Math.max(maxHigh, candles[i].high);
      minLow = Math.min(minLow, candles[i].low);
    }
    const maxGain = maxHigh / entry - 1;
    const maxDrawdown = minLow / entry - 1;
    const failed = maxDrawdown <= -0.06 && maxGain < 0.06;
    return {
      time: signal.time,
      reason: signal.reason,
      maxGain,
      maxDrawdown,
      failed,
    };
  });

  const failedOutcomes = outcomes.filter((candidate) => candidate.failed);
  const avgMaxGain =
    outcomes.length > 0
      ? outcomes.reduce((sum, candidate) => sum + candidate.maxGain, 0) /
        outcomes.length
      : 0;
  const avgMaxDrawdown =
    outcomes.length > 0
      ? outcomes.reduce((sum, candidate) => sum + candidate.maxDrawdown, 0) /
        outcomes.length
      : 0;

  return {
    count: outcomes.length,
    fail: failedOutcomes.length,
    failRate: outcomes.length > 0 ? failedOutcomes.length / outcomes.length : 0,
    avgMaxGain,
    avgMaxDrawdown,
    failedOutcomes,
  };
};

const calculateDailyQuality = (
  candles: Candle[],
  signals: MarketSignal[],
  lookaroundBars = 3,
) => {
  const localBottomIndices = getLocalBottomIndices(candles, lookaroundBars);
  const totalBars = candles.length;
  const buySignals = getIndexedBuySignals(candles, signals);
  const emittedBuyMask = new Array<boolean>(totalBars).fill(false);
  for (const buySignal of buySignals) {
    emittedBuyMask[buySignal.index] = true;
  }

  const buildBottomLegStats = (upThreshold: number) => {
    let count = 0;
    let hitLe5 = 0;

    for (const bottomIndex of localBottomIndices) {
      const end = Math.min(totalBars - 1, bottomIndex + 30);
      if (end <= bottomIndex + 1) {
        continue;
      }
      const entry = candles[bottomIndex].close;
      let maxHigh = -Infinity;
      let maxHighIndex = bottomIndex + 1;
      for (let i = bottomIndex + 1; i <= end; i += 1) {
        if (candles[i].high > maxHigh) {
          maxHigh = candles[i].high;
          maxHighIndex = i;
        }
      }
      if (!Number.isFinite(maxHigh)) {
        continue;
      }
      let minBeforeTop = Number.POSITIVE_INFINITY;
      for (let i = bottomIndex + 1; i <= maxHighIndex; i += 1) {
        minBeforeTop = Math.min(minBeforeTop, candles[i].low);
      }
      const upGain = maxHigh / entry - 1;
      const drawdownBeforeTop = minBeforeTop / entry - 1;
      const qualifies = upGain >= upThreshold && drawdownBeforeTop > -0.08;
      if (!qualifies) {
        continue;
      }

      count += 1;
      const hitEnd = Math.min(totalBars - 1, bottomIndex + 5);
      for (let i = bottomIndex; i <= hitEnd; i += 1) {
        if (emittedBuyMask[i]) {
      hitLe5 += 1;
          break;
        }
      }
    }

    return {
      count,
      hitLe5,
      miss: count - hitLe5,
      hitRate: count > 0 ? hitLe5 / count : 0,
    };
  };

  const buyOutcomeSummary = summarizeBuyOutcomes(candles, buySignals, 10);

  return {
    bottomLeg10: buildBottomLegStats(0.1),
    bottomLeg15: buildBottomLegStats(0.15),
    bottomLeg20: buildBottomLegStats(0.2),
    buyFailure10: {
      count: buyOutcomeSummary.count,
      fail: buyOutcomeSummary.fail,
      failRate: buyOutcomeSummary.failRate,
      avgMaxGain: buyOutcomeSummary.avgMaxGain,
      avgMaxDrawdown: buyOutcomeSummary.avgMaxDrawdown,
    },
    recentFailedBuys: buyOutcomeSummary.failedOutcomes.slice(-5).map((failedBuy) => ({
      date: new Date(failedBuy.time * 1000).toISOString().slice(0, 10),
      maxDrawdown: failedBuy.maxDrawdown,
      maxGain: failedBuy.maxGain,
      reason: failedBuy.reason,
    })),
  };
};

const calculateDailyBottomStudy = (
  candles: Candle[],
  signals: MarketSignal[],
  setupDetectedMask: boolean[],
  emittedBuyMask: boolean[],
  lookaroundBars = 3,
) => {
  const localBottomIndices = getLocalBottomIndices(candles, lookaroundBars);
  let setupHit = 0;
  let triggerHitLe3 = 0;

  for (const bottomIndex of localBottomIndices) {
    if (setupDetectedMask[bottomIndex]) {
      setupHit += 1;
    }

    const hitEnd = Math.min(candles.length - 1, bottomIndex + 3);
    for (let i = bottomIndex; i <= hitEnd; i += 1) {
      if (emittedBuyMask[i]) {
        triggerHitLe3 += 1;
        break;
      }
    }
  }

  const triggerSignals = getIndexedBuySignals(
    candles,
    signals,
    (signal) => signal.reason.startsWith(DAILY_TRIGGER_REASON_PREFIX),
  );
  const triggerOutcomeSummary = summarizeBuyOutcomes(candles, triggerSignals, 10);

  return {
    setupCoverage: buildCoverageStats(localBottomIndices.length, setupHit),
    "triggerCoverage<=3": buildCoverageStats(localBottomIndices.length, triggerHitLe3),
    failedTriggerBuys: {
      count: triggerOutcomeSummary.count,
      fail: triggerOutcomeSummary.fail,
      failRate: triggerOutcomeSummary.failRate,
      avgMaxGain: triggerOutcomeSummary.avgMaxGain,
      avgMaxDrawdown: triggerOutcomeSummary.avgMaxDrawdown,
    },
  };
};


const calculateChoppiness = (
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
) => {
  if (highs.length < period) {
    return [];
  }
  const result: number[] = [];
  const logBase = Math.log10(period);

  for (let i = period - 1; i < highs.length; i += 1) {
    const sliceHigh = highs.slice(i - period + 1, i + 1);
    const sliceLow = lows.slice(i - period + 1, i + 1);
    const windowHigh = Math.max(...sliceHigh);
    const windowLow = Math.min(...sliceLow);
    const range = windowHigh - windowLow;
    if (range === 0) {
      result.push(Number.NaN);
      continue;
    }
    let trSum = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (j === 0) {
        trSum += highs[j] - lows[j];
      } else {
        const tr = Math.max(
          highs[j] - lows[j],
          Math.abs(highs[j] - closes[j - 1]),
          Math.abs(lows[j] - closes[j - 1]),
        );
        trSum += tr;
      }
    }
    const ci = (100 * Math.log10(trSum / range)) / logBase;
    result.push(ci);
  }

  return result;
};

const calculateChandelierSeries = (
  candles: Candle[],
  atrValues: Array<number | null>,
  period = 22,
  multiplier = 3,
) => {
  const longSeries: Array<{ time: number; value: number }> = [];
  const shortSeries: Array<{ time: number; value: number }> = [];

  for (let i = 0; i < candles.length; i += 1) {
    if (i < period - 1) {
      continue;
    }
    const atrValue = atrValues[i];
    if (!isNumber(atrValue)) {
      continue;
    }
    const window = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((candle) => candle.high));
    const lowest = Math.min(...window.map((candle) => candle.low));
    longSeries.push({
      time: candles[i].time,
      value: highest - atrValue * multiplier,
    });
    shortSeries.push({
      time: candles[i].time,
      value: lowest + atrValue * multiplier,
    });
  }

  return { long: longSeries, short: shortSeries };
};

const calculateHma = (values: number[], period: number) => {
  if (values.length < period || period < 2) {
    return [];
  }
  const halfPeriod = Math.max(1, Math.floor(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = WMA.calculate({ period: halfPeriod, values });
  const wmaFull = WMA.calculate({ period, values });
  const wmaHalfAligned = alignValues(values.length, wmaHalf);
  const wmaFullAligned = alignValues(values.length, wmaFull);
  const diffSeries = wmaHalfAligned
    .map((half, index) => {
      const full = wmaFullAligned[index];
      if (!isNumber(half) || !isNumber(full)) {
        return null;
      }
      return 2 * half - full;
    })
    .filter(isNumber);
  return WMA.calculate({ period: sqrtPeriod, values: diffSeries });
};

const getRsiThresholds = (atrValue: number | null, close: number) => {
  if (!isNumber(atrValue) || close === 0) {
    return { oversold: 32, deep: 20, overbought: 70, extreme: 80 };
  }
  const atrPct = (atrValue / close) * 100;
  return {
    oversold: clamp(20, 35, 32 - atrPct * 0.4),
    deep: clamp(15, 25, 20 - atrPct * 0.3),
    overbought: clamp(65, 80, 70 + atrPct * 0.4),
    extreme: clamp(75, 90, 80 + atrPct * 0.4),
  };
};

const getDivergenceMasks = (
  candles: Candle[],
  rsiValues: Array<number | null>,
  window = 5,
) => {
  const length = candles.length;
  const isLow = new Array<boolean>(length).fill(false);
  const isHigh = new Array<boolean>(length).fill(false);

  for (let i = window; i < length - window; i += 1) {
    const lowSlice = candles
      .slice(i - window, i + window + 1)
      .map((candle) => candle.low);
    const highSlice = candles
      .slice(i - window, i + window + 1)
      .map((candle) => candle.high);
    const lowMin = Math.min(...lowSlice);
    const highMax = Math.max(...highSlice);

    if (candles[i].low === lowMin) {
      isLow[i] = true;
    }
    if (candles[i].high === highMax) {
      isHigh[i] = true;
    }
  }

  const lowIndices = isLow
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  const highIndices = isHigh
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);

  const bullMask = new Array<boolean>(length).fill(false);
  const bearMask = new Array<boolean>(length).fill(false);

  for (let i = 1; i < lowIndices.length; i += 1) {
    const curr = lowIndices[i];
    const prev = lowIndices[i - 1];
    const currRsi = rsiValues[curr];
    const prevRsi = rsiValues[prev];
    if (
      isNumber(currRsi) &&
      isNumber(prevRsi) &&
      candles[curr].low <= candles[prev].low &&
      currRsi > prevRsi &&
      currRsi < 40
    ) {
      bullMask[curr] = true;
    }
  }

  for (let i = 1; i < highIndices.length; i += 1) {
    const curr = highIndices[i];
    const prev = highIndices[i - 1];
    const currRsi = rsiValues[curr];
    const prevRsi = rsiValues[prev];
    if (
      isNumber(currRsi) &&
      isNumber(prevRsi) &&
      candles[curr].high >= candles[prev].high &&
      currRsi < prevRsi &&
      currRsi > 60
    ) {
      bearMask[curr] = true;
    }
  }

  return { bullMask, bearMask };
};

const getObvDivergenceMasks = (
  candles: Candle[],
  obvValues: Array<number | null>,
  window = 5,
) => {
  const length = candles.length;
  const isLow = new Array<boolean>(length).fill(false);
  const isHigh = new Array<boolean>(length).fill(false);

  for (let i = window; i < length - window; i += 1) {
    const lowSlice = candles
      .slice(i - window, i + window + 1)
      .map((candle) => candle.low);
    const highSlice = candles
      .slice(i - window, i + window + 1)
      .map((candle) => candle.high);
    const lowMin = Math.min(...lowSlice);
    const highMax = Math.max(...highSlice);

    if (candles[i].low === lowMin) {
      isLow[i] = true;
    }
    if (candles[i].high === highMax) {
      isHigh[i] = true;
    }
  }

  const lowIndices = isLow
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  const highIndices = isHigh
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);

  const bullMask = new Array<boolean>(length).fill(false);
  const bearMask = new Array<boolean>(length).fill(false);

  for (let i = 1; i < lowIndices.length; i += 1) {
    const curr = lowIndices[i];
    const prev = lowIndices[i - 1];
    const currObv = obvValues[curr];
    const prevObv = obvValues[prev];
    if (
      isNumber(currObv) &&
      isNumber(prevObv) &&
      candles[curr].low <= candles[prev].low &&
      currObv > prevObv
    ) {
      bullMask[curr] = true;
    }
  }

  for (let i = 1; i < highIndices.length; i += 1) {
    const curr = highIndices[i];
    const prev = highIndices[i - 1];
    const currObv = obvValues[curr];
    const prevObv = obvValues[prev];
    if (
      isNumber(currObv) &&
      isNumber(prevObv) &&
      candles[curr].high >= candles[prev].high &&
      currObv < prevObv
    ) {
      bearMask[curr] = true;
    }
  }

  return { bullMask, bearMask };
};

const getRsiDoubleBottom = (rsiValues: Array<number | null>, lookback = 20) => {
  const length = rsiValues.length;
  const mask = new Array<boolean>(length).fill(false);

  for (let i = lookback; i < length; i += 1) {
    const currRsi = rsiValues[i];
    if (!isNumber(currRsi) || currRsi > 30) {
      continue;
    }
    const window = rsiValues.slice(i - lookback, i);
    const lowIndices = window
      .map((value, index) => (isNumber(value) && value <= 30 ? index : -1))
      .filter((index) => index >= 0);
    if (!lowIndices.length) {
      continue;
    }
    const lastLow = lowIndices[lowIndices.length - 1];
    const between = window.slice(lastLow + 1).filter(isNumber);
    if (between.length && Math.max(...between) >= 40) {
      mask[i] = true;
    }
  }

  return mask;
};

export async function analyzeSymbol(
  request: Request,
  context?: { params?: { symbol?: string } | Promise<{ symbol?: string }> },
  options?: { userContext?: UserContext },
) {
  void options;
  const marketData = getMarketDataProvider();
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const symbolFromPath = pathParts[pathParts.length - 1] ?? "";
  const resolvedParams = context?.params ? await context.params : undefined;
  const rawSymbol =
    (typeof resolvedParams?.symbol === "string" && resolvedParams.symbol) ||
    symbolFromPath;
  const symbol = decodeURIComponent(rawSymbol);
  const rangeDaysResult = parseBoundedDays(url.searchParams.get("days"), {
    fallback: DEFAULT_DAYS,
    max: GENERAL_ANALYSIS_MAX_DAYS,
  });
  if (!rangeDaysResult.ok) {
    return rangeDaysResult.response;
  }
  const rangeDays = rangeDaysResult.value;
  const timeframeParam = url.searchParams.get("tf") ?? "1d";
  const debugMode = url.searchParams.get("debug") === "1";
  const diagMode = url.searchParams.get("diag") === "1";
  const trendFollowingRole =
    timeframeParam === "1d"
      ? "primary"
      : timeframeParam === "4h"
        ? "auxiliary"
        : "legacy-chart";
  const timeframeMap: Record<
    string,
    { interval: MarketDataInterval; resample?: number }
  > = {
    "1h": { interval: "1h" },
    "4h": { interval: "1h", resample: 4 },
    "1d": { interval: "1d" },
    "1wk": { interval: "1wk" },
  };
  const timeframe = timeframeMap[timeframeParam] ?? timeframeMap["1d"];
  const sanitizedSymbol = symbol.trim().toUpperCase();

  if (!sanitizedSymbol) {
    return Response.json({ error: "Symbol is required." }, { status: 400 });
  }

  const requestedRangeDays = Number.isFinite(rangeDays) ? rangeDays : DEFAULT_DAYS;
  const warmupDays = getWarmupDays(timeframeParam);
  const endDate = new Date();
  const requestedStartDate = new Date(endDate);
  requestedStartDate.setDate(endDate.getDate() - requestedRangeDays);
  const startDate = new Date(requestedStartDate);
  startDate.setDate(startDate.getDate() - warmupDays);

  const weeklyStartDate = new Date(endDate);
  const weeklyRangeDays = Math.max(
    Number.isFinite(rangeDays) ? rangeDays : DEFAULT_DAYS,
    365 * 3,
  );
  weeklyStartDate.setDate(endDate.getDate() - weeklyRangeDays);

  const [chart, weeklyChart] = await Promise.all([
    marketData.getCandles(sanitizedSymbol, {
      period1: startDate,
      period2: endDate,
      interval: timeframe.interval,
      includePrePost: timeframe.interval === "1h" ? false : undefined,
    }),
    marketData.getCandles(sanitizedSymbol, {
      period1: weeklyStartDate,
      period2: endDate,
      interval: "1wk",
    }),
  ]);

  const chartTimeZone = chart.timeZone ?? "UTC";

  if (!chart.candles.length) {
    return Response.json(
      { error: "No data returned for symbol." },
      { status: 404 },
    );
  }

  let candles: Candle[] = chart.candles;

  if (timeframe.resample) {
    candles = resampleCandles(candles, timeframe.resample, chartTimeZone);
  }

  const requestedStartUnix = toUnix(requestedStartDate);
  const visibleStartIndex = Math.max(
    0,
    candles.findIndex((candle) => candle.time >= requestedStartUnix),
  );

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);

  const weeklyCloses = weeklyChart.candles.map((candle) => candle.close);
  const weeklySma20 = SMA.calculate({ period: 20, values: weeklyCloses });
  const weeklySma60 = SMA.calculate({ period: 60, values: weeklyCloses });
  let weeklyTrend: "up" | "down" | "neutral" = "neutral";
  if (weeklySma20.length && weeklySma60.length) {
    const last20 = weeklySma20[weeklySma20.length - 1];
    const last60 = weeklySma60[weeklySma60.length - 1];
    if (last20 > last60) {
      weeklyTrend = "up";
    } else if (last20 < last60) {
      weeklyTrend = "down";
    }
  }

  const sma5 = SMA.calculate({ period: 5, values: closes });
  const sma20 = SMA.calculate({ period: 20, values: closes });
  const sma50 = SMA.calculate({ period: 50, values: closes });
  const sma60 = SMA.calculate({ period: 60, values: closes });
  const sma100 = SMA.calculate({ period: 100, values: closes });
  const volMa20 = SMA.calculate({ period: 20, values: volumes });
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const obv = OBV.calculate({ close: closes, volume: volumes });
  const obvMa20 = SMA.calculate({ period: 20, values: obv });
  const mfi = MFI.calculate({
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
    period: 14,
  });
  const hma20 = calculateHma(closes, 20);
  const hma50 = calculateHma(closes, 50);
  const ema200 = EMA.calculate({ period: 200, values: closes });
  const choppiness = calculateChoppiness(highs, lows, closes, 14);

  const rsi = RSI.calculate({ period: 14, values: closes });
  const bbands = BollingerBands.calculate({
    period: 20,
    stdDev: 2,
    values: closes,
  });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const stoch = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3,
  });
  const cci = CCI.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 20,
  });

  // Lead Buy indicators
  const fastStoch = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 5,
    signalPeriod: 3,
  });
  const rsi2 = RSI.calculate({ period: 2, values: closes });

  const psar = PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 });
  const williamsR = WilliamsR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  });

  const adx = ADX.calculate({
    close: closes,
    high: highs,
    low: lows,
    period: 14,
  });

  const rsiSeries = alignSeries(candles, rsi);
  const sma20Series = alignSeries(candles, sma20);
  const rsiAligned = alignValues(candles.length, rsi);
  const sma5Aligned = alignValues(candles.length, sma5);
  const sma20Aligned = alignValues(candles.length, sma20);
  const sma50Aligned = alignValues(candles.length, sma50);
  const sma60Aligned = alignValues(candles.length, sma60);
  const volMa20Aligned = alignValues(candles.length, volMa20);
  const bbAligned = alignValues(candles.length, bbands);
  const macdAligned = alignValues(candles.length, macd);
  const stochAligned = alignValues(candles.length, stoch);
  const cciAligned = alignValues(candles.length, cci);
  const adxAligned = alignValues(candles.length, adx);
  const atrAligned = alignValues(candles.length, atr);
  const obvAligned = alignValues(candles.length, obv);
  const obvMaAligned = alignValues(candles.length, obvMa20);
  const mfiAligned = alignValues(candles.length, mfi);
  const hma20Aligned = alignValues(candles.length, hma20);
  const hma50Aligned = alignValues(candles.length, hma50);
  const ema200Aligned = alignValues(candles.length, ema200);
  const chopAligned = alignValues(candles.length, choppiness);
  const fastStochAligned = alignValues(candles.length, fastStoch);
  const rsi2Aligned = alignValues(candles.length, rsi2);
  const williamsRAligned = alignValues(candles.length, williamsR);

  const atrUpperSeries = candles
    .map((candle, index) => {
      const atrValue = atrAligned[index];
      if (!isNumber(atrValue)) {
        return null;
      }
      return { time: candle.time, value: candle.close + atrValue * 2 };
    })
    .filter((value): value is { time: number; value: number } => value !== null);
  const atrLowerSeries = candles
    .map((candle, index) => {
      const atrValue = atrAligned[index];
      if (!isNumber(atrValue)) {
        return null;
      }
      return { time: candle.time, value: candle.close - atrValue * 2 };
    })
    .filter((value): value is { time: number; value: number } => value !== null);

  const chandelierSeries = calculateChandelierSeries(
    candles,
    atrAligned,
    22,
    3,
  );

  const weeklyUp = weeklyTrend === "up";
  const symbolIsCrypto = isCryptoSymbol(sanitizedSymbol);
  const growthProfileAtrGatePct = 0.035;
  const atrPctAligned = atrAligned.map((atrValue, index) =>
    isNumber(atrValue) && candles[index].close > 0
      ? atrValue / candles[index].close
      : null,
  );
  const rollingAtrPctMedian90 = calculateRollingMedian(atrPctAligned, 90);
  const growthProfileEligibleMask = candles.map(
    (_, index) =>
      !symbolIsCrypto &&
      isNumber(rollingAtrPctMedian90[index]) &&
      (rollingAtrPctMedian90[index] ?? 0) >= growthProfileAtrGatePct,
  );
  const growthProfileEligibleBars = growthProfileEligibleMask.filter(Boolean).length;
  const latestRollingAtrPctMedian =
    [...rollingAtrPctMedian90].reverse().find((value) => isNumber(value)) ?? null;
  const dailyProfileType =
    !symbolIsCrypto &&
    growthProfileEligibleBars > 0
      ? "growth reset"
      : "base panic";

  const { bullMask, bearMask } = getDivergenceMasks(candles, rsiAligned);
  const { bullMask: obvBullMask, bearMask: obvBearMask } = getObvDivergenceMasks(
    candles,
    obvAligned,
  );
  const rsiDoubleBottom = getRsiDoubleBottom(rsiAligned);

  const lookbackBars =
    timeframeParam === "1h" ? 48 : timeframeParam === "4h" ? 40 : timeframeParam === "1wk" ? 12 : 20;
  const minLevelAge = 4;
  const minWickPct = getMinWickPct(timeframeParam);
  const minPenetrationPct = 0.001;

  const swingTrapBull = new Array<boolean>(candles.length).fill(false);
  const swingTrapBear = new Array<boolean>(candles.length).fill(false);
  const swingTrapBullScore = new Array<number>(candles.length).fill(0);
  const swingTrapBearScore = new Array<number>(candles.length).fill(0);
  const swingTrapBullLevelIndex = new Array<number | null>(candles.length).fill(null);
  const swingTrapBearLevelIndex = new Array<number | null>(candles.length).fill(null);
  const swingTrapBullStop = new Array<number | null>(candles.length).fill(null);
  const swingTrapBullReason = new Array<string | null>(candles.length).fill(null);
  const swingTrapBullProfile = new Array<"base-panic" | "growth-reset" | null>(candles.length).fill(null);
  const swingTrapBearReason = new Array<string | null>(candles.length).fill(null);
  const swingTrapDebug = {
    bullSweepsDetected: 0,
    bullPendingCreated: 0,
    bullReclaimAttempts: 0,
    bullReclaimPassed: 0,
    bullPendingExpiredNoReclaim: 0,
    bullRejectedByConfluence: 0,
    bullRejectedByCountertrendGuard: 0,
    bullRejectedByFollowThrough: 0,
    setupDetected: 0,
    triggerCandidate: 0,
    triggerPassed: 0,
    rejectedByMomentumTurn: 0,
    rejectedByStructureBreak: 0,
    rejectedByVolumeOnlyFilter: 0,
    bullCrashReclaimPassed: 0,
    bullBalancedPanicPassed: 0,
    bullFlushPanicPassed: 0,
    bullSuppressedBy1dExactDayPolicy: 0,
    bullGrowthProfilePassed: 0,
    bullGrowthProfileRejectedByVolGate: 0,
    bullGrowthProfileRejectedByBreakoutQuality: 0,
    bullGrowthProfileClusterSuppressed: 0,
    bullGapSnapbackPassed: 0,
    bullTwoStepFlushPassed: 0,
    bullCompressionResetPassed: 0,
    bullTurnDayResetPassed: 0,
    bullCapitulationOverrideUsed: 0,
    bullCooldownOverrideUsed: 0,
    bullRejectedByCapitulationThreshold: 0,
    bullRejectedByCooldown: 0,
    bullRejectedByState: 0,
    bullSignalsEmitted: 0,
    bearSweepsDetected: 0,
    bearPendingCreated: 0,
    bearReclaimPassed: 0,
    bearRejectedByConfluence: 0,
    bearRejectedByCooldown: 0,
    bearRejectedByState: 0,
    bearSignalsEmitted: 0,
  };

  type PendingTrap = {
    level: number;
    levelIndex: number;
    sweepIndex: number;
    sweepLow: number;
    penetration: number;
    expiryIndex: number;
    reclaimAttempts: number;
  };

  type PendingBullFollowThrough = {
    confirmIndex: number;
    reclaimLevel: number;
    confluence: number;
    levelIndex: number;
    sweepLow: number;
    sweepAtr: number | null;
    trendContext: "aligned" | "neutral" | "countertrend";
    strongReclaim: boolean;
  };

  type PendingDailySetup = {
    setupIndex: number;
    expiryIndex: number;
    setupHigh: number;
    stopLow: number;
    setupAtr: number | null;
    setupScore: number;
    setupDetails: string[];
    growthEligible: boolean;
    rangeAtrMultiple: number;
    volumeRatio: number | null;
    closeLocation: number;
    dayReturn: number;
    macdImproving: boolean;
  };

  const trendCore = new Array<boolean>(candles.length).fill(false);
  const trendStrong = new Array<boolean>(candles.length).fill(false);
  const trendModerate = new Array<boolean>(candles.length).fill(false);
  const trendWeak = new Array<boolean>(candles.length).fill(false);
  const reversalCore = new Array<boolean>(candles.length).fill(false);
  const reversalStrong = new Array<boolean>(candles.length).fill(false);
  const reversalModerate = new Array<boolean>(candles.length).fill(false);
  const reversalWeak = new Array<boolean>(candles.length).fill(false);
  const condOverheat = new Array<boolean>(candles.length).fill(false);
  const overheatScore = new Array<number>(candles.length).fill(0);
  const condClimax = new Array<boolean>(candles.length).fill(false);
  const panicSell = new Array<boolean>(candles.length).fill(false);
  const buyingClimax = new Array<boolean>(candles.length).fill(false);
  const baseBuy = new Array<boolean>(candles.length).fill(false);
  const macdWeakening = new Array<boolean>(candles.length).fill(false);
  const adxRising = new Array<boolean>(candles.length).fill(false);
  const adxFalling = new Array<boolean>(candles.length).fill(false);
  const atrOversold = new Array<boolean>(candles.length).fill(false);
  const higherLow = new Array<boolean>(candles.length).fill(false);
  const volSpike = new Array<boolean>(candles.length).fill(false);
  const hmaCrossDown = new Array<boolean>(candles.length).fill(false);
  // Lead Buy signal masks
  const leadTrendBuy = new Array<boolean>(candles.length).fill(false);
  const kineticReversalBuy = new Array<boolean>(candles.length).fill(false);
  const stoppingVolume = new Array<boolean>(candles.length).fill(false);
  const bollingerTrap = new Array<boolean>(candles.length).fill(false);
  // V2.1: Capitulation signal mask
  const capitulation = new Array<boolean>(candles.length).fill(false);
  const dailySetupDetected = new Array<boolean>(candles.length).fill(false);


  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const rsiValue = rsiAligned[i];
    const ma5Value = sma5Aligned[i];
    const ma20Value = sma20Aligned[i];
    const ma60Value = sma60Aligned[i];
    const volMa20Value = volMa20Aligned[i];
    const bbValue = bbAligned[i];
    const macdValue = macdAligned[i];
    const stochValue = stochAligned[i];
    const mfiValue = mfiAligned[i];
    const atrValue = atrAligned[i];
    const hma20Value = hma20Aligned[i];
    const hma50Value = hma50Aligned[i];
    const ema200Value = ema200Aligned[i];
    const chopValue = chopAligned[i];
    const isRed = candle.close > candle.open;
    const {
      oversold: rsiOversold,
      deep: rsiDeep,
      overbought: rsiOverbought,
      extreme: rsiExtreme,
    } = getRsiThresholds(atrValue, candle.close);

    if (isNumber(volMa20Value)) {
      volSpike[i] = candle.volume > volMa20Value * 2.5;
      panicSell[i] = volSpike[i] && !isRed;
      buyingClimax[i] = volSpike[i] && isRed;
      // V2.1: Capitulation detection (Volume > 3x MA + RSI < 20 + Large Red Candle)
      const candleBody = Math.abs(candle.close - candle.open);
      const isLargeRedCandle = !isRed && candleBody > 0.6 * (candle.high - candle.low);
      capitulation[i] =
        candle.volume > volMa20Value * 3 &&
        isNumber(rsiValue) &&
        rsiValue < 20 &&
        isLargeRedCandle;
    }


    if (isNumber(adxAligned[i]?.adx) && i > 0) {
      const prevAdx = adxAligned[i - 1]?.adx;
      if (isNumber(prevAdx)) {
        adxRising[i] = (adxAligned[i]?.adx ?? 0) > prevAdx;
        adxFalling[i] = (adxAligned[i]?.adx ?? 0) < prevAdx;
      }
    }

    if (isNumber(macdValue?.histogram) && i > 0) {
      const prev = macdAligned[i - 1];
      if (isNumber(prev?.histogram)) {
        macdWeakening[i] = macdValue.histogram < prev.histogram;
      }
    }

    const obvValue = obvAligned[i];
    const obvMaValue = obvMaAligned[i];
    const obvUp =
      !isNumber(obvValue) || !isNumber(obvMaValue) || obvValue > obvMaValue;
    const obvDown =
      !isNumber(obvValue) || !isNumber(obvMaValue) || obvValue < obvMaValue;

    const volConfirm = isNumber(volMa20Value)
      ? candle.volume > volMa20Value
      : false;
    const spreadConfirm = isNumber(atrValue)
      ? candle.high - candle.low > atrValue
      : false;

    const prevHma20 = hma20Aligned[i - 1];
    const prevHma50 = hma50Aligned[i - 1];
    const hmaCrossUp =
      isNumber(prevHma20) &&
      isNumber(prevHma50) &&
      prevHma20 <= prevHma50 &&
      isNumber(hma20Value) &&
      isNumber(hma50Value) &&
      hma20Value > hma50Value;
    const hmaCrossDownSignal =
      isNumber(prevHma20) &&
      isNumber(prevHma50) &&
      prevHma20 >= prevHma50 &&
      isNumber(hma20Value) &&
      isNumber(hma50Value) &&
      hma20Value < hma50Value;
    hmaCrossDown[i] = hmaCrossDownSignal;

    if (
      isNumber(hma20Value) &&
      isNumber(hma50Value) &&
      isNumber(rsiValue) &&
      macdValue &&
      isNumber(macdValue.MACD) &&
      isNumber(macdValue.signal)
    ) {
      trendCore[i] =
        (hmaCrossUp || hma20Value > hma50Value) &&
        rsiValue > 50 &&
        macdValue.MACD > macdValue.signal;
    }

    const ema200Filter = !isNumber(ema200Value) || candle.close > ema200Value;
    const isTrending = isNumber(chopValue) ? chopValue < 38.2 : false;
    const isChoppy = isNumber(chopValue) ? chopValue > 61.8 : false;

    if (trendCore[i]) {
      const adxStrong = (adxAligned[i]?.adx ?? 0) > 25 && adxRising[i];
      const trendScore = [
        ema200Filter,
        isTrending,
        adxStrong,
        obvUp && volConfirm,
        spreadConfirm,
      ].filter(Boolean).length;

      if (isChoppy) {
        trendWeak[i] = true;
      } else if (trendScore >= 4) {
        trendStrong[i] = true;
      } else if (trendScore >= 2) {
        trendModerate[i] = true;
      } else {
        trendWeak[i] = true;
      }
    }

    if (
      isNumber(rsiValue) &&
      isNumber(bbValue?.lower) &&
      isNumber(stochValue?.k) &&
      isNumber(stochValue?.d)
    ) {
      baseBuy[i] =
        rsiValue < rsiOversold &&
        candle.close <= bbValue.lower * 1.02 &&
        stochValue.k > stochValue.d;
    }

    if (isNumber(atrValue) && isNumber(ma20Value)) {
      atrOversold[i] = candle.close <= ma20Value - atrValue * 2;
    }

    if (isNumber(rsiValue)) {
      const confirmBreak =
        (isNumber(ma20Value) && candle.close > ma20Value) ||
        (i > 0 &&
          candle.close >
          Math.max(
            ...candles
              .slice(Math.max(0, i - 3), i)
              .map((c) => c.high),
          ));
      reversalCore[i] = rsiValue < rsiOversold && confirmBreak;

      const isRanging = isNumber(adxAligned[i]?.adx)
        ? (adxAligned[i]?.adx ?? 0) < 25
        : true;
      const strongRange = isChoppy || (adxAligned[i]?.adx ?? 0) < 20;
      const panicPrev = i > 0 ? panicSell[i - 1] : false;

      if (reversalCore[i]) {
        const reversalScore = [
          strongRange,
          obvUp,
          bullMask[i] || higherLow[i],
          panicPrev,
        ].filter(Boolean).length;

        if (isRanging && reversalScore >= 4) {
          reversalStrong[i] = true;
        } else if (isRanging && reversalScore >= 2) {
          reversalModerate[i] = true;
        } else {
          reversalWeak[i] = true;
        }
      }
    }

    if (isNumber(rsiValue) && isNumber(bbValue?.upper) && isNumber(ma20Value)) {
      const overheatSignals = [
        rsiValue >= rsiOverbought,
        candle.high >= bbValue.upper,
        isNumber(stochValue?.k) && isNumber(stochValue?.d)
          ? stochValue.k < stochValue.d
          : false,
        isNumber(mfiValue) ? mfiValue >= 70 : false,
      ];
      const score = overheatSignals.filter(Boolean).length;
      overheatScore[i] = score;
      condOverheat[i] = score >= 2;
    }

    if (isNumber(rsiValue)) {
      condClimax[i] = buyingClimax[i] && rsiValue >= rsiOverbought;
    }

    if (i > 0) {
      const prevLow = candles[i - 1].low;
      higherLow[i] = candle.low > prevLow;
    }

    // Lead Trend Buy detection
    const fastStochValue = fastStochAligned[i];
    const prevFastStoch = fastStochAligned[i - 1];
    const rsi2Value = rsi2Aligned[i];
    const prevRsi2 = rsi2Aligned[i - 1];
    const prevHma20Val = hma20Aligned[i - 1];
    const prevPrevHma20 = hma20Aligned[i - 2];

    // HMA Turn: HMA20 slope turns positive (price > EMA200) with volume confirmation
    const hmaSlopeTurnsPositive =
      i >= 2 &&
      isNumber(prevPrevHma20) &&
      isNumber(prevHma20Val) &&
      isNumber(hma20Value) &&
      prevHma20Val <= prevPrevHma20 && // was falling or flat
      hma20Value > prevHma20Val; // now rising

    const hmaTurnBuy =
      hmaSlopeTurnsPositive &&
      ema200Filter &&
      volConfirm;

    // Stoch Launch: Fast Stoch(5,3,3) bullish cross with RSI > 50
    const stochLaunchBuy =
      isNumber(fastStochValue?.k) &&
      isNumber(fastStochValue?.d) &&
      isNumber(prevFastStoch?.k) &&
      isNumber(prevFastStoch?.d) &&
      prevFastStoch.k <= prevFastStoch.d &&
      fastStochValue.k > fastStochValue.d &&
      isNumber(rsiValue) &&
      rsiValue > 50 &&
      volConfirm;

    leadTrendBuy[i] = hmaTurnBuy || stochLaunchBuy;

    // Kinetic Reversal detection
    // Panic Rebound: RSI(2) < 5 and next candle closes higher
    const panicReboundBuy =
      i > 0 &&
      isNumber(prevRsi2) &&
      prevRsi2 < 5 &&
      candle.close > candle.open; // current candle is bullish

    // Stopping Volume: High volume (>2x) with small body or long lower wick
    const candleRange = candle.high - candle.low;
    const candleBody = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const hasStoppingVolume =
      isNumber(volMa20Value) &&
      candle.volume > volMa20Value * 2 &&
      candleRange > 0 &&
      (candleBody / candleRange < 0.3 || lowerWick / candleRange > 0.5);
    stoppingVolume[i] = hasStoppingVolume;

    // Bollinger Trap: Price breaks lower band then closes back inside
    const prevBb = bbAligned[i - 1];
    const hasBollingerTrap =
      i > 0 &&
      isNumber(prevBb?.lower) &&
      isNumber(bbValue?.lower) &&
      candles[i - 1].close < prevBb.lower &&
      candle.close > bbValue.lower;
    bollingerTrap[i] = hasBollingerTrap;

    kineticReversalBuy[i] = panicReboundBuy || hasStoppingVolume || hasBollingerTrap;
  }

  const isDailyTimeframe = timeframeParam === "1d";
  const dailyTriggerWindowBars = 2;
  const bullReclaimWindowBars = 1;
  let pendingBullTrap: PendingTrap | null = null;
  let pendingBullFollowThrough: PendingBullFollowThrough | null = null;
  let pendingDailySetup: PendingDailySetup | null = null;
  let pendingBearTrap: PendingTrap | null = null;

  for (let i = 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const range = candle.high - candle.low;
    const atrValue = atrAligned[i];
    const volMa20Value = volMa20Aligned[i];
    const rsiValue = rsiAligned[i];
    const cciValue = cciAligned[i];
    const stochValue = stochAligned[i];
    const macdValue = macdAligned[i];
    const bbValue = bbAligned[i];
    const ma20Value = sma20Aligned[i];
    const williamsValue = williamsRAligned[i];
    const ema200Value = ema200Aligned[i];
    const candlePatterns = detectCandlePatterns(candles, i);
    const {
      oversold: rsiOversold,
      overbought: rsiOverbought,
    } = getRsiThresholds(atrValue, candle.close);
    const trendContext: "aligned" | "neutral" | "countertrend" =
      weeklyUp || (isNumber(ema200Value) && candle.close >= ema200Value * 1.02)
        ? "aligned"
        : !isNumber(ema200Value) || candle.close >= ema200Value * 0.98
          ? "neutral"
          : "countertrend";
    const trendOk = trendContext !== "countertrend";
    const volumeRatio =
      isNumber(volMa20Value) && volMa20Value > 0
        ? candle.volume / volMa20Value
        : null;
    const closeLocation =
      range > 0 ? clamp(0, 1, (candle.close - candle.low) / range) : 0;

    if (isDailyTimeframe) {
      if (pendingDailySetup && i > pendingDailySetup.expiryIndex) {
        pendingDailySetup = null;
      }

      if (
        pendingDailySetup &&
        i > pendingDailySetup.setupIndex &&
        i <= pendingDailySetup.expiryIndex
      ) {
        pendingDailySetup.stopLow = Math.min(pendingDailySetup.stopLow, candle.low);
        const prevMacdValue = macdAligned[i - 1];
        const macdImproving =
          isNumber(macdValue?.histogram) &&
          isNumber(prevMacdValue?.histogram) &&
          macdValue.histogram > prevMacdValue.histogram;
        const oscillatorRecovered = Boolean(
          (isNumber(stochValue?.k) && stochValue.k > 20) ||
            (isNumber(williamsValue) && williamsValue > -80),
        );
        const strongClose =
          closeLocation >= 0.6 || candle.close > candles[i - 1].close;
        const structureRecovered =
          candle.close > candles[i - 1].high ||
          candle.close > pendingDailySetup.setupHigh;
        const triggerCandidate =
          structureRecovered || macdImproving || oscillatorRecovered || strongClose;
        const momentumTurn =
          macdImproving && oscillatorRecovered && strongClose;
        const triggerDayReturn = candle.close / candles[i - 1].close - 1;
        if (triggerCandidate) {
          swingTrapDebug.triggerCandidate += 1;
        }

        if (triggerCandidate && !structureRecovered) {
          swingTrapDebug.rejectedByStructureBreak += 1;
        } else if (structureRecovered && !momentumTurn) {
          swingTrapDebug.rejectedByMomentumTurn += 1;
        } else if (structureRecovered && momentumTurn) {
          swingTrapDebug.triggerPassed += 1;

          if (!pendingDailySetup.growthEligible) {
            swingTrapDebug.bullSuppressedBy1dExactDayPolicy += 1;
            if (!symbolIsCrypto) {
              swingTrapDebug.bullGrowthProfileRejectedByVolGate += 1;
            }
            pendingDailySetup = null;
          } else {
            const triggerLag = i - pendingDailySetup.setupIndex;
            const turnDayReset =
              triggerLag === 1 &&
              pendingDailySetup.setupScore >= 6 &&
              pendingDailySetup.macdImproving &&
              triggerDayReturn >= 0.08;
            const gapSnapback =
              triggerLag === 1 &&
              (
                (
                  pendingDailySetup.setupScore === 3 &&
                  triggerDayReturn >= 0.1 &&
                  closeLocation >= 0.85
                ) ||
                (
                  pendingDailySetup.setupScore >= 4 &&
                  pendingDailySetup.closeLocation <= 0.25 &&
                  triggerDayReturn >= 0.1 &&
                  closeLocation >= 0.9
                )
              );
            const twoStepFlush =
              triggerLag === 2 &&
              pendingDailySetup.setupScore >= 5 &&
              pendingDailySetup.closeLocation <= 0.1 &&
              pendingDailySetup.dayReturn <= -0.1 &&
              triggerDayReturn >= 0.07;
            const compressionReset =
              triggerLag === 1 &&
              pendingDailySetup.setupScore >= 5 &&
              pendingDailySetup.rangeAtrMultiple <= 0.8 &&
              isNumber(pendingDailySetup.volumeRatio) &&
              pendingDailySetup.volumeRatio <= 1 &&
              pendingDailySetup.dayReturn <= -0.04 &&
              closeLocation >= 0.6;

            if (
              !turnDayReset &&
              !gapSnapback &&
              !twoStepFlush &&
              !compressionReset
            ) {
              swingTrapDebug.bullGrowthProfileRejectedByBreakoutQuality += 1;
            } else {
              const stopBuffer = isNumber(pendingDailySetup.setupAtr)
                ? Math.max(pendingDailySetup.setupAtr * 0.25, candle.close * 0.005)
                : candle.close * 0.005;
              const archetype = turnDayReset
                ? "Turn-Day Reset"
                : gapSnapback
                  ? "Gap Snapback"
                  : twoStepFlush
                    ? "Two-Step Flush"
                    : "Compression Reset";

              swingTrapDebug.bullGrowthProfilePassed += 1;
              if (archetype === "Gap Snapback") {
                swingTrapDebug.bullGapSnapbackPassed += 1;
              } else if (archetype === "Two-Step Flush") {
                swingTrapDebug.bullTwoStepFlushPassed += 1;
              } else if (archetype === "Compression Reset") {
                swingTrapDebug.bullCompressionResetPassed += 1;
              } else {
                swingTrapDebug.bullTurnDayResetPassed += 1;
              }

              swingTrapBull[i] = true;
              swingTrapBullScore[i] = 4;
              swingTrapBullLevelIndex[i] = pendingDailySetup.setupIndex;
              swingTrapBullStop[i] =
                pendingDailySetup.stopLow - stopBuffer;
              swingTrapBullProfile[i] = "growth-reset";
              swingTrapBullReason[i] =
                `${DAILY_TRIGGER_REASON_PREFIX}Growth Reset: ${archetype} (+${triggerLag}). ` +
                `Setup ${pendingDailySetup.setupScore}/6 (${pendingDailySetup.setupDetails.join(", ")}). ` +
                `Trigger reclaimed structure with day return ${(triggerDayReturn * 100).toFixed(1)}% and close location ${closeLocation.toFixed(2)}.`;
              pendingDailySetup = null;
            }
          }
        }
      }

      const setupDetails: string[] = [];
      if (isNumber(rsiValue) && rsiValue <= 40) {
        setupDetails.push("RSI<=40");
      }
      if (isNumber(cciValue) && cciValue <= -100) {
        setupDetails.push("CCI<=-100");
      }
      if (
        (isNumber(stochValue?.k) && stochValue.k <= 20) ||
        (isNumber(williamsValue) && williamsValue <= -80)
      ) {
        setupDetails.push("Stoch/Williams oversold");
      }
      if (isNumber(bbValue?.lower) && candle.low < bbValue.lower) {
        setupDetails.push("Below BB lower");
      }
      if (isNumber(ma20Value) && candle.close <= ma20Value * 0.95) {
        setupDetails.push("<= SMA20 -5%");
      }
      if (
        i >= 5 &&
        candles[i - 5].close > 0 &&
        candle.close / candles[i - 5].close - 1 <= -0.07
      ) {
        setupDetails.push("5d return<=-7%");
      }

      const setupScore = setupDetails.length;
      if (setupScore >= 3) {
        dailySetupDetected[i] = true;
        swingTrapDebug.setupDetected += 1;

        if (swingTrapBull[i]) {
          pendingDailySetup = null;
        } else {
          const rangeAtrMultiple =
            isNumber(atrValue) && atrValue > 0 ? range / atrValue : 0;
          const dayReturn = i > 0 ? candle.close / candles[i - 1].close - 1 : 0;
          const prevMacdValue = macdAligned[i - 1];
          const setupMacdImproving =
            isNumber(macdValue?.histogram) &&
            isNumber(prevMacdValue?.histogram) &&
            macdValue.histogram > prevMacdValue.histogram;
          const crashReclaim =
            setupScore >= 5 &&
            rangeAtrMultiple >= 1.6 &&
            isNumber(volumeRatio) &&
            volumeRatio >= 2.5 &&
            closeLocation >= 0.6 &&
            dayReturn <= -0.01 &&
            (Boolean(isNumber(rsiValue) && rsiValue <= 28) ||
              Boolean(
                (isNumber(stochValue?.k) && stochValue.k <= 21) ||
                  (isNumber(williamsValue) && williamsValue <= -79),
              ));
          const balancedPanic =
            setupScore === 6 &&
            rangeAtrMultiple >= 1.3 &&
            isNumber(volumeRatio) &&
            volumeRatio >= 1.25 &&
            closeLocation >= 0.5 &&
            closeLocation <= 0.7 &&
            dayReturn <= -0.025 &&
            isNumber(stochValue?.k) &&
            stochValue.k <= 15 &&
            isNumber(williamsValue) &&
            williamsValue <= -85;
          const flushPanic =
            setupScore === 6 &&
            rangeAtrMultiple >= 1.8 &&
            isNumber(volumeRatio) &&
            volumeRatio >= 1.8 &&
            closeLocation <= 0.15 &&
            dayReturn <= -0.1 &&
            isNumber(rsiValue) &&
            rsiValue <= 20 &&
            isNumber(stochValue?.k) &&
            stochValue.k <= 5;

          if (setupScore >= 5 && !(crashReclaim || balancedPanic || flushPanic)) {
            swingTrapDebug.bullRejectedByCapitulationThreshold += 1;
          }

          if (crashReclaim || balancedPanic || flushPanic) {
            const stopBuffer = isNumber(atrValue)
              ? Math.max(atrValue * 0.25, candle.close * 0.005)
              : candle.close * 0.005;
            swingTrapDebug.triggerCandidate += 1;
            swingTrapDebug.triggerPassed += 1;
            swingTrapDebug.bullCapitulationOverrideUsed += 1;
            if (crashReclaim) {
              swingTrapDebug.bullCrashReclaimPassed += 1;
            } else if (balancedPanic) {
              swingTrapDebug.bullBalancedPanicPassed += 1;
            } else {
              swingTrapDebug.bullFlushPanicPassed += 1;
            }
            swingTrapBull[i] = true;
            swingTrapBullScore[i] = 4;
            swingTrapBullLevelIndex[i] = i;
            swingTrapBullStop[i] = candle.low - stopBuffer;
            swingTrapBullProfile[i] = "base-panic";
            const archetype = crashReclaim
              ? "Crash Reclaim"
              : balancedPanic
                ? "Balanced Panic"
                : "Flush Panic";
            swingTrapBullReason[i] =
              `${DAILY_TRIGGER_REASON_PREFIX}${archetype} exact-day panic. ` +
              `Setup ${setupScore}/6 (${setupDetails.join(", ")}). ` +
              `Range expanded ${rangeAtrMultiple.toFixed(2)}x ATR with ` +
              `${isNumber(volumeRatio) ? `volume ${volumeRatio.toFixed(2)}x` : "volume unavailable"}, ` +
              `close location ${closeLocation.toFixed(2)}, and day return ${(dayReturn * 100).toFixed(1)}%.`;
            pendingDailySetup = null;
          } else {
            const shouldReplaceSetup =
              !pendingDailySetup ||
              i > pendingDailySetup.expiryIndex ||
              (
                candle.low <= pendingDailySetup.stopLow &&
                (
                  closeLocation <= pendingDailySetup.closeLocation ||
                  dayReturn <= pendingDailySetup.dayReturn
                )
              ) ||
              setupScore > pendingDailySetup.setupScore ||
              (
                setupScore === pendingDailySetup.setupScore &&
                (
                  closeLocation <= pendingDailySetup.closeLocation - 0.15 ||
                  dayReturn <= pendingDailySetup.dayReturn - 0.02 ||
                  (
                    setupMacdImproving &&
                    !pendingDailySetup.macdImproving &&
                    candle.low > pendingDailySetup.stopLow
                  )
                )
              );

            if (shouldReplaceSetup) {
              pendingDailySetup = {
                setupIndex: i,
                expiryIndex: i + dailyTriggerWindowBars,
                setupHigh: candle.high,
                stopLow: candle.low,
                setupAtr: isNumber(atrValue) ? atrValue : null,
                setupScore,
                setupDetails,
                growthEligible: growthProfileEligibleMask[i],
                rangeAtrMultiple,
                volumeRatio,
                closeLocation,
                dayReturn,
                macdImproving: setupMacdImproving,
              };
            }
          }
        }
      }
    } else {
      let processedBullFollowThrough = false;

      if (pendingBullFollowThrough && pendingBullFollowThrough.confirmIndex === i) {
        processedBullFollowThrough = true;
        const confirmBuffer = isNumber(pendingBullFollowThrough.sweepAtr)
          ? pendingBullFollowThrough.sweepAtr * 0.15
          : candle.close * 0.0025;
        const followThroughPassed =
          candle.close >= pendingBullFollowThrough.reclaimLevel &&
          candle.low > pendingBullFollowThrough.sweepLow - confirmBuffer;

        if (followThroughPassed) {
          const baseAtr = isNumber(atrValue)
            ? atrValue
            : pendingBullFollowThrough.sweepAtr;
          const stopBuffer = isNumber(baseAtr)
            ? Math.max(baseAtr * 0.25, candle.close * 0.005)
            : candle.close * 0.005;
          const contextReason =
            pendingBullFollowThrough.trendContext === "aligned"
              ? "Trend-aligned context."
              : pendingBullFollowThrough.trendContext === "neutral"
                ? "Neutral trend context with higher confirmation."
                : "Countertrend context passed divergence/pattern guard.";
          const reclaimNote = pendingBullFollowThrough.strongReclaim
            ? " Strong reclaim observed."
            : "";

          swingTrapBull[i] = true;
          swingTrapBullScore[i] = pendingBullFollowThrough.confluence;
          swingTrapBullLevelIndex[i] = pendingBullFollowThrough.levelIndex;
          swingTrapBullStop[i] =
            pendingBullFollowThrough.sweepLow - stopBuffer;
          swingTrapBullReason[i] =
            `Reclaim+follow-through confirmed with confluence ${pendingBullFollowThrough.confluence}/4.` +
            `${reclaimNote} ${contextReason}`;
          pendingBullTrap = null;
        } else {
          swingTrapDebug.bullRejectedByFollowThrough += 1;
        }
        pendingBullFollowThrough = null;
      }

      if (
        pendingBullTrap &&
        i > pendingBullTrap.expiryIndex &&
        !pendingBullFollowThrough &&
        !processedBullFollowThrough
      ) {
        if (pendingBullTrap.reclaimAttempts === 0) {
          swingTrapDebug.bullPendingExpiredNoReclaim += 1;
        }
        pendingBullTrap = null;
      }

      if (
        pendingBullTrap &&
        i <= pendingBullTrap.expiryIndex &&
        !pendingBullFollowThrough &&
        !processedBullFollowThrough
      ) {
        const reclaimed = candle.close > pendingBullTrap.level;
        if (reclaimed) {
          pendingBullTrap.reclaimAttempts += 1;
          swingTrapDebug.bullReclaimAttempts += 1;
          swingTrapDebug.bullReclaimPassed += 1;
        }

        const reclaimStrength =
          range > 0 ? (candle.close - candle.low) / range : 0;
        const strongReclaim = reclaimed && reclaimStrength >= 0.6;
        const volumeConfirm = isNumber(volMa20Value)
          ? candle.volume >= volMa20Value * 1.1
          : false;
        const divergenceConfirm: boolean = Boolean(
          bullMask[i] || obvBullMask[i] || rsiDoubleBottom[i],
        );
        const reversalConfirm: boolean =
          candlePatterns.isHammer ||
          candlePatterns.isBullishEngulfing ||
          candlePatterns.isMorningStar;
        const momentumConfirm = isNumber(rsiValue) && rsiValue <= rsiOversold;
        const confluenceScore: number =
          Number(volumeConfirm) +
          Number(divergenceConfirm) +
          Number(reversalConfirm) +
          Number(momentumConfirm);
        const minConfluence = trendContext === "aligned" ? 1 : 2;
        const countertrendGuard =
          trendContext !== "countertrend" || divergenceConfirm || reversalConfirm;

        if (reclaimed && confluenceScore >= minConfluence) {
          if (!countertrendGuard) {
            swingTrapDebug.bullRejectedByCountertrendGuard += 1;
          } else {
            pendingBullFollowThrough = {
              confirmIndex: i + 1,
              reclaimLevel: pendingBullTrap.level,
              confluence: confluenceScore,
              levelIndex: pendingBullTrap.levelIndex,
              sweepLow: pendingBullTrap.sweepLow,
              sweepAtr: atrAligned[pendingBullTrap.sweepIndex],
              trendContext,
              strongReclaim,
            };
          }
        } else if (reclaimed) {
          swingTrapDebug.bullRejectedByConfluence += 1;
        }
      }
    }

    if (pendingBearTrap && pendingBearTrap.sweepIndex + 1 === i) {
      const reclaimed = candle.close < pendingBearTrap.level;
      if (reclaimed) {
        swingTrapDebug.bearReclaimPassed += 1;
      }
      const volumeConfirm = isNumber(volMa20Value)
        ? candle.volume >= volMa20Value * 1.1
        : false;
      const divergenceConfirm = bearMask[i] || obvBearMask[i];
      const reversalConfirm =
        candlePatterns.isShootingStar ||
        candlePatterns.isBearishEngulfing ||
        candlePatterns.isEveningStar;
      const momentumConfirm = isNumber(rsiValue) && rsiValue >= rsiOverbought;
      const confluenceScore: number =
        Number(volumeConfirm) +
        Number(divergenceConfirm) +
        Number(reversalConfirm) +
        Number(momentumConfirm);
      const minConfluence = trendOk ? 1 : 2;

      if (reclaimed && confluenceScore >= minConfluence) {
        swingTrapBear[i] = true;
        swingTrapBearScore[i] = confluenceScore;
        swingTrapBearLevelIndex[i] = pendingBearTrap.levelIndex;
        swingTrapBearReason[i] =
          `Plus-one rejection below sweep level with confluence ${confluenceScore}/4.` +
          ` ${trendOk ? "Trend-aligned context." : "Countertrend entry (extra confirmation met)."}`;
      } else if (reclaimed) {
        swingTrapDebug.bearRejectedByConfluence += 1;
      }
      pendingBearTrap = null;
    }

    if (!isDailyTimeframe) {
      const swingLowLevel = getLookbackLevel(candles, i, lookbackBars, "low");
      if (
        swingLowLevel &&
        i - swingLowLevel.index >= minLevelAge &&
        range > 0
      ) {
        const penetration = swingLowLevel.value - candle.low;
        const wickPct = penetration / range;
        const minPenetration = isNumber(atrValue)
          ? Math.max(atrValue * 0.05, candle.close * minPenetrationPct)
          : candle.close * minPenetrationPct;
        const qualifies =
          candle.low < swingLowLevel.value &&
          penetration >= minPenetration &&
          wickPct >= minWickPct;

        if (qualifies) {
          swingTrapDebug.bullSweepsDetected += 1;
          if (
            !pendingBullTrap ||
            penetration > pendingBullTrap.penetration ||
            i > pendingBullTrap.sweepIndex
          ) {
            pendingBullTrap = {
              level: swingLowLevel.value,
              levelIndex: swingLowLevel.index,
              sweepIndex: i,
              sweepLow: candle.low,
              penetration,
              expiryIndex: i + bullReclaimWindowBars,
              reclaimAttempts: 0,
            };
            pendingBullFollowThrough = null;
            swingTrapDebug.bullPendingCreated += 1;
          }
        }
      }
    }

    const swingHighLevel = getLookbackLevel(candles, i, lookbackBars, "high");
    if (
      swingHighLevel &&
      i - swingHighLevel.index >= minLevelAge &&
      range > 0
    ) {
      const penetration = candle.high - swingHighLevel.value;
      const wickPct = penetration / range;
      const minPenetration = isNumber(atrValue)
        ? Math.max(atrValue * 0.05, candle.close * minPenetrationPct)
        : candle.close * minPenetrationPct;
      const qualifies =
        candle.high > swingHighLevel.value &&
        penetration >= minPenetration &&
        wickPct >= minWickPct;

      if (qualifies) {
        swingTrapDebug.bearSweepsDetected += 1;
        if (
          !pendingBearTrap ||
          penetration > pendingBearTrap.penetration ||
          i > pendingBearTrap.sweepIndex
        ) {
          pendingBearTrap = {
            level: swingHighLevel.value,
            levelIndex: swingHighLevel.index,
            sweepIndex: i,
            sweepLow: candle.low,
            penetration,
            expiryIndex: i + 1,
            reclaimAttempts: 0,
          };
          swingTrapDebug.bearPendingCreated += 1;
        }
      }
    }
  }

  const buyTrendStrong = trendStrong.map(
    (value, index) => value && !trendStrong[index - 1],
  );
  const buyTrendModerate = trendModerate.map(
    (value, index) => value && !trendModerate[index - 1],
  );
  const buyTrendWeak = trendWeak.map(
    (value, index) => value && !trendWeak[index - 1],
  );
  const buyReversalStrong = reversalStrong.map(
    (value, index) => value && !reversalStrong[index - 1],
  );
  const buyReversalModerate = reversalModerate.map(
    (value, index) => value && !reversalModerate[index - 1],
  );
  const buyReversalWeak = reversalWeak.map(
    (value, index) => value && !reversalWeak[index - 1],
  );
  const sellOverheat = condOverheat.map(
    (value, index) => value && !condOverheat[index - 1],
  );
  const sellClimax = condClimax.map(
    (value, index) => value && !condClimax[index - 1],
  );

  const signals: MarketSignal[] = [];
  const emittedBuyMask = new Array<boolean>(candles.length).fill(false);

  const swingTrapCooldown =
    timeframeParam === "1h" ? 24 : timeframeParam === "4h" ? 18 : timeframeParam === "1wk" ? 4 : 45;
  const baseBuyCooldown =
    timeframeParam === "1d" ? 45 : swingTrapCooldown;
  const growthBuyCooldown =
    timeframeParam === "1d" ? 8 : swingTrapCooldown;
  const sellCooldown = swingTrapCooldown;
  let lastBuyIndex = -baseBuyCooldown;
  let lastGrowthBuyIndex = -growthBuyCooldown;
  let lastSellIndex = -sellCooldown;
  let signalState: "flat" | "long" | "short" = "flat";
  let lastBullTrapLevelIndex = -1;
  let lastBearTrapLevelIndex = -1;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    const rsiValue = rsiAligned[i];
    const bbValue = bbAligned[i];
    const atrValue = atrAligned[i];
    const ema200Value = ema200Aligned[i];
    const chopValue = chopAligned[i];
    const {
      overbought: rsiOverbought,
    } = getRsiThresholds(atrValue, candle.close);

    const sellCandidates: Array<{ label: string; reason: string }> = [];
    const buyCandidates: Array<{
      label: string;
      reason: string;
      stopLevel?: number;
      profile?: "base-panic" | "growth-reset";
    }> = [];

    // V2.2: Detect candlestick patterns for current candle
    const candlePatterns = detectCandlePatterns(candles, i);

    const obvValue = obvAligned[i];
    const obvMaValue = obvMaAligned[i];
    const volMa20Value = volMa20Aligned[i];
    const hasVolume = isNumber(volMa20Value) && candle.volume > volMa20Value;

    const obvDown =
      !isNumber(obvValue) || !isNumber(obvMaValue) || obvValue < obvMaValue;
    const isChoppy = isNumber(chopValue) ? chopValue > 61.8 : false;

    if (sellClimax[i] && obvDown) {
      sellCandidates.push({
        label: "Buying Climax (Strong)",
        reason: "Volume spike on up candle with RSI overbought.",
      });
    }

    // Lead Stop Failure: 2x ATR trailing stop for aggressive Lead Buy entries
    const atrValue2x = isNumber(atrAligned[i]) ? atrAligned[i]! * 2 : null;
    const recentHigh = i >= 5
      ? Math.max(...candles.slice(i - 5, i + 1).map((c) => c.high))
      : candle.high;
    const leadStopLevel = isNumber(atrValue2x) ? recentHigh - atrValue2x : null;
    const leadStopBreak = isNumber(leadStopLevel) && candle.close < leadStopLevel;

    // Only trigger Lead Stop if there was a recent Lead Buy signal
    const recentLeadBuy = i >= 10 && leadTrendBuy.slice(i - 10, i).some(Boolean);
    if (leadStopBreak && recentLeadBuy && !trendCore[i]) {
      sellCandidates.unshift({
        label: "Lead Stop Failure (Urgent)",
        reason: `Price broke 2x ATR stop (${leadStopLevel?.toFixed(2)}). Lead entry failed to trend.`,
      });
    }

    if (sellOverheat[i] && obvDown) {
      const score = overheatScore[i] ?? 0;
      const adxValue = adxAligned[i]?.adx ?? 0;
      const williamsRValue = williamsRAligned[i];
      const prevWilliamsR = williamsRAligned[i - 1];
      const isStrongTrend = adxValue > 25;

      // Williams %R turndown from overbought zone
      const williamsRTurndown =
        isNumber(williamsRValue) &&
        isNumber(prevWilliamsR) &&
        prevWilliamsR >= -20 &&
        williamsRValue < prevWilliamsR;

      // Candle weakness detection (Doji or Shooting Star)
      const candleRange = candle.high - candle.low;
      const candleBody = Math.abs(candle.close - candle.open);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const isDoji = candleRange > 0 && candleBody / candleRange < 0.1;
      const isShootingStar = candleRange > 0 && upperWick / candleRange > 0.6 && candle.close < candle.open;
      const candleWeakness = isDoji || isShootingStar;

      let strength = score >= 4 ? "Strong" : score >= 3 ? "Moderate" : "Weak";
      let reason = `Overheat condition (${score} signals).`;

      if (williamsRTurndown && isNumber(rsiValue) && rsiValue >= rsiOverbought) {
        reason = "RSI overbought + Williams %R turning down.";
        strength = "Moderate";
      }
      if (isNumber(bbValue?.upper) && candle.high >= bbValue.upper && candleWeakness) {
        reason = "BB upper touch + candle weakness (Doji/Shooting Star).";
        strength = "Moderate";
      }

      // Add partial profit suggestion and strong trend awareness
      // V2.2: Boost confidence if topping candlestick pattern present
      const hasTopPattern = candlePatterns.isShootingStar || candlePatterns.isEveningStar || candlePatterns.isBearishEngulfing;
      if (hasTopPattern) {
        strength = "Strong";
        reason = `${reason} + Bearish Candle Pattern (${candlePatterns.isShootingStar ? "Shooting Star" : candlePatterns.isEveningStar ? "Evening Star" : "Bearish Engulfing"}).`;
      }

      const labelSuffix = isStrongTrend ? " (Strong Trend - Hold)" : " (Partial)";
      sellCandidates.push({
        label: `Overheat Warning${labelSuffix}`,
        reason: isStrongTrend
          ? `${reason} ADX>${adxValue.toFixed(0)} suggests holding.`
          : `${reason} Consider 30-50% profit take.`,
      });
    }

    const emaBreak = isNumber(ema200Value) && candle.close < ema200Value;
    const hmaBreak = hmaCrossDown[i];

    // Chandelier Exit check (3x ATR trailing stop)
    const chandelierLongValue = chandelierSeries.long.find((p) => p.time === candle.time)?.value;
    const chandelierBreak = isNumber(chandelierLongValue) && candle.close < chandelierLongValue;

    const trendStopNow = emaBreak || hmaBreak || chandelierBreak;
    const prevChandelierLong = chandelierSeries.long.find((p) => p.time === candles[i - 1]?.time)?.value;
    const trendStopPrev =
      i > 0
        ? ((isNumber(ema200Aligned[i - 1]) &&
          candles[i - 1].close < (ema200Aligned[i - 1] ?? 0)) ||
          hmaCrossDown[i - 1] ||
          (isNumber(prevChandelierLong) && candles[i - 1].close < prevChandelierLong))
        : false;
    if (trendStopNow && !trendStopPrev) {
      // 1. Calculate Grading Metrics
      let daysBelowEMA = 0;
      if (isNumber(ema200Value) && candle.close < ema200Value) {
        let d = 0;
        while (i - d >= 0 && d < 5) {
          const c = candles[i - d];
          const e = ema200Aligned[i - d];
          if (isNumber(e) && c.close < e) {
            daysBelowEMA++;
          } else {
            break;
          }
          d++;
        }
      }

      const hmaGapVal = Math.abs((hma20Aligned[i] ?? 0) - (hma50Aligned[i] ?? 0));
      const atrVal = atrValue ?? 0;
      const isNarrowGap = atrVal > 0 && hmaGapVal < (0.3 * atrVal);
      const isWideGap = atrVal > 0 && hmaGapVal > (0.8 * atrVal);

      const adxVal = adxAligned[i]?.adx ?? 0;
      const isStrongTrend = adxVal >= 25;
      const isRange = adxVal < 20;

      // 2. Determine Grade
      // Default: Transition (Moderate)
      let label = "Trend Transition (Moderate)";
      let reason = "Trend breakdown pending confirmation.";

      if (daysBelowEMA >= 3 || (hmaBreak && isWideGap && isStrongTrend) || (chandelierBreak && isStrongTrend)) {
        // Strong: Sustained drop OR Strong breakdown momentum
        label = "Confirmed Trend Stop";
        reason = "Confirmed Trend Collapse (3+ days below EMA or High ADX breakdown).";
      } else if (isNarrowGap || isRange || (bearMask[i] && !isStrongTrend)) {
        // Weak: Noise / Range / Warning only
        label = "Trend Weakening (Weak)";
        reason = "Trend weakening warning (Narrow gap / Low ADX). Watch for bounce.";
      } else {
        // Moderate: Ambiguous / Transition
        label = "Trend Transition (Moderate)";
        reason = "Trend transition phase. Consider partial exit.";
      }

      sellCandidates.push({ label, reason });
    }

    if (bearMask[i]) {
      const confirmations = [
        obvBearMask[i],
        isNumber(rsiValue) && rsiValue >= rsiOverbought,
        isNumber(bbValue?.upper) && candle.high >= bbValue.upper,
        macdWeakening[i],
      ].filter(Boolean).length;
      const strength =
        confirmations >= 3 ? "Strong" : confirmations >= 2 ? "Moderate" : "Weak";
      sellCandidates.push({
        label: `Bear Divergence (${strength})`,
        reason: "Price higher high while RSI makes lower high.",
      });
    }

    const upgradedReversal =
      buyReversalWeak[i] && (bullMask[i] || obvBullMask[i]);

    // Lead Buy signals (early entries - higher priority)
    // V2.2: Filter out if signal candle is Doji, Shooting Star, or has long upper wick
    const leadCandleQuality = !candlePatterns.isDoji && !candlePatterns.isShootingStar && !candlePatterns.hasLongUpperWick;
    const leadStopPrice = isNumber(atrValue) ? candle.close - atrValue * 2 : undefined;
    if (leadTrendBuy[i] && !leadTrendBuy[i - 1] && leadCandleQuality) {
      buyCandidates.push({
        label: "Lead Buy (Aggressive)",
        reason: "HMA slope turn or Fast Stoch launch with volume confirmation.",
        stopLevel: leadStopPrice,
      });
    }

    if (kineticReversalBuy[i] && !kineticReversalBuy[i - 1]) {
      // V2.2: Require Hammer, Inverted Hammer, or Bullish Engulfing for confirmation
      const hasReversalCandle = candlePatterns.isHammer || candlePatterns.isInvertedHammer || candlePatterns.isBullishEngulfing;
      const hasMultipleConfirms =
        [stoppingVolume[i], bollingerTrap[i], bullMask[i], hasReversalCandle].filter(Boolean).length >= 2;

      // Only generate signal if confirmed by candle pattern OR multiple other confirms
      if (hasReversalCandle || hasMultipleConfirms) {
        const strength = hasReversalCandle && hasMultipleConfirms ? "Strong" : hasReversalCandle ? "Moderate" : "Weak";
        const reasons: string[] = [];
        if (stoppingVolume[i]) reasons.push("Stopping Volume");
        if (bollingerTrap[i]) reasons.push("Bollinger Trap");
        if (bullMask[i]) reasons.push("RSI Divergence");
        if (hasReversalCandle) {
          const patternName = candlePatterns.isHammer ? "Hammer" : candlePatterns.isBullishEngulfing ? "Bullish Engulfing" : "Inv. Hammer";
          reasons.push(patternName);
        }
        buyCandidates.push({
          label: `Kinetic Reversal (${strength})`,
          reason: reasons.join(" + ") || "Bottom reversal pattern detected.",
          stopLevel: leadStopPrice,
        });
      }
    }

    const hma50StopPrice = hma50Aligned[i];
    if (buyTrendStrong[i]) {
      buyCandidates.push({
        label: "Trend Buy (Strong)",
        reason:
          "HMA20>HMA50 with RSI>50 and MACD>Signal plus EMA200/ADX/CI/volume confirmation.",
        stopLevel: isNumber(hma50StopPrice) ? hma50StopPrice : undefined,
      });
    }

    if (buyReversalStrong[i] || upgradedReversal) {
      const reason = upgradedReversal
        ? "Oversold bounce upgraded by divergence confirmation."
        : "Oversold bounce with range/volume/divergence confirmation.";
      buyCandidates.push({ label: "Reversal Buy (Strong)", reason });
    }

    if (buyTrendModerate[i]) {
      buyCandidates.push({
        label: "Trend Buy (Moderate)",
        reason: "Trend cross with 2-3 confirmation filters.",
      });
    }

    if (buyReversalModerate[i]) {
      buyCandidates.push({
        label: "Reversal Buy (Moderate)",
        reason: "Oversold bounce with 2-3 confirmation filters.",
      });
    }

    if (buyTrendWeak[i]) {
      // V2.1: Trend Filter - suppress weak signals in strong downtrend
      const adxVal = adxAligned[i]?.adx ?? 0;
      const inStrongDowntrend =
        adxVal > 25 && isNumber(ema200Value) && candle.close < ema200Value;
      if (inStrongDowntrend) {
        // Skip weak trend buy in strong downtrend unless there's divergence
        if (!bullMask[i] && !obvBullMask[i]) {
          // Suppress this signal
        } else {
          buyCandidates.push({
            label: "Trend Buy (Weak + Divergence)",
            reason: "Weak trend entry confirmed by divergence in downtrend.",
          });
        }
      } else {
        const reason = isChoppy
          ? "Trend cross in choppy regime (aggressive entry)."
          : "HMA20>HMA50 with RSI>50 and MACD>Signal (early trend).";
        buyCandidates.push({ label: "Trend Buy (Weak)", reason });
      }
    }

    // V2.1: Capitulation Buy signal (watch/alert only)
    // V2.2: Entry trigger on reversal candle after capitulation
    if (capitulation[i] && !capitulation[i - 1]) {
      buyCandidates.push({
        label: "Capitulation (Watch)",
        reason: "Panic selling detected (Vol > 3x, RSI < 20). Wait for bounce confirmation.",
      });
    }
    // V2.2: Capitulation entry trigger - buy when reversal candle forms after capitulation alert
    const recentCapitulation = i >= 3 && capitulation.slice(i - 3, i).some(Boolean);
    if (recentCapitulation && (candlePatterns.isHammer || candlePatterns.isBullishEngulfing)) {
      buyCandidates.unshift({
        label: "Capitulation Entry (Candle Confirmed)",
        reason: `Reversal candle (${candlePatterns.isHammer ? "Hammer" : "Bullish Engulfing"}) after capitulation.`,
        stopLevel: candle.low,
      });
    }

    if (buyReversalWeak[i] && !upgradedReversal) {
      // V2.1: Also apply trend filter to weak reversals
      // V2.2: Upgrade if accompanied by Morning Star
      const adxVal = adxAligned[i]?.adx ?? 0;
      const inStrongDowntrend =
        adxVal > 25 && isNumber(ema200Value) && candle.close < ema200Value;
      if (!inStrongDowntrend || bullMask[i] || obvBullMask[i]) {
        if (candlePatterns.isMorningStar) {
          buyCandidates.push({
            label: "Reversal Buy (Moderate + Morning Star)",
            reason: "Weak reversal upgraded by Morning Star pattern.",
          });
        } else {
          buyCandidates.push({
            label: "Reversal Buy (Weak)",
            reason: "Oversold bounce confirmation.",
          });
        }
      }
    }

    if (bullMask[i]) {
      buyCandidates.push({
        label: "Bull Divergence",
        reason: "Price lower low while RSI makes higher low.",
      });
    }

    if (obvBullMask[i]) {
      buyCandidates.push({
        label: "OBV Bull Divergence",
        reason: "Price lower low while OBV makes higher low.",
      });
    }

    // V2.3: Standalone Candlestick Signals (Price Action)
    // Higher priority than Weak/Scout signals, but typically lower than Trend/Lead
    if (candlePatterns.isMorningStar && hasVolume) {
      buyCandidates.unshift({
        label: "Candle Pattern: Morning Star",
        reason: "Strong bullish reversal pattern (Morning Star) with volume.",
        stopLevel: Math.min(candle.low, candles[i - 1].low, candles[i - 2].low),
      });
    } else if (candlePatterns.isBullishEngulfing && isNumber(rsiValue) && rsiValue < 70 && hasVolume) {
      buyCandidates.push({
        label: "Candle Pattern: Bullish Engulfing",
        reason: "Bullish engulfing pattern with volume.",
        stopLevel: candle.low,
      });
    } else if (candlePatterns.isHammer && isNumber(rsiValue) && rsiValue < 45 && hasVolume) {
      buyCandidates.push({
        label: "Candle Pattern: Hammer",
        reason: "Hammer at potential bottom (RSI < 45) with volume.",
        stopLevel: candle.low,
      });
    }

    if (candlePatterns.isEveningStar && hasVolume) {
      sellCandidates.unshift({
        label: "Candle Pattern: Evening Star",
        reason: "Strong bearish reversal pattern (Evening Star) with volume.",
      });
    } else if (candlePatterns.isBearishEngulfing && isNumber(rsiValue) && rsiValue > 30 && hasVolume) {
      sellCandidates.push({
        label: "Candle Pattern: Bearish Engulfing",
        reason: "Bearish engulfing pattern with volume.",
      });
    } else if (candlePatterns.isShootingStar && isNumber(rsiValue) && rsiValue > 55 && hasVolume) {
      sellCandidates.push({
        label: "Candle Pattern: Shooting Star",
        reason: "Shooting Star at potential top (RSI > 55) with volume.",
      });
    }

    const bullTrapLevelIndex = swingTrapBullLevelIndex[i];
    const bearTrapLevelIndex = swingTrapBearLevelIndex[i];
    const hasBullTrap =
      swingTrapBull[i] &&
      bullTrapLevelIndex !== null &&
      bullTrapLevelIndex !== lastBullTrapLevelIndex;
    const hasBearTrap =
      swingTrapBear[i] &&
      bearTrapLevelIndex !== null &&
      bearTrapLevelIndex !== lastBearTrapLevelIndex;

    if (hasBullTrap) {
      buyCandidates.unshift({
        label: "Swing Trap BUY",
        reason:
          swingTrapBullReason[i] ??
          `Liquidity sweep reclaimed with confirmation score ${swingTrapBullScore[i]}/4.`,
        stopLevel:
          swingTrapBullStop[i] ??
          (isNumber(atrValue) ? candle.low - atrValue * 0.25 : candle.low - candle.close * 0.005),
        profile: swingTrapBullProfile[i] ?? "base-panic",
      });
    }
    if (hasBearTrap) {
      sellCandidates.unshift({
        label: "Swing Trap SELL",
        reason:
          swingTrapBearReason[i] ??
          `Liquidity sweep rejected with confirmation score ${swingTrapBearScore[i]}/4.`,
      });
    }

    if (!hasBullTrap) {
      buyCandidates.length = 0;
    }
    if (!hasBearTrap) {
      sellCandidates.length = 0;
    }
    if (!hasBullTrap && !hasBearTrap) {
      continue;
    }

    const preferSellTrap =
      hasBearTrap &&
      (!hasBullTrap || swingTrapBearScore[i] >= swingTrapBullScore[i]);
    if (preferSellTrap) {
      buyCandidates.length = 0;
    } else {
      sellCandidates.length = 0;
    }

    const hasRecentSell = i - lastSellIndex < sellCooldown;
    const sellStateBlocked =
      signalState === "short" &&
      (bearTrapLevelIndex === null || bearTrapLevelIndex === lastBearTrapLevelIndex);
    const buyStateBlocked =
      signalState === "long" &&
      (bullTrapLevelIndex === null || bullTrapLevelIndex === lastBullTrapLevelIndex);

    if (sellCandidates.length) {
      if (hasRecentSell) {
        swingTrapDebug.bearRejectedByCooldown += 1;
      } else if (sellStateBlocked) {
        swingTrapDebug.bearRejectedByState += 1;
      } else {
        const chosen = sellCandidates[0];
        signals.push({
          time: candle.time,
          type: "sell",
          label: chosen.label,
          reason: chosen.reason,
        });
        lastSellIndex = i;
        signalState = "short";
        swingTrapDebug.bearSignalsEmitted += 1;
        if (bearTrapLevelIndex !== null) {
          lastBearTrapLevelIndex = bearTrapLevelIndex;
        }
      }
      continue;
    }

    if (buyCandidates.length) {
      const chosen = buyCandidates[0];
      const chosenBuyCooldown =
        chosen.profile === "growth-reset"
          ? growthBuyCooldown
          : baseBuyCooldown;
      const hasRecentBuy = i - lastBuyIndex < chosenBuyCooldown;
      const blockedBySellCooldown =
        chosen.profile === "growth-reset" ? false : hasRecentSell;
      const hasRecentGrowthBuy =
        chosen.profile === "growth-reset" &&
        i - lastGrowthBuyIndex < growthBuyCooldown;

      if (hasRecentBuy || blockedBySellCooldown) {
        swingTrapDebug.bullRejectedByCooldown += 1;
        if (hasRecentGrowthBuy) {
          swingTrapDebug.bullGrowthProfileClusterSuppressed += 1;
        }
      } else if (buyStateBlocked) {
        swingTrapDebug.bullRejectedByState += 1;
      } else {
        signals.push({
          time: candle.time,
          type: "buy",
          label: chosen.label,
          reason: chosen.reason,
          stopLevel: chosen.stopLevel,
        });
        lastBuyIndex = i;
        if (chosen.profile === "growth-reset") {
          lastGrowthBuyIndex = i;
        }
        signalState = "long";
        emittedBuyMask[i] = true;
        swingTrapDebug.bullSignalsEmitted += 1;
        if (bullTrapLevelIndex !== null) {
          lastBullTrapLevelIndex = bullTrapLevelIndex;
        }
      }
    }
  }

  const visibleCandles = candles.slice(visibleStartIndex);
  const visibleSignals = signals.filter((signal) => signal.time >= requestedStartUnix);
  const trendFollowingSignals = calculateTrendFollowingSignals({
    candles,
    sma5: sma5Aligned,
    sma20: sma20Aligned,
    sma50: sma50Aligned,
    volumeMa20: volMa20Aligned,
    includeDiagnostics: debugMode || diagMode,
  });
  const trendFollowing = {
    ...trendFollowingSignals,
    primaryTimeframe: "1d",
    currentTimeframe: timeframeParam,
    role: trendFollowingRole,
    signals: trendFollowingSignals.signals.filter(
      (signal) => signal.time >= requestedStartUnix,
    ),
  };
  const breakoutRule = calculateBreakoutRule({
    candles,
    sma20: sma20Aligned,
  });
  const latestCandle = candles[candles.length - 1];
  const latestSma5 = sma5Aligned[sma5Aligned.length - 1] ?? null;
  const latestSma20 = sma20Aligned[sma20Aligned.length - 1] ?? null;
  const recentLow10 = candles.length
    ? Math.min(...candles.slice(-10).map((candle) => candle.low))
    : null;
  const recentHigh20 = candles.length
    ? Math.max(...candles.slice(-20).map((candle) => candle.high))
    : null;
  const tradeSetupStopCandidates = [
    latestSma20 ? latestSma20 * 0.985 : null,
    isNumber(recentLow10) ? recentLow10 : null,
  ].filter(isNumber);
  const tradeSetup = buildTradeSetup({
    decision:
      breakoutRule.status === "risk-off"
        ? "avoid"
        : breakoutRule.status === "profit-tracking"
          ? "hold"
          : breakoutRule.status === "breakout-ready"
            ? "enter"
            : "watch",
    price: latestCandle?.close ?? null,
    breakoutRule,
    risk: {
      stopPrice: tradeSetupStopCandidates.length ? Math.min(...tradeSetupStopCandidates) : null,
    },
    levels: {
      sma5: latestSma5,
      sma20: latestSma20,
      aggressiveEntryLow: latestSma5 ? latestSma5 * 0.99 : null,
      aggressiveEntryHigh: latestSma5 ? latestSma5 * 1.015 : null,
      conservativeEntryLow: latestSma20 ? latestSma20 * 0.985 : null,
      conservativeEntryHigh: latestSma20 ? latestSma20 * 1.02 : null,
      newEntryStop: tradeSetupStopCandidates.length ? Math.min(...tradeSetupStopCandidates) : null,
      breakoutPrice: recentHigh20,
    },
  });
  const { chartQuality, patternSignals, breakoutSignal } = calculatePatternSignals({
    candles,
    sma5: sma5Aligned,
    sma20: sma20Aligned,
    sma50: sma50Aligned,
    volumeMa20: volMa20Aligned,
    breakoutRule,
    tradeSetup,
  });
  const signalReliability = calculateSignalReliability({
    candles,
    sma5: sma5Aligned,
    sma20: sma20Aligned,
    sma50: sma50Aligned,
    volumeMa20: volMa20Aligned,
    patternSignals,
    breakoutSignal,
  });
  const visibleEmittedBuyMask = emittedBuyMask.slice(visibleStartIndex);
  const visibleDailySetupDetected = dailySetupDetected.slice(visibleStartIndex);
  const visibleGrowthEligibleBars = growthProfileEligibleMask
    .slice(visibleStartIndex)
    .filter(Boolean).length;
  const payload = {
    symbol: sanitizedSymbol,
    candles: visibleCandles,
    indicators: {
      sma: {
        "5": filterTimedSeries(alignSeries(candles, sma5), requestedStartUnix),
        "20": filterTimedSeries(sma20Series, requestedStartUnix),
        "60": filterTimedSeries(alignSeries(candles, sma60), requestedStartUnix),
        "100": filterTimedSeries(alignSeries(candles, sma100), requestedStartUnix),
      },
      rsi: filterTimedSeries(rsiSeries, requestedStartUnix),
      bbands: {
        upper: filterTimedSeries(
          alignSeries(candles, bbands.map((value) => value.upper)),
          requestedStartUnix,
        ),
        middle: filterTimedSeries(
          alignSeries(candles, bbands.map((value) => value.middle)),
          requestedStartUnix,
        ),
        lower: filterTimedSeries(
          alignSeries(candles, bbands.map((value) => value.lower)),
          requestedStartUnix,
        ),
      },
      psar: filterTimedSeries(alignSeries(candles, psar), requestedStartUnix),
      adx: filterTimedSeries(
        alignSeries(candles, adx.map((value) => value.adx)),
        requestedStartUnix,
      ),
      atrStops: {
        upper: filterTimedSeries(atrUpperSeries, requestedStartUnix),
        lower: filterTimedSeries(atrLowerSeries, requestedStartUnix),
      },
      chandelier: {
        long: filterTimedSeries(chandelierSeries.long, requestedStartUnix),
        short: filterTimedSeries(chandelierSeries.short, requestedStartUnix),
      },
    },
    signals: visibleSignals,
    trendFollowing,
    breakoutRule,
    tradeSetup,
    chartQuality,
    patternSignals,
    breakoutSignal,
    signalReliability,
  };

  if (!debugMode) {
    return Response.json(payload);
  }

  const debugMeta: {
    timeframe: string;
    swingTrap: {
      lookbackBars: number;
      minLevelAge: number;
      minWickPct: number;
      minPenetrationPct: number;
      cooldownBars: number;
    };
    counters: typeof swingTrapDebug;
    bottomCapture?: ReturnType<typeof calculateBottomCapture>;
    dailyQuality?: ReturnType<typeof calculateDailyQuality>;
    dailyBottomStudy?: ReturnType<typeof calculateDailyBottomStudy>;
    dailyProfile?: {
      type: "base panic" | "growth reset";
      isCrypto: boolean;
      growthGateThresholdPct: number;
      latestRollingAtrMedianPct: number | null;
      eligibleBars: number;
    };
  } = {
    timeframe: timeframeParam,
    swingTrap: {
      lookbackBars,
      minLevelAge,
      minWickPct,
      minPenetrationPct,
      cooldownBars: swingTrapCooldown,
    },
    counters: swingTrapDebug,
  };
  if (diagMode) {
    debugMeta.bottomCapture = calculateBottomCapture(visibleCandles, visibleEmittedBuyMask, 3);
    if (isDailyTimeframe) {
      debugMeta.dailyProfile = {
        type: dailyProfileType as "base panic" | "growth reset",
        isCrypto: symbolIsCrypto,
        growthGateThresholdPct: growthProfileAtrGatePct,
        latestRollingAtrMedianPct: latestRollingAtrPctMedian,
        eligibleBars: visibleGrowthEligibleBars,
      };
      debugMeta.dailyQuality = calculateDailyQuality(visibleCandles, visibleSignals, 3);
      debugMeta.dailyBottomStudy = calculateDailyBottomStudy(
        visibleCandles,
        visibleSignals,
        visibleDailySetupDetected,
        visibleEmittedBuyMask,
        3,
      );
    }
  }

  return Response.json({
    ...payload,
    debugMeta,
  });
}
