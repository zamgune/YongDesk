/**
 * KRX/NXT 국내 주식 호가 단위(tick size) 정규화.
 *
 * 토스 주문 API 는 KR 지정가가 호가 단위에 맞지 않으면 `400 invalid-request`
 * 를 반환합니다 (에러 data.tickSize / data.nearestPrices 포함). 사다리 가격을
 * 그대로 보내면 거부되므로, 주문 직전에 유효 호가로 보정해야 합니다.
 *
 * 2023-01-25 개편된 KRX 호가가격단위 기준.
 */

type TickBand = { below: number; tick: number };

// 가격 구간(미만 기준)별 호가 단위 (원)
const KR_TICK_BANDS: TickBand[] = [
  { below: 2_000, tick: 1 },
  { below: 5_000, tick: 5 },
  { below: 20_000, tick: 10 },
  { below: 50_000, tick: 50 },
  { below: 200_000, tick: 100 },
  { below: 500_000, tick: 500 },
  { below: Number.POSITIVE_INFINITY, tick: 1_000 },
];

/** 해당 가격대의 KR 호가 단위를 반환합니다. */
export const krTickSize = (price: number): number => {
  for (const band of KR_TICK_BANDS) {
    if (price < band.below) {
      return band.tick;
    }
  }
  return 1_000;
};

export type TickRoundMode = "nearest" | "down" | "up";

/**
 * KR 지정가를 유효 호가 단위로 보정합니다.
 * - 매수 사다리: "down"(보수적으로 더 낮은 가격) 권장
 * - 매도 사다리: "up"(보수적으로 더 높은 가격) 권장
 */
export const normalizeKrLimitPrice = (price: number, mode: TickRoundMode = "nearest"): number => {
  if (!Number.isFinite(price) || price <= 0) {
    return price;
  }
  const tick = krTickSize(price);
  const ratio = price / tick;
  const rounded =
    mode === "down" ? Math.floor(ratio) : mode === "up" ? Math.ceil(ratio) : Math.round(ratio);
  return rounded * tick;
};

/** 가격이 이미 유효 호가 단위에 맞는지 검사합니다. */
export const isValidKrLimitPrice = (price: number): boolean => {
  if (!Number.isFinite(price) || price <= 0) {
    return false;
  }
  return price % krTickSize(price) === 0;
};
