import type { BreakoutRule } from "@/lib/market/breakout-rule";
import type { BreakoutSignal } from "@/lib/market/pattern-signals";
import type { SignalReliability } from "@/lib/market/signal-reliability";
import type { TradeSetup } from "@/lib/market/trade-setup";

export type PositionManagementLevelStatus = "ready" | "triggered" | "unavailable";

export type PositionManagementLevel = {
  id: string;
  label: string;
  price: number | null;
  allocationPct?: number;
  distancePct: number | null;
  status: PositionManagementLevelStatus;
  note: string;
};

export type PositionManagementPlan = {
  bias: "defense" | "take-profit" | "hold" | "wait";
  headline: string;
  setupStop: PositionManagementLevel;
  portfolioStop: PositionManagementLevel;
  trailingStop: PositionManagementLevel;
  takeProfitLevels: PositionManagementLevel[];
  stagedExitPlan: PositionManagementLevel[];
  reentryCondition: string;
  riskWarnings: string[];
};

export type PositionManagementPlanInput = {
  currentPrice: number | null;
  averagePrice?: number | null;
  quantity?: number | null;
  currencyMatched?: boolean;
  levels?: {
    sma20?: number | null;
    primaryStop?: number | null;
    hardStop?: number | null;
    resistance?: number | null;
  } | null;
  breakoutRule?: BreakoutRule | null;
  breakoutSignal?: BreakoutSignal | null;
  tradeSetup?: TradeSetup | null;
  signalReliability?: SignalReliability | null;
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const firstNumber = (...values: Array<number | null | undefined>) => {
  const found = values.find(isNumber);
  return found ?? null;
};

const lowestNumber = (...values: Array<number | null | undefined>) => {
  const candidates = values.filter(isNumber);
  return candidates.length ? Math.min(...candidates) : null;
};

const getDistancePct = (price: number | null, currentPrice: number | null) =>
  isNumber(price) && isNumber(currentPrice) && currentPrice > 0
    ? price / currentPrice - 1
    : null;

const getStatus = (
  price: number | null,
  currentPrice: number | null,
  direction: "above" | "below",
): PositionManagementLevelStatus => {
  if (!isNumber(price) || !isNumber(currentPrice)) {
    return "unavailable";
  }
  return direction === "above"
    ? currentPrice >= price
      ? "triggered"
      : "ready"
    : currentPrice <= price
      ? "triggered"
      : "ready";
};

const level = ({
  id,
  label,
  price,
  allocationPct,
  currentPrice,
  direction,
  note,
}: {
  id: string;
  label: string;
  price: number | null;
  allocationPct?: number;
  currentPrice: number | null;
  direction: "above" | "below";
  note: string;
}): PositionManagementLevel => ({
  id,
  label,
  price,
  allocationPct,
  distancePct: getDistancePct(price, currentPrice),
  status: getStatus(price, currentPrice, direction),
  note,
});

const getProfitPrice = (
  preferred: Array<number | null | undefined>,
  fallback: number | null,
  floor?: number | null,
) => {
  const candidates = preferred
    .filter(isNumber)
    .filter((value) => !isNumber(floor) || value > floor * 1.005)
    .sort((a, b) => a - b);
  return candidates[0] ?? fallback;
};

export const calculatePositionManagementPlan = ({
  currentPrice,
  averagePrice,
  currencyMatched = true,
  levels,
  breakoutRule,
  breakoutSignal,
  tradeSetup,
  signalReliability,
}: PositionManagementPlanInput): PositionManagementPlan => {
  const setupStopPrice = firstNumber(
    breakoutSignal?.failureLevel,
    tradeSetup?.failureLevel,
    levels?.primaryStop,
    breakoutRule?.fixedStopPrice,
    levels?.hardStop,
  );
  const portfolioStopPrice = lowestNumber(
    setupStopPrice,
    breakoutRule?.fixedStopPrice,
    levels?.hardStop,
  );
  const trailingStopPrice = firstNumber(
    breakoutRule?.trailingExitPrice,
    levels?.sma20,
    levels?.primaryStop,
  );
  const entryBasis = currencyMatched && isNumber(averagePrice) && averagePrice > 0
    ? averagePrice
    : currentPrice;
  const riskPerShare =
    isNumber(entryBasis) && isNumber(setupStopPrice) && setupStopPrice < entryBasis
      ? entryBasis - setupStopPrice
      : isNumber(entryBasis)
        ? entryBasis * 0.08
        : null;
  const oneR = isNumber(entryBasis) && isNumber(riskPerShare) ? entryBasis + riskPerShare : null;
  const twoR = isNumber(entryBasis) && isNumber(riskPerShare) ? entryBasis + riskPerShare * 2 : null;
  const firstTakeProfitPrice = getProfitPrice(
    [levels?.resistance, oneR],
    oneR,
    entryBasis,
  );
  const secondTakeProfitPrice = getProfitPrice(
    [twoR, breakoutRule?.profitSwitchPrice],
    twoR ?? (isNumber(firstTakeProfitPrice) ? firstTakeProfitPrice * 1.1 : null),
    firstTakeProfitPrice,
  );

  const setupStop = level({
    id: "setup-stop",
    label: "돌파매매 손절",
    price: setupStopPrice,
    allocationPct: 30,
    currentPrice,
    direction: "below",
    note: "패턴/돌파 셋업이 무효화되는 1차 방어선입니다.",
  });
  const trailingStop = level({
    id: "trailing-stop",
    label: "추적 손절",
    price: trailingStopPrice,
    allocationPct: 40,
    currentPrice,
    direction: "below",
    note: "수익권에서는 잔여 물량의 추세 보유 기준으로 봅니다.",
  });
  const portfolioStop = level({
    id: "portfolio-stop",
    label: "전체 손절",
    price: portfolioStopPrice,
    allocationPct: 30,
    currentPrice,
    direction: "below",
    note: "보유 논리가 깨졌다고 보고 잔여 비중 정리를 검토하는 최종 방어선입니다.",
  });
  const takeProfitLevels = [
    level({
      id: "take-profit-1",
      label: "1차 분할익절",
      price: firstTakeProfitPrice,
      allocationPct: 30,
      currentPrice,
      direction: "above",
      note: "저항선 근처 또는 1R 도달 시 일부 수익 보호를 검토합니다.",
    }),
    level({
      id: "take-profit-2",
      label: "2차 분할익절",
      price: secondTakeProfitPrice,
      allocationPct: 30,
      currentPrice,
      direction: "above",
      note: "2R 또는 +20% 전환가 도달 시 추가 수익 실현을 검토합니다.",
    }),
    level({
      id: "runner",
      label: "잔여 추세보유",
      price: trailingStopPrice,
      allocationPct: 40,
      currentPrice,
      direction: "below",
      note: "잔여 40%는 20일선/추적 손절 이탈 전까지 추세를 따라갑니다.",
    }),
  ];
  const stagedExitPlan = [
    setupStop,
    level({
      id: "defense-stop",
      label: "추가 비중 축소",
      price: trailingStopPrice ?? setupStopPrice,
      allocationPct: 40,
      currentPrice,
      direction: "below",
      note: "추적 손절 또는 주요 지지선 이탈 시 추가 방어를 검토합니다.",
    }),
    portfolioStop,
  ];
  const riskWarnings = [
    setupStop.status === "triggered" ? "현재가가 돌파매매 손절 기준을 이미 이탈했습니다." : null,
    isNumber(setupStop.distancePct) && setupStop.distancePct < -0.12
      ? "돌파매매 손절선까지 거리가 12%를 넘어 손절폭이 큽니다."
      : null,
    !currencyMatched ? "평단가와 현재가 통화가 달라 손익률 기반 익절 판단은 제외합니다." : null,
    signalReliability?.grade === "low" ? "유사 신호 신뢰도가 낮아 비중 확대보다 방어 기준 확인이 우선입니다." : null,
  ].filter((warning): warning is string => Boolean(warning));
  const firstProfitTriggered = takeProfitLevels.some(
    (item) => item.id.startsWith("take-profit") && item.status === "triggered",
  );
  const nearSetupStop =
    isNumber(currentPrice) &&
    isNumber(setupStopPrice) &&
    currentPrice <= setupStopPrice * 1.03;
  const bias =
    setupStop.status === "triggered" || portfolioStop.status === "triggered" || nearSetupStop
      ? "defense"
      : firstProfitTriggered
        ? "take-profit"
        : tradeSetup?.type === "risk-off"
          ? "wait"
          : "hold";
  const headline =
    bias === "defense"
      ? "손절 기준이 가까워 분할 방어와 추가매수 금지가 우선입니다."
      : bias === "take-profit"
        ? "목표가에 도달했거나 근접해 분할익절과 잔여 추세보유를 함께 봅니다."
        : bias === "wait"
          ? "방어 신호가 있어 신규 비중 확대보다 회복 확인이 우선입니다."
          : "손절선과 목표가를 함께 두고 보유 논리를 관리합니다.";

  return {
    bias,
    headline,
    setupStop,
    portfolioStop,
    trailingStop,
    takeProfitLevels,
    stagedExitPlan,
    reentryCondition:
      breakoutSignal?.entryPlan ??
      tradeSetup?.validIf ??
      "손절 후에는 기준선 회복과 거래량 재확인이 동시에 나올 때만 재진입을 검토합니다.",
    riskWarnings,
  };
};
