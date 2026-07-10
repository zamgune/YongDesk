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

export type CryptoOrderPreview = {
  exchange: CryptoExchange;
  method: "POST";
  url: string;
  body: {
    market: string;
    side: "bid" | "ask";
    volume: string;
    price: string;
    ord_type: "limit";
    identifier?: string;
  };
  orderSubmissionAttempted: false;
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
    createOrderPath: "/v1/orders",
    docsUrl: "https://docs.upbit.com/kr/reference/auth",
  },
  bithumb: {
    baseUrl: "https://api.bithumb.com",
    jwtAlgorithm: "HS256" as const,
    accountsPath: "/v1/accounts",
    orderChancePath: "/v1/orders/chance",
    createOrderPath: "/v2/orders",
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
  const url = `${CONTRACTS[exchange].baseUrl}${path}${queryString ? `?${queryString}` : ""}`;
  const requestUrl = body ? `${CONTRACTS[exchange].baseUrl}${path}` : url;
  const token = createCryptoExchangeJwt({ exchange, credentials, queryString });
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
}): CryptoOrderPreview => ({
  exchange,
  method: "POST",
  url: `${CONTRACTS[exchange].baseUrl}${CONTRACTS[exchange].createOrderPath}`,
  body: {
    market,
    side,
    volume,
    price,
    ord_type: "limit",
    ...(identifier ? { identifier } : {}),
  },
  orderSubmissionAttempted: false,
});

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
      parameters: { uuid: brokerOrderId },
      fetchImpl,
    });
  return { orderId: orderId(exchange, raw), clientOrderId: orderClientId(exchange, raw), raw };
};
