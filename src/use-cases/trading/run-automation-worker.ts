import { createHash, randomUUID } from "node:crypto";

import type { AutomationStrategyConfig } from "@/domain/automation";
import type { BrokerOrderRequest } from "@/domain/trading";
import type { BrokerPort } from "@/ports/broker";
import { LiveTradingDisabledError } from "@/adapters/toss/toss-broker";
import { TossApiError } from "@/lib/toss/client";
import {
  evaluateLadderTriggers,
  type LadderTrigger,
} from "./evaluate-ladder-triggers.ts";
import { evaluateLoopGrid } from "./evaluate-loop-grid.ts";
import { evaluatePercentGrid } from "./evaluate-percent-grid.ts";
import type { OrderPrecheck } from "./precheck-order.ts";
import { closeGridLot, getGridLots, openGridLot } from "@/lib/automation/grid-state";
import { getLoopGridState, recordLoopGridBuy, recordLoopGridSell } from "@/lib/automation/loop-state";
import {
  getWorkerState,
  recordExecutedStep,
  saveWorkerState,
  type StrategyWorkerState,
} from "@/lib/automation/worker-state";

export type WorkerLogLevel = "info" | "warning" | "error";

export type WorkerLog = {
  level: WorkerLogLevel;
  stepId?: string;
  message: string;
};

export type WorkerOrderOutcome = {
  stepId: string;
  side: "buy" | "sell";
  limitPrice: number | null;
  quantity: number;
  clientOrderId: string;
  status: "submitted" | "blocked" | "rejected" | "error";
  brokerOrderId?: string;
  message: string;
};

export type AutomationWorkerTickResult = {
  strategyId: string;
  symbol: string;
  marketPrice: number;
  liveTradingEnabled: boolean;
  evaluatedAt: string;
  triggers: number;
  orders: WorkerOrderOutcome[];
  logs: WorkerLog[];
};

export type RunAutomationWorkerTickInput = {
  userId: string;
  config: AutomationStrategyConfig;
  /** 토스에서 받은 현재가 */
  marketPrice: number;
  broker: BrokerPort;
  /** BrokerPort 가 실거래를 허용하는지. 로그/응답 표기에 사용 */
  liveTradingEnabled: boolean;
  accountSeq: number;
  /** YYYY-MM-DD. 호출부에서 KST 영업일 기준으로 전달 */
  today: string;
  /** 주문 전 잔고·매도가능수량 사전검증 (없으면 검증 생략) */
  precheck?: OrderPrecheck;
  /** 청산(익절/손절) 시 매도할 보유 수량 해석기. 없으면 청산은 신호 로그만 */
  resolveExitQuantity?: (symbol: string) => Promise<number>;
  /** 청산 기준 진입가(보유 평단) 해석기. 없으면 config.currentPrice 근사 사용 */
  resolveEntryPrice?: (symbol: string) => Promise<number | null>;
  /** rescueMode=cancel-and-liquidate 시 취소할 미체결 주문 ID 해석기 */
  resolveOpenOrderIds?: (symbol: string) => Promise<string[]>;
  now?: string;
};

const marketCurrency = (market: "US" | "KR" | "CRYPTO") => (market === "US" ? "USD" : "KRW");

/** 토스 clientOrderId 제약(≤36, [A-Za-z0-9-_])에 맞춘 결정적 멱등 키 */
const toClientOrderId = (stepKey: string, today: string): string =>
  createHash("sha256").update(`${stepKey}:${today}`).digest("hex").slice(0, 32);

export const runAutomationWorkerTick = async ({
  userId,
  config,
  marketPrice,
  broker,
  liveTradingEnabled,
  accountSeq,
  today,
  precheck,
  resolveExitQuantity,
  resolveEntryPrice,
  resolveOpenOrderIds,
  now = new Date().toISOString(),
}: RunAutomationWorkerTickInput): Promise<AutomationWorkerTickResult> => {
  const logs: WorkerLog[] = [];
  const orders: WorkerOrderOutcome[] = [];

  let state = await getWorkerState(userId, config.id, today);

  const symbol = config.symbol.trim().toUpperCase();

  // 순환분할식 퍼센트 그리드 모드
  if (config.mode === "percent-grid" && config.grid) {
    return runGridTick({
      userId,
      config,
      symbol,
      marketPrice,
      broker,
      liveTradingEnabled,
      accountSeq,
      precheck,
      state,
      now,
    });
  }

  // 1% 순환매매 모드
  if (config.mode === "loop-grid" && config.loop) {
    return runLoopGridTick({
      userId,
      config,
      symbol,
      marketPrice,
      broker,
      liveTradingEnabled,
      accountSeq,
      precheck,
      state,
      now,
    });
  }

  const entryPrice = resolveEntryPrice ? await resolveEntryPrice(symbol) : null;

  const evaluation = evaluateLadderTriggers({
    config,
    marketPrice,
    executedStepKeys: new Set(state.executedStepKeys),
    dailyBuys: state.buys,
    dailySells: state.sells,
    entryPrice,
  });

  for (const blocker of evaluation.blockers) {
    logs.push({ level: "warning", message: blocker });
  }
  for (const skip of evaluation.skipped) {
    logs.push({ level: "warning", stepId: skip.stepId, message: `건너뜀: ${skip.reason}` });
  }
  if (evaluation.exitSignal) {
    logs.push({
      level: evaluation.exitSignal.kind === "stop-loss" ? "warning" : "info",
      message: `청산 신호(${evaluation.exitSignal.kind}): ${evaluation.exitSignal.reason}`,
    });
  }

  for (const trigger of evaluation.triggers) {
    // 사전검증 (잔고/매도가능수량). 실패 시 전송하지 않고 rejected 처리.
    if (precheck) {
      const check = await precheck({
        side: trigger.side,
        symbol: config.symbol.trim().toUpperCase(),
        quantity: trigger.quantity,
        price: trigger.limitPrice,
        currency: marketCurrency(config.market),
      });
      if (!check.ok) {
        orders.push({
          stepId: trigger.stepId,
          side: trigger.side,
          limitPrice: trigger.limitPrice,
          quantity: trigger.quantity,
          clientOrderId: "",
          status: "rejected",
          message: `사전검증 거부: ${check.reason ?? "사유 미상"}`,
        });
        logs.push({ level: "warning", stepId: trigger.stepId, message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        continue;
      }
    }

    const outcome = await submitTrigger({
      config,
      trigger,
      broker,
      accountSeq,
      today,
    });
    orders.push(outcome);
    logs.push({
      level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info",
      stepId: trigger.stepId,
      message: outcome.message,
    });
    // 실제 전송된 경우에만 원장에 기록 (blocked/error 는 다음 틱 재평가)
    if (outcome.status === "submitted") {
      state = recordExecutedStep(state, trigger.stepKey, trigger.side);
    }
  }

  // 청산 신호 처리: (rescue 시) 미체결 취소 → 보유 수량 전량 시장가 매도 (일일 멱등)
  if (evaluation.exitSignal && resolveExitQuantity) {
    const exitStepKey = `${config.id}:exit:${evaluation.exitSignal.kind}`;
    if (!state.executedStepKeys.includes(exitStepKey)) {
      // rescueMode=cancel-and-liquidate: 청산 전 해당 종목 미체결 주문 취소
      if (config.exitRules.rescueMode === "cancel-and-liquidate" && resolveOpenOrderIds) {
        await cancelOpenOrdersForExit({ symbol, broker, accountSeq, resolveOpenOrderIds, logs });
      }
      const quantity = await resolveExitQuantity(symbol);
      if (quantity > 0) {
        const outcome = await submitExitOrder({
          symbol,
          quantity,
          exitStepKey,
          reason: evaluation.exitSignal.reason,
          broker,
          accountSeq,
          today,
        });
        orders.push(outcome);
        logs.push({
          level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info",
          message: outcome.message,
        });
        if (outcome.status === "submitted") {
          state = recordExecutedStep(state, exitStepKey, "sell");
        }
      } else {
        logs.push({
          level: "info",
          message: `청산 신호(${evaluation.exitSignal.kind}) 발생했으나 매도 가능 보유 수량이 0입니다.`,
        });
      }
    }
  }

  await saveWorkerState(state);

  return {
    strategyId: config.id,
    symbol: config.symbol,
    marketPrice,
    liveTradingEnabled,
    evaluatedAt: now,
    triggers: evaluation.triggers.length,
    orders,
    logs,
  };
};

const submitTrigger = async ({
  config,
  trigger,
  broker,
  accountSeq,
  today,
}: {
  config: AutomationStrategyConfig;
  trigger: LadderTrigger;
  broker: BrokerPort;
  accountSeq: number;
  today: string;
}): Promise<WorkerOrderOutcome> => {
  const clientOrderId = toClientOrderId(trigger.stepKey, today);
  const request: BrokerOrderRequest = {
    orderIntentId: trigger.stepKey,
    accountSeq,
    symbol: config.symbol,
    side: trigger.side,
    type: "limit",
    quantity: trigger.quantity,
    limitPrice: trigger.limitPrice,
    stopPrice: null,
    clientOrderId,
    timeInForce: "DAY",
  };

  const base = {
    stepId: trigger.stepId,
    side: trigger.side,
    limitPrice: trigger.limitPrice,
    quantity: trigger.quantity,
    clientOrderId,
  };

  try {
    const result = await broker.submitOrder(request);
    return {
      ...base,
      status: "submitted",
      brokerOrderId: result.brokerOrderId,
      message: `주문 전송: ${trigger.side === "buy" ? "매수" : "매도"} ${trigger.quantity}주 @ ${trigger.limitPrice} (${trigger.reason})`,
    };
  } catch (error) {
    if (error instanceof LiveTradingDisabledError) {
      return {
        ...base,
        status: "blocked",
        message: `[실거래 비활성] 전송 차단 — 발동 조건 충족: ${trigger.side === "buy" ? "매수" : "매도"} ${trigger.quantity}주 @ ${trigger.limitPrice} (${trigger.reason})`,
      };
    }
    if (error instanceof TossApiError) {
      return {
        ...base,
        status: "error",
        message: `토스 주문 실패 [${error.code}]: ${error.message}`,
      };
    }
    return {
      ...base,
      status: "error",
      message: `주문 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const cancelOpenOrdersForExit = async ({
  symbol,
  broker,
  accountSeq,
  resolveOpenOrderIds,
  logs,
}: {
  symbol: string;
  broker: BrokerPort;
  accountSeq: number;
  resolveOpenOrderIds: (symbol: string) => Promise<string[]>;
  logs: WorkerLog[];
}): Promise<void> => {
  let orderIds: string[] = [];
  try {
    orderIds = await resolveOpenOrderIds(symbol);
  } catch (error) {
    logs.push({
      level: "warning",
      message: `청산 전 미체결 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  for (const orderId of orderIds) {
    try {
      await broker.cancelOrder({ accountSeq, brokerOrderId: orderId });
      logs.push({ level: "info", message: `청산 전 미체결 취소: ${orderId}` });
    } catch (error) {
      if (error instanceof TossApiError) {
        logs.push({ level: "warning", message: `미체결 취소 실패 [${error.code}] ${orderId}: ${error.message}` });
      } else {
        logs.push({
          level: "warning",
          message: `미체결 취소 차단/오류 ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
};

const submitExitOrder = async ({
  symbol,
  quantity,
  exitStepKey,
  reason,
  broker,
  accountSeq,
  today,
}: {
  symbol: string;
  quantity: number;
  exitStepKey: string;
  reason: string;
  broker: BrokerPort;
  accountSeq: number;
  today: string;
}): Promise<WorkerOrderOutcome> => {
  const clientOrderId = toClientOrderId(exitStepKey, today);
  const request: BrokerOrderRequest = {
    orderIntentId: exitStepKey,
    accountSeq,
    symbol,
    side: "sell",
    type: "market",
    quantity,
    limitPrice: null,
    stopPrice: null,
    clientOrderId,
    timeInForce: "DAY",
  };
  const base = {
    stepId: exitStepKey.split(":").slice(-1).join(":"),
    side: "sell" as const,
    limitPrice: null,
    quantity,
    clientOrderId,
  };
  try {
    const result = await broker.submitOrder(request);
    return {
      ...base,
      status: "submitted",
      brokerOrderId: result.brokerOrderId,
      message: `청산 매도 전송: ${quantity}주 시장가 (${reason})`,
    };
  } catch (error) {
    if (error instanceof LiveTradingDisabledError) {
      return {
        ...base,
        status: "blocked",
        message: `[실거래 비활성] 청산 전송 차단 — 매도 ${quantity}주 시장가 (${reason})`,
      };
    }
    if (error instanceof TossApiError) {
      return { ...base, status: "error", message: `청산 주문 실패 [${error.code}]: ${error.message}` };
    }
    return {
      ...base,
      status: "error",
      message: `청산 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// === 순환분할 퍼센트 그리드 ===

const submitGridOrder = async ({
  symbol,
  side,
  quantity,
  limitPrice,
  reason,
  stepId,
  broker,
  accountSeq,
  label = "그리드",
}: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  reason: string;
  stepId: string;
  broker: BrokerPort;
  accountSeq: number;
  label?: string;
}): Promise<WorkerOrderOutcome> => {
  // 그리드는 lot 상태로 멱등을 보장하므로 주문마다 고유 clientOrderId 사용
  const clientOrderId = randomUUID().replace(/-/g, "").slice(0, 32);
  const request: BrokerOrderRequest = {
    orderIntentId: stepId,
    accountSeq,
    symbol,
    side,
    type: "limit",
    quantity,
    limitPrice,
    stopPrice: null,
    clientOrderId,
    timeInForce: "DAY",
  };
  const base = { stepId, side, limitPrice, quantity, clientOrderId };
  try {
    const result = await broker.submitOrder(request);
    return {
      ...base,
      status: "submitted",
      brokerOrderId: result.brokerOrderId,
      message: `주문 전송: ${side === "buy" ? "매수" : "매도"} ${quantity}주 @ ${Math.round(limitPrice)} (${reason})`,
    };
  } catch (error) {
    if (error instanceof LiveTradingDisabledError) {
      return {
        ...base,
        status: "blocked",
        message: `[실거래 비활성] 전송 차단 — ${side === "buy" ? "매수" : "매도"} ${quantity}주 @ ${Math.round(limitPrice)} (${reason})`,
      };
    }
    if (error instanceof TossApiError) {
      return { ...base, status: "error", message: `${label} 주문 실패 [${error.code}]: ${error.message}` };
    }
    return {
      ...base,
      status: "error",
      message: `${label} 주문 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const runGridTick = async ({
  userId,
  config,
  symbol,
  marketPrice,
  broker,
  liveTradingEnabled,
  accountSeq,
  precheck,
  state,
  now,
}: {
  userId: string;
  config: RunAutomationWorkerTickInput["config"];
  symbol: string;
  marketPrice: number;
  broker: BrokerPort;
  liveTradingEnabled: boolean;
  accountSeq: number;
  precheck?: OrderPrecheck;
  state: StrategyWorkerState;
  now: string;
}): Promise<AutomationWorkerTickResult> => {
  const logs: WorkerLog[] = [];
  const orders: WorkerOrderOutcome[] = [];
  const plan = config.grid!;
  const currency = config.market === "US" ? "USD" : "KRW";

  const openLots = await getGridLots(userId, config.id);
  const evaluation = evaluatePercentGrid({
    plan,
    marketPrice,
    openLots,
    dailyBuys: state.buys,
    dailySells: state.sells,
    maxDailyBuys: config.riskLimits.maxDailyBuys,
    maxDailySells: config.riskLimits.maxDailySells,
    maxLossPct: config.riskLimits.maxLossPct,
    fractionalQuantity: config.market === "CRYPTO",
  });

  for (const blocker of evaluation.blockers) {
    logs.push({ level: "warning", message: blocker });
  }

  let buys = state.buys;
  let sells = state.sells;

  // 매수 차수
  for (const buy of evaluation.buys) {
    const stepId = `grid:buy:r${buy.rungIndex}`;
    if (precheck) {
      const check = await precheck({ side: "buy", symbol, quantity: buy.quantity, price: buy.buyLevel, currency });
      if (!check.ok) {
        orders.push({ stepId, side: "buy", limitPrice: buy.buyLevel, quantity: buy.quantity, clientOrderId: "", status: "rejected", message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        logs.push({ level: "warning", stepId, message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        continue;
      }
    }
    const outcome = await submitGridOrder({ symbol, side: "buy", quantity: buy.quantity, limitPrice: buy.buyLevel, reason: buy.reason, stepId, broker, accountSeq });
    orders.push(outcome);
    logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
    if (outcome.status === "submitted") {
      await openGridLot(userId, config.id, { rungIndex: buy.rungIndex, entryPrice: buy.buyLevel, quantity: buy.quantity });
      buys += 1;
    }
  }

  // 매도 차수 (차수별 개별)
  for (const sell of evaluation.sells) {
    const stepId = `grid:sell:r${sell.rungIndex}`;
    if (precheck) {
      const check = await precheck({ side: "sell", symbol, quantity: sell.quantity, price: sell.sellLevel, currency });
      if (!check.ok) {
        orders.push({ stepId, side: "sell", limitPrice: sell.sellLevel, quantity: sell.quantity, clientOrderId: "", status: "rejected", message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        logs.push({ level: "warning", stepId, message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        continue;
      }
    }
    const outcome = await submitGridOrder({ symbol, side: "sell", quantity: sell.quantity, limitPrice: sell.sellLevel, reason: sell.reason, stepId, broker, accountSeq });
    orders.push(outcome);
    logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
    if (outcome.status === "submitted") {
      await closeGridLot(userId, config.id, sell.lotId);
      sells += 1;
    }
  }

  await saveWorkerState({ ...state, buys, sells });

  return {
    strategyId: config.id,
    symbol: config.symbol,
    marketPrice,
    liveTradingEnabled,
    evaluatedAt: now,
    triggers: evaluation.buys.length + evaluation.sells.length,
    orders,
    logs,
  };
};

// === 1% 순환매매 ===

const runLoopGridTick = async ({
  userId,
  config,
  symbol,
  marketPrice,
  broker,
  liveTradingEnabled,
  accountSeq,
  precheck,
  state,
  now,
}: {
  userId: string;
  config: RunAutomationWorkerTickInput["config"];
  symbol: string;
  marketPrice: number;
  broker: BrokerPort;
  liveTradingEnabled: boolean;
  accountSeq: number;
  precheck?: OrderPrecheck;
  state: StrategyWorkerState;
  now: string;
}): Promise<AutomationWorkerTickResult> => {
  const logs: WorkerLog[] = [];
  const orders: WorkerOrderOutcome[] = [];
  const plan = config.loop!;
  const currency = config.market === "US" ? "USD" : "KRW";

  const loopState = await getLoopGridState(userId, config.id, plan);
  const evaluation = evaluateLoopGrid({
    plan,
    marketPrice,
    state: loopState,
    dailyBuys: state.buys,
    dailySells: state.sells,
    maxDailyBuys: config.riskLimits.maxDailyBuys,
    maxDailySells: config.riskLimits.maxDailySells,
    maxPositionValue: config.riskLimits.maxPositionValue,
    maxLossPct: config.riskLimits.maxLossPct,
    now,
    fractionalQuantity: config.market === "CRYPTO",
  });

  for (const blocker of evaluation.blockers) {
    logs.push({ level: "warning", message: blocker });
  }

  let buys = state.buys;
  let sells = state.sells;

  if (evaluation.buy) {
    const buy = evaluation.buy;
    const stepId = "loop:buy";
    if (precheck) {
      const check = await precheck({ side: "buy", symbol, quantity: buy.quantity, price: buy.buyLevel, currency });
      if (!check.ok) {
        orders.push({ stepId, side: "buy", limitPrice: buy.buyLevel, quantity: buy.quantity, clientOrderId: "", status: "rejected", message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        logs.push({ level: "warning", stepId, message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
      } else {
        const outcome = await submitGridOrder({ symbol, side: "buy", quantity: buy.quantity, limitPrice: buy.buyLevel, reason: buy.reason, stepId, broker, accountSeq, label: "순환매매" });
        orders.push(outcome);
        logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
        if (outcome.status === "submitted") {
          await recordLoopGridBuy(userId, config.id, { anchorPrice: buy.anchorPrice, entryPrice: buy.buyLevel, quantity: buy.quantity, executedAt: now });
          buys += 1;
        }
      }
    } else {
      const outcome = await submitGridOrder({ symbol, side: "buy", quantity: buy.quantity, limitPrice: buy.buyLevel, reason: buy.reason, stepId, broker, accountSeq, label: "순환매매" });
      orders.push(outcome);
      logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
      if (outcome.status === "submitted") {
        await recordLoopGridBuy(userId, config.id, { anchorPrice: buy.anchorPrice, entryPrice: buy.buyLevel, quantity: buy.quantity, executedAt: now });
        buys += 1;
      }
    }
  }

  if (evaluation.sell) {
    const sell = evaluation.sell;
    const stepId = "loop:sell";
    if (precheck) {
      const check = await precheck({ side: "sell", symbol, quantity: sell.quantity, price: sell.sellLevel, currency });
      if (!check.ok) {
        orders.push({ stepId, side: "sell", limitPrice: sell.sellLevel, quantity: sell.quantity, clientOrderId: "", status: "rejected", message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
        logs.push({ level: "warning", stepId, message: `사전검증 거부: ${check.reason ?? "사유 미상"}` });
      } else {
        const outcome = await submitGridOrder({ symbol, side: "sell", quantity: sell.quantity, limitPrice: sell.sellLevel, reason: sell.reason, stepId, broker, accountSeq, label: "순환매매" });
        orders.push(outcome);
        logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
        if (outcome.status === "submitted") {
          await recordLoopGridSell(userId, config.id, { sellPrice: sell.sellLevel, executedAt: now });
          sells += 1;
        }
      }
    } else {
      const outcome = await submitGridOrder({ symbol, side: "sell", quantity: sell.quantity, limitPrice: sell.sellLevel, reason: sell.reason, stepId, broker, accountSeq, label: "순환매매" });
      orders.push(outcome);
      logs.push({ level: outcome.status === "error" ? "error" : outcome.status === "blocked" ? "warning" : "info", stepId, message: outcome.message });
      if (outcome.status === "submitted") {
        await recordLoopGridSell(userId, config.id, { sellPrice: sell.sellLevel, executedAt: now });
        sells += 1;
      }
    }
  }

  await saveWorkerState({ ...state, buys, sells });

  return {
    strategyId: config.id,
    symbol: config.symbol,
    marketPrice,
    liveTradingEnabled,
    evaluatedAt: now,
    triggers: (evaluation.buy ? 1 : 0) + (evaluation.sell ? 1 : 0),
    orders,
    logs,
  };
};

export type { StrategyWorkerState };
