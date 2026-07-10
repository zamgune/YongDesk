import type { Currency } from "@/domain/portfolio";
import type { OrderIntent, OrderSide, OrderType } from "@/domain/trading";
import { checkOrderIntentRisk, defaultRiskPolicy, type RiskPolicy } from "./risk-policy.ts";

export type CreateOrderIntentInput = {
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  currency: Currency;
  sourceSignalId?: string;
  rationale: string[];
  riskPolicy?: RiskPolicy;
};

export function createOrderIntent(input: CreateOrderIntentInput) {
  const intent: OrderIntent = {
    id: crypto.randomUUID(),
    userId: input.userId,
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    type: input.type,
    quantity: input.quantity,
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    currency: input.currency,
    status: "draft",
    sourceSignalId: input.sourceSignalId,
    rationale: input.rationale,
    createdAt: new Date().toISOString(),
  };
  const referencePrice = intent.limitPrice ?? intent.stopPrice;
  const estimatedOrderValue = referencePrice === null
    ? null
    : referencePrice * intent.quantity;
  const riskCheck = checkOrderIntentRisk({
    intent,
    policy: input.riskPolicy ?? defaultRiskPolicy,
    estimatedOrderValue,
  });

  return {
    intent: riskCheck.passed
      ? {
        ...intent,
        status: "risk_checked" as const,
      }
      : intent,
    riskCheck,
  };
}
