import type { AutomationOrderSizing, GridLot, GridPlan, GridRung } from "@/domain/automation";
import { resolveOrderSizing } from "./resolve-order-sizing.ts";

/**
 * 순환분할식 퍼센트 그리드 평가 (순수 함수).
 *
 * - 매수: 가격이 차수별 매수선(기준가 × (1 − buyDropPct))까지 내려오고, 그 차수를
 *   현재 보유(open lot)하고 있지 않으면 매수. → 가격이 빠질수록 자동 물타기.
 * - 매도: 보유 중인 각 차수(lot)를 자기 매수가 × (1 + sellRisePct)에 개별 매도.
 *   → 오를 때마다 차수별 익절. (정석 순환분할)
 *
 * 차수별로 buyDropPct/sellRisePct 를 다르게 줄 수 있어 가변 퍼센트를 지원합니다.
 * 멱등성은 "그 차수의 open lot 유무"로 보장합니다(같은 차수는 팔리기 전엔 재매수 안 함).
 */

export type GridBuyTrigger = {
  rungIndex: number;
  /** 매수 발동(지정가) 가격 = basePrice × (1 − buyDropPct/100) */
  buyLevel: number;
  quantity: number;
  notional: number;
  reason: string;
};

export type GridSellTrigger = {
  lotId: string;
  rungIndex: number;
  /** 매도 발동(지정가) 가격 = entryPrice × (1 + sellRisePct/100) */
  sellLevel: number;
  quantity: number;
  entryPrice: number;
  reason: string;
};

export type GridEvaluation = {
  buys: GridBuyTrigger[];
  sells: GridSellTrigger[];
  blockers: string[];
};

export type EvaluateGridInput = {
  plan: GridPlan;
  marketPrice: number;
  openLots: GridLot[];
  /** 오늘 누적 매수/매도 횟수 (일일 한도 적용용) */
  dailyBuys: number;
  dailySells: number;
  maxDailyBuys: number;
  maxDailySells: number;
  /** 기준가 대비 이 하락률을 넘으면 신규 매수만 중단합니다. */
  maxLossPct: number;
  orderSizing?: AutomationOrderSizing;
  /** 코인처럼 소수 수량을 허용할 때 true. */
  fractionalQuantity?: boolean;
};

const buyLevelFor = (basePrice: number, rung: GridRung) =>
  basePrice * (1 - rung.buyDropPct / 100);

const sellLevelFor = (lot: GridLot, rung: GridRung | undefined, fallbackRisePct: number) => {
  const risePct = rung ? rung.sellRisePct : fallbackRisePct;
  return lot.entryPrice * (1 + risePct / 100);
};

/** 차수별 매수선/매도선 미리보기 (UI용) */
export const gridPreview = (plan: GridPlan) =>
  plan.rungs
    .toSorted((a, b) => a.index - b.index)
    .map((rung) => ({
      rungIndex: rung.index,
      buyDropPct: rung.buyDropPct,
      sellRisePct: rung.sellRisePct,
      buyLevel: Math.round(buyLevelFor(plan.basePrice, rung) * 100) / 100,
      notional: rung.notional,
    }));

export const evaluatePercentGrid = ({
  plan,
  marketPrice,
  openLots,
  dailyBuys,
  dailySells,
  maxDailyBuys,
  maxDailySells,
  maxLossPct,
  orderSizing,
  fractionalQuantity = false,
}: EvaluateGridInput): GridEvaluation => {
  const buys: GridBuyTrigger[] = [];
  const sells: GridSellTrigger[] = [];
  const blockers: string[] = [];

  if (!Number.isFinite(plan.basePrice) || plan.basePrice <= 0) {
    blockers.push("그리드 기준가가 올바르지 않습니다.");
    return { buys, sells, blockers };
  }
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    blockers.push("유효한 현재가를 확인할 수 없습니다.");
    return { buys, sells, blockers };
  }

  const rungByIndex = new Map(plan.rungs.map((r) => [r.index, r]));
  const heldRungs = new Set(openLots.map((lot) => lot.rungIndex));
  const currentDropPct = ((plan.basePrice - marketPrice) / plan.basePrice) * 100;
  const buyStoppedByLossLimit = Number.isFinite(maxLossPct) && maxLossPct > 0 && currentDropPct > maxLossPct;

  let buyCount = dailyBuys;
  let sellCount = dailySells;

  // 매수: 발동선 도달 + 미보유 차수 (깊은 차수부터 처리하면 한 틱 다중 발동도 자연스러움)
  if (buyStoppedByLossLimit) {
    blockers.push(`추가매수 중단선(${maxLossPct}%) 초과로 신규 매수를 보류합니다.`);
  } else {
    for (const rung of [...plan.rungs].sort((a, b) => b.buyDropPct - a.buyDropPct)) {
      if (heldRungs.has(rung.index)) {
        continue;
      }
      if (Number.isFinite(maxLossPct) && maxLossPct > 0 && rung.buyDropPct > maxLossPct) {
        blockers.push(`추가매수 중단선(${maxLossPct}%) 초과로 ${rung.index}차 매수 보류`);
        continue;
      }
      const buyLevel = buyLevelFor(plan.basePrice, rung);
      if (marketPrice > buyLevel) {
        continue;
      }
      if (buyCount >= maxDailyBuys) {
        blockers.push(`일일 최대 매수 횟수(${maxDailyBuys}) 초과로 ${rung.index}차 매수 보류`);
        continue;
      }
      buyCount += 1;
      const sizing = resolveOrderSizing({
        orderSizing,
        legacyNotional: rung.notional,
        price: buyLevel,
        fractionalQuantity,
      });
      buys.push({
        rungIndex: rung.index,
        buyLevel,
        quantity: sizing.quantity,
        notional: sizing.notional,
        reason: `${rung.index}차 매수 발동 (기준가 −${rung.buyDropPct}% = ${Math.round(buyLevel)}, 현재가 ${Math.round(marketPrice)})`,
      });
    }
  }

  // 매도: 보유 차수별 개별 익절
  for (const lot of openLots) {
    const rung = rungByIndex.get(lot.rungIndex);
    const sellLevel = sellLevelFor(lot, rung, 0);
    if (rung === undefined) {
      continue;
    }
    if (marketPrice < sellLevel) {
      continue;
    }
    if (sellCount >= maxDailySells) {
      blockers.push(`일일 최대 매도 횟수(${maxDailySells}) 초과로 ${lot.rungIndex}차 매도 보류`);
      continue;
    }
    sellCount += 1;
    sells.push({
      lotId: lot.lotId,
      rungIndex: lot.rungIndex,
      sellLevel,
      quantity: lot.quantity,
      entryPrice: lot.entryPrice,
      reason: `${lot.rungIndex}차 익절 발동 (매수가 ${Math.round(lot.entryPrice)} +${rung.sellRisePct}% = ${Math.round(sellLevel)}, 현재가 ${Math.round(marketPrice)})`,
    });
  }

  return { buys, sells, blockers };
};
