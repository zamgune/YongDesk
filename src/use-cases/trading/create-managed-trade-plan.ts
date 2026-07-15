import type { Currency } from "@/domain/portfolio";
import type {
  ManagedTradeExitLeg,
  ManagedTradeHorizon,
  ManagedTradeMode,
  ManagedTradePlan,
  ManagedTradePurpose,
  OrderIntent,
  RiskCheckResult,
} from "@/domain/trading";
import { createOrderIntent } from "./create-order-intent.ts";

export type CreateManagedTradePlanInput = {
  userId: string;
  symbol: string;
  assetClass: "stock" | "crypto";
  currency: Currency;
  purpose: ManagedTradePurpose;
  mode: ManagedTradeMode;
  horizon: ManagedTradeHorizon;
  quantity: number;
  entryPrice?: number | null;
  takeProfit?: { enabled: boolean; triggerPrice?: number | null; orderPrice?: number | null };
  stopLoss?: { enabled: boolean; triggerPrice?: number | null; orderPrice?: number | null };
  expiryDate: string;
  accountSeq?: number;
  sourceAnalysisId?: string;
};

export type ManagedTradePlanBuildResult = {
  plan: ManagedTradePlan;
  legIntents: OrderIntent[];
  riskCheck: RiskCheckResult;
};

const disabledExit = (kind: ManagedTradeExitLeg["kind"]): ManagedTradeExitLeg => ({
  kind,
  enabled: false,
  triggerPrice: null,
  orderPrice: null,
});

const exitFromInput = (
  kind: ManagedTradeExitLeg["kind"],
  value: CreateManagedTradePlanInput["takeProfit"],
): ManagedTradeExitLeg => {
  if (!value?.enabled) return disabledExit(kind);
  return {
    kind,
    enabled: true,
    triggerPrice: value.triggerPrice ?? null,
    orderPrice: value.orderPrice ?? value.triggerPrice ?? null,
  };
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

export const createManagedTradePlan = (
  input: CreateManagedTradePlanInput,
  now = new Date(),
): ManagedTradePlanBuildResult => {
  const symbol = input.symbol.trim().toUpperCase();
  const takeProfit = exitFromInput("take-profit", input.takeProfit);
  const stopLoss = exitFromInput("stop-loss", input.stopLoss);
  const referencePrice = input.entryPrice ?? null;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!symbol) blockers.push("종목 코드가 필요합니다.");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) blockers.push("주문 수량은 0보다 커야 합니다.");
  if (!validDate(input.expiryDate)) blockers.push("만료일은 YYYY-MM-DD 형식이어야 합니다.");
  if (input.assetClass === "crypto" && input.mode === "toss-live") blockers.push("코인 실거래 자동 청산은 현재 지원하지 않습니다.");
  if (input.purpose === "new-position" && (!referencePrice || referencePrice <= 0)) blockers.push("신규 매수 진입가가 필요합니다.");
  if (input.purpose === "manage-position" && !takeProfit.enabled && !stopLoss.enabled) blockers.push("보유분 관리에는 최소 하나의 청산 조건이 필요합니다.");
  if (input.mode === "toss-live" && input.purpose === "new-position" && takeProfit.enabled && stopLoss.enabled) {
    blockers.push("Toss는 신규 매수와 익절·손절을 한번에 묶는 3단 브래킷을 지원하지 않습니다.");
  }
  if (takeProfit.enabled && (!takeProfit.triggerPrice || takeProfit.triggerPrice <= 0)) blockers.push("익절 트리거 가격이 필요합니다.");
  if (stopLoss.enabled && (!stopLoss.triggerPrice || stopLoss.triggerPrice <= 0)) blockers.push("손절 트리거 가격이 필요합니다.");
  if (referencePrice && takeProfit.triggerPrice && takeProfit.triggerPrice <= referencePrice) blockers.push("익절가는 기준가보다 높아야 합니다.");
  if (referencePrice && stopLoss.triggerPrice && stopLoss.triggerPrice >= referencePrice) blockers.push("손절가는 기준가보다 낮아야 합니다.");
  if (stopLoss.enabled) warnings.push("손절 지정가는 급락 시 미체결될 수 있습니다.");

  const riskPolicy = { allowLiveTrading: true, maxOrderValue: null, maxPositionValue: null };
  const legIntents: OrderIntent[] = [];
  const entryResult = input.purpose === "new-position" && referencePrice
    ? createOrderIntent({
      userId: input.userId,
      symbol,
      side: "buy",
      type: "limit",
      quantity: input.quantity,
      limitPrice: referencePrice,
      currency: input.currency,
      rationale: ["관리형 매매 계획 진입"],
      sourceSignalId: input.sourceAnalysisId,
      riskPolicy,
    })
    : null;
  if (entryResult) {
    legIntents.push(entryResult.intent);
    blockers.push(...entryResult.riskCheck.blockers);
    warnings.push(...entryResult.riskCheck.warnings);
  }
  for (const exit of [takeProfit, stopLoss]) {
    if (!exit.enabled || !exit.orderPrice) continue;
    const result = createOrderIntent({
      userId: input.userId,
      symbol,
      side: "sell",
      type: "limit",
      quantity: input.quantity,
      limitPrice: exit.orderPrice,
      stopPrice: exit.triggerPrice,
      currency: input.currency,
      rationale: [exit.kind === "take-profit" ? "관리형 매매 계획 익절" : "관리형 매매 계획 손절"],
      sourceSignalId: input.sourceAnalysisId,
      riskPolicy,
    });
    legIntents.push(result.intent);
    blockers.push(...result.riskCheck.blockers);
    warnings.push(...result.riskCheck.warnings);
  }

  const timestamp = now.toISOString();
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const plan: ManagedTradePlan = {
    id: crypto.randomUUID(),
    userId: input.userId,
    symbol,
    assetClass: input.assetClass,
    currency: input.currency,
    purpose: input.purpose,
    mode: input.mode,
    horizon: input.horizon,
    quantity: input.quantity,
    referencePrice,
    entry: entryResult?.intent ?? null,
    exits: { takeProfit, stopLoss },
    expiryDate: input.expiryDate,
    accountSeq: input.accountSeq,
    sourceAnalysisId: input.sourceAnalysisId,
    status: uniqueBlockers.length === 0 ? "risk_checked" : "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    plan,
    legIntents,
    riskCheck: {
      passed: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      maxPositionValue: null,
      estimatedOrderValue: referencePrice ? referencePrice * input.quantity : null,
    },
  };
};
