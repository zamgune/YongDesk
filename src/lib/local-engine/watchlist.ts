import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getCryptoTickers } from "@/lib/crypto-exchange/client";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { getMarketDataProvider, type MarketQuote } from "@/lib/market-data";

export type WatchlistAssetClass = "stock" | "crypto";
export type WatchlistMarket = "KR" | "US" | "CRYPTO";

export type WatchlistItem = {
  id: string;
  symbol: string;
  name: string | null;
  assetClass: WatchlistAssetClass;
  market: WatchlistMarket;
  addedAt: string;
};

export type WatchlistSummaryItem = WatchlistItem & {
  price: number | null;
  changePercent: number | null;
  currency: "KRW" | "USD";
  dataSource: "yahoo" | "upbit";
  quoteAt: string | null;
  stale: boolean;
  error: string | null;
};

export type WatchlistResponse = {
  maxItems: number;
  items: WatchlistItem[];
};

export type WatchlistSummaryResponse = WatchlistResponse & {
  generatedAt: string;
  items: WatchlistSummaryItem[];
};

export const WATCHLIST_MAX_ITEMS = 20;

type WatchlistStore = {
  items: WatchlistItem[];
};

type WatchlistPayload = Record<string, unknown>;

type WatchlistSummaryDependencies = {
  getStockQuotes: (symbols: string[]) => Promise<Map<string, MarketQuote | Error>>;
  getCryptoQuotes: (markets: string[]) => Promise<Map<string, { price: number; quoteAt: string } | Error>>;
  now: () => Date;
};

const WATCHLIST_STORE_PATH = stockAnalysisStoragePath("watchlist", "items.json");

const asText = (value: unknown, maxLength: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;

const isWatchlistAssetClass = (value: unknown): value is WatchlistAssetClass =>
  value === "stock" || value === "crypto";

const normalizeStockSymbol = (value: string, market: WatchlistMarket) => {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!normalized) {
    throw new WatchlistRequestError(400, "종목 코드를 입력하세요.");
  }
  if (market === "KR" && /^\d{6}$/.test(normalized)) {
    return `${normalized}.KS`;
  }
  return normalized.slice(0, 24);
};

const normalizeCryptoSymbol = (value: string) => {
  const normalized = value.trim().toUpperCase();
  const existing = normalized.match(/^KRW-([A-Z0-9]+)$/);
  const base = existing?.[1] ?? normalized.replace(/[^A-Z0-9]/g, "");
  if (!base) {
    throw new WatchlistRequestError(400, "KRW 코인 마켓을 입력하세요.");
  }
  return `KRW-${base.slice(0, 16)}`;
};

const normalizeItem = (payload: WatchlistPayload): Omit<WatchlistItem, "id" | "addedAt"> => {
  const assetClass = payload.assetClass;
  if (!isWatchlistAssetClass(assetClass)) {
    throw new WatchlistRequestError(400, "assetClass는 stock 또는 crypto여야 합니다.");
  }
  const rawMarket = asText(payload.market, 12);
  const market: WatchlistMarket = assetClass === "crypto"
    ? "CRYPTO"
    : rawMarket === "KR" || rawMarket === "US"
      ? rawMarket
      : (() => { throw new WatchlistRequestError(400, "주식 시장은 KR 또는 US여야 합니다."); })();
  const rawSymbol = asText(payload.symbol, 48);
  if (!rawSymbol) {
    throw new WatchlistRequestError(400, "종목 코드를 입력하세요.");
  }
  return {
    symbol: assetClass === "crypto"
      ? normalizeCryptoSymbol(rawSymbol)
      : normalizeStockSymbol(rawSymbol, market),
    name: asText(payload.name, 120),
    assetClass,
    market,
  };
};

const defaultStore = (): WatchlistStore => ({ items: [] });

const readStore = async (): Promise<WatchlistStore> => {
  try {
    const parsed = JSON.parse(await readFile(WATCHLIST_STORE_PATH, "utf8")) as Partial<WatchlistStore>;
    if (!Array.isArray(parsed.items)) {
      return defaultStore();
    }
    return {
      items: parsed.items.filter((item): item is WatchlistItem =>
        typeof item?.id === "string" &&
        typeof item.symbol === "string" &&
        typeof item.assetClass === "string" &&
        typeof item.market === "string" &&
        typeof item.addedAt === "string",
      ).slice(0, WATCHLIST_MAX_ITEMS),
    };
  } catch {
    return defaultStore();
  }
};

const writeStore = async (store: WatchlistStore) => {
  await mkdir(dirname(WATCHLIST_STORE_PATH), { recursive: true });
  const temporaryPath = `${WATCHLIST_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, WATCHLIST_STORE_PATH);
};

const response = (items: WatchlistItem[]): WatchlistResponse => ({
  maxItems: WATCHLIST_MAX_ITEMS,
  items,
});

const defaultDependencies = (): WatchlistSummaryDependencies => ({
  getStockQuotes: async (symbols) => {
    const provider = getMarketDataProvider();
    const results = await Promise.allSettled(symbols.map((symbol) => provider.getQuote(symbol)));
    return new Map(symbols.map((symbol, index) => {
      const result = results[index];
      if (result.status === "fulfilled" && result.value) {
        return [symbol, result.value];
      }
      return [symbol, result.status === "rejected"
        ? result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        : new Error("현재가를 찾을 수 없습니다.")];
    }));
  },
  getCryptoQuotes: async (markets) => {
    try {
      const quotes = await getCryptoTickers("upbit", markets);
      const found = new Map(quotes.map((quote) => [quote.market, {
        price: quote.tradePrice,
        quoteAt: new Date(quote.timestamp).toISOString(),
      }]));
      return new Map(markets.map((market) => [market, found.get(market) ?? new Error("현재가를 찾을 수 없습니다.")]));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      return new Map(markets.map((market) => [market, failure]));
    }
  },
  now: () => new Date(),
});

const fixtureDependencies = (): WatchlistSummaryDependencies => ({
  getStockQuotes: async (symbols) => new Map(symbols.map((symbol, index) => [symbol, {
    symbol,
    price: /^\d{6}\.K[QS]$/.test(symbol) ? 88_000 + index * 100 : 200 + index * 10,
    changePercent: index % 2 === 0 ? 1.25 : -0.75,
  }])),
  getCryptoQuotes: async (markets) => new Map(markets.map((market, index) => [market, {
    price: 150_000_000 + index * 1_000_000,
    quoteAt: "2026-07-11T00:00:00.000Z",
  }])),
  now: () => new Date("2026-07-11T00:00:10.000Z"),
});

const errorText = (error: Error) => error.message.slice(0, 180) || "시세를 불러오지 못했습니다.";

export class WatchlistRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const listWatchlist = async (): Promise<WatchlistResponse> => response((await readStore()).items);

export const addWatchlistItem = async (payload: WatchlistPayload): Promise<WatchlistResponse> => {
  const item = normalizeItem(payload);
  const store = await readStore();
  const existing = store.items.find((candidate) =>
    candidate.assetClass === item.assetClass && candidate.symbol === item.symbol,
  );
  if (existing) {
    return response(store.items);
  }
  if (store.items.length >= WATCHLIST_MAX_ITEMS) {
    throw new WatchlistRequestError(409, `관심종목은 최대 ${WATCHLIST_MAX_ITEMS}개까지 저장할 수 있습니다.`);
  }
  const next: WatchlistItem = {
    ...item,
    id: `watch-${randomUUID()}`,
    addedAt: new Date().toISOString(),
  };
  const items = [...store.items, next];
  await writeStore({ items });
  return response(items);
};

export const removeWatchlistItem = async (id: string): Promise<WatchlistResponse> => {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new WatchlistRequestError(400, "관심종목 ID가 필요합니다.");
  }
  const store = await readStore();
  const items = store.items.filter((item) => item.id !== normalizedId);
  if (items.length === store.items.length) {
    throw new WatchlistRequestError(404, "관심종목을 찾을 수 없습니다.");
  }
  await writeStore({ items });
  return response(items);
};

export const summarizeWatchlistItems = async (
  items: WatchlistItem[],
  dependencies: WatchlistSummaryDependencies = defaultDependencies(),
): Promise<WatchlistSummaryItem[]> => {
  const stockSymbols = items.filter((item) => item.assetClass === "stock").map((item) => item.symbol);
  const cryptoMarkets = items.filter((item) => item.assetClass === "crypto").map((item) => item.symbol);
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    stockSymbols.length ? dependencies.getStockQuotes(stockSymbols) : Promise.resolve(new Map()),
    cryptoMarkets.length ? dependencies.getCryptoQuotes(cryptoMarkets) : Promise.resolve(new Map()),
  ]);
  const generatedAt = dependencies.now().toISOString();
  return items.map((item) => {
    const quote = item.assetClass === "crypto" ? cryptoQuotes.get(item.symbol) : stockQuotes.get(item.symbol);
    if (quote instanceof Error || !quote) {
      return {
        ...item,
        price: null,
        changePercent: null,
        currency: item.market === "US" ? "USD" : "KRW",
        dataSource: item.assetClass === "crypto" ? "upbit" : "yahoo",
        quoteAt: null,
        stale: true,
        error: errorText(quote instanceof Error ? quote : new Error("현재가를 찾을 수 없습니다.")),
      };
    }
    if (item.assetClass === "crypto") {
      return {
        ...item,
        price: quote.price,
        changePercent: null,
        currency: "KRW",
        dataSource: "upbit",
        quoteAt: quote.quoteAt,
        stale: Date.parse(generatedAt) - Date.parse(quote.quoteAt) > 2 * 60 * 1_000,
        error: null,
      };
    }
    return {
      ...item,
      price: quote.price,
      changePercent: quote.changePercent ?? null,
      currency: item.market === "US" ? "USD" : "KRW",
      dataSource: "yahoo",
      quoteAt: generatedAt,
      stale: false,
      error: null,
    };
  });
};

export const getWatchlistSummary = async (): Promise<WatchlistSummaryResponse> => {
  const { items } = await readStore();
  const dependencies = process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE === "1"
    ? fixtureDependencies()
    : defaultDependencies();
  return {
    maxItems: WATCHLIST_MAX_ITEMS,
    generatedAt: dependencies.now().toISOString(),
    items: await summarizeWatchlistItems(items, dependencies),
  };
};
