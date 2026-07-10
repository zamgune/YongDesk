import type { Candle } from "@/domain/market";
import type { BreakoutSignal, PatternSignals, PatternSignalType } from "@/lib/market/pattern-signals";

export type SignalReliabilityGrade = "high" | "medium" | "low" | "insufficient-data";

export type SignalReliability = {
  pattern: PatternSignalType | "trend-following";
  grade: SignalReliabilityGrade;
  score: number;
  sampleSize: number;
  successRate: number | null;
  stopHitRate: number | null;
  averageMaxGainPct: number | null;
  averageMaxDrawdownPct: number | null;
  averageBarsHeld: number | null;
  riskReward: number | null;
  reasons: string[];
};

type SignalReliabilityInput = {
  candles: Candle[];
  sma5?: Array<number | null>;
  sma20?: Array<number | null>;
  sma50?: Array<number | null>;
  volumeMa20?: Array<number | null>;
  patternSignals?: PatternSignals | null;
  breakoutSignal?: BreakoutSignal | null;
};

type EvaluatedSetup = {
  success: boolean;
  stopped: boolean;
  maxGainPct: number;
  maxDrawdownPct: number;
  barsHeld: number;
};

const MIN_SAMPLE_SIZE = 3;
const DEFAULT_HORIZON_BARS = 20;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const calculateAlignedSma = (candles: Candle[], period: number): Array<number | null> =>
  candles.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }
    const window = candles.slice(index + 1 - period, index + 1);
    return average(window.map((candle) => candle.close));
  });

const calculateAlignedVolumeMa = (candles: Candle[], period: number): Array<number | null> =>
  candles.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }
    const window = candles.slice(index + 1 - period, index + 1);
    return average(window.map((candle) => candle.volume));
  });

const getSeriesValue = (series: Array<number | null>, index: number) => {
  const value = series[index];
  return isNumber(value) ? value : null;
};

const highOf = (candles: Candle[]) =>
  candles.length ? Math.max(...candles.map((candle) => candle.high)) : null;

const lowOf = (candles: Candle[]) =>
  candles.length ? Math.min(...candles.map((candle) => candle.low)) : null;

const getVolumeRatio = (
  candles: Candle[],
  volumeMa20: Array<number | null>,
  index: number,
) => {
  const averageVolume = getSeriesValue(volumeMa20, index);
  if (!isNumber(averageVolume) || averageVolume <= 0) {
    return null;
  }
  return candles[index].volume / averageVolume;
};

const countNearLevel = (
  candles: Candle[],
  level: number | null,
  selector: (candle: Candle) => number,
  tolerance = 0.025,
) => {
  if (!isNumber(level) || level <= 0) {
    return 0;
  }
  return candles.filter((candle) => Math.abs(selector(candle) / level - 1) <= tolerance).length;
};

const getFocusedPattern = (
  patternSignals?: PatternSignals | null,
  breakoutSignal?: BreakoutSignal | null,
): SignalReliability["pattern"] => {
  if (breakoutSignal?.pattern && breakoutSignal.pattern !== "none") {
    return breakoutSignal.pattern;
  }
  if (patternSignals?.primaryPattern && patternSignals.primaryPattern !== "none") {
    return patternSignals.primaryPattern;
  }
  return "trend-following";
};

const detectSetupAt = ({
  candles,
  index,
  pattern,
  sma5,
  sma20,
  sma50,
  volumeMa20,
}: {
  candles: Candle[];
  index: number;
  pattern: SignalReliability["pattern"];
  sma5: Array<number | null>;
  sma20: Array<number | null>;
  sma50: Array<number | null>;
  volumeMa20: Array<number | null>;
}) => {
  const candle = candles[index];
  const previous = candles[index - 1];
  const volumeRatio = getVolumeRatio(candles, volumeMa20, index);
  const currentSma5 = getSeriesValue(sma5, index);
  const currentSma20 = getSeriesValue(sma20, index);
  const currentSma50 = getSeriesValue(sma50, index);
  const previousSma20 = getSeriesValue(sma20, index - 1);
  const prior120 = candles.slice(Math.max(0, index - 120), index);
  const prior80 = candles.slice(Math.max(0, index - 80), index);
  const prior50 = candles.slice(Math.max(0, index - 50), index);
  const prior40 = candles.slice(Math.max(0, index - 40), index);
  const prior20 = candles.slice(Math.max(0, index - 20), index);
  const priorHigh120 = highOf(prior120);
  const priorHigh50 = highOf(prior50);
  const priorLow50 = lowOf(prior50);
  const priorHigh20 = highOf(prior20);

  if (pattern === "new-high") {
    return isNumber(priorHigh120) && candle.close > priorHigh120 && (volumeRatio ?? 1) >= 1.15;
  }

  if (pattern === "box-breakout") {
    const rangePct =
      isNumber(priorHigh50) && isNumber(priorLow50) && priorLow50 > 0
        ? priorHigh50 / priorLow50 - 1
        : null;
    return (
      isNumber(priorHigh50) &&
      isNumber(rangePct) &&
      rangePct <= 0.3 &&
      countNearLevel(prior50, priorHigh50, (bar) => bar.high) >= 2 &&
      countNearLevel(prior50, priorLow50, (bar) => bar.low) >= 2 &&
      candle.close > priorHigh50 &&
      (volumeRatio ?? 1) >= 1.15
    );
  }

  if (pattern === "triangle-breakout") {
    const firstHalf = prior40.slice(0, 20);
    const secondHalf = prior40.slice(20);
    const firstRange =
      isNumber(highOf(firstHalf)) && isNumber(lowOf(firstHalf))
        ? (highOf(firstHalf) ?? 0) - (lowOf(firstHalf) ?? 0)
        : null;
    const secondRange =
      isNumber(highOf(secondHalf)) && isNumber(lowOf(secondHalf))
        ? (highOf(secondHalf) ?? 0) - (lowOf(secondHalf) ?? 0)
        : null;
    return (
      isNumber(priorHigh20) &&
      isNumber(firstRange) &&
      isNumber(secondRange) &&
      secondRange < firstRange * 0.75 &&
      candle.close > priorHigh20 &&
      (volumeRatio ?? 1) >= 1.15
    );
  }

  if (pattern === "cup-handle") {
    const cupHigh = highOf(prior80);
    const cupLow = lowOf(prior80);
    const drawdown = isNumber(cupHigh) && isNumber(cupLow) && cupHigh > 0 ? 1 - cupLow / cupHigh : null;
    return (
      isNumber(cupHigh) &&
      isNumber(drawdown) &&
      drawdown >= 0.12 &&
      drawdown <= 0.38 &&
      candle.close > cupHigh * 0.985 &&
      (volumeRatio ?? 1) >= 1.15
    );
  }

  if (pattern === "ma-reclaim") {
    return (
      isNumber(currentSma20) &&
      isNumber(previousSma20) &&
      previous.close < previousSma20 &&
      candle.close > currentSma20 &&
      currentSma20 >= previousSma20
    );
  }

  return (
    isNumber(currentSma5) &&
    isNumber(currentSma20) &&
    isNumber(currentSma50) &&
    currentSma5 > currentSma20 &&
    currentSma20 > currentSma50 &&
    candle.close > currentSma20 &&
    (volumeRatio ?? 1) >= 1.1
  );
};

const evaluateSetup = (
  candles: Candle[],
  index: number,
  horizonBars = DEFAULT_HORIZON_BARS,
): EvaluatedSetup | null => {
  const entry = candles[index].close;
  if (!isNumber(entry) || entry <= 0) {
    return null;
  }
  const recentLow = lowOf(candles.slice(Math.max(0, index - 10), index + 1));
  const stop = Math.max(recentLow ?? entry * 0.92, entry * 0.92);
  const risk = entry - stop;
  if (!isNumber(stop) || risk <= entry * 0.015) {
    return null;
  }
  const target = entry + risk * 2;
  const future = candles.slice(index + 1, index + 1 + horizonBars);
  if (!future.length) {
    return null;
  }

  let success = false;
  let stopped = false;
  let barsHeld = future.length;

  for (let offset = 0; offset < future.length; offset += 1) {
    const bar = future[offset];
    if (bar.low <= stop) {
      stopped = true;
      barsHeld = offset + 1;
      break;
    }
    if (bar.high >= target) {
      success = true;
      barsHeld = offset + 1;
      break;
    }
  }

  const maxHigh = Math.max(...future.map((bar) => bar.high));
  const minLow = Math.min(...future.map((bar) => bar.low));

  return {
    success,
    stopped,
    maxGainPct: maxHigh / entry - 1,
    maxDrawdownPct: minLow / entry - 1,
    barsHeld,
  };
};

const getGradeLabel = (grade: SignalReliabilityGrade) => {
  switch (grade) {
    case "high":
      return "높음";
    case "medium":
      return "보통";
    case "low":
      return "낮음";
    case "insufficient-data":
      return "데이터 부족";
  }
};

export const getSignalReliabilityGradeLabel = getGradeLabel;

export const calculateSignalReliability = ({
  candles,
  sma5 = calculateAlignedSma(candles, 5),
  sma20 = calculateAlignedSma(candles, 20),
  sma50 = calculateAlignedSma(candles, 50),
  volumeMa20 = calculateAlignedVolumeMa(candles, 20),
  patternSignals,
  breakoutSignal,
}: SignalReliabilityInput): SignalReliability => {
  const pattern = getFocusedPattern(patternSignals, breakoutSignal);
  const setups: EvaluatedSetup[] = [];
  const lastEvaluableIndex = candles.length - DEFAULT_HORIZON_BARS - 1;

  for (let index = 60; index <= lastEvaluableIndex; index += 1) {
    if (
      detectSetupAt({
        candles,
        index,
        pattern,
        sma5,
        sma20,
        sma50,
        volumeMa20,
      })
    ) {
      const evaluated = evaluateSetup(candles, index);
      if (evaluated) {
        setups.push(evaluated);
      }
    }
  }

  const sampleSize = setups.length;
  const successRate = sampleSize ? setups.filter((setup) => setup.success).length / sampleSize : null;
  const stopHitRate = sampleSize ? setups.filter((setup) => setup.stopped).length / sampleSize : null;
  const averageMaxGainPct = average(setups.map((setup) => setup.maxGainPct));
  const averageMaxDrawdownPct = average(setups.map((setup) => setup.maxDrawdownPct));
  const averageBarsHeld = average(setups.map((setup) => setup.barsHeld));
  const riskReward =
    isNumber(averageMaxGainPct) && isNumber(averageMaxDrawdownPct) && averageMaxDrawdownPct < 0
      ? averageMaxGainPct / Math.abs(averageMaxDrawdownPct)
      : null;

  const score =
    sampleSize < MIN_SAMPLE_SIZE || successRate === null || stopHitRate === null
      ? 0
      : Math.round(
          clamp(
            0,
            100,
            successRate * 58 +
              (riskReward ?? 0) * 14 -
              stopHitRate * 22 +
              clamp(0, 12, sampleSize),
          ),
        );
  const grade: SignalReliabilityGrade =
    sampleSize < MIN_SAMPLE_SIZE
      ? "insufficient-data"
      : score >= 68 && (successRate ?? 0) >= 0.58
        ? "high"
        : score >= 48 && (successRate ?? 0) >= 0.42
          ? "medium"
          : "low";
  const reasons = [
    sampleSize < MIN_SAMPLE_SIZE
      ? `유사 신호가 ${sampleSize}회라 통계 신뢰도가 부족합니다.`
      : `최근 유사 신호 ${sampleSize}회를 기준으로 평가했습니다.`,
    successRate !== null
      ? `목표 구간 선도달 비율은 ${(successRate * 100).toFixed(0)}%입니다.`
      : "목표 구간 선도달 비율은 아직 계산할 수 없습니다.",
    stopHitRate !== null
      ? `손절선 선도달 비율은 ${(stopHitRate * 100).toFixed(0)}%입니다.`
      : "손절선 선도달 비율은 아직 계산할 수 없습니다.",
    riskReward !== null
      ? `평균 손익비는 ${riskReward.toFixed(2)}배입니다.`
      : "평균 손익비 계산에는 더 많은 과거 사례가 필요합니다.",
  ];

  return {
    pattern,
    grade,
    score,
    sampleSize,
    successRate,
    stopHitRate,
    averageMaxGainPct,
    averageMaxDrawdownPct,
    averageBarsHeld,
    riskReward,
    reasons: [`신호 신뢰도: ${getGradeLabel(grade)}`, ...reasons],
  };
};
