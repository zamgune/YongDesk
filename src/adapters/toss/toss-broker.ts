import { randomUUID } from "node:crypto";

import type { BrokerOrderRequest, BrokerOrderResult, OrderIntentStatus } from "@/domain/trading";
import type { BrokerCancelRequest, BrokerPort } from "@/ports/broker";
import { TossApiError, type TossClient } from "@/lib/toss/client";
import type { OrderCreateRequest, TossTimeInForce } from "@/lib/toss/types";
import { isValidKrLimitPrice, normalizeKrLimitPrice } from "@/lib/toss/tick";

/**
 * 토스증권 BrokerPort 구현체.
 *
 * 안전장치(핵심): `liveTradingEnabled` 가 true 가 아니면 토스 주문 API 를 절대
 * 호출하지 않고 차단합니다. "실거래 직전까지" 단계에서는 이 플래그를 끈 채
 * 페이로드 빌드/검증까지만 수행합니다. 실제 주문 전송은 명시적으로 플래그를
 * 켠 경우에만 일어납니다.
 */

export type TossBrokerOptions = {
  client: TossClient;
  /** 실거래 전송 허용 여부. 기본 false (차단). */
  liveTradingEnabled?: boolean;
};

/** 토스 심볼 규칙: KR 은 6자리 숫자, US 는 영문 티커 */
const isKrSymbol = (symbol: string) => /^\d{6}$/.test(symbol.trim());

export class LiveTradingDisabledError extends Error {
  readonly request: BrokerOrderRequest;

  constructor(request: BrokerOrderRequest) {
    super("실거래가 비활성 상태입니다. 주문이 토스로 전송되지 않았습니다.");
    this.name = "LiveTradingDisabledError";
    this.request = request;
  }
}

const mapToTossStatus = (): OrderIntentStatus => "submitted";

/**
 * BrokerOrderRequest → 토스 OrderCreateRequest 페이로드로 변환합니다.
 * - KR 지정가는 호가 단위(tick)에 맞춰 보정합니다 (매수=down, 매도=up).
 * - clientOrderId(멱등성 키)가 없으면 생성합니다.
 */
export const buildTossOrderPayload = (request: BrokerOrderRequest): OrderCreateRequest => {
  const symbol = request.symbol.trim().toUpperCase();
  const side = request.side === "sell" ? "SELL" : "BUY";
  const clientOrderId = request.clientOrderId ?? randomUUID().replace(/-/g, "").slice(0, 32);
  const timeInForce: TossTimeInForce = request.timeInForce ?? "DAY";

  if (request.type === "market") {
    return {
      clientOrderId,
      symbol,
      side,
      orderType: "MARKET",
      quantity: String(request.quantity),
      timeInForce,
      confirmHighValueOrder: request.confirmHighValueOrder ?? false,
    };
  }

  // 지정가 (stop-limit 은 현재 토스 미지원이므로 limit 으로 취급)
  const rawPrice = request.limitPrice ?? request.stopPrice;
  if (rawPrice === null || rawPrice === undefined) {
    throw new TossApiError(400, "invalid-request", "지정가 주문에는 가격이 필요합니다.");
  }
  const price = isKrSymbol(symbol)
    ? normalizeKrLimitPrice(rawPrice, side === "BUY" ? "down" : "up")
    : rawPrice;

  return {
    clientOrderId,
    symbol,
    side,
    orderType: "LIMIT",
    quantity: String(request.quantity),
    price: String(price),
    timeInForce,
    confirmHighValueOrder: request.confirmHighValueOrder ?? false,
  };
};

export const createTossBroker = ({
  client,
  liveTradingEnabled = false,
}: TossBrokerOptions): BrokerPort => ({
  async submitOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult> {
    const payload = buildTossOrderPayload(request);

    // KR 지정가 호가 단위 사전 검증 (전송 전 차단)
    if (payload.orderType === "LIMIT" && isKrSymbol(payload.symbol) && payload.price) {
      const numeric = Number(payload.price);
      if (!isValidKrLimitPrice(numeric)) {
        throw new TossApiError(
          400,
          "invalid-request",
          `호가 단위에 맞지 않는 가격입니다: ${payload.price}`,
        );
      }
    }

    // === 실거래 게이트 ===
    if (!liveTradingEnabled) {
      throw new LiveTradingDisabledError(request);
    }

    const result = await client.createOrder(request.accountSeq, payload);
    return {
      brokerOrderId: result.orderId,
      status: mapToTossStatus(),
      submittedAt: new Date().toISOString(),
      message: result.clientOrderId ? `clientOrderId=${result.clientOrderId}` : undefined,
    };
  },

  async cancelOrder(request: BrokerCancelRequest): Promise<BrokerOrderResult> {
    if (!liveTradingEnabled) {
      throw new Error("실거래가 비활성 상태입니다. 취소 요청이 토스로 전송되지 않았습니다.");
    }
    const result = await client.cancelOrder(request.accountSeq, request.brokerOrderId);
    return {
      brokerOrderId: result.orderId,
      status: "canceled",
      submittedAt: new Date().toISOString(),
    };
  },
});
