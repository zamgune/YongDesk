export type TossOpenApiRequiredOperation = {
  path: string;
  method: "get" | "post";
  accountHeader: boolean;
  purpose: string;
};

export const TOSS_OPENAPI_SPEC_VERSION = "1.2.2";
export const TOSS_OPENAPI_BASE_URL = "https://openapi.tossinvest.com";
export const TOSS_OPENAPI_DOCS_URL = "https://developers.tossinvest.com/docs";
export const TOSS_OPENAPI_JSON_URL = "https://openapi.tossinvest.com/openapi-docs/latest/openapi.json";

export const TOSS_OPENAPI_REQUIRED_OPERATIONS: readonly TossOpenApiRequiredOperation[] = [
  { path: "/oauth2/token", method: "post", accountHeader: false, purpose: "OAuth2 client credentials token" },
  { path: "/api/v1/accounts", method: "get", accountHeader: false, purpose: "Toss account list" },
  { path: "/api/v1/prices", method: "get", accountHeader: false, purpose: "current prices" },
  { path: "/api/v1/candles", method: "get", accountHeader: false, purpose: "candles" },
  { path: "/api/v1/market-indicators/{symbol}/candles", method: "get", accountHeader: false, purpose: "market indicator candles" },
  { path: "/api/v1/orderbook", method: "get", accountHeader: false, purpose: "orderbook" },
  { path: "/api/v1/trades", method: "get", accountHeader: false, purpose: "recent trades" },
  { path: "/api/v1/price-limits", method: "get", accountHeader: false, purpose: "KR price limits" },
  { path: "/api/v1/stocks", method: "get", accountHeader: false, purpose: "stock master" },
  { path: "/api/v1/stocks/{symbol}/warnings", method: "get", accountHeader: false, purpose: "stock warnings" },
  { path: "/api/v1/exchange-rate", method: "get", accountHeader: false, purpose: "exchange rate" },
  { path: "/api/v1/market-calendar/KR", method: "get", accountHeader: false, purpose: "KR market calendar" },
  { path: "/api/v1/market-calendar/US", method: "get", accountHeader: false, purpose: "US market calendar" },
  { path: "/api/v1/rankings", method: "get", accountHeader: false, purpose: "market and Toss Securities rankings" },
  { path: "/api/v1/buying-power", method: "get", accountHeader: true, purpose: "pre-trade buying power" },
  { path: "/api/v1/sellable-quantity", method: "get", accountHeader: true, purpose: "pre-trade sellable quantity" },
  { path: "/api/v1/commissions", method: "get", accountHeader: true, purpose: "commission schedule" },
  { path: "/api/v1/holdings", method: "get", accountHeader: true, purpose: "holdings" },
  { path: "/api/v1/orders", method: "get", accountHeader: true, purpose: "order history" },
  { path: "/api/v1/orders", method: "post", accountHeader: true, purpose: "order submission" },
  { path: "/api/v1/orders/{orderId}", method: "get", accountHeader: true, purpose: "order detail" },
  { path: "/api/v1/orders/{orderId}/modify", method: "post", accountHeader: true, purpose: "order modification" },
  { path: "/api/v1/orders/{orderId}/cancel", method: "post", accountHeader: true, purpose: "order cancel" },
];

export const TOSS_OPENAPI_CONTRACT = {
  specVersion: TOSS_OPENAPI_SPEC_VERSION,
  baseUrl: TOSS_OPENAPI_BASE_URL,
  docsUrl: TOSS_OPENAPI_DOCS_URL,
  openApiJsonUrl: TOSS_OPENAPI_JSON_URL,
  requiredOperations: TOSS_OPENAPI_REQUIRED_OPERATIONS,
  accountHeaderName: "X-Tossinvest-Account",
} as const;
