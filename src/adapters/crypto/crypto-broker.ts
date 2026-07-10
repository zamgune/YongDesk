import type { BrokerOrderRequest, BrokerOrderResult } from "@/domain/trading";
import { LiveTradingDisabledError } from "@/adapters/toss/toss-broker";
import {
  cancelCryptoOrder,
  createCryptoLimitOrder,
  createCryptoMarketSellOrder,
  type CryptoExchange,
  type CryptoExchangeCredentials,
} from "@/lib/crypto-exchange/client";
import type { BrokerPort } from "@/ports/broker";

const decimalString = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("코인 주문 가격과 수량은 0보다 큰 유한 숫자여야 합니다.");
  }
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
};

export const createCryptoBroker = ({
  exchange,
  credentials,
  liveTradingEnabled = false,
}: {
  exchange: CryptoExchange;
  credentials: CryptoExchangeCredentials;
  liveTradingEnabled?: boolean;
}): BrokerPort => ({
  async submitOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    if (!liveTradingEnabled) {
      throw new LiveTradingDisabledError(request);
    }
    const market = request.symbol.trim().toUpperCase();
    if (!/^KRW-[A-Z0-9]+$/.test(market)) {
      throw new Error(`지원하지 않는 코인 마켓입니다: ${market}`);
    }
    const clientOrderId = (request.clientOrderId ?? request.orderIntentId)
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, exchange === "bithumb" ? 36 : 64);
    const side = request.side === "buy" ? "bid" : "ask";
    const result = request.type === "market"
      ? request.side === "sell"
        ? await createCryptoMarketSellOrder(exchange, credentials, {
          market,
          side: "ask",
          volume: decimalString(request.quantity),
          clientOrderId,
        })
        : (() => { throw new Error("코인 시장가 매수는 수량이 아닌 주문 총액이 필요해 자동 전략에서 지원하지 않습니다."); })()
      : await createCryptoLimitOrder(exchange, credentials, {
        market,
        side,
        volume: decimalString(request.quantity),
        price: decimalString(request.limitPrice ?? request.stopPrice ?? 0),
        clientOrderId,
      });
    return {
      brokerOrderId: result.orderId,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      message: `${exchange} clientOrderId=${result.clientOrderId ?? clientOrderId}`,
    };
  },

  async cancelOrder(request): Promise<BrokerOrderResult> {
    if (!liveTradingEnabled) {
      throw new Error("코인 실거래가 비활성 상태라 취소 요청을 전송하지 않았습니다.");
    }
    const result = await cancelCryptoOrder(exchange, credentials, request.brokerOrderId);
    return {
      brokerOrderId: result.orderId,
      status: "canceled",
      submittedAt: new Date().toISOString(),
    };
  },
});
