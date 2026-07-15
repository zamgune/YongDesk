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
  previousClose: number | null;
  dailyAtr14: number | null;
  marketContext?: CrashMarketContext;
  confirmationLookaheadBars?: number;
};

const finitePositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const average = (values: number[]) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

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
  const candles = input.candles5m
    .filter((candle) =>
      Number.isFinite(candle.time) &&
      finitePositive(candle.open) &&
      finitePositive(candle.high) &&
      finitePositive(candle.low) &&
      finitePositive(candle.close) &&
      Number.isFinite(candle.volume) && candle.volume >= 0,
    )
    .toSorted((left, right) => left.time - right.time);
  if (candles.length < 24 || !finitePositive(input.previousClose) || !finitePositive(input.dailyAtr14)) {
    return unavailableSignal(marketContext, [
      candles.length < 24 ? "확정 5분봉 24개" : null,
      !finitePositive(input.previousClose) ? "직전 거래일 종가" : null,
      !finitePositive(input.dailyAtr14) ? "일봉 ATR14" : null,
    ].filter((value): value is string => value !== null));
  }

  const rsi14 = alignedIndicator(candles.length, RSI.calculate({
    values: candles.map((candle) => candle.close),
    period: 14,
  }));
  const rsi2 = alignedIndicator(candles.length, RSI.calculate({
    values: candles.map((candle) => candle.close),
    period: 2,
  }));
  const atr5m = alignedIndicator(candles.length, ATR.calculate({
    high: candles.map((candle) => candle.high),
    low: candles.map((candle) => candle.low),
    close: candles.map((candle) => candle.close),
    period: 14,
  }));
  const volumeRatios = candles.map((candle, index) => {
    const baseline = average(candles.slice(Math.max(0, index - 20), index).map((item) => item.volume));
    return baseline && baseline > 0 ? candle.volume / baseline : null;
  });

  let panicIndex = -1;
  for (let index = 20; index < candles.length; index += 1) {
    const candle = candles[index];
    const comparison = candles[index - 3];
    const sessionChangePct = (candle.close / input.previousClose - 1) * 100;
    const recentDropPct = comparison ? (candle.close / comparison.close - 1) * 100 : 0;
    const dailyAtrDrop = input.previousClose - candle.close >= input.dailyAtr14 * 1.5;
    const priceShock = (sessionChangePct <= -4 && dailyAtrDrop) || recentDropPct <= -3;
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
      blockers: ["급락 가격 조건, 거래량 2배, RSI 과매도 조건을 함께 확인합니다."],
      panicAt: null,
      confirmationAt: null,
      quoteAt: latest.time,
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
      quoteAt: latest.time,
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
        quoteAt: latest.time,
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
      ],
      blockers: ["강한 양봉·Hammer·Bullish Engulfing과 급락봉 중간값 회복을 기다립니다."],
      panicAt: panic.time,
      confirmationAt: null,
      quoteAt: latest.time,
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
  const riskDistance = clamp(confirmation.close - rawStructureStop, atr * 0.8, atr * 1.8);
  const stopPrice = confirmation.close - riskDistance;
  if (!finitePositive(stopPrice) || !finitePositive(riskDistance)) {
    return unavailableSignal(marketContext, ["양수인 구조 손절가와 손실 거리"]);
  }
  const resistanceCandidates = candles
    .slice(Math.max(0, panicIndex - 60), panicIndex)
    .map((candle) => candle.high)
    .filter((price) => price > confirmation.close)
    .toSorted((left, right) => left - right);
  const resistance = resistanceCandidates[0] ?? null;
  const resistanceR = resistance === null ? null : (resistance - confirmation.close) / riskDistance;
  const insufficientReward = resistanceR !== null && resistanceR > 0 && resistanceR < 0.8;
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
  return {
    stage: insufficientReward ? "insufficient-reward" : "entry-ready",
    confidence: insufficientReward ? "low" : confidence,
    label: insufficientReward ? "반전 확인 · 보상 부족" : "매수 검토 가능",
    detail: insufficientReward
      ? "가까운 저항까지 0.8R 미만이라 신규 진입 신호로 승격하지 않았습니다."
      : "확정 5분봉 반전과 거래량·가격 회복 조건을 통과했습니다.",
    reasons: [
      "급락 이후 반전 캔들 확인",
      `급락봉 중간값 ${roundedPrice(panicMidpoint)} 회복`,
      `확인봉 거래량 ${volumeRatios[confirmationIndex]?.toFixed(1) ?? "-"}배`,
      marketContext.label,
    ],
    blockers: insufficientReward ? ["가까운 저항까지 예상 보상이 0.8R 미만입니다."] : [],
    panicAt: panic.time,
    confirmationAt: confirmation.time,
    quoteAt: latest.time,
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
