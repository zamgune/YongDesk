import type { AutomationStrategyConfig } from "@/domain/automation";

/**
 * 순환분할식 사다리 자동매매의 "트리거 평가" 순수 함수.
 *
 * 한 틱(현재가 한 번)에 대해 어떤 사다리 단계가 발동되는지, 어떤 단계가 일일
 * 한도/포지션 한도/멱등(이미 발동)으로 막히는지 계산합니다. 실제 주문 전송은
 * 하지 않습니다 — 오케스트레이션(run-automation-worker)이 BrokerPort로 처리합니다.
 *
 * 트리거 규칙:
 * - 매수 단계: 현재가 <= 단계가격 (가격이 매수 사다리까지 내려옴)
 * - 매도 단계: 현재가 >= 단계가격 (가격이 매도 사다리까지 올라옴)
 */

export type LadderTrigger = {
  /** 멱등 키. `${configId}:${stepId}` */
  stepKey: string;
  stepId: string;
  side: "buy" | "sell";
  limitPrice: number;
  quantity: number;
  notional: number;
  reason: string;
};

export type LadderSkip = {
  stepId: string;
  side: "buy" | "sell";
  reason: string;
};

export type LadderEvaluation = {
  triggers: LadderTrigger[];
  skipped: LadderSkip[];
  /** 전략 단위 차단 사유 (있으면 트리거를 만들지 않음) */
  blockers: string[];
  exitSignal: ExitSignal | null;
};

export type ExitSignal = {
  kind: "take-profit" | "stop-loss";
  /** exitRules 기준 가격 */
  level: number;
  reason: string;
};

export type EvaluateLadderInput = {
  config: AutomationStrategyConfig;
  /** 토스 현재가 */
  marketPrice: number;
  /** 이미 발동되어 처리된 stepKey 집합 (오늘 기준) */
  executedStepKeys: ReadonlySet<string>;
  /** 오늘 누적 매수/매도 횟수 */
  dailyBuys: number;
  dailySells: number;
  /** 청산 기준 진입가. 보유 평단(holdings)을 우선 사용하고, 없으면 config.currentPrice */
  entryPrice?: number | null;
};

const stepQuantity = (notional: number, price: number) =>
  Math.max(1, Math.floor(notional / price));

/**
 * exitRules(익절/손절률)를 현재가 진입 기준으로 환산해 청산 신호를 판단합니다.
 * 기준가는 전략의 currentPrice(설정 시점 현재가)를 진입 평단 근사치로 사용합니다.
 * (정확한 보유 평단 기반 청산은 holdings 동기화 단계에서 대체)
 */
const evaluateExit = (
  config: AutomationStrategyConfig,
  marketPrice: number,
  entryPrice?: number | null,
): ExitSignal | null => {
  const entry = entryPrice && Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : config.currentPrice;
  if (!Number.isFinite(entry) || entry <= 0) {
    return null;
  }
  const takeLevel = entry * (1 + config.exitRules.takeProfitPct / 100);
  const stopLevel = entry * (1 - config.exitRules.stopLossPct / 100);
  if (marketPrice >= takeLevel) {
    return {
      kind: "take-profit",
      level: takeLevel,
      reason: `익절 기준 +${config.exitRules.takeProfitPct}% (≈${Math.round(takeLevel)}) 도달`,
    };
  }
  if (marketPrice <= stopLevel) {
    return {
      kind: "stop-loss",
      level: stopLevel,
      reason: `손절 기준 -${config.exitRules.stopLossPct}% (≈${Math.round(stopLevel)}) 이탈`,
    };
  }
  return null;
};

export const evaluateLadderTriggers = ({
  config,
  marketPrice,
  executedStepKeys,
  dailyBuys,
  dailySells,
  entryPrice,
}: EvaluateLadderInput): LadderEvaluation => {
  const triggers: LadderTrigger[] = [];
  const skipped: LadderSkip[] = [];
  const blockers: string[] = [];

  if (config.status !== "enabled") {
    blockers.push("전략이 활성(enabled) 상태가 아닙니다.");
    return { triggers, skipped, blockers, exitSignal: null };
  }
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    blockers.push("유효한 현재가를 확인할 수 없습니다.");
    return { triggers, skipped, blockers, exitSignal: null };
  }

  const exitSignal = evaluateExit(config, marketPrice, entryPrice);

  // 틱 내 누적 카운터/포지션 가치 (이번 틱에서 새로 발동되는 분 포함)
  let buys = dailyBuys;
  let sells = dailySells;
  let committedNotional = 0;

  // 가격 우선순위: 매수는 현재가에 가까운(높은) 가격부터, 매도는 낮은 가격부터
  const ordered = [...config.ladder].sort((a, b) =>
    a.side === b.side ? (a.side === "buy" ? b.price - a.price : a.price - b.price) : 0,
  );

  for (const step of ordered) {
    const stepKey = `${config.id}:${step.id}`;
    if (executedStepKeys.has(stepKey)) {
      continue; // 이미 발동됨 (멱등)
    }
    const triggered =
      step.side === "buy" ? marketPrice <= step.price : marketPrice >= step.price;
    if (!triggered) {
      continue;
    }

    if (step.side === "buy") {
      if (buys >= config.riskLimits.maxDailyBuys) {
        skipped.push({ stepId: step.id, side: "buy", reason: "일일 최대 매수 횟수 초과" });
        continue;
      }
      if (committedNotional + step.notional > config.riskLimits.maxPositionValue) {
        skipped.push({ stepId: step.id, side: "buy", reason: "최대 보유 금액 한도 초과" });
        continue;
      }
      buys += 1;
      committedNotional += step.notional;
    } else {
      if (sells >= config.riskLimits.maxDailySells) {
        skipped.push({ stepId: step.id, side: "sell", reason: "일일 최대 매도 횟수 초과" });
        continue;
      }
      sells += 1;
    }

    triggers.push({
      stepKey,
      stepId: step.id,
      side: step.side,
      limitPrice: step.price,
      quantity: stepQuantity(step.notional, step.price),
      notional: step.notional,
      reason:
        step.condition ||
        `${step.side === "buy" ? "매수" : "매도"} 사다리 ${step.price} 도달 (현재가 ${marketPrice})`,
    });
  }

  return { triggers, skipped, blockers, exitSignal };
};
