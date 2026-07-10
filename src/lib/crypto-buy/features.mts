import {
  ATR,
  BollingerBands,
  EMA,
  RSI,
  SMA,
} from "technicalindicators";

import type {
  BacktestConfig,
  CryptoBar,
  CryptoFeatureRow,
  SignalSide,
  CryptoParentTimeframe,
  CryptoInterval,
  LowerTfConfirmation,
  SignalFamily,
  TradeDirection,
} from "./types.mts";

const EPSILON = 1e-9;

type ParentProfile = {
  return3Threshold: number;
  return5Threshold: number;
  return3UpThreshold: number;
  return5UpThreshold: number;
  volumeRatioThreshold: number;
  volumeRatioBonusThreshold: number;
  rsi7OversoldThreshold: number;
  rsi7OverboughtThreshold: number;
  rsi14Threshold: number;
  rsi14BonusThreshold: number;
  rsi14OverboughtThreshold: number;
  rsi14OverboughtBonusThreshold: number;
  zScoreThreshold: number;
  zScoreBonusThreshold: number;
  zScoreOverboughtThreshold: number;
  zScoreOverboughtBonusThreshold: number;
  flushRecoveryThreshold: number;
  weakLowerWickThreshold: number;
  reboundRecoveryThreshold: number;
  tightUpperWickThreshold: number;
  minParentScore: number;
};

type DailyLaneEvaluation = {
  flushSignal: boolean;
  reboundSignal: boolean;
  capitulationSignal: boolean;
  signalFamily: SignalFamily | null;
  signalLane:
    | "flush"
    | "clean-rebound"
    | "extreme-reversal"
    | "capitulation-core"
    | "capitulation-alt"
    | null;
  lowerTfGate: boolean;
  lowerTfMode: "pass" | "depth-override" | "fail";
  setupPanicPassed: boolean;
};

type SellLaneEvaluation = {
  rejectionSignal: boolean;
  upthrustSignal: boolean;
  blowoffSignal: boolean;
  signalFamily: SignalFamily | null;
  signalLane:
    | "clean-rejection"
    | "rejection-confirm"
    | "upthrust-reversal"
    | "blowoff-capitulation"
    | null;
  lowerTfGate: boolean;
  lowerTfMode: "pass" | "depth-override" | "fail";
  setupPanicPassed: boolean;
};

type SellWarningEvaluation = {
  level: 0 | 1 | 2 | 3;
  reasons: string[];
};

const PARENT_PROFILES: Record<CryptoParentTimeframe, ParentProfile> = {
  "1d": {
    return3Threshold: -0.075,
    return5Threshold: -0.075,
    return3UpThreshold: 0.075,
    return5UpThreshold: 0.075,
    volumeRatioThreshold: 1.4,
    volumeRatioBonusThreshold: 2.4,
    rsi7OversoldThreshold: 30,
    rsi7OverboughtThreshold: 70,
    rsi14Threshold: 34,
    rsi14BonusThreshold: 30,
    rsi14OverboughtThreshold: 66,
    rsi14OverboughtBonusThreshold: 70,
    zScoreThreshold: -1.2,
    zScoreBonusThreshold: -2,
    zScoreOverboughtThreshold: 1.2,
    zScoreOverboughtBonusThreshold: 2,
    flushRecoveryThreshold: 0.35,
    weakLowerWickThreshold: 0.75,
    reboundRecoveryThreshold: 0.45,
    tightUpperWickThreshold: 0.75,
    minParentScore: 7,
  },
  "4h": {
    return3Threshold: -0.05,
    return5Threshold: -0.06,
    return3UpThreshold: 0.05,
    return5UpThreshold: 0.06,
    volumeRatioThreshold: 1.6,
    volumeRatioBonusThreshold: 2.6,
    rsi7OversoldThreshold: 28,
    rsi7OverboughtThreshold: 72,
    rsi14Threshold: 36,
    rsi14BonusThreshold: 32,
    rsi14OverboughtThreshold: 64,
    rsi14OverboughtBonusThreshold: 68,
    zScoreThreshold: -1.35,
    zScoreBonusThreshold: -2.1,
    zScoreOverboughtThreshold: 1.35,
    zScoreOverboughtBonusThreshold: 2.1,
    flushRecoveryThreshold: 0.35,
    weakLowerWickThreshold: 0.9,
    reboundRecoveryThreshold: 0.48,
    tightUpperWickThreshold: 0.9,
    minParentScore: 7,
  },
};

export const evaluateDailySignalLanes = ({
  panicPassed,
  oversoldCount,
  rangeReentry,
  recoveryRatio,
  wickBodyRatio,
  upperWickBodyRatio,
  flushSignalBase,
  volumeRatio20,
  breakdownDepth20,
  primaryLowerTfPassed,
  primaryLowerTfBreakdownDepth20,
  return3,
  return5,
  rsi14,
}: {
  panicPassed: boolean;
  oversoldCount: number;
  rangeReentry: boolean;
  recoveryRatio: number;
  wickBodyRatio: number;
  upperWickBodyRatio: number;
  flushSignalBase: boolean;
  volumeRatio20: number | null;
  breakdownDepth20: number | null;
  primaryLowerTfPassed: boolean;
  primaryLowerTfBreakdownDepth20: number | null;
  return3: number | null;
  return5: number | null;
  rsi14: number | null;
}): DailyLaneEvaluation => {
  const hasPrimaryDepth =
    typeof primaryLowerTfBreakdownDepth20 === "number";
  const primaryDepthOverride =
    !primaryLowerTfPassed &&
    hasPrimaryDepth &&
    primaryLowerTfBreakdownDepth20 >= 0.08;
  const flushSignal =
    flushSignalBase &&
    rangeReentry &&
    oversoldCount === 3 &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 1.8 &&
    typeof breakdownDepth20 === "number" &&
    breakdownDepth20 >= 0.02 &&
    primaryLowerTfPassed &&
    hasPrimaryDepth &&
    primaryLowerTfBreakdownDepth20 >= 0.02;
  const cleanReboundSignal =
    rangeReentry &&
    recoveryRatio >= 0.55 &&
    upperWickBodyRatio <= 0.3 &&
    wickBodyRatio <= 2;
  const extremeReversalSignal =
    oversoldCount === 3 &&
    !rangeReentry &&
    recoveryRatio >= 0.45 &&
    upperWickBodyRatio <= 0.1 &&
    typeof return3 === "number" &&
    return3 <= -0.1 &&
    typeof return5 === "number" &&
    return5 <= -0.1 &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 2.5 &&
    typeof rsi14 === "number" &&
    rsi14 <= 37 &&
    (primaryLowerTfPassed || primaryDepthOverride);
  const coreCapitulationSignal =
    panicPassed &&
    oversoldCount === 3 &&
    primaryLowerTfPassed &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 3.5 &&
    hasPrimaryDepth &&
    primaryLowerTfBreakdownDepth20 >= 0.06;
  const altCapitulationSignal =
    oversoldCount === 3 &&
    typeof return3 === "number" &&
    return3 <= -0.1 &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 4 &&
    typeof rsi14 === "number" &&
    rsi14 <= 35 &&
    typeof breakdownDepth20 === "number" &&
    breakdownDepth20 >= 0.1 &&
    primaryLowerTfPassed &&
    hasPrimaryDepth &&
    primaryLowerTfBreakdownDepth20 >= 0.08;
  const reboundSignal = cleanReboundSignal || extremeReversalSignal;
  const capitulationSignal =
    coreCapitulationSignal || altCapitulationSignal;
  const signalLane = altCapitulationSignal
    ? "capitulation-alt"
    : coreCapitulationSignal
      ? "capitulation-core"
      : flushSignal
        ? "flush"
        : extremeReversalSignal
          ? "extreme-reversal"
          : cleanReboundSignal
            ? "clean-rebound"
            : null;
  const signalFamily: SignalFamily | null =
    signalLane === "capitulation-alt" || signalLane === "capitulation-core"
      ? "capitulation"
      : signalLane === "flush"
        ? "flush"
        : signalLane === "clean-rebound" || signalLane === "extreme-reversal"
          ? "rebound"
          : null;
  const lowerTfMode =
    signalLane === "extreme-reversal" && primaryDepthOverride
      ? "depth-override"
      : primaryLowerTfPassed
        ? "pass"
        : "fail";

  return {
    flushSignal,
    reboundSignal,
    capitulationSignal,
    signalFamily,
    signalLane,
    lowerTfGate:
      primaryLowerTfPassed ||
      (signalLane === "extreme-reversal" && primaryDepthOverride),
    lowerTfMode,
    setupPanicPassed:
      panicPassed || extremeReversalSignal || altCapitulationSignal,
  };
};

export const evaluateSellSignalLanes = ({
  panicUpPassed,
  overboughtCount,
  return5,
  rangeReject,
  rejectionRatio,
  recoveryRatio,
  wickBodyRatio,
  upperWickBodyRatio,
  volumeRatio20,
  breakoutDepth20,
  primaryLowerTfPassed,
  primaryLowerTfExcursionDepth20,
  recentOverboughtWithin2,
  recentBreakoutSeenWithin2,
  previousBreakoutHold,
  previousStrongBreakoutSeenWithin2,
  currentBreakoutConfirm,
  currentStrongBreakout,
}: {
  panicUpPassed: boolean;
  overboughtCount: number;
  return5: number | null;
  rangeReject: boolean;
  rejectionRatio: number;
  recoveryRatio: number;
  wickBodyRatio: number;
  upperWickBodyRatio: number;
  volumeRatio20: number | null;
  breakoutDepth20: number | null;
  primaryLowerTfPassed: boolean;
  primaryLowerTfExcursionDepth20: number | null;
  recentOverboughtWithin2: boolean;
  recentBreakoutSeenWithin2: boolean;
  previousBreakoutHold: boolean;
  previousStrongBreakoutSeenWithin2: boolean;
  currentBreakoutConfirm: boolean;
  currentStrongBreakout: boolean;
}): SellLaneEvaluation => {
  const hasPrimaryDepth = typeof primaryLowerTfExcursionDepth20 === "number";
  const primaryDepthOverride =
    !primaryLowerTfPassed &&
    hasPrimaryDepth &&
    primaryLowerTfExcursionDepth20 >= 0.08;
  const cleanRejectionSignal =
    rangeReject &&
    rejectionRatio >= 0.55 &&
    wickBodyRatio <= 0.3 &&
    upperWickBodyRatio <= 2 &&
    primaryLowerTfPassed;
  const standardRejectionConfirmSignal =
    rangeReject &&
    rejectionRatio >= (previousBreakoutHold ? 0.42 : 0.45) &&
    wickBodyRatio <= 3 &&
    upperWickBodyRatio <= 5 &&
    primaryLowerTfPassed &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 <= 1.6 &&
    recentOverboughtWithin2 &&
    overboughtCount <= 2 &&
    typeof return5 === "number" &&
    return5 <= 0.08 &&
    (previousBreakoutHold || recentBreakoutSeenWithin2 || currentBreakoutConfirm);
  const dojiRejectionConfirmSignal =
    rangeReject &&
    rejectionRatio >= 0.7 &&
    recoveryRatio <= 0.35 &&
    primaryLowerTfPassed &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 <= 1.6 &&
    (previousBreakoutHold || previousStrongBreakoutSeenWithin2 || currentStrongBreakout) &&
    (recentOverboughtWithin2 || currentStrongBreakout);
  const rejectionConfirmSignal =
    standardRejectionConfirmSignal || dojiRejectionConfirmSignal;
  const rejectionSignal = cleanRejectionSignal || rejectionConfirmSignal;
  const upthrustSignal =
    overboughtCount === 3 &&
    typeof breakoutDepth20 === "number" &&
    breakoutDepth20 >= 0.05 &&
    rangeReject &&
    rejectionRatio >= 0.45 &&
    upperWickBodyRatio >= 0.8 &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 2 &&
    panicUpPassed &&
    (primaryLowerTfPassed || primaryDepthOverride);
  const blowoffSignal =
    overboughtCount === 3 &&
    panicUpPassed &&
    typeof volumeRatio20 === "number" &&
    volumeRatio20 >= 3.5 &&
    typeof breakoutDepth20 === "number" &&
    breakoutDepth20 >= 0.08 &&
    primaryLowerTfPassed;
  const signalLane = blowoffSignal
    ? "blowoff-capitulation"
    : upthrustSignal
      ? "upthrust-reversal"
      : cleanRejectionSignal
        ? "clean-rejection"
        : rejectionConfirmSignal
          ? "rejection-confirm"
        : null;
  const signalFamily: SignalFamily | null =
    signalLane === "blowoff-capitulation"
      ? "blowoff"
      : signalLane === "upthrust-reversal"
        ? "upthrust"
        : signalLane === "clean-rejection" || signalLane === "rejection-confirm"
          ? "rejection"
          : null;
  const lowerTfMode =
    signalLane === "upthrust-reversal" && primaryDepthOverride
      ? "depth-override"
      : primaryLowerTfPassed
        ? "pass"
        : "fail";

  return {
    rejectionSignal,
    upthrustSignal,
    blowoffSignal,
    signalFamily,
    signalLane,
    lowerTfGate:
      primaryLowerTfPassed ||
      (signalLane === "upthrust-reversal" && primaryDepthOverride),
    lowerTfMode,
    setupPanicPassed:
      rejectionSignal || upthrustSignal || blowoffSignal || panicUpPassed,
  };
};

export const evaluateSellWarning = ({
  side,
  liquidityPassed,
  overboughtCount,
  recentOverboughtWithin2,
  recentBreakoutSeenWithin2,
  previousBreakoutHold,
  previousStrongBreakoutSeenWithin2,
  rangeReject,
  breakoutDepth20,
  upperWickBodyRatio,
  rejectionRatio,
  primaryLowerTfPassed,
  primaryLowerTfExcursionDepth20,
}: {
  side: SignalSide;
  liquidityPassed: boolean;
  overboughtCount: number;
  recentOverboughtWithin2: boolean;
  recentBreakoutSeenWithin2: boolean;
  previousBreakoutHold: boolean;
  previousStrongBreakoutSeenWithin2: boolean;
  rangeReject: boolean;
  breakoutDepth20: number | null;
  upperWickBodyRatio: number;
  rejectionRatio: number;
  primaryLowerTfPassed: boolean;
  primaryLowerTfExcursionDepth20: number | null;
}): SellWarningEvaluation => {
  if (side !== "sell" || !liquidityPassed) {
    return { level: 0, reasons: [] };
  }

  const priorBreakoutPressure = previousBreakoutHold || recentBreakoutSeenWithin2;
  const strongBreakoutPressure =
    previousStrongBreakoutSeenWithin2 ||
    (typeof breakoutDepth20 === "number" && breakoutDepth20 >= 0.012);
  const failedBreakoutConfirmed =
    rejectionRatio >= 0.5 ||
    upperWickBodyRatio >= 1.4 ||
    (rangeReject &&
      typeof breakoutDepth20 === "number" &&
      breakoutDepth20 <= 0.005);
  const level1Base =
    recentOverboughtWithin2 &&
    priorBreakoutPressure &&
    primaryLowerTfPassed &&
    failedBreakoutConfirmed;
  const level1 =
    level1Base &&
    (rejectionRatio >= 0.5 || upperWickBodyRatio >= 1.4);
  const level2 =
    level1 &&
    strongBreakoutPressure &&
    rejectionRatio >= 0.58;
  const level3 =
    level2 &&
    typeof primaryLowerTfExcursionDepth20 === "number" &&
    primaryLowerTfExcursionDepth20 >= 0.05 &&
    (upperWickBodyRatio >= 1.3 || rejectionRatio >= 0.55);
  const level: 0 | 1 | 2 | 3 = level3 ? 3 : level2 ? 2 : level1 ? 1 : 0;

  if (level === 0) {
    return { level, reasons: [] };
  }

  const reasons: string[] = [];
  if (recentOverboughtWithin2 || overboughtCount >= 2) {
    reasons.push("overbought-pressure");
  }
  if (priorBreakoutPressure) {
    reasons.push("prior-breakout-pressure");
  }
  if (typeof breakoutDepth20 === "number" && breakoutDepth20 >= 0.012) {
    reasons.push("breakout-depth");
  }
  if (upperWickBodyRatio >= 1.4) {
    reasons.push("upper-wick-pressure");
  }
  if (rejectionRatio >= 0.5) {
    reasons.push("rejection-pressure");
  }
  if (primaryLowerTfPassed) {
    reasons.push("lower-tf-pass");
  }
  if (strongBreakoutPressure) {
    reasons.push("strong-breakout");
  }
  if (rangeReject) {
    reasons.push("range-reject");
  }

  return {
    level,
    reasons,
  };
};

const alignValues = <T,>(length: number, values: T[]) => {
  const offset = Math.max(length - values.length, 0);
  return Array.from({ length }, (_, index) =>
    index < offset ? null : values[index - offset],
  );
};

const calculateRollingStdDev = (values: number[], period: number) => {
  const result = new Array<number | null>(values.length).fill(null);

  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const mean =
      window.reduce((sum, value) => sum + value, 0) / Math.max(window.length, 1);
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(window.length, 1);
    result[index] = Math.sqrt(variance);
  }

  return result;
};

const calculatePreviousAverage = (values: number[], period: number) => {
  const result = new Array<number | null>(values.length).fill(null);
  let runningSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      runningSum += values[index - 1];
    }
    if (index - 1 >= period) {
      runningSum -= values[index - period - 1];
    }
    if (index >= period) {
      result[index] = runningSum / period;
    }
  }

  return result;
};

const calculateInclusiveAverage = (values: Array<number | null>, period: number) => {
  const result = new Array<number | null>(values.length).fill(null);
  let runningSum = 0;
  let validCount = 0;

  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (typeof current === "number" && Number.isFinite(current)) {
      runningSum += current;
      validCount += 1;
    }

    const staleIndex = index - period;
    if (staleIndex >= 0) {
      const staleValue = values[staleIndex];
      if (typeof staleValue === "number" && Number.isFinite(staleValue)) {
        runningSum -= staleValue;
        validCount -= 1;
      }
    }

    if (index >= period - 1 && validCount === period) {
      result[index] = runningSum / period;
    }
  }

  return result;
};

const calculatePreviousRollingMin = (values: number[], period: number) => {
  const result = new Array<number | null>(values.length).fill(null);

  for (let index = period; index < values.length; index += 1) {
    const window = values.slice(index - period, index);
    result[index] = Math.min(...window);
  }

  return result;
};

const calculatePreviousRollingMax = (values: number[], period: number) => {
  const result = new Array<number | null>(values.length).fill(null);

  for (let index = period; index < values.length; index += 1) {
    const window = values.slice(index - period, index);
    result[index] = Math.max(...window);
  }

  return result;
};

export const forwardFillHigherTimeframe = ({
  lowerTimeframeBars,
  higherTimeframeBars,
  higherCloseValues,
  higherEma50Values,
  higherRsi14Values,
}: {
  lowerTimeframeBars: CryptoBar[];
  higherTimeframeBars: CryptoBar[];
  higherCloseValues: Array<number | null>;
  higherEma50Values: Array<number | null>;
  higherRsi14Values: Array<number | null>;
}) => {
  const result = lowerTimeframeBars.map(() => ({
    close: null as number | null,
    ema50: null as number | null,
    rsi14: null as number | null,
  }));
  let cursor = -1;

  for (let index = 0; index < lowerTimeframeBars.length; index += 1) {
    const lowerBar = lowerTimeframeBars[index];
    while (
      cursor + 1 < higherTimeframeBars.length &&
      higherTimeframeBars[cursor + 1].closeTime <= lowerBar.closeTime
    ) {
      cursor += 1;
    }
    if (cursor < 0) {
      continue;
    }
    result[index] = {
      close: higherCloseValues[cursor],
      ema50: higherEma50Values[cursor],
      rsi14: higherRsi14Values[cursor],
    };
  }

  return result;
};

const createEmptyLowerTfConfirmation = (
  interval: CryptoInterval,
  required: boolean,
  direction: TradeDirection,
): LowerTfConfirmation => ({
  interval,
  required,
  direction,
  passed: false,
  triggeredBreak: false,
  lastRecovery: false,
  lastReentry: false,
  triggerTime: null,
  priorRangeLevel20: null,
  priorRangeLow20: null,
  lastChildClose: null,
  excursionDepth20: null,
  breakdownDepth20: null,
});

export const calculateLowerTfConfirmations = ({
  parentBars,
  childBars,
  interval,
  required,
  direction = "long",
}: {
  parentBars: CryptoBar[];
  childBars: CryptoBar[];
  interval: CryptoInterval;
  required: boolean;
  direction?: TradeDirection;
}) => {
  const rangeValues =
    direction === "long"
      ? childBars.map((bar) => bar.low)
      : childBars.map((bar) => bar.high);
  const priorRangeLevel20 =
    direction === "long"
      ? calculatePreviousRollingMin(rangeValues, 20)
      : calculatePreviousRollingMax(rangeValues, 20);
  const excursionDepth20 = childBars.map((bar, index) => {
    const priorLevel = priorRangeLevel20[index];
    if (typeof priorLevel !== "number") {
      return null;
    }
    return direction === "long"
      ? Math.max((priorLevel - bar.low) / (priorLevel + EPSILON), 0)
      : Math.max((bar.high - priorLevel) / (priorLevel + EPSILON), 0);
  });

  let childCursor = 0;

  return parentBars.map<LowerTfConfirmation>((parentBar) => {
    while (
      childCursor < childBars.length &&
      childBars[childCursor].closeTime < parentBar.openTime
    ) {
      childCursor += 1;
    }

    let scanIndex = childCursor;
    let lastClosedChildIndex = -1;
    let triggeredBreak = false;
    let triggerTime: number | null = null;
    let maxBreakdownDepth: number | null = null;

    while (
      scanIndex < childBars.length &&
      childBars[scanIndex].closeTime <= parentBar.closeTime
    ) {
      const childBar = childBars[scanIndex];
      if (childBar.openTime >= parentBar.openTime) {
        lastClosedChildIndex = scanIndex;
        const depth = excursionDepth20[scanIndex];
        if (typeof depth === "number" && depth > 0) {
          triggeredBreak = true;
          triggerTime ??= childBar.closeTime;
          maxBreakdownDepth =
            maxBreakdownDepth === null ? depth : Math.max(maxBreakdownDepth, depth);
        }
      }
      scanIndex += 1;
    }

    if (lastClosedChildIndex < 0) {
      return createEmptyLowerTfConfirmation(interval, required, direction);
    }

    const lastChild = childBars[lastClosedChildIndex];
    const priorLevel = priorRangeLevel20[lastClosedChildIndex];
    const lastRecovery =
      typeof priorLevel === "number"
        ? direction === "long"
          ? lastChild.close >= priorLevel
          : lastChild.close <= priorLevel
        : false;

    return {
      interval,
      required,
      direction,
      passed: triggeredBreak && lastRecovery,
      triggeredBreak,
      lastRecovery,
      lastReentry: lastRecovery,
      triggerTime,
      priorRangeLevel20: priorLevel,
      priorRangeLow20: priorLevel,
      lastChildClose: lastChild.close,
      excursionDepth20: maxBreakdownDepth,
      breakdownDepth20: maxBreakdownDepth,
    };
  });
};

export const calculateCryptoFeatures = ({
  bars,
  side = "buy",
  parentTimeframe,
  config,
  primaryLowerTfConfirmations,
  secondaryLowerTfConfirmations,
}: {
  bars: CryptoBar[];
  side?: SignalSide;
  parentTimeframe: CryptoParentTimeframe;
  config: BacktestConfig;
  primaryLowerTfConfirmations: LowerTfConfirmation[];
  secondaryLowerTfConfirmations: LowerTfConfirmation[];
}) => {
  const profile = PARENT_PROFILES[parentTimeframe];
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);
  const quoteVolumes = bars.map((bar) =>
    bar.quoteVolume > 0 ? bar.quoteVolume : bar.close * bar.volume,
  );

  const rsi7 = alignValues(
    bars.length,
    RSI.calculate({ period: 7, values: closes }),
  );
  const rsi14 = alignValues(
    bars.length,
    RSI.calculate({ period: 14, values: closes }),
  );
  const atr14 = alignValues(
    bars.length,
    ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }),
  );
  const ema5 = alignValues(
    bars.length,
    EMA.calculate({ period: 5, values: closes }),
  );
  const ema50 = alignValues(
    bars.length,
    EMA.calculate({ period: 50, values: closes }),
  );
  const bbands20_2 = alignValues(
    bars.length,
    BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }),
  );
  const sma20 = alignValues(
    bars.length,
    SMA.calculate({ period: 20, values: closes }),
  );
  const std20 = calculateRollingStdDev(closes, 20);
  const volumeAverage20 = calculatePreviousAverage(volumes, 20);
  const quoteAverage20d = calculatePreviousAverage(quoteVolumes, 20);
  const priorRangeLow20 = calculatePreviousRollingMin(lows, 20);
  const priorRangeHigh20 = calculatePreviousRollingMax(highs, 20);

  const natr = atr14.map((value, index) =>
    typeof value === "number" ? value / (closes[index] + EPSILON) : null,
  );
  const natrAverage50 = calculateInclusiveAverage(natr, 50);

  return bars.map<CryptoFeatureRow>((bar, index) => {
    const direction: TradeDirection = side === "buy" ? "long" : "short";
    const primaryLowerTf =
      primaryLowerTfConfirmations[index] ??
      createEmptyLowerTfConfirmation("4h", true, direction);
    const secondaryLowerTf =
      secondaryLowerTfConfirmations[index] ??
      createEmptyLowerTfConfirmation("1h", false, direction);
    const primaryLowerTfDepth =
      primaryLowerTf.excursionDepth20 ??
      primaryLowerTf.breakdownDepth20 ??
      null;
    const return3 =
      index >= 3 ? bar.close / (closes[index - 3] + EPSILON) - 1 : null;
    const return5 =
      index >= 5 ? bar.close / (closes[index - 5] + EPSILON) - 1 : null;
    const averageVolume = volumeAverage20[index];
    const volumeRatio20 =
      typeof averageVolume === "number"
        ? bar.volume / (averageVolume + EPSILON)
        : null;
    const priorLow = priorRangeLow20[index];
    const breakdownDepth20 =
      typeof priorLow === "number"
        ? (priorLow - bar.low) / (priorLow + EPSILON)
        : null;
    const rangeReentry = typeof priorLow === "number" ? bar.close >= priorLow : false;
    const breakdownHold = !rangeReentry;
    const priorHigh = priorRangeHigh20[index];
    const breakoutDepth20 =
      typeof priorHigh === "number"
        ? (bar.high - priorHigh) / (priorHigh + EPSILON)
        : null;
    const rangeReject = typeof priorHigh === "number" ? bar.close <= priorHigh : false;
    const breakoutHold = !rangeReject;
    const recoveryRatio = (bar.close - bar.low) / (bar.high - bar.low + EPSILON);
    const rejectionRatio = (bar.high - bar.close) / (bar.high - bar.low + EPSILON);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const body = Math.abs(bar.close - bar.open);
    const wickBodyRatio = lowerWick / (body + EPSILON);
    const upperWickBodyRatio = upperWick / (body + EPSILON);
    const panicClose = recoveryRatio <= profile.flushRecoveryThreshold;
    const weakLowerWick = wickBodyRatio <= profile.weakLowerWickThreshold;
    const tightUpperWick = upperWickBodyRatio <= profile.tightUpperWickThreshold;
    const stdValue = std20[index];
    const smaValue = sma20[index];
    const zScore20 =
      typeof smaValue === "number" && typeof stdValue === "number"
        ? (bar.close - smaValue) / (stdValue + EPSILON)
        : null;
    const bbLower20_2 =
      bbands20_2[index] && typeof bbands20_2[index]?.lower === "number"
        ? bbands20_2[index]!.lower
        : null;
    const bbUpper20_2 =
      bbands20_2[index] && typeof bbands20_2[index]?.upper === "number"
        ? bbands20_2[index]!.upper
        : null;
    const atrValue = atr14[index];
    const natrValue = natr[index];
    const natrAverage = natrAverage50[index];
    const volatilityExpansion =
      typeof natrValue === "number" && typeof natrAverage === "number"
        ? natrValue / (natrAverage + EPSILON)
        : null;
    const liquidityAverage20d = quoteAverage20d[index];
    const liquidityPassed =
      typeof liquidityAverage20d === "number"
        ? liquidityAverage20d >= config.advThreshold
        : false;
    const oversoldCount =
      (typeof rsi7[index] === "number" &&
      rsi7[index]! <= profile.rsi7OversoldThreshold
        ? 1
        : 0) +
      (typeof zScore20 === "number" && zScore20 <= profile.zScoreThreshold ? 1 : 0) +
      (typeof bbLower20_2 === "number" && bar.low < bbLower20_2 ? 1 : 0);
    const overboughtCount =
      (typeof rsi7[index] === "number" &&
      rsi7[index]! >= profile.rsi7OverboughtThreshold
        ? 1
        : 0) +
      (typeof zScore20 === "number" &&
      zScore20 >= profile.zScoreOverboughtThreshold
        ? 1
        : 0) +
      (typeof bbUpper20_2 === "number" && bar.high > bbUpper20_2 ? 1 : 0);
    const panicPassed =
      typeof return3 === "number" &&
      return3 <= profile.return3Threshold &&
      typeof return5 === "number" &&
      return5 <= profile.return5Threshold &&
      typeof volumeRatio20 === "number" &&
      volumeRatio20 >= profile.volumeRatioThreshold &&
      typeof rsi14[index] === "number" &&
      rsi14[index]! <= profile.rsi14Threshold;
    const panicUpPassed =
      typeof return3 === "number" &&
      return3 >= profile.return3UpThreshold &&
      typeof return5 === "number" &&
      return5 >= profile.return5UpThreshold &&
      typeof volumeRatio20 === "number" &&
      volumeRatio20 >= profile.volumeRatioThreshold &&
      typeof rsi14[index] === "number" &&
      rsi14[index]! >= profile.rsi14OverboughtThreshold;
    const previousClose = index > 0 ? bars[index - 1].close : bar.close;
    const flushSignalBase =
      panicClose &&
      weakLowerWick &&
      bar.close <= previousClose;
    const previousStdValue = index > 0 ? std20[index - 1] : null;
    const previousSmaValue = index > 0 ? sma20[index - 1] : null;
    const previousZScore20 =
      index > 0 &&
      typeof previousSmaValue === "number" &&
      typeof previousStdValue === "number"
        ? (bars[index - 1].close - previousSmaValue) / (previousStdValue + EPSILON)
        : null;
    const previousBbUpper20_2 =
      index > 0 && bbands20_2[index - 1] && typeof bbands20_2[index - 1]?.upper === "number"
        ? bbands20_2[index - 1]!.upper
        : null;
    const previousOverboughtCount =
      index > 0
        ? (typeof rsi7[index - 1] === "number" &&
          rsi7[index - 1]! >= profile.rsi7OverboughtThreshold
            ? 1
            : 0) +
          (typeof previousZScore20 === "number" &&
          previousZScore20 >= profile.zScoreOverboughtThreshold
            ? 1
            : 0) +
          (typeof previousBbUpper20_2 === "number" &&
          bars[index - 1].high > previousBbUpper20_2
            ? 1
            : 0)
        : 0;
    const previousPriorHigh = index > 0 ? priorRangeHigh20[index - 1] : null;
    const previousBreakoutDepth20 =
      index > 0 && typeof previousPriorHigh === "number"
        ? (bars[index - 1].high - previousPriorHigh) / (previousPriorHigh + EPSILON)
        : null;
    const previous2PriorHigh = index > 1 ? priorRangeHigh20[index - 2] : null;
    const previous2BreakoutDepth20 =
      index > 1 && typeof previous2PriorHigh === "number"
        ? (bars[index - 2].high - previous2PriorHigh) / (previous2PriorHigh + EPSILON)
        : null;
    const previousRangeReject =
      index > 0 && typeof previousPriorHigh === "number"
        ? bars[index - 1].close <= previousPriorHigh
        : false;
    const previousBreakoutHold = index > 0 ? !previousRangeReject : false;
    const recentOverboughtWithin2 =
      overboughtCount >= 2 || previousOverboughtCount >= 2;
    const recentBreakoutSeenWithin2 =
      (typeof previousBreakoutDepth20 === "number" && previousBreakoutDepth20 >= 0.008) ||
      (typeof previous2BreakoutDepth20 === "number" && previous2BreakoutDepth20 >= 0.008);
    const previousStrongBreakoutSeenWithin2 =
      (typeof previousBreakoutDepth20 === "number" && previousBreakoutDepth20 >= 0.012) ||
      (typeof previous2BreakoutDepth20 === "number" && previous2BreakoutDepth20 >= 0.012);
    const currentBreakoutConfirm =
      typeof breakoutDepth20 === "number" && breakoutDepth20 >= 0.004;
    const currentStrongBreakout =
      typeof breakoutDepth20 === "number" && breakoutDepth20 >= 0.012;
    const recentReturn5HighWithin2 =
      (typeof return5 === "number" && return5 >= 0.04) ||
      (index > 0 &&
        index - 1 >= 5 &&
        bars[index - 1].close / (closes[index - 6] + EPSILON) - 1 >= 0.04);
    const buyLane =
      parentTimeframe === "1d"
        ? evaluateDailySignalLanes({
            panicPassed,
            oversoldCount,
            rangeReentry,
            recoveryRatio,
            wickBodyRatio,
            upperWickBodyRatio,
            flushSignalBase,
            volumeRatio20,
            breakdownDepth20,
            primaryLowerTfPassed: primaryLowerTf.passed,
            primaryLowerTfBreakdownDepth20: primaryLowerTfDepth,
            return3,
            return5,
            rsi14: rsi14[index],
          })
        : null;
    const sellLane = evaluateSellSignalLanes({
      panicUpPassed,
      overboughtCount,
      return5,
      rangeReject,
      rejectionRatio,
      recoveryRatio,
      wickBodyRatio,
      upperWickBodyRatio,
      volumeRatio20,
      breakoutDepth20,
      primaryLowerTfPassed: primaryLowerTf.passed,
      primaryLowerTfExcursionDepth20: primaryLowerTfDepth,
      recentOverboughtWithin2,
      recentBreakoutSeenWithin2,
      previousBreakoutHold,
      previousStrongBreakoutSeenWithin2,
      currentBreakoutConfirm,
      currentStrongBreakout,
    });
    const sellWarning = evaluateSellWarning({
      side,
      liquidityPassed,
      overboughtCount,
      recentOverboughtWithin2,
      recentBreakoutSeenWithin2,
      previousBreakoutHold,
      previousStrongBreakoutSeenWithin2,
      rangeReject,
      breakoutDepth20,
      upperWickBodyRatio,
      rejectionRatio,
      primaryLowerTfPassed: primaryLowerTf.passed,
      primaryLowerTfExcursionDepth20: primaryLowerTfDepth,
    });
    const flushSignal =
      side === "buy"
        ? parentTimeframe === "1d"
          ? Boolean(buyLane?.flushSignal)
          : flushSignalBase
        : false;
    const reboundSignal =
      side === "buy"
        ? parentTimeframe === "1d"
          ? Boolean(buyLane?.reboundSignal)
          : recoveryRatio >= profile.reboundRecoveryThreshold && tightUpperWick
        : false;
    const capitulationSignal =
      side === "buy" && parentTimeframe === "1d"
        ? Boolean(buyLane?.capitulationSignal)
        : false;
    const rejectionSignal = side === "sell" ? sellLane.rejectionSignal : false;
    const upthrustSignal = side === "sell" ? sellLane.upthrustSignal : false;
    const blowoffSignal = side === "sell" ? sellLane.blowoffSignal : false;
    const signalFamily: SignalFamily | null =
      side === "buy"
        ? parentTimeframe === "1d"
          ? buyLane?.signalFamily ?? null
          : flushSignal
            ? "flush"
            : reboundSignal
              ? "rebound"
              : null
        : sellLane.signalFamily;
    const signalLane =
      side === "buy"
        ? parentTimeframe === "1d"
          ? buyLane?.signalLane ?? null
          : flushSignal
            ? "flush"
            : reboundSignal
              ? "clean-rebound"
              : null
        : sellLane.signalLane;
    const reversalPassed = side === "buy" ? reboundSignal : rejectionSignal || upthrustSignal;
    const htfPassed =
      (typeof ema50[index] === "number" && bar.close > ema50[index]!) ||
      (typeof rsi14[index] === "number" && rsi14[index]! > 45);
    const parentScore =
      side === "buy"
        ? (typeof return3 === "number" && return3 <= profile.return3Threshold ? 2 : 0) +
          (typeof return5 === "number" && return5 <= profile.return5Threshold ? 1 : 0) +
          (typeof volumeRatio20 === "number" &&
          volumeRatio20 >= profile.volumeRatioThreshold
            ? 1
            : 0) +
          (typeof volumeRatio20 === "number" &&
          volumeRatio20 >= profile.volumeRatioBonusThreshold
            ? 1
            : 0) +
          (typeof rsi14[index] === "number" && rsi14[index]! <= profile.rsi14Threshold
            ? 1
            : 0) +
          (typeof rsi14[index] === "number" &&
          rsi14[index]! <= profile.rsi14BonusThreshold
            ? 1
            : 0) +
          (oversoldCount >= 2 ? 1 : 0) +
          (oversoldCount === 3 ? 1 : 0) +
          (typeof bbLower20_2 === "number" && bar.low < bbLower20_2 ? 1 : 0) +
          (typeof zScore20 === "number" && zScore20 <= profile.zScoreBonusThreshold
            ? 1
            : 0) +
          (flushSignal ? 1 : 0) +
          (reboundSignal ? 1 : 0) +
          (typeof volatilityExpansion === "number" && volatilityExpansion >= 1.2
            ? 1
            : 0)
        : (typeof return3 === "number" && return3 >= profile.return3UpThreshold ? 2 : 0) +
          (typeof return5 === "number" && return5 >= profile.return5UpThreshold ? 1 : 0) +
          (typeof volumeRatio20 === "number" &&
          volumeRatio20 >= profile.volumeRatioThreshold
            ? 1
            : 0) +
          (typeof volumeRatio20 === "number" &&
          volumeRatio20 >= profile.volumeRatioBonusThreshold
            ? 1
            : 0) +
          (typeof rsi14[index] === "number" &&
          rsi14[index]! >= profile.rsi14OverboughtThreshold
            ? 1
            : 0) +
          (typeof rsi14[index] === "number" &&
          rsi14[index]! >= profile.rsi14OverboughtBonusThreshold
            ? 1
            : 0) +
          (overboughtCount >= 2 ? 1 : 0) +
          (overboughtCount === 3 ? 1 : 0) +
          (typeof bbUpper20_2 === "number" && bar.high > bbUpper20_2 ? 1 : 0) +
          (typeof zScore20 === "number" &&
          zScore20 >= profile.zScoreOverboughtBonusThreshold
            ? 1
            : 0) +
          (previousBreakoutHold ? 1 : 0) +
          (recentBreakoutSeenWithin2 ? 1 : 0) +
          (rangeReject ? 1 : 0) +
          (recentOverboughtWithin2 ? 1 : 0) +
          (primaryLowerTf.passed ? 1 : 0) +
          (rejectionSignal ? 1 : 0) +
          (upthrustSignal ? 1 : 0) +
          (blowoffSignal ? 1 : 0) +
          (typeof volatilityExpansion === "number" && volatilityExpansion >= 1.2
            ? 1
            : 0);
    const score = parentScore + (secondaryLowerTf.passed ? 1 : 0);
    const lowerTfGate =
      side === "buy"
        ? parentTimeframe === "1d"
          ? buyLane?.lowerTfGate ?? false
          : primaryLowerTf.passed
        : sellLane.lowerTfGate;
    const sellMinScore =
      signalLane === "upthrust-reversal" || signalLane === "blowoff-capitulation"
        ? profile.minParentScore
        : signalLane === "clean-rejection"
          ? 5
          : signalLane === "rejection-confirm"
          ? 6
          : profile.minParentScore;
    const recentSellContextPassed =
      recentOverboughtWithin2 &&
      (previousBreakoutHold || recentBreakoutSeenWithin2 || currentBreakoutConfirm);
    const sellDojiOverrideContextPassed =
      rejectionRatio >= 0.7 &&
      recoveryRatio <= 0.35 &&
      primaryLowerTf.passed &&
      currentStrongBreakout;
    const setupActive =
      liquidityPassed &&
      (side === "buy"
        ? parentTimeframe === "1d"
          ? buyLane?.setupPanicPassed ?? false
          : panicPassed
        : sellLane.setupPanicPassed) &&
      (side === "buy"
        ? oversoldCount >= 2
        : signalLane === "clean-rejection" || signalLane === "rejection-confirm"
          ? recentSellContextPassed || sellDojiOverrideContextPassed
          : overboughtCount >= 2) &&
      signalFamily !== null &&
      (side === "sell" ? score >= sellMinScore : parentScore >= profile.minParentScore) &&
      lowerTfGate;
    const notes: string[] = [];

    if (side === "buy" && panicPassed) {
      notes.push("panic");
    }
    if (side === "sell" && panicUpPassed) {
      notes.push("panic-up");
    }
    if (side === "buy" && oversoldCount >= 2) {
      notes.push(`oversold:${oversoldCount}`);
    }
    if (side === "sell" && overboughtCount >= 2) {
      notes.push(`overbought:${overboughtCount}`);
    }
    if (side === "sell" && recentOverboughtWithin2) {
      notes.push("recent-overbought");
    }
    if (side === "sell" && recentBreakoutSeenWithin2) {
      notes.push("recent-breakout");
    }
    if (side === "sell" && previousBreakoutHold) {
      notes.push("prev-breakout-hold");
    }
    if (side === "sell" && recentBreakoutSeenWithin2) {
      notes.push("prev-breakout-depth");
    }
    if (side === "sell" && sellWarning.level > 0) {
      notes.push(`sell-warning:${sellWarning.level}`);
    }
    if (side === "buy" && panicClose) {
      notes.push("panic-close");
    }
    if (weakLowerWick) {
      notes.push("weak-wick");
    }
    if (tightUpperWick) {
      notes.push("tight-upper");
    }
    if (side === "buy" && breakdownHold) {
      notes.push("breakdown-hold");
    }
    if (side === "sell" && breakoutHold) {
      notes.push("breakout-hold");
    }
    if (flushSignal) {
      notes.push("flush");
    }
    if (reboundSignal) {
      notes.push("rebound");
    }
    if (capitulationSignal) {
      notes.push("capitulation");
    }
    if (rejectionSignal) {
      notes.push("rejection");
    }
    if (upthrustSignal) {
      notes.push("upthrust");
    }
    if (blowoffSignal) {
      notes.push("blowoff");
    }
    if (signalLane) {
      notes.push(`lane:${signalLane}`);
    }
    if (side === "buy") {
      notes.push(
        `lower-tf:${parentTimeframe === "1d" ? buyLane?.lowerTfMode ?? "fail" : primaryLowerTf.passed ? "pass" : "fail"}`,
      );
    } else {
      notes.push(`lower-tf:${sellLane.lowerTfMode}`);
    }
    if (reversalPassed) {
      notes.push("reversal");
    }
    if (primaryLowerTf.passed) {
      notes.push(
        `${primaryLowerTf.interval}-${side === "buy" ? "range-pass" : "reject-pass"}`,
      );
    }
    if (secondaryLowerTf.passed) {
      notes.push(`${secondaryLowerTf.interval}-bonus-pass`);
    }
    if (htfPassed) {
      notes.push("htf");
    }
    if (
      typeof volatilityExpansion === "number" &&
      volatilityExpansion >= 1.2
    ) {
      notes.push("ve");
    }

    return {
      index,
      bar,
      side,
      timeframe: parentTimeframe,
      return3,
      return5,
      volumeRatio20,
      rsi7: rsi7[index],
      rsi14: rsi14[index],
      zScore20,
      bbUpper20_2,
      bbLower20_2,
      priorRangeLow20: priorLow,
      breakdownDepth20,
      rangeReentry,
      breakdownHold,
      priorRangeHigh20: priorHigh,
      breakoutDepth20,
      rangeReject,
      breakoutHold,
      recoveryRatio,
      rejectionRatio,
      wickBodyRatio,
      upperWickBodyRatio,
      panicClose,
      weakLowerWick,
      tightUpperWick,
      panicUpPassed,
      overboughtCount,
      recentOverboughtWithin2,
      recentBreakoutSeenWithin2,
      recentReturn5HighWithin2,
      previousBreakoutHold,
      sellWarningLevel: sellWarning.level,
      sellWarningReasons: sellWarning.reasons,
      flushSignal,
      reboundSignal,
      capitulationSignal,
      rejectionSignal,
      upthrustSignal,
      blowoffSignal,
      signalFamily,
      signalLane,
      atr14: atrValue,
      volatilityExpansion,
      ema5: ema5[index],
      htfClose: bar.close,
      htfEma50: ema50[index],
      htfRsi14: rsi14[index],
      htfPassed,
      liquidityAverage20d,
      liquidityPassed,
      oversoldCount,
      panicPassed,
      reversalPassed,
      primaryLowerTf,
      secondaryLowerTf,
      setupActive,
      panicBuySetup: side === "buy" ? setupActive : false,
      score,
      notes,
    };
  });
};
