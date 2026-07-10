import type { TossCurrency } from "@/lib/toss/types";

/**
 * 주문 사전검증.
 *
 * 주문 전송 직전에 토스 매수 가능 금액 / 매도 가능 수량을 조회해, 잔고·보유
 * 부족으로 거부될 주문을 미리 걸러냅니다. 같은 틱에서 통화별 매수가능금액은
 * 1회만 조회해 캐시합니다.
 */

export type PrecheckResult = {
  ok: boolean;
  reason?: string;
  /** 검증에 사용한 한도 (매수=현금, 매도=매도가능수량) */
  available?: number;
};

export type OrderPrecheckDeps = {
  accountSeq: number;
  getBuyingPower: (accountSeq: number, currency: TossCurrency) => Promise<{ cashBuyingPower: string }>;
  getSellableQuantity: (accountSeq: number, symbol: string) => Promise<{ sellableQuantity: string }>;
};

export type PrecheckOrderInput = {
  side: "buy" | "sell";
  symbol: string;
  quantity: number;
  /** 지정가. 시장가면 추정 가격(현재가) 사용 */
  price: number;
  currency: TossCurrency;
};

export type OrderPrecheck = (input: PrecheckOrderInput) => Promise<PrecheckResult>;

/** KR 6자리 숫자 심볼 → KRW, 그 외 USD (currency 미지정 시 보조 추론) */
export const inferCurrency = (symbol: string): TossCurrency =>
  /^\d{6}$/.test(symbol.trim()) ? "KRW" : "USD";

export const createOrderPrecheck = (deps: OrderPrecheckDeps): OrderPrecheck => {
  const buyingPowerCache = new Map<TossCurrency, number>();

  const resolveBuyingPower = async (currency: TossCurrency): Promise<number> => {
    const cached = buyingPowerCache.get(currency);
    if (cached !== undefined) {
      return cached;
    }
    const res = await deps.getBuyingPower(deps.accountSeq, currency);
    const value = Number(res.cashBuyingPower);
    const normalized = Number.isFinite(value) ? value : 0;
    buyingPowerCache.set(currency, normalized);
    return normalized;
  };

  return async ({ side, symbol, quantity, price, currency }): Promise<PrecheckResult> => {
    if (quantity <= 0) {
      return { ok: false, reason: "주문 수량이 0 이하입니다." };
    }
    if (side === "buy") {
      const cash = await resolveBuyingPower(currency);
      const estimatedCost = quantity * price;
      if (estimatedCost > cash) {
        return {
          ok: false,
          available: cash,
          reason: `매수 가능 금액 부족 (필요 ≈${Math.round(estimatedCost)}, 가능 ${Math.round(cash)})`,
        };
      }
      // 캐시 차감: 같은 틱의 후속 매수가 누적 한도를 넘지 않도록
      buyingPowerCache.set(currency, cash - estimatedCost);
      return { ok: true, available: cash };
    }

    const res = await deps.getSellableQuantity(deps.accountSeq, symbol);
    const sellable = Number(res.sellableQuantity);
    const normalized = Number.isFinite(sellable) ? sellable : 0;
    if (quantity > normalized) {
      return {
        ok: false,
        available: normalized,
        reason: `매도 가능 수량 부족 (요청 ${quantity}, 가능 ${normalized})`,
      };
    }
    return { ok: true, available: normalized };
  };
};
