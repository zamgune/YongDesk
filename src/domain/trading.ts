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
