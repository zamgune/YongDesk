import type { BrokerOrderRequest, BrokerOrderResult } from "@/domain/trading";

export type BrokerCancelRequest = {
  accountSeq: number;
  brokerOrderId: string;
};

export type BrokerPort = {
  submitOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>;
  cancelOrder(request: BrokerCancelRequest): Promise<BrokerOrderResult>;
};
