import type { OrderIntent, RiskCheckResult } from "@/domain/trading";

export type RiskPolicy = {
  maxOrderValue: number | null;
  maxPositionValue: number | null;
  allowLiveTrading: boolean;
};

export const defaultRiskPolicy: RiskPolicy = {
  maxOrderValue: null,
  maxPositionValue: null,
  allowLiveTrading: false,
};

export function checkOrderIntentRisk({
  intent,
  policy = defaultRiskPolicy,
  estimatedOrderValue,
}: {
  intent: OrderIntent;
  policy?: RiskPolicy;
  estimatedOrderValue: number | null;
}): RiskCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!policy.allowLiveTrading) {
    blockers.push("실거래 주문은 기본적으로 비활성화되어 있습니다.");
  }

  if (intent.quantity <= 0) {
    blockers.push("주문 수량이 0보다 커야 합니다.");
  }

  if (
    policy.maxOrderValue !== null &&
    estimatedOrderValue !== null &&
    estimatedOrderValue > policy.maxOrderValue
  ) {
    blockers.push("주문 금액이 허용 한도를 초과했습니다.");
  }

  if (intent.type !== "market" && intent.limitPrice === null) {
    warnings.push("지정가 계열 주문에는 기준 가격 확인이 필요합니다.");
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    maxPositionValue: policy.maxPositionValue,
    estimatedOrderValue,
  };
}
