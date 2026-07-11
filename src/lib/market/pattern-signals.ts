import type { BreakoutRule } from "@/lib/market/breakout-rule";
import type { TradeSetup } from "@/lib/market/trade-setup";

export type ChartQualityGrade = "excellent" | "good" | "watch" | "weak";
export type PatternSignalType =
  | "box-breakout"
  | "triangle-breakout"
  | "cup-handle"
  | "new-high"
  | "ma-reclaim"
  | "none";
export type PatternSignalStatus = "watch" | "triggered" | "confirmed" | "retest" | "extended" | "failed";

export type ChartQuality = {
  score: number;
  grade: ChartQualityGrade;
  reasons: string[];
};

export type PatternSignal = {
  type: PatternSignalType;
  status: PatternSignalStatus;
  score: number;
  level: number | null;
  failureLevel: number | null;
  reasons: string[];
};

export type PatternSignals = {
  primaryPattern: PatternSignalType;
  patterns: PatternSignal[];
};

export type BreakoutSignal = {
  status: PatternSignalStatus;
  pattern: PatternSignalType;
  breakoutLevel: number | null;
  supportLevel: number | null;
  failureLevel: number | null;
  volumeRatio: number | null;
  entryPlan: string;
  invalidation: string;
  reasons: string[];
  /** 차트 주기의 실제 발생 봉. 차트 주석을 위한 선택 필드다. */
  time?: number;
  /** 발생 봉의 돌파 기준 가격. */
  price?: number;
};

export type PatternCandle = {
  high: number;
  low: number;
  close: number;
  volume: number;
};

type PatternSignalInput = {
  candles: PatternCandle[];
  sma5?: Array<number | null>;
  sma20?: Array<number | null>;
  sma50?: Array<number | null>;
  volumeMa20?: Array<number | null>;
  breakoutRule?: BreakoutRule | null;
  tradeSetup?: TradeSetup | null;
  return5?: number | null;
};

const EXTENDED_BREAKOUT_DISTANCE_PCT = 0.08;
const EXTENDED_RETURN5_PCT = 0.18;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const clamp = (min: number, max: number, value: number) =>
  Math.max(min, Math.min(max, value));

const latestNumber = (series?: Array<number | null>) => {
  const value = series?.[series.length - 1];
  return isNumber(value) ? value : null;
};

const numberFromEnd = (series: Array<number | null> | undefined, offset: number) => {
  const value = series?.[series.length - 1 - offset];
  return isNumber(value) ? value : null;
};

const highOf = (candles: PatternCandle[]) =>
  candles.length ? Math.max(...candles.map((candle) => candle.high)) : null;

const lowOf = (candles: PatternCandle[]) =>
  candles.length ? Math.min(...candles.map((candle) => candle.low)) : null;

const countNear = (
  candles: PatternCandle[],
  level: number | null,
  selector: (candle: PatternCandle) => number,
  tolerance = 0.02,
) => {
  if (!isNumber(level) || level <= 0) {
    return 0;
  }
  return candles.filter((candle) => Math.abs(selector(candle) / level - 1) <= tolerance).length;
};

const formatPrice = (value: number | null | undefined) =>
  isNumber(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const statusWeight: Record<PatternSignalStatus, number> = {
  confirmed: 5,
  retest: 4,
  triggered: 3,
  watch: 2,
  extended: 2,
  failed: 1,
};

const getPatternLabel = (type: PatternSignalType) => {
  switch (type) {
    case "box-breakout":
      return "박스권 상단";
    case "triangle-breakout":
      return "수렴 상단";
    case "cup-handle":
      return "컵앤핸들 림";
    case "new-high":
      return "신고가 기준";
    case "ma-reclaim":
      return "20일선 회복";
    case "none":
      return "돌파 기준";
  }
};

const getStatusFromLevel = ({
  latest,
  previous,
  level,
  failureLevel,
  volumeRatio,
  hadRecentBreakout,
  return5,
}: {
  latest: PatternCandle;
  previous: PatternCandle;
  level: number | null;
  failureLevel: number | null;
  volumeRatio: number | null;
  hadRecentBreakout?: boolean;
  return5?: number | null;
}): PatternSignalStatus => {
  if (!isNumber(level)) {
    return "watch";
  }
  if (isNumber(failureLevel) && latest.close < failureLevel) {
    return "failed";
  }
  const distancePct = latest.close / level - 1;
  if (distancePct >= EXTENDED_BREAKOUT_DISTANCE_PCT || (isNumber(return5) && return5 >= EXTENDED_RETURN5_PCT)) {
    return "extended";
  }
  if (hadRecentBreakout && latest.close >= level * 0.985 && latest.close <= level * 1.035) {
    return "retest";
  }
  if (previous.close > level && latest.close >= level * 0.985 && latest.close <= level * 1.035) {
    return "retest";
  }
  if (latest.close > level && isNumber(volumeRatio) && volumeRatio >= 1.3) {
    return volumeRatio >= 1.5 ? "confirmed" : "triggered";
  }
  if (latest.close > level) {
    return "triggered";
  }
  return "watch";
};

const buildBoxPattern = (
  candles: PatternCandle[],
  volumeRatio: number | null,
  return5: number | null,
): PatternSignal | null => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const prior = candles.slice(0, -1);
  const window = prior.slice(-80);
  if (!latest || window.length < 40) {
    return null;
  }
  const level = highOf(window);
  const support = lowOf(window);
  if (!isNumber(level) || !isNumber(support) || latest.close <= 0) {
    return null;
  }
  const widthPct = (level - support) / latest.close;
  const resistanceTouches = countNear(window, level, (candle) => candle.high, 0.025);
  const supportTouches = countNear(window, support, (candle) => candle.low, 0.03);
  const basePass = widthPct <= 0.35 && resistanceTouches >= 2 && supportTouches >= 2;
  if (!basePass) {
    return null;
  }
  const failureLevel = Math.max(level * 0.97, support);
  const hadRecentBreakout = prior.slice(-8).some((candle) => candle.close > level);
  const status = getStatusFromLevel({ latest, previous, level, failureLevel, volumeRatio, hadRecentBreakout, return5 });
  const score =
    42 +
    Math.min(resistanceTouches, 4) * 5 +
    Math.min(supportTouches, 4) * 3 +
    (status === "confirmed" ? 18 : status === "retest" ? 14 : status === "triggered" ? 10 : status === "extended" ? 4 : 0) -
    (widthPct > 0.28 ? 8 : 0);

  return {
    type: "box-breakout",
    status,
    score: clamp(0, 100, Math.round(score)),
    level,
    failureLevel,
    reasons: [
      `상단 저항 ${formatPrice(level)} 근처 터치 ${resistanceTouches}회`,
      `하단 지지 ${formatPrice(support)} 근처 터치 ${supportTouches}회`,
      `박스 폭 ${(widthPct * 100).toFixed(1)}%`,
    ],
  };
};

const buildTrianglePattern = (
  candles: PatternCandle[],
  volumeRatio: number | null,
  return5: number | null,
): PatternSignal | null => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const prior = candles.slice(0, -1);
  const left = prior.slice(-60, -30);
  const right = prior.slice(-30);
  if (!latest || left.length < 20 || right.length < 20) {
    return null;
  }
  const leftHigh = highOf(left);
  const rightHigh = highOf(right);
  const leftLow = lowOf(left);
  const rightLow = lowOf(right);
  if (!isNumber(leftHigh) || !isNumber(rightHigh) || !isNumber(leftLow) || !isNumber(rightLow)) {
    return null;
  }
  const highsContracting = rightHigh < leftHigh * 0.995;
  const lowsRising = rightLow > leftLow * 1.005;
  if (!highsContracting || !lowsRising) {
    return null;
  }
  const level = rightHigh;
  const failureLevel = rightLow;
  const hadRecentBreakout = prior.slice(-8).some((candle) => candle.close > level);
  const status = getStatusFromLevel({ latest, previous, level, failureLevel, volumeRatio, hadRecentBreakout, return5 });
  const compressionPct = (level - failureLevel) / latest.close;
  const score =
    48 +
    (compressionPct <= 0.18 ? 12 : 4) +
    (status === "confirmed" ? 20 : status === "retest" ? 15 : status === "triggered" ? 10 : status === "extended" ? 4 : 0);

  return {
    type: "triangle-breakout",
    status,
    score: clamp(0, 100, Math.round(score)),
    level,
    failureLevel,
    reasons: [
      `고점 ${formatPrice(leftHigh)} -> ${formatPrice(rightHigh)}로 낮아짐`,
      `저점 ${formatPrice(leftLow)} -> ${formatPrice(rightLow)}로 높아짐`,
      `수렴 폭 ${(compressionPct * 100).toFixed(1)}%`,
    ],
  };
};

const buildCupHandlePattern = (
  candles: PatternCandle[],
  volumeRatio: number | null,
  return5: number | null,
): PatternSignal | null => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const prior = candles.slice(0, -1);
  const window = prior.slice(-140);
  if (!latest || window.length < 90) {
    return null;
  }
  const left = window.slice(0, Math.floor(window.length * 0.35));
  const middle = window.slice(Math.floor(window.length * 0.25), Math.floor(window.length * 0.75));
  const right = window.slice(Math.floor(window.length * 0.6));
  const handle = prior.slice(-15);
  const leftHigh = highOf(left);
  const cupLow = lowOf(middle);
  const rightHigh = highOf(right);
  const handleLow = lowOf(handle);
  if (!isNumber(leftHigh) || !isNumber(cupLow) || !isNumber(rightHigh) || !isNumber(handleLow)) {
    return null;
  }
  const rim = Math.max(leftHigh, rightHigh);
  const depthPct = (rim - cupLow) / rim;
  const rightRecovery = rightHigh >= leftHigh * 0.9;
  const handleDepthPct = (rightHigh - handleLow) / rightHigh;
  const priorUptrend = window[0]?.close ? leftHigh / window[0].close - 1 >= 0.12 : false;
  const handleVolume = average(handle.map((candle) => candle.volume));
  const cupVolume = average(window.slice(-60, -15).map((candle) => candle.volume));
  const handleVolumeContraction = isNumber(handleVolume) && isNumber(cupVolume) && handleVolume < cupVolume * 0.9;

  if (
    depthPct < 0.12 ||
    depthPct > 0.38 ||
    !rightRecovery ||
    handleDepthPct > 0.18 ||
    !priorUptrend
  ) {
    return null;
  }

  const level = rim;
  const failureLevel = Math.max(handleLow, rim * 0.93);
  const hadRecentBreakout = prior.slice(-8).some((candle) => candle.close > level);
  const status = getStatusFromLevel({ latest, previous, level, failureLevel, volumeRatio, hadRecentBreakout, return5 });
  const score =
    50 +
    (handleVolumeContraction ? 12 : 0) +
    (depthPct >= 0.15 && depthPct <= 0.32 ? 8 : 0) +
    (status === "confirmed" ? 20 : status === "retest" ? 15 : status === "triggered" ? 10 : status === "extended" ? 4 : 0);

  return {
    type: "cup-handle",
    status,
    score: clamp(0, 100, Math.round(score)),
    level,
    failureLevel,
    reasons: [
      `컵 깊이 ${(depthPct * 100).toFixed(1)}%`,
      `핸들 조정 ${(handleDepthPct * 100).toFixed(1)}%`,
      handleVolumeContraction ? "핸들 구간 거래량 감소" : "핸들 거래량 감소 확인 약함",
    ],
  };
};

const buildNewHighPattern = (
  candles: PatternCandle[],
  breakoutRule: BreakoutRule | null | undefined,
  return5: number | null,
): PatternSignal | null => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const level = breakoutRule?.newHighLevel ?? null;
  if (!latest || !isNumber(level)) {
    return null;
  }
  const volumeRatio = breakoutRule?.volumeConfirmation.ratio20 ?? null;
  const failureLevel = Math.max(level * 0.97, breakoutRule?.trailingExitPrice ?? 0);
  const status = getStatusFromLevel({ latest, previous, level, failureLevel, volumeRatio, return5 });
  const score =
    45 +
    (breakoutRule?.status === "breakout-ready" ? 20 : 0) +
    (status === "confirmed" ? 20 : status === "retest" ? 15 : status === "triggered" ? 10 : status === "extended" ? 4 : 0);

  return {
    type: "new-high",
    status,
    score: clamp(0, 100, Math.round(score)),
    level,
    failureLevel,
    reasons: breakoutRule?.reasons.slice(0, 3) ?? [`신고가 기준 ${formatPrice(level)} 확인`],
  };
};

const buildMaReclaimPattern = (
  candles: PatternCandle[],
  sma20: Array<number | null> | undefined,
  volumeRatio: number | null,
  return5: number | null,
): PatternSignal | null => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const level = latestNumber(sma20);
  if (!latest || !isNumber(level)) {
    return null;
  }
  const previousSma20 = numberFromEnd(sma20, 5);
  const rising = isNumber(previousSma20) && level >= previousSma20;
  const crossed = previous.close < level && latest.close >= level;
  if (!crossed && !(latest.close >= level && rising)) {
    return null;
  }
  const failureLevel = level * 0.985;
  const status = getStatusFromLevel({ latest, previous, level, failureLevel, volumeRatio, return5 });
  const score =
    38 +
    (rising ? 12 : 0) +
    (crossed ? 10 : 0) +
    (status === "confirmed" ? 16 : status === "triggered" ? 10 : status === "extended" ? 3 : 0);

  return {
    type: "ma-reclaim",
    status,
    score: clamp(0, 100, Math.round(score)),
    level,
    failureLevel,
    reasons: [
      `20일선 ${formatPrice(level)} ${crossed ? "회복" : "상회"}`,
      rising ? "20일선 기울기 유지" : "20일선 기울기 확인 필요",
    ],
  };
};

const getChartQuality = ({
  candles,
  sma5,
  sma20,
  sma50,
  volumeRatio,
  patterns,
}: {
  candles: PatternCandle[];
  sma5?: Array<number | null>;
  sma20?: Array<number | null>;
  sma50?: Array<number | null>;
  volumeRatio: number | null;
  patterns: PatternSignal[];
}): ChartQuality => {
  const latest = candles[candles.length - 1];
  const ma5 = latestNumber(sma5);
  const ma20 = latestNumber(sma20);
  const ma50 = latestNumber(sma50);
  const ma20Base = numberFromEnd(sma20, 5);
  const high20 = highOf(candles.slice(-20));
  const low20 = lowOf(candles.slice(-20));
  const primaryPatternScore = patterns[0]?.score ?? 0;
  const reasons: string[] = [];

  let trendScore = 0;
  if (latest && isNumber(ma5) && latest.close >= ma5) {
    trendScore += 10;
    reasons.push("현재가가 5일선 위에 있습니다.");
  }
  if (latest && isNumber(ma20) && latest.close >= ma20) {
    trendScore += 10;
    reasons.push("현재가가 20일선 위에 있습니다.");
  }
  if (isNumber(ma5) && isNumber(ma20) && ma5 >= ma20) {
    trendScore += 8;
  }
  if (isNumber(ma20) && isNumber(ma50) && ma20 >= ma50) {
    trendScore += 8;
  }
  if (isNumber(ma20) && isNumber(ma20Base) && ma20 >= ma20Base) {
    trendScore += 9;
    reasons.push("20일선 기울기가 유지됩니다.");
  }

  const baseScore = Math.min(25, primaryPatternScore * 0.25);
  if (patterns[0]) {
    reasons.push(`${getPatternLabel(patterns[0].type)} 패턴 점수 ${patterns[0].score}점`);
  }

  const volumeScore = isNumber(volumeRatio)
    ? volumeRatio >= 1.5
      ? 15
      : volumeRatio >= 1.3
        ? 11
        : volumeRatio >= 1
          ? 7
          : 3
    : 0;
  if (isNumber(volumeRatio)) {
    reasons.push(`거래량은 20일 평균 대비 ${volumeRatio.toFixed(2)}배입니다.`);
  }

  const tightnessPct = latest && isNumber(high20) && isNumber(low20)
    ? (high20 - low20) / latest.close
    : null;
  const tightnessScore = isNumber(tightnessPct)
    ? tightnessPct <= 0.12
      ? 10
      : tightnessPct <= 0.22
        ? 7
        : 3
    : 0;

  const riskPct = latest && isNumber(patterns[0]?.failureLevel)
    ? Math.abs(latest.close / patterns[0].failureLevel - 1)
    : null;
  const riskRewardScore = isNumber(riskPct)
    ? riskPct <= 0.08
      ? 5
      : riskPct <= 0.13
        ? 3
        : 0
    : 0;

  const score = clamp(0, 100, Math.round(trendScore + baseScore + volumeScore + tightnessScore + riskRewardScore));
  const grade: ChartQualityGrade =
    score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "watch" : "weak";

  if (isNumber(riskPct)) {
    reasons.push(`실패선까지 거리는 ${(riskPct * 100).toFixed(1)}%입니다.`);
  }

  return {
    score,
    grade,
    reasons: reasons.slice(0, 5),
  };
};

const buildFallbackPattern = (tradeSetup?: TradeSetup | null): PatternSignal => ({
  type: "none",
  status: "watch",
  score: 0,
  level: tradeSetup?.keyLevel ?? null,
  failureLevel: tradeSetup?.failureLevel ?? null,
  reasons: ["명확한 돌파 패턴은 아직 확인되지 않았습니다."],
});

export const calculatePatternSignals = ({
  candles,
  sma5,
  sma20,
  sma50,
  volumeMa20,
  breakoutRule,
  tradeSetup,
  return5,
}: PatternSignalInput): {
  chartQuality: ChartQuality;
  patternSignals: PatternSignals;
  breakoutSignal: BreakoutSignal;
} => {
  const latest = candles[candles.length - 1];
  const latestVolumeMa20 = latestNumber(volumeMa20);
  const fallbackAvgVolume20 = average(candles.slice(-21, -1).map((candle) => candle.volume));
  const volumeBase = latestVolumeMa20 ?? fallbackAvgVolume20;
  const volumeRatio = latest && isNumber(volumeBase) && volumeBase > 0
    ? latest.volume / volumeBase
    : breakoutRule?.volumeConfirmation.ratio20 ?? null;
  const fallbackReturn5 = latest && candles.length > 5 && candles[candles.length - 6]?.close
    ? latest.close / candles[candles.length - 6].close - 1
    : null;
  const recentReturn5 = isNumber(return5) ? return5 : fallbackReturn5;

  const patterns = [
    buildBoxPattern(candles, volumeRatio, recentReturn5),
    buildTrianglePattern(candles, volumeRatio, recentReturn5),
    buildCupHandlePattern(candles, volumeRatio, recentReturn5),
    buildNewHighPattern(candles, breakoutRule, recentReturn5),
    buildMaReclaimPattern(candles, sma20, volumeRatio, recentReturn5),
  ]
    .filter((pattern): pattern is PatternSignal => pattern !== null)
    .toSorted((left, right) =>
      statusWeight[right.status] - statusWeight[left.status] ||
      right.score - left.score,
    );
  const primary = patterns[0] ?? buildFallbackPattern(tradeSetup);
  const chartQuality = getChartQuality({
    candles,
    sma5,
    sma20,
    sma50,
    volumeRatio,
    patterns,
  });
  const status =
    chartQuality.grade === "weak" && primary.status !== "failed" && primary.status !== "extended"
      ? "watch"
      : primary.status;
  const supportLevel = primary.type === "new-high"
    ? primary.level
    : tradeSetup?.keyLevel ?? primary.level;
  const label = getPatternLabel(primary.type);

  return {
    chartQuality,
    patternSignals: {
      primaryPattern: primary.type,
      patterns: patterns.length ? patterns : [primary],
    },
    breakoutSignal: {
      status,
      pattern: primary.type,
      breakoutLevel: primary.level,
      supportLevel,
      failureLevel: primary.failureLevel,
      volumeRatio,
      entryPlan:
        status === "confirmed"
          ? `${label} ${formatPrice(primary.level)} 돌파 직후 확인 구간입니다. 종가 유지와 거래량 확인 후 제한적으로 접근합니다.`
          : status === "retest"
            ? `${label} ${formatPrice(primary.level)} 돌파 후 지지 재확인 구간입니다.`
            : status === "extended"
              ? "이미 추세가 진행된 구간입니다. 추격보다 5일선/20일선 또는 돌파선 눌림을 기다립니다."
              : status === "triggered"
                ? `${label} ${formatPrice(primary.level)} 돌파가 발생했지만 거래량/종가 확인이 더 필요합니다.`
                : status === "failed"
                  ? `${formatPrice(primary.failureLevel)} 아래 마감으로 돌파 실패 구간입니다.`
                  : `${label} ${formatPrice(primary.level)} 돌파 전까지 관찰합니다.`,
      invalidation:
        status === "failed"
          ? "이미 실패선 아래로 내려와 신규 진입을 보류합니다."
          : status === "extended"
            ? "추격 진입은 제한하고 5일선/20일선 또는 돌파 기준선 지지 실패 시 보류합니다."
          : `${formatPrice(primary.failureLevel)} 아래 일봉 마감 시 돌파 아이디어를 무효로 봅니다.`,
      reasons: primary.reasons,
    },
  };
};
