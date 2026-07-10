import { createHash } from "node:crypto";

import type {
  Account,
  ApiResponse,
  BuyingPowerResponse,
  CandlePageResponse,
  Commission,
  ErrorResponse,
  ExchangeRateResponse,
  HoldingsOverview,
  KrMarketCalendarResponse,
  OAuth2ErrorResponse,
  OAuth2TokenResponse,
  Order,
  OrderCreateRequest,
  OrderListStatus,
  OrderModifyRequest,
  OrderbookResponse,
  OrderOperationResponse,
  OrderResponse,
  PaginatedOrderResponse,
  Price,
  PriceLimitResponse,
  SellableQuantityResponse,
  StockInfo,
  StockWarning,
  TossCandleInterval,
  TossCurrency,
  Trade,
  UsMarketCalendarResponse,
} from "./types";
import { TOSS_OPENAPI_BASE_URL } from "./contract.ts";

const DEFAULT_BASE_URL = TOSS_OPENAPI_BASE_URL;
// 토큰 expires_in 만료 전 미리 갱신할 여유 (초)
const TOKEN_REFRESH_MARGIN_SEC = 120;
const REQUEST_TIMEOUT_MS = 10_000;

export type TossRateLimitSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
};

export type TossApiErrorResponseBody = {
  error: string;
  code: string;
  requestId?: string;
  toss: {
    status: number;
    code: string;
    message: string;
    guidance: string;
    requestId?: string;
    retryAfterMs?: number;
    rateLimit?: TossRateLimitSnapshot;
    data?: Record<string, unknown> | null;
  };
};

export type TossCredentials = {
  clientId: string;
  clientSecret: string;
};

/** 토스 API 도메인 에러. code 기반으로 호출부에서 분기합니다. */
export class TossApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly data?: Record<string, unknown> | null;
  readonly retryAfterMs?: number;
  readonly rateLimit?: TossRateLimitSnapshot;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    data?: Record<string, unknown> | null,
    meta: {
      retryAfterMs?: number;
      rateLimit?: TossRateLimitSnapshot;
    } = {},
  ) {
    super(message || code);
    this.name = "TossApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.data = data;
    this.retryAfterMs = meta.retryAfterMs;
    this.rateLimit = meta.rateLimit;
  }
}

const TOSS_ERROR_GUIDANCE: Record<string, string> = {
  "confirm-high-value-required": "고액 주문 확인 플래그가 필요합니다. 주문 금액과 확인 절차를 다시 검토하세요.",
  "account-header-required": "계좌 API에는 X-Tossinvest-Account 헤더가 필요합니다. 계좌 선택 상태를 다시 불러오세요.",
  "invalid-token": "토스 액세스 토큰이 유효하지 않습니다. client_id/client_secret 재검증이 필요합니다.",
  "request-in-progress": "같은 요청이 처리 중입니다. 잠시 후 재시도하고 중복 주문 여부를 확인하세요.",
  "insufficient-buying-power": "매수 가능 금액이 부족합니다. 주문 금액과 계좌 현금을 확인하세요.",
  "order-hours-closed": "현재 주문 가능 시간이 아닙니다. 시장 운영 시간을 확인하세요.",
  "stock-restricted": "종목 제한으로 주문할 수 없습니다. 매수 유의사항과 거래 제한을 확인하세요.",
  "price-out-of-range": "주문 가격이 허용 범위를 벗어났습니다. 상하한가와 호가 단위를 확인하세요.",
  "opposite-pending-order-exists": "반대 방향 미체결 주문이 있습니다. 기존 주문을 취소하거나 체결 상태를 동기화하세요.",
  "order-type-not-allowed": "현재 종목/시장/시간대에서 허용되지 않는 주문 유형입니다.",
  "prerequisite-required": "주문 전 필요한 동의나 사전 절차가 완료되지 않았습니다.",
  "investor-exchange-not-integrated": "투자자 거래소 연동 상태를 확인해야 합니다.",
  "amount-order-outside-regular-hours": "정규장 외 금액 주문이 제한됩니다. 주문 유형과 시간을 확인하세요.",
  "rate-limit-exceeded": "토스 API 요청 한도를 초과했습니다. Retry-After 이후 재시도하세요.",
  maintenance: "토스 API 점검 중입니다. 점검 종료 후 다시 시도하세요.",
};

export const getTossErrorGuidance = (code: string) =>
  TOSS_ERROR_GUIDANCE[code] ?? "토스 API 응답의 code/requestId를 기준으로 원인을 확인하세요.";

export const formatTossApiError = (
  error: TossApiError,
  prefix = "토스 API 요청 실패",
): TossApiErrorResponseBody => ({
  error: `${prefix}: ${error.message}`,
  code: error.code,
  requestId: error.requestId,
  toss: {
    status: error.status,
    code: error.code,
    message: error.message,
    guidance: getTossErrorGuidance(error.code),
    requestId: error.requestId,
    retryAfterMs: error.retryAfterMs,
    rateLimit: error.rateLimit,
    data: error.data,
  },
});

type CachedToken = { accessToken: string; expiresAtMs: number };

// 프로세스 내 토큰 캐시. client_id와 client_secret의 fingerprint만 키로 사용합니다.
const tokenCache = new Map<string, CachedToken>();
const tokenRequests = new Map<string, Promise<CachedToken>>();

const cacheKey = (credentials: TossCredentials) => createHash("sha256")
  .update(credentials.clientId)
  .update("\0")
  .update(credentials.clientSecret)
  .digest("hex");

const requestTimeoutSignal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

const baseUrl = () => (process.env.TOSS_OPENAPI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

const issueToken = async (credentials: TossCredentials): Promise<CachedToken> => {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  const response = await fetch(`${baseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: requestTimeoutSignal(),
  });
  const json = (await response.json().catch(() => null)) as
    | OAuth2TokenResponse
    | OAuth2ErrorResponse
    | null;
  if (!response.ok || !json || !("access_token" in json)) {
    const err = (json ?? {}) as OAuth2ErrorResponse;
    throw new TossApiError(
      response.status,
      err.error ?? "token-issue-failed",
      err.error_description ?? "토스 액세스 토큰 발급에 실패했습니다.",
    );
  }
  return {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + Math.max(0, json.expires_in - TOKEN_REFRESH_MARGIN_SEC) * 1000,
  };
};

const getAccessToken = async (credentials: TossCredentials): Promise<string> => {
  const key = cacheKey(credentials);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.accessToken;
  }
  const pending = tokenRequests.get(key);
  if (pending) {
    return (await pending).accessToken;
  }
  const request = issueToken(credentials);
  tokenRequests.set(key, request);
  try {
    const fresh = await request;
    tokenCache.set(key, fresh);
    return fresh.accessToken;
  } finally {
    tokenRequests.delete(key);
  }
};

type RequestOptions = {
  method?: "GET" | "HEAD" | "POST";
  accountSeq?: number;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  retry429?: number;
  retry401?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const numberHeader = (headers: Headers, name: string): number | null => {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : null;
};

const readRateLimitHeaders = (headers: Headers): TossRateLimitSnapshot | undefined => {
  const limit = numberHeader(headers, "X-RateLimit-Limit");
  const remaining = numberHeader(headers, "X-RateLimit-Remaining");
  const resetSeconds = numberHeader(headers, "X-RateLimit-Reset");
  if (limit === null && remaining === null && resetSeconds === null) {
    return undefined;
  }
  return { limit, remaining, resetSeconds };
};

const readRetryAfterMs = (headers: Headers): number | undefined => {
  const retryAfter = numberHeader(headers, "Retry-After");
  if (retryAfter !== null && retryAfter >= 0) {
    return retryAfter * 1000;
  }
  const resetSeconds = numberHeader(headers, "X-RateLimit-Reset");
  if (resetSeconds !== null && resetSeconds >= 0) {
    return resetSeconds * 1000;
  }
  return undefined;
};

const parseJson = (text: string): unknown | null => {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const request = async <T>(
  credentials: TossCredentials,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const token = await getAccessToken(credentials);
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) {
      url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (options.accountSeq !== undefined) {
    headers["X-Tossinvest-Account"] = String(options.accountSeq);
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const method = options.method ?? "GET";

  const response = await fetch(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: requestTimeoutSignal(),
  });

  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok) {
    const retryableMethod = method === "GET" || method === "HEAD";
    if (response.status === 401) {
      tokenCache.delete(cacheKey(credentials));
      if (retryableMethod && (options.retry401 ?? 1) > 0) {
        return request<T>(credentials, path, {
          ...options,
          retry401: (options.retry401 ?? 1) - 1,
        });
      }
    }
    if (response.status === 429 && retryableMethod && (options.retry429 ?? 2) > 0) {
      const waitMs = readRetryAfterMs(response.headers) ?? 1000;
      await sleep(Math.min(waitMs, 5000));
      return request<T>(credentials, path, {
        ...options,
        retry429: (options.retry429 ?? 2) - 1,
      });
    }
    const error = (json as ErrorResponse | null)?.error;
    throw new TossApiError(
      response.status,
      error?.code ?? `http-${response.status}`,
      error?.message ?? "토스 API 요청이 실패했습니다.",
      error?.requestId ??
        response.headers.get("X-Request-Id") ??
        response.headers.get("cf-ray") ??
        undefined,
      error?.data ?? null,
      {
        retryAfterMs: readRetryAfterMs(response.headers),
        rateLimit: readRateLimitHeaders(response.headers),
      },
    );
  }

  return (json as ApiResponse<T>).result;
};

/**
 * 회원의 토스 자격증명으로 바인딩된 클라이언트.
 * 토큰 캐시는 client_id 단위로 프로세스 내에서 공유됩니다.
 */
export const createTossClient = (credentials: TossCredentials) => ({
  /** 자격증명 검증용: 토큰 발급이 성공하는지 확인합니다. */
  verifyToken: () => getAccessToken(credentials),

  listAccounts: () => request<Account[]>(credentials, "/api/v1/accounts"),

  getPrices: (symbols: string[]) =>
    request<Price[]>(credentials, "/api/v1/prices", {
      query: { symbols: symbols.join(",") },
    }),

  getCandles: (
    symbol: string,
    options: {
      interval: TossCandleInterval;
      count?: number;
      before?: string;
      adjusted?: boolean;
    },
  ) =>
    request<CandlePageResponse>(credentials, "/api/v1/candles", {
      query: {
        symbol,
        interval: options.interval,
        count: options.count,
        before: options.before,
        adjusted: options.adjusted,
      },
    }),

  getOrderbook: (symbol: string) =>
    request<OrderbookResponse>(credentials, "/api/v1/orderbook", {
      query: { symbol },
    }),

  getTrades: (symbol: string, count?: number) =>
    request<Trade[]>(credentials, "/api/v1/trades", {
      query: { symbol, count },
    }),

  getPriceLimit: (symbol: string) =>
    request<PriceLimitResponse>(credentials, "/api/v1/price-limits", {
      query: { symbol },
    }),

  getStocks: (symbols: string[]) =>
    request<StockInfo[]>(credentials, "/api/v1/stocks", {
      query: { symbols: symbols.join(",") },
    }),

  getStockWarnings: (symbol: string) =>
    request<StockWarning[]>(credentials, `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`),

  getExchangeRate: (
    baseCurrency: TossCurrency,
    quoteCurrency: TossCurrency,
    dateTime?: string,
  ) =>
    request<ExchangeRateResponse>(credentials, "/api/v1/exchange-rate", {
      query: { baseCurrency, quoteCurrency, dateTime },
    }),

  getKrMarketCalendar: (date?: string) =>
    request<KrMarketCalendarResponse>(credentials, "/api/v1/market-calendar/KR", {
      query: { date },
    }),

  getUsMarketCalendar: (date?: string) =>
    request<UsMarketCalendarResponse>(credentials, "/api/v1/market-calendar/US", {
      query: { date },
    }),

  getBuyingPower: (accountSeq: number, currency: TossCurrency) =>
    request<BuyingPowerResponse>(credentials, "/api/v1/buying-power", {
      accountSeq,
      query: { currency },
    }),

  getSellableQuantity: (accountSeq: number, symbol: string) =>
    request<SellableQuantityResponse>(credentials, "/api/v1/sellable-quantity", {
      accountSeq,
      query: { symbol },
    }),

  getCommissions: (accountSeq: number) =>
    request<Commission[]>(credentials, "/api/v1/commissions", { accountSeq }),

  getHoldings: (accountSeq: number, symbol?: string) =>
    request<HoldingsOverview>(credentials, "/api/v1/holdings", {
      accountSeq,
      query: { symbol },
    }),

  /** 진행 중(OPEN) 주문 전량 조회. nextCursor 는 항상 null. */
  getOpenOrders: (accountSeq: number, symbol?: string) =>
    request<PaginatedOrderResponse>(credentials, "/api/v1/orders", {
      accountSeq,
      query: { status: "OPEN", symbol },
    }),

  listOrders: (
    accountSeq: number,
    options: {
      status: OrderListStatus;
      symbol?: string;
      from?: string;
      to?: string;
      cursor?: string;
      limit?: number;
    },
  ) =>
    request<PaginatedOrderResponse>(credentials, "/api/v1/orders", {
      accountSeq,
      query: options,
    }),

  /** 개별 주문 상세 조회 (모든 상태). 종료 주문 확인에 사용. */
  getOrder: (accountSeq: number, orderId: string) =>
    request<Order>(credentials, `/api/v1/orders/${orderId}`, { accountSeq }),

  createOrder: (accountSeq: number, payload: OrderCreateRequest) =>
    request<OrderResponse>(credentials, "/api/v1/orders", {
      method: "POST",
      accountSeq,
      body: payload,
    }),

  modifyOrder: (accountSeq: number, orderId: string, payload: OrderModifyRequest) =>
    request<OrderOperationResponse>(credentials, `/api/v1/orders/${orderId}/modify`, {
      method: "POST",
      accountSeq,
      body: payload,
    }),

  cancelOrder: (accountSeq: number, orderId: string) =>
    request<OrderOperationResponse>(credentials, `/api/v1/orders/${orderId}/cancel`, {
      method: "POST",
      accountSeq,
    }),
});

export type TossClient = ReturnType<typeof createTossClient>;

/** 테스트/안전장치용: 토큰 캐시를 비웁니다. */
export const clearTossTokenCache = () => {
  tokenCache.clear();
  tokenRequests.clear();
};
