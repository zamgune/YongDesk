import type { Currency } from "./portfolio";
import type { OrderIntentStatus, OrderSide } from "./trading";

export type Execution = {
  id: string;
  userId: string;
  orderIntentId: string;
  brokerOrderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  currency: Currency;
  executedAt: string;
  fee: number | null;
  tax: number | null;
};

export type TradeLog = {
  id: string;
  userId: string;
  symbol: string;
  message: string;
  level: "info" | "warning" | "error";
  createdAt: string;
  orderIntentId?: string;
  brokerOrderId?: string;
};

export type AutoTradeLog = TradeLog & {
  strategyInstanceId: string;
  orderStatus?: OrderIntentStatus;
  riskBlockers?: string[];
};
