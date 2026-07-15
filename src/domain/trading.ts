import type { Currency } from "./portfolio";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop-limit";

export type OrderIntentStatus =
  | "draft"
  | "risk_checked"
  | "approved"
  | "submitted"
  | "partial_filled"
  | "filled"
  | "rejected"
  | "canceled";

export type OrderIntent = {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  currency: Currency;
  status: OrderIntentStatus;
  sourceSignalId?: string;
  rationale: string[];
  createdAt: string;
};

export type RiskCheckResult = {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  maxPositionValue: number | null;
  estimatedOrderValue: number | null;
};

export type TimeInForce = "DAY" | "CLS";

export type BrokerOrderRequest = {
  orderIntentId: string;
  /** 토스 accountSeq (X-Tossinvest-Account 헤더). GET /accounts 에서 획득 */
  accountSeq: number;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  /** 멱등성 키 (토스 clientOrderId). 재시도 시 중복 주문 방지 */
  clientOrderId?: string;
  timeInForce?: TimeInForce;
  /** 1억원 이상 주문 확인 플래그 */
  confirmHighValueOrder?: boolean;
};

export type BrokerOrderResult = {
  brokerOrderId: string;
  status: OrderIntentStatus;
  submittedAt: string;
  message?: string;
};

export type ManagedTradePurpose = "new-position" | "manage-position";
export type ManagedTradeMode = "paper" | "toss-live";
export type ManagedTradeHorizon = "day" | "swing";
export type ManagedTradePlanStatus =
  | "draft"
  | "risk_checked"
  | "watching-entry"
  | "position-open"
  | "watching-exit"
  | "completed"
  | "canceled"
  | "rejected"
  | "unknown";

export type ManagedTradeExitLeg = {
  kind: "take-profit" | "stop-loss";
  enabled: boolean;
  triggerPrice: number | null;
  orderPrice: number | null;
};

/**
 * 진입 주문과 선택형 청산 계획을 함께 보관하는 상위 계약입니다.
 * 실제 제출 시 각 leg는 별도의 OrderIntent/RiskCheck 경계를 통과합니다.
 */
export type ManagedTradePlan = {
  id: string;
  userId: string;
  symbol: string;
  assetClass: "stock" | "crypto";
  currency: Currency;
  purpose: ManagedTradePurpose;
  mode: ManagedTradeMode;
  horizon: ManagedTradeHorizon;
  quantity: number;
  referencePrice: number | null;
  entry: OrderIntent | null;
  exits: {
    takeProfit: ManagedTradeExitLeg;
    stopLoss: ManagedTradeExitLeg;
  };
  expiryDate: string;
  accountSeq?: number;
  sourceAnalysisId?: string;
  status: ManagedTradePlanStatus;
  createdAt: string;
  updatedAt: string;
};
