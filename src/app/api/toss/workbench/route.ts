import { loadDecryptedCredentials, getBrokerCredentialView } from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import type {
  Account,
  Commission,
  HoldingsItem,
  KrMarketCalendarResponse,
  PaginatedOrderResponse,
  StockInfo,
  StockWarning,
  TossCurrency,
  UsMarketCalendarResponse,
} from "@/lib/toss/types";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type WorkbenchPosition = {
  id: string;
  symbol: string;
  market: string;
  name?: string;
  normalizedSymbol: string;
  avgPrice: number;
  quantity: number;
  currency: TossCurrency;
  memo?: string;
  updatedAt: string;
  source: "toss";
  lastPrice: number | null;
  warnings: StockWarning[];
};

const maskAccountNo = (value: string) => {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.max(0, compact.length - 4))}${compact.slice(-4)}`;
};

const safeNumber = (value: string | null | undefined) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const inferMarket = (item: HoldingsItem, stock?: StockInfo) => {
  const stockMarket = stock?.market?.toUpperCase();
  if (stockMarket === "KOSPI" || stockMarket === "KOSDAQ" || stockMarket === "US") {
    return stockMarket;
  }
  if (item.marketCountry === "US") {
    return "US";
  }
  return "KOSPI";
};

const normalizeSymbolForMarket = (symbol: string, market: string) => {
  const compact = symbol.trim().toUpperCase();
  if ((market === "KOSPI" || market === "KOSDAQ") && /^\d{6}$/.test(compact)) {
    return market === "KOSDAQ" ? `${compact}.KQ` : `${compact}.KS`;
  }
  return compact;
};

const toWorkbenchPosition = (
  item: HoldingsItem,
  stockBySymbol: Map<string, StockInfo>,
  warningsBySymbol: Map<string, StockWarning[]>,
  updatedAt: string,
): WorkbenchPosition | null => {
  const symbol = item.symbol.trim().toUpperCase();
  const quantity = safeNumber(item.quantity);
  const avgPrice = safeNumber(item.averagePurchasePrice);
  if (!symbol || quantity === null || quantity <= 0 || avgPrice === null || avgPrice <= 0) {
    return null;
  }
  const stock = stockBySymbol.get(symbol);
  const market = inferMarket(item, stock);
  return {
    id: `toss:${market}:${symbol}`,
    symbol,
    market,
    name: item.name || stock?.name,
    normalizedSymbol: normalizeSymbolForMarket(symbol, market),
    avgPrice,
    quantity,
    currency: item.currency,
    memo: "토스 보유자산에서 동기화",
    updatedAt,
    source: "toss",
    lastPrice: safeNumber(item.lastPrice),
    warnings: warningsBySymbol.get(symbol) ?? [],
  };
};

const settle = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise;
  } catch {
    return fallback;
  }
};

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const userId = auth.userContext.userId;
  const credential = await getBrokerCredentialView(userId, "toss");
  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials || credential?.status !== "verified") {
    return Response.json({
      connected: false,
      credential,
      positions: [],
      accounts: [],
      warnings: ["토스 API 키를 등록하고 검증하면 실계좌 기반 기능을 사용할 수 있습니다."],
    });
  }

  const client = createTossClient(credentials);

  try {
    const accounts = await client.listAccounts();
    const brokerage = accounts.find((account) => account.accountType === "BROKERAGE") ?? accounts[0];
    if (!brokerage) {
      return Response.json({
        connected: true,
        credential,
        accounts: [],
        positions: [],
        warnings: ["토스 종합매매 계좌를 찾지 못했습니다."],
      });
    }

    const accountSeq = brokerage.accountSeq;
    const [holdings, buyingPowerKrw, buyingPowerUsd, commissions, openOrders, krCalendar, usCalendar, exchangeRate] =
      await Promise.all([
        client.getHoldings(accountSeq),
        settle(client.getBuyingPower(accountSeq, "KRW"), null),
        settle(client.getBuyingPower(accountSeq, "USD"), null),
        settle<Commission[]>(client.getCommissions(accountSeq), []),
        settle<PaginatedOrderResponse>(client.getOpenOrders(accountSeq), {
          orders: [],
          nextCursor: null,
          hasNext: false,
        }),
        settle<KrMarketCalendarResponse | null>(client.getKrMarketCalendar(), null),
        settle<UsMarketCalendarResponse | null>(client.getUsMarketCalendar(), null),
        settle(client.getExchangeRate("USD", "KRW"), null),
      ]);

    const symbols = holdings.items.map((item) => item.symbol.trim().toUpperCase()).filter(Boolean);
    const stocks = symbols.length ? await settle<StockInfo[]>(client.getStocks(symbols), []) : [];
    const stockBySymbol = new Map(stocks.map((stock) => [stock.symbol.toUpperCase(), stock]));
    const warningEntries = await Promise.all(
      symbols.map(async (symbol) => [symbol, await settle<StockWarning[]>(client.getStockWarnings(symbol), [])] as const),
    );
    const warningsBySymbol = new Map(warningEntries);
    const updatedAt = new Date().toISOString();
    const positions = holdings.items
      .map((item) => toWorkbenchPosition(item, stockBySymbol, warningsBySymbol, updatedAt))
      .filter((position): position is WorkbenchPosition => position !== null);

    const publicAccount = (account: Account) => ({
      accountNo: maskAccountNo(account.accountNo),
      accountSeq: account.accountSeq,
      accountType: account.accountType,
    });

    return Response.json({
      connected: true,
      credential,
      accountSeq,
      accounts: accounts.map(publicAccount),
      positions,
      holdingsOverview: {
        totalPurchaseAmount: holdings.totalPurchaseAmount,
        marketValue: holdings.marketValue,
        profitLoss: holdings.profitLoss,
        dailyProfitLoss: holdings.dailyProfitLoss,
      },
      buyingPower: {
        KRW: buyingPowerKrw,
        USD: buyingPowerUsd,
      },
      commissions,
      orders: {
        open: openOrders.orders,
        closed: [],
      },
      marketInfo: {
        krCalendar,
        usCalendar,
        exchangeRate,
      },
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(
        { connected: true, credential, ...formatTossApiError(error, "토스 워크벤치 조회 실패") },
        { status: error.status === 401 ? 401 : 502 },
      );
    }
    return Response.json({ connected: true, credential, error: "토스 워크벤치 데이터를 불러오지 못했습니다." }, { status: 502 });
  }
}
