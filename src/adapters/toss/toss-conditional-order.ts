import type { ManagedTradePlan } from "@/domain/trading";
import type {
  ConditionalOrderConditionRequest,
  ConditionalOrderCreateRequest,
} from "@/lib/toss/types";
import { krTickSize, normalizeKrLimitPrice } from "@/lib/toss/tick";

const tossSymbol = (symbol: string) => symbol.trim().toUpperCase().replace(/\.KS$/, "");
const isKrSymbol = (symbol: string) => /^\d{6}$/.test(tossSymbol(symbol));

const normalizePrice = (symbol: string, price: number, mode: "down" | "up") =>
  isKrSymbol(symbol) ? normalizeKrLimitPrice(price, mode) : Number(price.toFixed(2));

const stopOrderPrice = (symbol: string, triggerPrice: number, explicit: number | null) => {
  if (explicit && explicit < triggerPrice) return normalizePrice(symbol, explicit, "down");
  if (isKrSymbol(symbol)) {
    const trigger = normalizeKrLimitPrice(triggerPrice, "down");
    return Math.max(krTickSize(trigger), trigger - krTickSize(trigger));
  }
  return Math.max(0.01, Number((triggerPrice - 0.01).toFixed(2)));
};

const sellCondition = (
  plan: ManagedTradePlan,
  kind: "take-profit" | "stop-loss",
): ConditionalOrderConditionRequest => {
  const exit = kind === "take-profit" ? plan.exits.takeProfit : plan.exits.stopLoss;
  if (!exit.enabled || !exit.triggerPrice) throw new Error(`${kind} 조건이 비어 있습니다.`);
  const triggerPrice = normalizePrice(plan.symbol, exit.triggerPrice, kind === "take-profit" ? "up" : "down");
  const orderPrice = kind === "stop-loss"
    ? stopOrderPrice(plan.symbol, triggerPrice, exit.orderPrice)
    : normalizePrice(plan.symbol, exit.orderPrice ?? triggerPrice, "up");
  return {
    orderSide: "SELL",
    triggerPrice: String(triggerPrice),
    orderPrice: String(orderPrice),
  };
};

export const buildTossConditionalOrderPayload = (
  plan: ManagedTradePlan,
  clientOrderId: string,
): ConditionalOrderCreateRequest | null => {
  if (plan.mode !== "toss-live") throw new Error("Toss 조건주문은 toss-live 계획만 변환할 수 있습니다.");
  if (plan.assetClass !== "stock") throw new Error("Toss 조건주문은 주식만 지원합니다.");
  const symbol = tossSymbol(plan.symbol);
  const takeProfitEnabled = plan.exits.takeProfit.enabled;
  const stopLossEnabled = plan.exits.stopLoss.enabled;
  if (!takeProfitEnabled && !stopLossEnabled) return null;

  if (plan.purpose === "new-position") {
    if (takeProfitEnabled && stopLossEnabled) throw new Error("Toss는 신규 매수의 3단 브래킷을 지원하지 않습니다.");
    const entryPrice = plan.entry?.limitPrice;
    if (!entryPrice) throw new Error("OTO 진입가가 필요합니다.");
    const normalizedEntry = normalizePrice(plan.symbol, entryPrice, "down");
    return {
      symbol,
      type: "OTO",
      quantity: String(plan.quantity),
      orderType: "LIMIT",
      clientOrderId,
      expireDate: plan.expiryDate,
      first: { orderSide: "BUY", triggerPrice: String(normalizedEntry), orderPrice: String(normalizedEntry) },
      second: sellCondition(plan, takeProfitEnabled ? "take-profit" : "stop-loss"),
      confirmHighValueOrder: false,
    };
  }

  if (takeProfitEnabled && stopLossEnabled) {
    return {
      symbol,
      type: "OCO",
      quantity: String(plan.quantity),
      orderType: "LIMIT",
      clientOrderId,
      expireDate: plan.expiryDate,
      first: sellCondition(plan, "take-profit"),
      second: sellCondition(plan, "stop-loss"),
      confirmHighValueOrder: false,
    };
  }

  return {
    symbol,
    type: "SINGLE",
    quantity: String(plan.quantity),
    orderType: "LIMIT",
    clientOrderId,
    expireDate: plan.expiryDate,
    first: sellCondition(plan, takeProfitEnabled ? "take-profit" : "stop-loss"),
    confirmHighValueOrder: false,
  };
};
