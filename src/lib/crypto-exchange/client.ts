import { createHash, createHmac, randomUUID } from "node:crypto";

export type CryptoExchange = "upbit" | "bithumb";

export type CryptoExchangeCredentials = {
  accessKey: string;
  secretKey: string;
};

export type CryptoAccount = {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price?: string;
  avg_buy_price_modified?: boolean;
  unit_currency?: string;
};

export type CryptoTickerQuote = {
  market: string;
  tradePrice: number;
  timestamp: number;
  tradeTimestamp: number | null;
};

export type UpbitCandleInterval = "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1wk";

export type UpbitCandle = {
  market: string;
  time: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  isClosed: boolean;
};

export type CryptoOrderConstraints = {
  minTotal: number | null;
  maxTotal: number | null;
  priceUnit: number | null;
  feeRate: number | null;
};

export type UpbitOrderbookInstrument = {
  market: string;
  quoteCurrency: string;
  tickSize: number;
  supportedLevels: number[];
};

type CryptoOrderPreviewBase = {
  method: "POST";
  url: string;
  orderSubmissionAttempted: false;
};

export type CryptoOrderPreview =
  | CryptoOrderPreviewBase & {
    exchange: "upbit";
    body: {
      market: string;
      side: "bid" | "ask";
      volume: string;
      price: string;
      ord_type: "limit";
      identifier?: string;
    };
  }
  | CryptoOrderPreviewBase & {
    exchange: "bithumb";
    body: {
      market: string;
      side: "bid" | "ask";
      volume: string;
      price: string;
      order_type: "limit";
      client_order_id?: string;
    };
  };

export type CryptoLimitOrderRequest = {
  market: string;
  side: "bid" | "ask";
  volume: string;
  price: string;
  clientOrderId: string;
};

export type CryptoMarketSellOrderRequest = {
  market: string;
  side: "ask";
  volume: string;
  clientOrderId: string;
};

export type CryptoOrderResult = {
  orderId: string;
  clientOrderId: string | null;
  raw: Record<string, unknown>;
};

export type CryptoOrderStatus = {
  orderId: string;
  clientOrderId: string | null;
  state: string | null;
  raw: Record<string, unknown>;
};

export type CryptoOpenOrder = {
  orderId: string;
  clientOrderId: string | null;
  market: string;
  side: "bid" | "ask";
  state: string;
  price: number | null;
  volume: number;
  executedVolume: number;
};

export class CryptoExchangeApiError extends Error {
  readonly exchange: CryptoExchange;
  readonly status: number;

  constructor(exchange: CryptoExchange, status: number, message: string) {
    super(message);
    this.name = "CryptoExchangeApiError";
    this.exchange = exchange;
    this.status = status;
  }
}

const CONTRACTS = {
  upbit: {
    baseUrl: "https://api.upbit.com",
    jwtAlgorithm: "HS512" as const,
    accountsPath: "/v1/accounts",
    orderChancePath: "/v1/orders/chance",
    tickerPath: "/v1/ticker",
    createOrderPath: "/v1/orders",
    orderLookupPath: "/v1/order",
    docsUrl: "https://docs.upbit.com/kr/reference/auth",
  },
  bithumb: {
    baseUrl: "https://api.bithumb.com",
    jwtAlgorithm: "HS256" as const,
    accountsPath: "/v1/accounts",
    orderChancePath: "/v1/orders/chance",
    tickerPath: "/v1/ticker",
    createOrderPath: "/v2/orders",
    orderLookupPath: null,
    docsUrl: "https://apidocs.bithumb.com/docs/인증-토큰-생성하기",
  },
};

export const cryptoExchangeContract = (exchange: CryptoExchange) => ({
  exchange,
  ...CONTRACTS[exchange],
  authHeader: "Authorization: Bearer <JWT>",
  queryHashAlgorithm: "SHA512" as const,
});

const base64Url = (value: string | Buffer) => Buffer.from(value)
  .toString("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

export const buildCryptoQueryString = (parameters: Record<string, string | number>) =>
  Object.entries(parameters)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

export const buildCryptoQueryHashString = (parameters: Record<string, string | number>) =>
  Object.entries(parameters)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");

export const createCryptoExchangeJwt = ({
  exchange,
  credentials,
  queryString = "",
  nonce = randomUUID(),
  timestamp = Date.now(),
}: {
  exchange: CryptoExchange;
  credentials: CryptoExchangeCredentials;
  queryString?: string;
  nonce?: string;
  timestamp?: number;
}) => {
  const contract = CONTRACTS[exchange];
  const header = { alg: contract.jwtAlgorithm, typ: "JWT" };
  const payload: Record<string, string | number> = {
    access_key: credentials.accessKey,
    nonce,
  };
  if (exchange === "bithumb") {
    payload.timestamp = timestamp;
  }
  if (queryString) {
    payload.query_hash = createHash("sha512").update(queryString, "utf8").digest("hex");
    payload.query_hash_alg = "SHA512";
  }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const digest = contract.jwtAlgorithm === "HS512" ? "sha512" : "sha256";
  const signature = createHmac(digest, credentials.secretKey).update(signingInput).digest();
  return `${signingInput}.${base64Url(signature)}`;
};

const privateRequest = async <T>({
  exchange,
  credentials,
  path,
  parameters,
  method = "GET",
  body,
  fetchImpl = fetch,
}: {
  exchange: CryptoExchange;
  credentials: CryptoExchangeCredentials;
  path: string;
  parameters?: Record<string, string | number>;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<T> => {
  const queryValues = body ?? parameters;
  const queryString = queryValues ? buildCryptoQueryString(queryValues) : "";
  const queryHashString = queryValues && exchange === "upbit"
    ? buildCryptoQueryHashString(queryValues)
    : queryString;
  const url = `${CONTRACTS[exchange].baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
  const requestUrl = body ? `${CONTRACTS[exchange].baseUrl}${path}` : url;
  const token = createCryptoExchangeJwt({ exchange, credentials, queryString: queryHashString });
  const response = await fetchImpl(requestUrl, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : `HTTP ${response.status}`;
    throw new CryptoExchangeApiError(exchange, response.status, `${exchange} API ${response.status}: ${detail}`);
  }
  return payload as T;
};

const publicRequest = async <T>({
  exchange,
  path,
  parameters,
  fetchImpl = fetch,
}: {
  exchange: CryptoExchange;
  path: string;
  parameters?: Record<string, string | number>;
  fetchImpl?: typeof fetch;
}): Promise<T> => {
  const queryString = parameters ? buildCryptoQueryString(parameters) : "";
  const url = `${CONTRACTS[exchange].baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? JSON.stringify(payload) : `HTTP ${response.status}`;
    throw new CryptoExchangeApiError(exchange, response.status, `${exchange} API ${response.status}: ${detail}`);
  }
  return payload as T;
};

const numericValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export const getCryptoAccounts = (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  fetchImpl: typeof fetch = fetch,
) => privateRequest<CryptoAccount[]>({
  exchange,
  credentials,
  path: CONTRACTS[exchange].accountsPath,
  fetchImpl,
});

export const getCryptoOrderChance = (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  market: string,
  fetchImpl: typeof fetch = fetch,
) => privateRequest<Record<string, unknown>>({
  exchange,
  credentials,
  path: CONTRACTS[exchange].orderChancePath,
  parameters: { market },
  fetchImpl,
});

export const getCryptoTicker = async (
  exchange: CryptoExchange,
  market: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoTickerQuote> => {
  const quotes = await getCryptoTickers(exchange, [market], fetchImpl);
  const quote = quotes[0];
  if (!quote) {
    throw new CryptoExchangeApiError(exchange, 502, `${exchange} 현재가 응답이 유효하지 않습니다.`);
  }
  return quote;
};

export const getCryptoTickers = async (
  exchange: CryptoExchange,
  markets: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoTickerQuote[]> => {
  const normalizedMarkets = [...new Set(markets.map((market) => market.trim().toUpperCase()).filter(Boolean))];
  if (!normalizedMarkets.length) {
    return [];
  }
  const payload = await publicRequest<Array<Record<string, unknown>>>({
    exchange,
    path: CONTRACTS[exchange].tickerPath,
    parameters: { markets: normalizedMarkets.join(",") },
    fetchImpl,
  });
  return payload.flatMap((ticker) => {
    const tradePrice = numericValue(ticker.trade_price);
    const timestamp = numericValue(ticker.timestamp);
    if (tradePrice === null || tradePrice <= 0 || timestamp === null || timestamp <= 0) {
      return [];
    }
    return [{
      market: typeof ticker.market === "string" ? ticker.market.toUpperCase() : "",
      tradePrice,
      timestamp,
      tradeTimestamp: numericValue(ticker.trade_timestamp),
    }];
  }).filter((ticker) => ticker.market.length > 0);
};

const UPBIT_CANDLE_CONTRACT: Record<UpbitCandleInterval, { path: string; seconds: number }> = {
  "5m": { path: "/v1/candles/minutes/5", seconds: 5 * 60 },
  "15m": { path: "/v1/candles/minutes/15", seconds: 15 * 60 },
  "30m": { path: "/v1/candles/minutes/30", seconds: 30 * 60 },
  "1h": { path: "/v1/candles/minutes/60", seconds: 60 * 60 },
  "4h": { path: "/v1/candles/minutes/240", seconds: 4 * 60 * 60 },
  "1d": { path: "/v1/candles/days", seconds: 24 * 60 * 60 },
  "1wk": { path: "/v1/candles/weeks", seconds: 7 * 24 * 60 * 60 },
};

const upbitCandleTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
};

export const getUpbitCandles = async (
  market: string,
  options: {
    interval: UpbitCandleInterval;
    count?: number;
    to?: string;
    nowMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<UpbitCandle[]> => {
  const contract = UPBIT_CANDLE_CONTRACT[options.interval];
  const count = Math.min(Math.max(Math.trunc(options.count ?? 200), 1), 200);
  const payload = await publicRequest<Array<Record<string, unknown>>>({
    exchange: "upbit",
    path: contract.path,
    parameters: {
      market: market.toUpperCase(),
      count,
      ...(options.to ? { to: options.to } : {}),
    },
    fetchImpl,
  });
  if (!Array.isArray(payload)) {
    throw new CryptoExchangeApiError("upbit", 502, "upbit 캔들 응답이 배열이 아닙니다.");
  }
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  return payload
    .map((item): UpbitCandle | null => {
      const time = upbitCandleTimestamp(item.candle_date_time_utc);
      const open = numericValue(item.opening_price);
      const high = numericValue(item.high_price);
      const low = numericValue(item.low_price);
      const close = numericValue(item.trade_price);
      const volume = numericValue(item.candle_acc_trade_volume);
      const quoteVolume = numericValue(item.candle_acc_trade_price);
      if (
        time === null ||
        open === null || open <= 0 ||
        high === null || high <= 0 ||
        low === null || low <= 0 ||
        close === null || close <= 0 ||
        volume === null || volume < 0 ||
        quoteVolume === null || quoteVolume < 0
      ) {
        return null;
      }
      const closeTime = time + contract.seconds;
      return {
        market: typeof item.market === "string" ? item.market : market.toUpperCase(),
        time,
        closeTime,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume,
        isClosed: closeTime <= nowSeconds,
      };
    })
    .filter((candle): candle is UpbitCandle => candle !== null)
    .toSorted((left, right) => left.time - right.time);
};

export const getUpbitOrderbookInstrument = async (
  market: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpbitOrderbookInstrument> => {
  const payload = await publicRequest<Array<Record<string, unknown>>>({
    exchange: "upbit",
    path: "/v1/orderbook/instruments",
    parameters: { markets: market },
    fetchImpl,
  });
  const instrument = payload.find((item) => item.market === market);
  const tickSize = numericValue(instrument?.tick_size);
  const quoteCurrency = instrument?.quote_currency;
  if (!instrument || typeof quoteCurrency !== "string" || tickSize === null || tickSize <= 0) {
    throw new CryptoExchangeApiError("upbit", 502, "upbit 호가 정책 응답이 유효하지 않습니다.");
  }
  const supportedLevels = Array.isArray(instrument.supported_levels)
    ? instrument.supported_levels
      .map(numericValue)
      .filter((value): value is number => value !== null && value >= 0)
    : [];
  return {
    market,
    quoteCurrency,
    tickSize,
    supportedLevels,
  };
};

export const getCryptoOrderConstraints = (
  chance: Record<string, unknown>,
  side: "bid" | "ask",
): CryptoOrderConstraints => {
  const market = objectValue(chance.market);
  const sideRules = objectValue(market?.[side]);
  return {
    minTotal: numericValue(sideRules?.min_total),
    maxTotal: numericValue(sideRules?.max_total ?? market?.max_total),
    priceUnit: numericValue(sideRules?.price_unit),
    feeRate: numericValue(chance[side === "bid" ? "bid_fee" : "ask_fee"]),
  };
};

export const previewCryptoLimitOrder = ({
  exchange,
  market,
  side,
  volume,
  price,
  identifier,
}: {
  exchange: CryptoExchange;
  market: string;
  side: "bid" | "ask";
  volume: string;
  price: string;
  identifier?: string;
}): CryptoOrderPreview => {
  const common = {
    method: "POST" as const,
    url: `${CONTRACTS[exchange].baseUrl}${CONTRACTS[exchange].createOrderPath}`,
    orderSubmissionAttempted: false as const,
  };
  if (exchange === "upbit") {
    return {
      ...common,
      exchange,
      body: {
        market,
        side,
        volume,
        price,
        ord_type: "limit",
        ...(identifier ? { identifier } : {}),
      },
    };
  }
  return {
    ...common,
    exchange,
    body: {
      market,
      side,
      volume,
      price,
      order_type: "limit",
      ...(identifier ? { client_order_id: identifier } : {}),
    },
  };
};

const orderClientId = (exchange: CryptoExchange, body: Record<string, unknown>) => {
  const value = exchange === "upbit" ? body.identifier : body.client_order_id;
  return typeof value === "string" ? value : null;
};

const orderId = (exchange: CryptoExchange, body: Record<string, unknown>) => {
  const value = exchange === "upbit" ? body.uuid : body.order_id ?? body.uuid;
  if (typeof value !== "string" || !value.trim()) {
    throw new CryptoExchangeApiError(exchange, 502, `${exchange} 주문 응답에 주문 ID가 없습니다.`);
  }
  return value;
};

export const createCryptoLimitOrder = async (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  request: CryptoLimitOrderRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoOrderResult> => {
  const body: Record<string, string> = exchange === "upbit"
    ? {
      market: request.market,
      side: request.side,
      volume: request.volume,
      price: request.price,
      ord_type: "limit",
      identifier: request.clientOrderId,
    }
    : {
      market: request.market,
      side: request.side,
      volume: request.volume,
      price: request.price,
      order_type: "limit",
      client_order_id: request.clientOrderId,
    };
  const raw = await privateRequest<Record<string, unknown>>({
    exchange,
    credentials,
    path: CONTRACTS[exchange].createOrderPath,
    method: "POST",
    body,
    fetchImpl,
  });
  return { orderId: orderId(exchange, raw), clientOrderId: orderClientId(exchange, raw), raw };
};

export const createCryptoMarketSellOrder = async (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  request: CryptoMarketSellOrderRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoOrderResult> => {
  const body: Record<string, string> = exchange === "upbit"
    ? {
      market: request.market,
      side: "ask",
      volume: request.volume,
      ord_type: "market",
      identifier: request.clientOrderId,
    }
    : {
      market: request.market,
      side: "ask",
      volume: request.volume,
      order_type: "market",
      client_order_id: request.clientOrderId,
    };
  const raw = await privateRequest<Record<string, unknown>>({
    exchange,
    credentials,
    path: CONTRACTS[exchange].createOrderPath,
    method: "POST",
    body,
    fetchImpl,
  });
  return { orderId: orderId(exchange, raw), clientOrderId: orderClientId(exchange, raw), raw };
};

export const getCryptoOrderByClientOrderId = async (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoOrderStatus> => {
  if (!identifier.trim()) {
    throw new CryptoExchangeApiError(exchange, 400, `${exchange} 주문 식별자가 필요합니다.`);
  }
  const raw = await privateRequest<Record<string, unknown>>({
    exchange,
    credentials,
    path: CONTRACTS[exchange].orderLookupPath ?? "/v1/order",
    parameters: exchange === "upbit" ? { identifier } : { client_order_id: identifier },
    fetchImpl,
  });
  const state = typeof raw.state === "string" ? raw.state : null;
  return {
    orderId: orderId(exchange, raw),
    clientOrderId: orderClientId(exchange, raw),
    state,
    raw,
  };
};

export const getUpbitOrderByIdentifier = (
  credentials: CryptoExchangeCredentials,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
) => getCryptoOrderByClientOrderId("upbit", credentials, identifier, fetchImpl);

export const getCryptoOpenOrders = async (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoOpenOrder[]> => {
  const raw = await privateRequest<Array<Record<string, unknown>>>({
    exchange,
    credentials,
    path: "/v1/orders",
    parameters: { state: "wait" },
    fetchImpl,
  });
  return raw.flatMap((item): CryptoOpenOrder[] => {
    const market = typeof item.market === "string" ? item.market.toUpperCase() : "";
    const side = item.side === "ask" ? "ask" : item.side === "bid" ? "bid" : null;
    const volume = numericValue(item.volume ?? item.quantity);
    const executedVolume = numericValue(item.executed_volume ?? item.executed_quantity) ?? 0;
    if (!market || !side || volume === null || volume < 0) return [];
    try {
      return [{
        orderId: orderId(exchange, item),
        clientOrderId: orderClientId(exchange, item),
        market,
        side,
        state: typeof item.state === "string" ? item.state : "wait",
        price: numericValue(item.price ?? item.order_price),
        volume,
        executedVolume,
      }];
    } catch {
      return [];
    }
  });
};

export const cancelCryptoOrder = async (
  exchange: CryptoExchange,
  credentials: CryptoExchangeCredentials,
  brokerOrderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoOrderResult> => {
  const raw = exchange === "upbit"
    ? await privateRequest<Record<string, unknown>>({
      exchange,
      credentials,
      path: "/v1/order",
      method: "DELETE",
      parameters: { uuid: brokerOrderId },
      fetchImpl,
    })
    : await privateRequest<Record<string, unknown>>({
      exchange,
      credentials,
      path: "/v2/order",
      method: "DELETE",
      parameters: { order_id: brokerOrderId },
      fetchImpl,
    });
  return { orderId: orderId(exchange, raw), clientOrderId: orderClientId(exchange, raw), raw };
};
