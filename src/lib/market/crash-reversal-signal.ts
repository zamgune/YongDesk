import { ATR, RSI } from "technicalindicators";

import type { MarketCandle } from "@/lib/market-data/types";

export type CrashReversalStage =
  | "inactive"
  | "panic-watch"
  | "entry-ready"
  | "insufficient-reward"
  | "invalidated"
  | "expired"
  | "unavailable";

export type CrashReversalConfidence = "high" | "medium" | "low" | "insufficient-data";

export type CrashMarketContext = {
  status: "supportive" | "weak" | "unavailable";
  label: string;
  changePct: number | null;
  recoveryPct: number | null;
  quoteAt: string | null;
};

export type CrashReversalExitPlan = {
  entryPrice: number;
  stopPrice: number;
  firstTakeProfit: number;
  secondTakeProfit: number;
  firstAllocationPct: 50;
  secondAllocationPct: 50;
  riskPerShare: number;
  rewardRisk: number;
  firstTargetBasis: "near-resistance" | "1R";
  isBrokerStopEligible: false;
};

export type CrashReversalSignal = {
  stage: CrashReversalStage;
  confidence: CrashReversalConfidence;
  label: string;
  detail: string;
  reasons: string[];
  blockers: string[];
  panicAt: number | null;
  confirmationAt: number | null;
  quoteAt: number | null;
  sessionChangePct: number | null;
  recentDropPct: number | null;
  volumeRatio: number | null;
  rsi14: number | null;
  rsi2: number | null;
  marketContext: CrashMarketContext;
  exitPlan: CrashReversalExitPlan | null;
  orderSubmissionAttempted: false;
};

export type CrashReversalInput = {
  candles5m: MarketCandle[];
  priorSessionReferenceCandles5m?: MarketCandle[];
  requireTimeOfDayVolumeReference?: boolean;
  previousClose: number | null;
  dailyAtr14: number | null;
  marketContext?: CrashMarketContext;
  confirmationLookaheadBars?: number;
};

const finitePositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

const TIME_OF_DAY_REFERENCE_SESSIONS = 20;

const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const kstClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const kstDateKey = (timestampSeconds: number) =>
  kstDateFormatter.format(new Date(timestampSeconds * 1_000));

const kstSessionMinutes = (timestampSeconds: number) => {
  const parts = Object.fromEntries(kstClockFormatter
    .formatToParts(new Date(timestampSeconds * 1_000))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
};

const sanitizeCandles = (candles: MarketCandle[]) => {
  const deduped = new Map<number, MarketCandle>();
  for (const candle of candles) {
    if (
      Number.isFinite(candle.time) &&
      finitePositive(candle.open) &&
      finitePositive(candle.high) &&
      finitePositive(candle.low) &&
      finitePositive(candle.close) &&
      Number.isFinite(candle.volume) && candle.volume >= 0
    ) {
      deduped.set(candle.time, candle);
    }
  }
  return [...deduped.values()].toSorted((left, right) => left.time - right.time);
};

const timeOfDayVolumeReferences = (candles: MarketCandle[]) => {
  const volumesByMinute = new Map<number, Map<string, number>>();
  for (const candle of candles) {
    const minute = kstSessionMinutes(candle.time);
    const byDate = volumesByMinute.get(minute) ?? new Map<string, number>();
    byDate.set(kstDateKey(candle.time), candle.volume);
    volumesByMinute.set(minute, byDate);
  }
  return new Map([...volumesByMinute.entries()].map(([minute, byDate]) => [
    minute,
    {
      average: average([...byDate.values()]),
      samples: byDate.size,
    },
  ]));
};

const alignedIndicator = (length: number, values: number[]) => [
  ...new Array<number | null>(Math.max(0, length - values.length)).fill(null),
  ...values,
];

const defaultMarketContext = (): CrashMarketContext => ({
  status: "unavailable",
  label: "KOSPI 확인 불가",
  changePct: null,
  recoveryPct: null,
  quoteAt: null,
});

const unavailableSignal = (
  marketContext: CrashMarketContext,
  blockers: string[],
): CrashReversalSignal => ({
  stage: "unavailable",
  confidence: "insufficient-data",
  label: "계산 불가",
  detail: "확정 5분봉과 변동성 표본이 부족합니다.",
  reasons: [],
  blockers,
  panicAt: null,
  confirmationAt: null,
  quoteAt: null,
  sessionChangePct: null,
  recentDropPct: null,
  volumeRatio: null,
  rsi14: null,
  rsi2: null,
  marketContext,
  exitPlan: null,
  orderSubmissionAttempted: false,
});

const candleCloseLocation = (candle: MarketCandle) => {
  const range = candle.high - candle.low;
  return range > 0 ? (candle.close - candle.low) / range : 0.5;
};

const isHammer = (candle: MarketCandle) => {
  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  return body > 0 && lowerWick >= body * 2 && upperWick <= body * 1.2;
};

const isBullishEngulfing = (previous: MarketCandle | undefined, current: MarketCandle) =>
  Boolean(
    previous &&
    previous.close < previous.open &&
    current.close > current.open &&
    current.open <= previous.close &&
    current.close >= previous.open,
  );

const isStrongBullish = (candle: MarketCandle) => {
  const range = candle.high - candle.low;
  const body = candle.close - candle.open;
  return range > 0 && body > 0 && body / range >= 0.55 && candleCloseLocation(candle) >= 0.65;
};

const roundedPrice = (price: number) => Math.round(price * 100) / 100;

const fiveMinuteCloseTime = (candle: MarketCandle) =>
  candle.closeTime ?? candle.time + 5 * 60;

export const assessCrashMarketContext = (
  candles5m: MarketCandle[],
  quoteAt: string | null = null,
): CrashMarketContext => {
  const candles = candles5m.toSorted((left, right) => left.time - right.time);
  if (candles.length < 3 || !finitePositive(candles[0]?.open)) {
    return defaultMarketContext();
  }
  const latest = candles.at(-1)!;
  const sessionOpen = candles[0].open;
  const sessionLow = Math.min(...candles.map((candle) => candle.low));
  const sessionHigh = Math.max(...candles.map((candle) => candle.high));
  const changePct = (latest.close / sessionOpen - 1) * 100;
  const range = sessionHigh - sessionLow;
  const recoveryPct = range > 0 ? (latest.close - sessionLow) / range * 100 : 50;
  const weak = changePct <= -1.5 && recoveryPct < 35;
  return {
    status: weak ? "weak" : "supportive",
    label: weak ? "KOSPI 약세 지속" : "KOSPI 회복·중립",
    changePct,
    recoveryPct,
    quoteAt,
  };
};

export const calculateCrashReversalSignal = (
  input: CrashReversalInput,
): CrashReversalSignal => {
  const marketContext = input.marketContext ?? defaultMarketContext();
  const sanitizedCurrent = sanitizeCandles(input.candles5m);
  const currentDate = sanitizedCurrent.length ? kstDateKey(sanitizedCurrent.at(-1)!.time) : null;
  const candles = currentDate === null
    ? []
    : sanitizedCurrent.filter((candle) => kstDateKey(candle.time) === currentDate);
  const referenceCandles = currentDate === null
    ? []
    : sanitizeCandles(input.priorSessionReferenceCandles5m ?? [])
      .filter((candle) => kstDateKey(candle.time) < currentDate);
  const referencesByMinute = timeOfDayVolumeReferences(referenceCandles);
  const referenceStats = candles.map((candle) => referencesByMinute.get(kstSessionMinutes(candle.time)) ?? null);
  const hasTimeOfDayReference = referenceStats.some((reference) =>
    (reference?.samples ?? 0) >= TIME_OF_DAY_REFERENCE_SESSIONS &&
    finitePositive(reference?.average));
  const hasCompleteTimeOfDayReference = referenceStats.length > 0 && referenceStats.every((reference) =>
    (reference?.samples ?? 0) >= TIME_OF_DAY_REFERENCE_SESSIONS &&
    finitePositive(reference?.average));
  const indicatorCandles = [
    ...referenceCandles.slice(-100),
    ...candles,
  ];
  const hasOpeningWarmup = hasTimeOfDayReference && indicatorCandles.length >= 15;
  const insufficientCurrentHistory = candles.length < 24 && !hasOpeningWarmup;
  if (
    insufficientCurrentHistory ||
    !finitePositive(input.previousClose) ||
    !finitePositive(input.dailyAtr14) ||
    (input.requireTimeOfDayVolumeReference === true && !hasCompleteTimeOfDayReference)
  ) {
    return unavailableSignal(marketContext, [
      insufficientCurrentHistory ? "확정 5분봉 24개 또는 동일 시간대 과거 20거래일 참조" : null,
      !finitePositive(input.previousClose) ? "직전 거래일 종가" : null,
      !finitePositive(input.dailyAtr14) ? "일봉 ATR14" : null,
      input.requireTimeOfDayVolumeReference === true && !hasCompleteTimeOfDayReference
        ? "동일 KST 5분 구간의 과거 20거래일 거래량"
        : null,
    ].filter((value): value is string => value !== null));
  }

  const indicatorOffset = indicatorCandles.length - candles.length;
  const rsi14 = alignedIndicator(indicatorCandles.length, RSI.calculate({
    values: indicatorCandles.map((candle) => candle.close),
    period: 14,
  })).slice(indicatorOffset);
  const rsi2 = alignedIndicator(indicatorCandles.length, RSI.calculate({
    values: indicatorCandles.map((candle) => candle.close),
    period: 2,
  })).slice(indicatorOffset);
  const atr5m = alignedIndicator(indicatorCandles.length, ATR.calculate({
    high: indicatorCandles.map((candle) => candle.high),
    low: indicatorCandles.map((candle) => candle.low),
    close: indicatorCandles.map((candle) => candle.close),
    period: 14,
  })).slice(indicatorOffset);
  const volumeRatios = candles.map((candle, index) => {
    const reference = referenceStats[index];
    if (
      (reference?.samples ?? 0) >= TIME_OF_DAY_REFERENCE_SESSIONS &&
      finitePositive(reference?.average)
    ) {
      return candle.volume / reference.average;
    }
    if (input.requireTimeOfDayVolumeReference === true) return null;
    const baseline = average(candles.slice(Math.max(0, index - 20), index).map((item) => item.volume));
    return baseline && baseline > 0 ? candle.volume / baseline : null;
  });
  const volumeReferenceReason = (index: number) => {
    const reference = referenceStats[index];
    return (reference?.samples ?? 0) >= TIME_OF_DAY_REFERENCE_SESSIONS
      ? `동일 KST 5분 구간 과거 ${reference!.samples}거래일 거래량 대비`
      : "당일 직전 20개 5분봉 거래량 대비";
  };

  let panicIndex = -1;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const comparison = candles[index - 3];
    const sessionChangePct = (candle.close / input.previousClose - 1) * 100;
    const recentDropPct = comparison ? (candle.close / comparison.close - 1) * 100 : null;
    const dailyAtrDrop = input.previousClose - candle.close >= input.dailyAtr14 * 1.5;
    const priceShock = (sessionChangePct <= -4 && dailyAtrDrop) || (recentDropPct ?? 0) <= -3;
    const volumeShock = (volumeRatios[index] ?? 0) >= 2;
    const momentumShock = (rsi14[index] ?? 100) <= 25 || (rsi2[index] ?? 100) <= 10;
    if (priceShock && volumeShock && momentumShock) {
      panicIndex = index;
    }
  }

  const latest = candles.at(-1)!;
  if (panicIndex < 0) {
    return {
      stage: "inactive",
      confidence: "low",
      label: "급락 신호 없음",
      detail: "가격·거래량·과매도 조건이 동시에 충족되지 않았습니다.",
      reasons: [],
      blockers: [
        "급락 가격 조건, 거래량 2배, RSI 과매도 조건을 함께 확인합니다.",
        input.requireTimeOfDayVolumeReference === true
          ? "거래량은 동일 KST 5분 구간의 과거 20거래일과 비교합니다."
          : null,
      ].filter((value): value is string => value !== null),
      panicAt: null,
      confirmationAt: null,
      quoteAt: fiveMinuteCloseTime(latest),
      sessionChangePct: (latest.close / input.previousClose - 1) * 100,
      recentDropPct: candles.length > 3 ? (latest.close / candles.at(-4)!.close - 1) * 100 : null,
      volumeRatio: volumeRatios.at(-1) ?? null,
      rsi14: rsi14.at(-1) ?? null,
      rsi2: rsi2.at(-1) ?? null,
      marketContext,
      exitPlan: null,
      orderSubmissionAttempted: false,
    };
  }

  const panic = candles[panicIndex];
  const maxLookahead = Math.max(1, input.confirmationLookaheadBars ?? 6);
  const endIndex = Math.min(candles.length - 1, panicIndex + maxLookahead);
  const barsAfterPanic = candles.slice(panicIndex + 1, endIndex + 1);
  const breachedIndex = barsAfterPanic.findIndex((candle) => candle.low < panic.low);
  const sessionChangePct = (latest.close / input.previousClose - 1) * 100;
  const recentDropPct = panicIndex >= 3 ? (panic.close / candles[panicIndex - 3].close - 1) * 100 : null;
  if (breachedIndex >= 0) {
    return {
      stage: "invalidated",
      confidence: "low",
      label: "급락 저점 재이탈",
      detail: "급락 저점을 다시 이탈해 반전 후보를 무효화했습니다.",
      reasons: [`급락 저점 ${roundedPrice(panic.low)} 아래로 내려갔습니다.`],
      blockers: ["새 급락 구간과 반전봉을 다시 확인해야 합니다."],
      panicAt: panic.time,
      confirmationAt: null,
      quoteAt: fiveMinuteCloseTime(latest),
      sessionChangePct,
      recentDropPct,
      volumeRatio: volumeRatios[panicIndex],
      rsi14: rsi14[panicIndex],
      rsi2: rsi2[panicIndex],
      marketContext,
      exitPlan: null,
      orderSubmissionAttempted: false,
    };
  }

  const panicMidpoint = (panic.open + panic.close) / 2;
  let confirmationIndex = -1;
  for (let index = panicIndex + 1; index <= endIndex; index += 1) {
    const candle = candles[index];
    const patternConfirmed = isHammer(candle) || isBullishEngulfing(candles[index - 1], candle) || isStrongBullish(candle);
    const reclaimed = candle.close >= panicMidpoint && candleCloseLocation(candle) >= 0.65;
    const volumeConfirmed = (volumeRatios[index] ?? 0) >= 1.2;
    if (patternConfirmed && reclaimed && volumeConfirmed) {
      confirmationIndex = index;
      break;
    }
  }

  if (confirmationIndex < 0) {
    if (candles.length - 1 > panicIndex + maxLookahead) {
      return {
        stage: "expired",
        confidence: "low",
        label: "반전 확인 시간 만료",
        detail: "급락 뒤 30분 안에 확인봉이 나오지 않아 후보를 만료했습니다.",
        reasons: [`급락봉 이후 ${maxLookahead}개 확정 5분봉을 확인했습니다.`],
        blockers: ["새 급락 구간이 형성되기 전까지 신규 진입 신호를 내지 않습니다."],
        panicAt: panic.time,
        confirmationAt: null,
        quoteAt: fiveMinuteCloseTime(latest),
        sessionChangePct,
        recentDropPct,
        volumeRatio: volumeRatios[panicIndex],
        rsi14: rsi14[panicIndex],
        rsi2: rsi2[panicIndex],
        marketContext,
        exitPlan: null,
        orderSubmissionAttempted: false,
      };
    }
    return {
      stage: "panic-watch",
      confidence: marketContext.status === "weak" ? "low" : "medium",
      label: "급락 감지 · 반전 대기",
      detail: "투매 조건은 감지했지만 확정 5분봉 반전 조건이 아직 부족합니다.",
      reasons: [
        `당일 ${sessionChangePct.toFixed(1)}% · 15분 ${recentDropPct?.toFixed(1) ?? "-"}%`,
        `급락봉 거래량 ${volumeRatios[panicIndex]?.toFixed(1) ?? "-"}배`,
        volumeReferenceReason(panicIndex),
      ],
      blockers: ["강한 양봉·Hammer·Bullish Engulfing과 급락봉 중간값 회복을 기다립니다."],
      panicAt: panic.time,
      confirmationAt: null,
      quoteAt: fiveMinuteCloseTime(latest),
      sessionChangePct,
      recentDropPct,
      volumeRatio: volumeRatios[panicIndex],
      rsi14: rsi14[panicIndex],
      rsi2: rsi2[panicIndex],
      marketContext,
      exitPlan: null,
      orderSubmissionAttempted: false,
    };
  }

  const confirmation = candles[confirmationIndex];
  const atr = atr5m[confirmationIndex];
  if (!finitePositive(atr)) {
    return unavailableSignal(marketContext, ["5분봉 ATR14"]);
  }
  const recentLow = Math.min(...candles.slice(Math.max(0, confirmationIndex - 19), confirmationIndex + 1).map((candle) => candle.low));
  const rawStructureStop = Math.min(panic.low, recentLow) - atr * 0.2;
  const stopPrice = rawStructureStop;
  const riskDistance = confirmation.close - stopPrice;
  if (!finitePositive(stopPrice) || !finitePositive(riskDistance)) {
    return unavailableSignal(marketContext, ["양수인 구조 손절가와 손실 거리"]);
  }
  const minimumRiskDistance = atr * 0.8;
  const maximumRiskDistance = atr * 1.8;
  const riskDistanceOutsideRange =
    riskDistance < minimumRiskDistance || riskDistance > maximumRiskDistance;
  const resistanceCandidates = candles
    .slice(Math.max(0, panicIndex - 60), panicIndex)
    .map((candle) => candle.high)
    .filter((price) => price > confirmation.close)
    .toSorted((left, right) => left - right);
  const resistance = resistanceCandidates[0] ?? null;
  const resistanceR = resistance === null ? null : (resistance - confirmation.close) / riskDistance;
  const resistanceRewardInsufficient = resistanceR !== null && resistanceR > 0 && resistanceR < 0.8;
  const insufficientReward = riskDistanceOutsideRange || resistanceRewardInsufficient;
  const firstUsesResistance = resistanceR !== null && resistanceR >= 0.8 && resistanceR <= 1.5;
  const firstTakeProfit = firstUsesResistance ? resistance! : confirmation.close + riskDistance;
  const secondTakeProfit = confirmation.close + riskDistance * 2;
  const exitPlan: CrashReversalExitPlan = {
    entryPrice: roundedPrice(confirmation.close),
    stopPrice: roundedPrice(stopPrice),
    firstTakeProfit: roundedPrice(firstTakeProfit),
    secondTakeProfit: roundedPrice(secondTakeProfit),
    firstAllocationPct: 50,
    secondAllocationPct: 50,
    riskPerShare: roundedPrice(riskDistance),
    rewardRisk: roundedPrice((secondTakeProfit - confirmation.close) / riskDistance),
    firstTargetBasis: firstUsesResistance ? "near-resistance" : "1R",
    isBrokerStopEligible: false,
  };
  const confidence = marketContext.status === "weak" || marketContext.status === "unavailable"
    ? "medium" as const
    : "high" as const;
  const riskBlocker = riskDistanceOutsideRange
    ? riskDistance < minimumRiskDistance
      ? "구조 손절 거리가 0.8 ATR보다 좁아 신규 진입 위험 기준을 충족하지 않습니다."
      : "구조 손절 거리가 1.8 ATR보다 넓어 손절선을 안쪽으로 당기지 않고 신규 진입을 보류합니다."
    : null;
  const blockers = [
    riskBlocker,
    resistanceRewardInsufficient ? "가까운 저항까지 예상 보상이 0.8R 미만입니다." : null,
  ].filter((value): value is string => value !== null);
  return {
    stage: insufficientReward ? "insufficient-reward" : "entry-ready",
    confidence: insufficientReward ? "low" : confidence,
    label: riskDistanceOutsideRange
      ? "반전 확인 · 위험폭 부적합"
      : resistanceRewardInsufficient
        ? "반전 확인 · 보상 부족"
        : "매수 검토 가능",
    detail: riskDistanceOutsideRange
      ? "구조 손절선을 유지한 결과 허용 ATR 위험폭 밖이어서 신규 진입 신호로 승격하지 않았습니다."
      : resistanceRewardInsufficient
        ? "가까운 저항까지 0.8R 미만이라 신규 진입 신호로 승격하지 않았습니다."
        : "확정 5분봉 반전과 거래량·가격 회복 조건을 통과했습니다.",
    reasons: [
      "급락 이후 반전 캔들 확인",
      `급락봉 중간값 ${roundedPrice(panicMidpoint)} 회복`,
      `확인봉 거래량 ${volumeRatios[confirmationIndex]?.toFixed(1) ?? "-"}배`,
      volumeReferenceReason(confirmationIndex),
      marketContext.label,
    ],
    blockers,
    panicAt: panic.time,
    confirmationAt: fiveMinuteCloseTime(confirmation),
    quoteAt: fiveMinuteCloseTime(latest),
    sessionChangePct,
    recentDropPct,
    volumeRatio: volumeRatios[confirmationIndex],
    rsi14: rsi14[confirmationIndex],
    rsi2: rsi2[confirmationIndex],
    marketContext,
    exitPlan,
    orderSubmissionAttempted: false,
  };
};
