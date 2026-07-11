import type {
  Account as TossAccount,
  BuyingPowerResponse,
  HoldingsOverview,
  Order as TossOrder,
  TossCurrency,
} from "@/lib/toss/types";
import type {
  CryptoAccount,
  CryptoExchange,
  CryptoOpenOrder,
  CryptoTickerQuote,
} from "@/lib/crypto-exchange/client";

export type RealPortfolioProvider = "toss" | CryptoExchange;
export type RealPortfolioConnectionStatus = "connected" | "disconnected" | "error";

export type RealPortfolioBalance = {
  currency: string;
  available: number | null;
  locked: number | null;
  total: number | null;
  buyingPower: number | null;
};

export type RealPortfolioAccount = {
  id: string;
  provider: RealPortfolioProvider;
  label: string;
  maskedAccount: string | null;
  accountType: string;
  balances: RealPortfolioBalance[];
};

export type RealPortfolioPosition = {
  id: string;
  provider: RealPortfolioProvider;
  accountId: string;
  accountLabel: string;
  symbol: string;
  name: string | null;
  currency: string;
  availableQuantity: number;
  lockedQuantity: number;
  quantity: number;
  averagePrice: number | null;
  currentPrice: number | null;
  purchaseAmount: number | null;
  marketValue: number | null;
  profitLoss: number | null;
  profitLossRate: number | null;
  valuationSupported: boolean;
};

export type RealPortfolioOpenOrder = {
  id: string;
  provider: RealPortfolioProvider;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  price: number | null;
  quantity: number;
  filledQuantity: number;
  clientOrderId: string | null;
};

export type RealPortfolioCurrencyTotal = {
  provider: RealPortfolioProvider;
  currency: string;
  cash: number | null;
  buyingPower: number | null;
  purchaseAmount: number | null;
  marketValue: number | null;
  profitLoss: number | null;
};

export type RealPortfolioProviderView = {
  provider: RealPortfolioProvider;
  connectionStatus: RealPortfolioConnectionStatus;
  accounts: RealPortfolioAccount[];
  positions: RealPortfolioPosition[];
  openOrders: RealPortfolioOpenOrder[];
  totalsByCurrency: RealPortfolioCurrencyTotal[];
  stale: boolean;
  partial: boolean;
  lastSuccessfulAt: string | null;
  error: string | null;
};

export type RealPortfolioResponse = {
  generatedAt: string;
  providers: RealPortfolioProviderView[];
  totalsByCurrency: RealPortfolioCurrencyTotal[];
  orderSubmissionAttempted: false;
};

const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonNegative = (value: unknown): number => {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : 0;
};

const amountForCurrency = (
  value: { krw?: string | null; usd?: string | null } | undefined,
  currency: string,
): number | null => {
  if (!value) return null;
  return finite(currency === "USD" ? value.usd : value.krw);
};

const ratio = (profitLoss: number | null, purchaseAmount: number | null) =>
  profitLoss !== null && purchaseAmount !== null && purchaseAmount > 0
    ? (profitLoss / purchaseAmount) * 100
    : null;

const sumNullable = (values: Array<number | null>) => {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) : null;
};

export const disconnectedRealPortfolioProvider = (
  provider: RealPortfolioProvider,
): RealPortfolioProviderView => ({
  provider,
  connectionStatus: "disconnected",
  accounts: [],
  positions: [],
  openOrders: [],
  totalsByCurrency: [],
  stale: false,
  partial: false,
  lastSuccessfulAt: null,
  error: null,
});

export type TossPortfolioAccountInput = {
  account: TossAccount;
  maskedAccount: string;
  holdings: HoldingsOverview | null;
  buyingPower: Partial<Record<TossCurrency, BuyingPowerResponse | null>>;
  openOrders: TossOrder[];
  errors: string[];
};

export const normalizeTossRealPortfolio = (
  inputs: TossPortfolioAccountInput[],
  generatedAt: string,
): RealPortfolioProviderView => {
  const accounts: RealPortfolioAccount[] = [];
  const positions: RealPortfolioPosition[] = [];
  const openOrders: RealPortfolioOpenOrder[] = [];
  const errors = inputs.flatMap((input) => input.errors);

  for (const [index, input] of inputs.entries()) {
    const accountId = `toss-account-${index + 1}`;
    const label = `Toss ${input.maskedAccount}`;
    const balances = (["KRW", "USD"] as const).flatMap((currency) => {
      const buyingPower = finite(input.buyingPower[currency]?.cashBuyingPower);
      return buyingPower === null ? [] : [{
        currency,
        available: null,
        locked: null,
        total: null,
        buyingPower,
      }];
    });
    accounts.push({
      id: accountId,
      provider: "toss",
      label,
      maskedAccount: input.maskedAccount,
      accountType: input.account.accountType,
      balances,
    });

    for (const holding of input.holdings?.items ?? []) {
      const quantity = nonNegative(holding.quantity);
      const averagePrice = finite(holding.averagePurchasePrice);
      const currentPrice = finite(holding.lastPrice);
      const purchaseAmount = amountForCurrency(holding.cost, holding.currency)
        ?? (averagePrice !== null ? averagePrice * quantity : null);
      const marketValue = amountForCurrency(holding.marketValue, holding.currency)
        ?? (currentPrice !== null ? currentPrice * quantity : null);
      const profitLoss = amountForCurrency(holding.profitLoss, holding.currency)
        ?? (marketValue !== null && purchaseAmount !== null ? marketValue - purchaseAmount : null);
      positions.push({
        id: `${accountId}:${holding.symbol.toUpperCase()}`,
        provider: "toss",
        accountId,
        accountLabel: label,
        symbol: holding.symbol.toUpperCase(),
        name: holding.name || null,
        currency: holding.currency,
        availableQuantity: quantity,
        lockedQuantity: 0,
        quantity,
        averagePrice,
        currentPrice,
        purchaseAmount,
        marketValue,
        profitLoss,
        profitLossRate: ratio(profitLoss, purchaseAmount),
        valuationSupported: currentPrice !== null && marketValue !== null,
      });
    }

    for (const order of input.openOrders) {
      openOrders.push({
        id: `toss:${order.orderId}`,
        provider: "toss",
        accountId,
        symbol: order.symbol.toUpperCase(),
        side: order.side === "SELL" ? "sell" : "buy",
        status: order.status,
        price: finite(order.price),
        quantity: nonNegative(order.quantity),
        filledQuantity: nonNegative(order.execution.filledQuantity),
        clientOrderId: null,
      });
    }
  }

  const currencies = new Set([
    ...accounts.flatMap((account) => account.balances.map((balance) => balance.currency)),
    ...positions.map((position) => position.currency),
  ]);
  const totalsByCurrency = [...currencies].sort().map((currency) => ({
    provider: "toss" as const,
    currency,
    cash: null,
    buyingPower: sumNullable(accounts.flatMap((account) =>
      account.balances.filter((balance) => balance.currency === currency).map((balance) => balance.buyingPower))),
    purchaseAmount: sumNullable(positions.filter((position) => position.currency === currency).map((position) => position.purchaseAmount)),
    marketValue: sumNullable(positions.filter((position) => position.currency === currency).map((position) => position.marketValue)),
    profitLoss: sumNullable(positions.filter((position) => position.currency === currency).map((position) => position.profitLoss)),
  }));

  return {
    provider: "toss",
    connectionStatus: "connected",
    accounts,
    positions,
    openOrders,
    totalsByCurrency,
    stale: false,
    partial: errors.length > 0,
    lastSuccessfulAt: generatedAt,
    error: errors.length ? errors.join(" · ") : null,
  };
};

export const normalizeCryptoRealPortfolio = ({
  exchange,
  accounts: rawAccounts,
  tickers,
  openOrders: rawOpenOrders,
  generatedAt,
  errors = [],
}: {
  exchange: CryptoExchange;
  accounts: CryptoAccount[];
  tickers: CryptoTickerQuote[];
  openOrders: CryptoOpenOrder[];
  generatedAt: string;
  errors?: string[];
}): RealPortfolioProviderView => {
  const tickerByMarket = new Map(tickers.map((ticker) => [ticker.market.toUpperCase(), ticker]));
  const krw = rawAccounts.find((account) => account.currency.toUpperCase() === "KRW");
  const cashAvailable = finite(krw?.balance);
  const cashLocked = finite(krw?.locked);
  const account: RealPortfolioAccount = {
    id: exchange,
    provider: exchange,
    label: exchange === "upbit" ? "Upbit" : "Bithumb",
    maskedAccount: null,
    accountType: "CRYPTO_EXCHANGE",
    balances: [{
      currency: "KRW",
      available: cashAvailable,
      locked: cashLocked,
      total: cashAvailable !== null || cashLocked !== null
        ? (cashAvailable ?? 0) + (cashLocked ?? 0)
        : null,
      buyingPower: cashAvailable,
    }],
  };
  const positions = rawAccounts
    .filter((item) => item.currency.toUpperCase() !== "KRW")
    .filter((item) => nonNegative(item.balance) + nonNegative(item.locked) > 0)
    .map((item): RealPortfolioPosition => {
      const currencyCode = item.currency.toUpperCase();
      const availableQuantity = nonNegative(item.balance);
      const lockedQuantity = nonNegative(item.locked);
      const quantity = availableQuantity + lockedQuantity;
      const averagePrice = finite(item.avg_buy_price);
      const currentPrice = tickerByMarket.get(`KRW-${currencyCode}`)?.tradePrice ?? null;
      const purchaseAmount = averagePrice !== null && averagePrice > 0 ? averagePrice * quantity : null;
      const marketValue = currentPrice !== null ? currentPrice * quantity : null;
      const profitLoss = purchaseAmount !== null && marketValue !== null ? marketValue - purchaseAmount : null;
      return {
        id: `${exchange}:${currencyCode}`,
        provider: exchange,
        accountId: exchange,
        accountLabel: account.label,
        symbol: `KRW-${currencyCode}`,
        name: currencyCode,
        currency: "KRW",
        availableQuantity,
        lockedQuantity,
        quantity,
        averagePrice,
        currentPrice,
        purchaseAmount,
        marketValue,
        profitLoss,
        profitLossRate: ratio(profitLoss, purchaseAmount),
        valuationSupported: currentPrice !== null,
      };
    });
  const openOrders = rawOpenOrders.map((order): RealPortfolioOpenOrder => ({
    id: `${exchange}:${order.orderId}`,
    provider: exchange,
    accountId: exchange,
    symbol: order.market,
    side: order.side === "ask" ? "sell" : "buy",
    status: order.state,
    price: order.price,
    quantity: order.volume,
    filledQuantity: order.executedVolume,
    clientOrderId: order.clientOrderId,
  }));
  const coinMarketValue = sumNullable(positions.map((position) => position.marketValue));
  const coinPurchaseAmount = sumNullable(positions.map((position) => position.purchaseAmount));
  const coinProfitLoss = sumNullable(positions.map((position) => position.profitLoss));
  const totalsByCurrency: RealPortfolioCurrencyTotal[] = [{
    provider: exchange,
    currency: "KRW",
    cash: account.balances[0]?.total ?? null,
    buyingPower: account.balances[0]?.buyingPower ?? null,
    purchaseAmount: coinPurchaseAmount,
    marketValue: coinMarketValue !== null
      ? coinMarketValue + (account.balances[0]?.total ?? 0)
      : account.balances[0]?.total ?? null,
    profitLoss: coinProfitLoss,
  }];
  return {
    provider: exchange,
    connectionStatus: "connected",
    accounts: [account],
    positions,
    openOrders,
    totalsByCurrency,
    stale: false,
    partial: errors.length > 0 || positions.some((position) => !position.valuationSupported),
    lastSuccessfulAt: generatedAt,
    error: errors.length ? errors.join(" · ") : null,
  };
};

export const realPortfolioResponse = (
  providers: RealPortfolioProviderView[],
  generatedAt = new Date().toISOString(),
): RealPortfolioResponse => ({
  generatedAt,
  providers,
  totalsByCurrency: providers.flatMap((provider) => provider.totalsByCurrency),
  orderSubmissionAttempted: false,
});
