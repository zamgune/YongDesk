/**
 * 토스증권 Open API (https://openapi.tossinvest.com) 타입.
 * OpenAPI 1.2.2 스펙 기준. 필요한 엔드포인트만 추렸습니다.
 *
 * 주의:
 * - 모든 금액/수량/가격은 API 에서 문자열(decimal)로 내려옵니다. 정밀도 손실을
 *   막기 위해 string 으로 유지하고, 계산이 필요한 지점에서만 Number 변환합니다.
 * - enum 류는 "unknown 값 허용" 이 스펙 권고이므로 string 베이스 union 으로 둡니다.
 */

export type TossCurrency = "KRW" | "USD";
export type TossMarketCountry = "KR" | "US";
export type TossOrderSide = "BUY" | "SELL";
export type TossOrderType = "LIMIT" | "MARKET";
export type TossTimeInForce = "DAY" | "CLS";
export type TossCandleInterval = "1m" | "1d";
export type TossRankingType =
  | "MARKET_TRADING_AMOUNT"
  | "MARKET_TRADING_VOLUME"
  | "TOP_GAINERS"
  | "TOP_LOSERS"
  | "TOSS_SECURITIES_TRADING_AMOUNT"
  | "TOSS_SECURITIES_TRADING_VOLUME";
export type TossRankingDuration = "realtime" | "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y";

/** 클라이언트는 unknown 코드를 허용해야 한다 (스펙 명시). */
export type TossOrderStatus =
  | "PENDING"
  | "PENDING_CANCEL"
  | "PENDING_REPLACE"
  | "PARTIAL_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "CANCEL_REJECTED"
  | "REPLACE_REJECTED"
  | "REPLACED"
  | (string & {});

export type TossAccountType =
  | "BROKERAGE"
  | "OVERSEAS_DERIVATIVES"
  | "PENSION_SAVINGS"
  | "RESHORING_INVESTMENT"
  | (string & {});

// --- OAuth ---

export type OAuth2TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number; // 초
};

export type OAuth2ErrorResponse = {
  error: string;
  error_description?: string;
};

// --- 공통 envelope ---

export type ApiError = {
  requestId: string;
  code: string;
  message: string;
  data?: Record<string, unknown> | null;
};

export type ApiResponse<T> = { result: T };
export type ErrorResponse = { error: ApiError };

// --- Account ---

export type Account = {
  accountNo: string;
  accountSeq: number;
  accountType: TossAccountType;
};

// --- Market Data ---

export type Price = {
  symbol: string;
  timestamp: string | null;
  lastPrice: string;
  currency: TossCurrency;
};

export type Candle = {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: TossCurrency;
};

export type CandlePageResponse = {
  candles: Candle[];
  nextBefore: string | null;
};

export type MarketIndicatorCandle = Omit<Candle, "currency">;

export type MarketIndicatorCandlePageResponse = {
  candles: MarketIndicatorCandle[];
  nextBefore: string | null;
};

export type OrderbookEntry = {
  price: string;
  volume: string;
};

export type OrderbookResponse = {
  timestamp: string | null;
  currency: TossCurrency;
  asks: OrderbookEntry[];
  bids: OrderbookEntry[];
};

export type Trade = {
  price: string;
  volume: string;
  timestamp: string;
  currency: TossCurrency;
};

export type PriceLimitResponse = {
  timestamp: string;
  upperLimitPrice: string | null;
  lowerLimitPrice: string | null;
  currency: TossCurrency;
};

export type TossRankingItem = {
  rank: number;
  symbol: string;
  currency: TossCurrency;
  price: {
    lastPrice: string;
    basePrice: string;
    changeRate: string;
  };
  tradingVolume: string;
  tradingAmount: string;
};

export type TossRankingResponse = {
  rankedAt: string | null;
  rankings: TossRankingItem[];
};

export type StockInfo = {
  symbol: string;
  name: string;
  englishName: string;
  isinCode: string;
  market: string;
  securityType: string;
  isCommonShare: boolean;
  status: string;
  currency: TossCurrency;
  listDate: string | null;
  delistDate: string | null;
  sharesOutstanding: string;
  leverageFactor: string | null;
  koreanMarketDetail?: unknown;
};

export type StockWarning = {
  warningType: string;
  exchange: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type ExchangeRateResponse = {
  baseCurrency: TossCurrency;
  quoteCurrency: TossCurrency;
  rate: string;
  midRate: string;
  basisPoint: string;
  rateChangeType: string;
  validFrom: string;
  validUntil: string;
};

export type MarketSession = {
  startTime: string;
  endTime: string;
};

export type KrMarketDay = {
  date: string;
  integrated: {
    preMarket: MarketSession | null;
    regularMarket: MarketSession | null;
    afterMarket: MarketSession | null;
  } | null;
};

export type KrMarketCalendarResponse = {
  today: KrMarketDay;
  previousBusinessDay: KrMarketDay;
  nextBusinessDay: KrMarketDay;
};

export type UsMarketDay = {
  date: string;
  dayMarket: MarketSession | null;
  preMarket: MarketSession | null;
  regularMarket: MarketSession | null;
  afterMarket: MarketSession | null;
};

export type UsMarketCalendarResponse = {
  today: UsMarketDay;
  previousBusinessDay: UsMarketDay;
  nextBusinessDay: UsMarketDay;
};

// --- Order ---

export type OrderCreateQuantityBased = {
  clientOrderId?: string;
  symbol: string;
  side: TossOrderSide;
  orderType: TossOrderType;
  timeInForce?: TossTimeInForce;
  quantity: string;
  price?: string;
  confirmHighValueOrder?: boolean;
};

export type OrderCreateAmountBased = {
  clientOrderId?: string;
  symbol: string;
  side: TossOrderSide;
  orderType: "MARKET";
  orderAmount: string;
  confirmHighValueOrder?: boolean;
};

export type OrderCreateRequest = OrderCreateQuantityBased | OrderCreateAmountBased;

export type OrderResponse = {
  orderId: string;
  clientOrderId: string | null;
};

export type OrderOperationResponse = {
  orderId: string;
};

export type OrderModifyRequest = {
  orderType: TossOrderType;
  quantity?: string;
  price?: string;
  confirmHighValueOrder?: boolean;
};

// --- Order History (조회) ---

/** 목록 조회 라이프사이클 필터. */
export type OrderListStatus = "OPEN" | "CLOSED";

export type OrderExecution = {
  filledQuantity: string;
  averageFilledPrice: string | null;
  filledAmount: string | null;
  commission: string | null;
  tax: string | null;
  filledAt: string | null;
  settlementDate: string | null;
};

export type Order = {
  orderId: string;
  symbol: string;
  side: TossOrderSide;
  orderType: TossOrderType;
  timeInForce: TossTimeInForce | "OPG" | (string & {});
  status: TossOrderStatus;
  price: string | null;
  quantity: string;
  orderAmount: string | null;
  currency: TossCurrency;
  orderedAt: string;
  canceledAt: string | null;
  execution: OrderExecution;
};

export type PaginatedOrderResponse = {
  orders: Order[];
  nextCursor: string | null;
  hasNext: boolean;
};

// --- Order Info (사전 검증) ---

export type BuyingPowerResponse = {
  currency: TossCurrency;
  cashBuyingPower: string;
};

export type SellableQuantityResponse = {
  sellableQuantity: string;
};

export type Commission = {
  marketCountry: TossMarketCountry;
  commissionRate: string; // % 단위. "0.015" = 0.015%
  startDate: string | null;
  endDate: string | null;
};

// --- Asset (보유) ---

export type TossAmountByCurrency = {
  krw: string;
  usd?: string | null;
};

export type TossMarketValue = TossAmountByCurrency;
export type TossProfitLoss = TossAmountByCurrency;
export type TossDailyProfitLoss = TossAmountByCurrency;
export type TossCost = TossAmountByCurrency;

export type HoldingsItem = {
  symbol: string;
  name: string;
  marketCountry: TossMarketCountry;
  currency: TossCurrency;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  marketValue?: TossMarketValue;
  profitLoss?: TossProfitLoss;
  dailyProfitLoss?: TossDailyProfitLoss;
  cost?: TossCost;
};

export type HoldingsOverview = {
  totalPurchaseAmount?: TossAmountByCurrency;
  marketValue?: TossMarketValue;
  profitLoss?: TossProfitLoss;
  dailyProfitLoss?: TossDailyProfitLoss;
  items: HoldingsItem[];
};
