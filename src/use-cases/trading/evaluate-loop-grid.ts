import type { LoopGridPlan, LoopGridState } from "@/domain/automation";

export type LoopGridBuyTrigger = {
  side: "buy";
  buyLevel: number;
  anchorPrice: number;
  quantity: number;
  notional: number;
  reason: string;
};

export type LoopGridSellTrigger = {
  side: "sell";
  sellLevel: number;
  entryPrice: number;
  quantity: number;
  reason: string;
};

export type LoopGridEvaluation = {
  buy: LoopGridBuyTrigger | null;
  sell: LoopGridSellTrigger | null;
  blockers: string[];
};

export type EvaluateLoopGridInput = {
  plan: LoopGridPlan;
  marketPrice: number;
  state: LoopGridState;
  dailyBuys: number;
  dailySells: number;
  maxDailyBuys: number;
  maxDailySells: number;
  maxPositionValue: number;
  /** 기준가 대비 이 하락률을 넘으면 신규 매수만 중단합니다. */
  maxLossPct: number;
  now: string;
  /** 코인처럼 소수 수량을 허용할 때 true. */
  fractionalQuantity?: boolean;
};

const stepQuantity = (notional: number, price: number, fractional = false) =>
  fractional
    ? Math.floor((notional / price) * 100_000_000) / 100_000_000
    : Math.max(1, Math.floor(notional / price));

const minutesBetween = (fromIso: string, toIso: string) => {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (to - from) / 60_000);
};

export const loopBuyLevel = (anchorPrice: number, buyDropPct: number) =>
  anchorPrice * (1 - buyDropPct / 100);

export const loopSellLevel = (entryPrice: number, sellRisePct: number) =>
  entryPrice * (1 + sellRisePct / 100);

export const evaluateLoopGrid = ({
  plan,
  marketPrice,
  state,
  dailyBuys,
  dailySells,
  maxDailyBuys,
  maxDailySells,
  maxPositionValue,
  maxLossPct,
  now,
  fractionalQuantity = false,
}: EvaluateLoopGridInput): LoopGridEvaluation => {
  const blockers: string[] = [];
  const anchorPrice = Number.isFinite(state.anchorPrice) && state.anchorPrice > 0
    ? state.anchorPrice
    : plan.anchorPrice;

  if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
    blockers.push("순환매매 기준가가 올바르지 않습니다.");
    return { buy: null, sell: null, blockers };
  }
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    blockers.push("유효한 현재가를 확인할 수 없습니다.");
    return { buy: null, sell: null, blockers };
  }
  if (plan.buyDropPct <= 0 || plan.sellRisePct <= 0) {
    blockers.push("순환매매 매수/매도 퍼센트는 0보다 커야 합니다.");
    return { buy: null, sell: null, blockers };
  }
  if (plan.notional <= 0) {
    blockers.push("순환매매 1회 매수 금액이 필요합니다.");
    return { buy: null, sell: null, blockers };
  }
  if (plan.notional > maxPositionValue) {
    blockers.push("1회 매수 금액이 최대 보유 금액을 초과합니다.");
    return { buy: null, sell: null, blockers };
  }
  if (
    state.lastCycleAt &&
    plan.cooldownMinutes > 0 &&
    minutesBetween(state.lastCycleAt, now) < plan.cooldownMinutes
  ) {
    blockers.push(`쿨다운 ${plan.cooldownMinutes}분 대기 중입니다.`);
    return { buy: null, sell: null, blockers };
  }

  if (state.positionState === "holding") {
    const entryPrice = state.entryPrice ?? 0;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || state.quantity <= 0) {
      blockers.push("순환매매 보유 상태가 올바르지 않습니다.");
      return { buy: null, sell: null, blockers };
    }
    const sellLevel = loopSellLevel(entryPrice, plan.sellRisePct);
    if (marketPrice < sellLevel) {
      return { buy: null, sell: null, blockers };
    }
    if (dailySells >= maxDailySells) {
      blockers.push(`일일 최대 매도 횟수(${maxDailySells}) 초과로 순환매도 보류`);
      return { buy: null, sell: null, blockers };
    }
    return {
      buy: null,
      sell: {
        side: "sell",
        sellLevel,
        entryPrice,
        quantity: state.quantity,
        reason: `순환매도 발동 (매수가 ${Math.round(entryPrice)} +${plan.sellRisePct}% = ${Math.round(sellLevel)}, 현재가 ${Math.round(marketPrice)})`,
      },
      blockers,
    };
  }

  const buyLevel = loopBuyLevel(anchorPrice, plan.buyDropPct);
  if (marketPrice > buyLevel) {
    return { buy: null, sell: null, blockers };
  }
  const currentDropPct = ((anchorPrice - marketPrice) / anchorPrice) * 100;
  if (Number.isFinite(maxLossPct) && maxLossPct > 0 && currentDropPct > maxLossPct) {
    blockers.push(`추가매수 중단선(${maxLossPct}%) 초과로 순환매수 보류`);
    return { buy: null, sell: null, blockers };
  }
  if (dailyBuys >= maxDailyBuys) {
    blockers.push(`일일 최대 매수 횟수(${maxDailyBuys}) 초과로 순환매수 보류`);
    return { buy: null, sell: null, blockers };
  }
  return {
    buy: {
      side: "buy",
      buyLevel,
      anchorPrice,
      quantity: stepQuantity(plan.notional, buyLevel, fractionalQuantity),
      notional: plan.notional,
      reason: `순환매수 발동 (기준가 ${Math.round(anchorPrice)} −${plan.buyDropPct}% = ${Math.round(buyLevel)}, 현재가 ${Math.round(marketPrice)})`,
    },
    sell: null,
    blockers,
  };
};
