import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getCryptoTickers } from "@/lib/crypto-exchange/client";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { getCommunityPain } from "../community-pain/service.mts";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { resolveInstrumentDisplay, type InstrumentDisplay } from "@/lib/market/instrument-display";
import { getMarketDataProvider, type MarketCandle, type MarketQuote } from "@/lib/market-data";
import { createTossClient } from "@/lib/toss/client";

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
  instrument: InstrumentDisplay;
  insights: WatchlistInsights;
};

export type WatchlistInsightStatus = "ok" | "low-evidence" | "unavailable" | "error" | "unsupported";

export type WatchlistTechnicalInsight = {
  label: "상승 우세" | "중립" | "하락 주의" | "근거 부족" | "지원 준비" | "갱신 실패";
  status: WatchlistInsightStatus;
  detail: string;
  generatedAt: string | null;
  error: string | null;
};

export type WatchlistSentimentInsight = {
  label: "공포" | "과열" | "의견 분열" | "차분" | "근거 부족" | "Reddit 연결 필요" | "지원 준비" | "갱신 실패";
  status: WatchlistInsightStatus;
  painScore: number | null;
  gajuaScore: number | null;
  confidence: number | null;
  evidenceCount: number | null;
  generatedAt: string | null;
  error: string | null;
};

export type WatchlistAttentionInsight = {
  label: "토스 체결 관심" | "관심 높음" | "관심 보통" | "관심 낮음" | "근거 부족" | "지원 준비" | "갱신 실패";
  status: WatchlistInsightStatus;
  source: "toss-rankings" | "volume-ratio" | "unavailable";
  detail: string;
  rank: number | null;
  generatedAt: string | null;
  error: string | null;
};

export type WatchlistInsights = {
  technical: WatchlistTechnicalInsight;
  sentiment: WatchlistSentimentInsight;
  attention: WatchlistAttentionInsight;
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
  getStockCandles: (symbol: string) => Promise<MarketCandle[]>;
  getSentiment: (item: WatchlistItem) => Promise<WatchlistSentimentInsight>;
  getTossRanks: (markets: WatchlistMarket[]) => Promise<Map<string, { rank: number; rankedAt: string | null }>>;
  now: () => Date;
};

const WATCHLIST_STORE_PATH = stockAnalysisStoragePath("watchlist", "items.json");
const WATCHLIST_INSIGHT_TTL_MS = 5 * 60 * 1_000;
const WATCHLIST_INSIGHT_CONCURRENCY = 3;
const localUserId = () => process.env.STOCK_ANALYSIS_LOCAL_USER_ID?.trim() || "local-macos-user";
const insightCache = new Map<string, { expiresAt: number; insight: WatchlistInsights }>();

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

const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const unavailableTechnical = (): WatchlistTechnicalInsight => ({
  label: "근거 부족",
  status: "low-evidence",
  detail: "일봉 데이터를 충분히 확보하지 못했습니다.",
  generatedAt: null,
  error: null,
});

const unsupportedInsights = (): WatchlistInsights => ({
  technical: {
    label: "지원 준비",
    status: "unsupported",
    detail: "코인 기술 요약은 다음 단계에서 제공합니다.",
    generatedAt: null,
    error: null,
  },
  sentiment: {
    label: "지원 준비",
    status: "unsupported",
    painScore: null,
    gajuaScore: null,
    confidence: null,
    evidenceCount: null,
    generatedAt: null,
    error: null,
  },
  attention: {
    label: "지원 준비",
    status: "unsupported",
    source: "unavailable",
    detail: "코인 관심도는 다음 단계에서 제공합니다.",
    rank: null,
    generatedAt: null,
    error: null,
  },
});

const technicalFromCandles = (candles: MarketCandle[], now: Date): WatchlistTechnicalInsight => {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  if (closes.length < 20) return unavailableTechnical();
  const latest = closes.at(-1)!;
  const sma20 = average(closes.slice(-20));
  const sma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;
  if (sma20 === null) return unavailableTechnical();
  const aboveShort = latest >= sma20;
  const aboveLong = sma200 === null || latest >= sma200;
  const label = aboveShort && aboveLong ? "상승 우세" : !aboveShort && !aboveLong ? "하락 주의" : "중립";
  const longDetail = sma200 === null ? "SMA20 기준" : "SMA20·SMA200 기준";
  return {
    label,
    status: "ok",
    detail: longDetail,
    generatedAt: now.toISOString(),
    error: null,
  };
};

const attentionFromCandles = (
  candles: MarketCandle[],
  now: Date,
  tossRank?: { rank: number; rankedAt: string | null },
): WatchlistAttentionInsight => {
  if (tossRank) {
    return {
      label: "토스 체결 관심",
      status: "ok",
      source: "toss-rankings",
      detail: `토스증권 체결 기준 ${tossRank.rank}위`,
      rank: tossRank.rank,
      generatedAt: tossRank.rankedAt ?? now.toISOString(),
      error: null,
    };
  }
  const volumes = candles.map((candle) => candle.volume).filter((volume) => Number.isFinite(volume) && volume >= 0);
  if (volumes.length < 21) {
    return {
      label: "근거 부족",
      status: "low-evidence",
      source: "volume-ratio",
      detail: "거래량 기준 데이터가 부족합니다.",
      rank: null,
      generatedAt: null,
      error: null,
    };
  }
  const latest = volumes.at(-1)!;
  const baseline = average(volumes.slice(-21, -1));
  if (!baseline || baseline <= 0) {
    return {
      label: "근거 부족",
      status: "low-evidence",
      source: "volume-ratio",
      detail: "평균 거래량을 계산하지 못했습니다.",
      rank: null,
      generatedAt: null,
      error: null,
    };
  }
  const ratio = latest / baseline;
  const label = ratio >= 1.7 ? "관심 높음" : ratio >= 0.7 ? "관심 보통" : "관심 낮음";
  return {
    label,
    status: "ok",
    source: "volume-ratio",
    detail: `20일 평균 대비 ${ratio.toFixed(1)}배`,
    rank: null,
    generatedAt: now.toISOString(),
    error: null,
  };
};

const sentimentFromCommunity = async (item: WatchlistItem): Promise<WatchlistSentimentInsight> => {
  const source = item.market === "KR" ? "paxnet" : "reddit";
  const response = await getCommunityPain({
    symbol: item.symbol,
    market: item.market,
    requestedSources: [source],
    limit: 30,
  });
  const configurationRequired = response.sourceStats.some((stat) => stat.status === "configuration-required");
  if (configurationRequired) {
    return {
      label: "Reddit 연결 필요",
      status: "unavailable",
      painScore: null,
      gajuaScore: null,
      confidence: null,
      evidenceCount: null,
      generatedAt: response.generatedAt,
      error: null,
    };
  }
  const label = response.lowEvidence
    ? "근거 부족"
    : response.sentimentRegime === "panic"
      ? "공포"
      : response.sentimentRegime === "hype"
        ? "과열"
        : response.sentimentRegime === "divided"
          ? "의견 분열"
          : "차분";
  return {
    label,
    status: response.lowEvidence ? "low-evidence" : "ok",
    painScore: response.painScore,
    gajuaScore: response.gajuaScore,
    confidence: response.confidence,
    evidenceCount: response.evidenceCount,
    generatedAt: response.generatedAt,
    error: null,
  };
};

const normalizeTossRankSymbol = (symbol: string, market: WatchlistMarket) =>
  market === "KR" ? `${symbol.replace(/\.(?:KS|KQ)$/i, "")}.KS` : symbol.toUpperCase();

const mapWithConcurrency = async <T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

const defaultDependencies = (): WatchlistSummaryDependencies => ({
  getStockQuotes: async (symbols) => {
    const provider = getMarketDataProvider();
    const results = await Promise.allSettled(symbols.map((symbol) => provider.getQuote(symbol)));
    return new Map<string, MarketQuote | Error>(symbols.map((symbol, index): [string, MarketQuote | Error] => {
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
      return new Map<string, { price: number; quoteAt: string } | Error>(
        markets.map((market): [string, { price: number; quoteAt: string } | Error] => [
          market,
          found.get(market) ?? new Error("현재가를 찾을 수 없습니다."),
        ]),
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      return new Map<string, { price: number; quoteAt: string } | Error>(
        markets.map((market): [string, { price: number; quoteAt: string } | Error] => [market, failure]),
      );
    }
  },
  getStockCandles: async (symbol) => {
    const now = new Date();
    const response = await getMarketDataProvider().getCandles(symbol, {
      period1: new Date(now.getTime() - 380 * 24 * 60 * 60 * 1_000),
      period2: now,
      interval: "1d",
    });
    return response.candles;
  },
  getSentiment: sentimentFromCommunity,
  getTossRanks: async (markets) => {
    const credentials = await loadDecryptedCredentials(localUserId(), "toss").catch(() => null);
    if (!credentials) return new Map();
    const client = createTossClient(credentials);
    const results = await Promise.allSettled(
      [...new Set(markets.filter((market) => market === "KR" || market === "US"))].map(async (market) => ({
        market,
        response: await client.getRankings({
          type: "TOSS_SECURITIES_TRADING_AMOUNT",
          marketCountry: market,
          duration: "1d",
          count: 100,
          excludeInvestmentCaution: false,
        }),
      })),
    );
    const ranks = new Map<string, { rank: number; rankedAt: string | null }>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value.response.rankings) {
        ranks.set(normalizeTossRankSymbol(item.symbol, result.value.market), {
          rank: item.rank,
          rankedAt: result.value.response.rankedAt,
        });
      }
    }
    return ranks;
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
  getStockCandles: async () => Array.from({ length: 220 }, (_, index) => ({
    time: 1_700_000_000 + index * 86_400,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: index === 219 ? 2_000 : 1_000,
  })),
  getSentiment: async () => ({
    label: "근거 부족",
    status: "low-evidence",
    painScore: 0,
    gajuaScore: 0,
    confidence: 0,
    evidenceCount: 0,
    generatedAt: "2026-07-11T00:00:00.000Z",
    error: null,
  }),
  getTossRanks: async () => new Map(),
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
  dependencies: Partial<WatchlistSummaryDependencies> = {},
): Promise<WatchlistSummaryItem[]> => {
  const resolvedDependencies: WatchlistSummaryDependencies = {
    ...defaultDependencies(),
    ...dependencies,
  };
  const stockSymbols = items.filter((item) => item.assetClass === "stock").map((item) => item.symbol);
  const cryptoMarkets = items.filter((item) => item.assetClass === "crypto").map((item) => item.symbol);
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    stockSymbols.length ? resolvedDependencies.getStockQuotes(stockSymbols) : Promise.resolve(new Map()),
    cryptoMarkets.length ? resolvedDependencies.getCryptoQuotes(cryptoMarkets) : Promise.resolve(new Map()),
  ]);
  const generatedAt = resolvedDependencies.now().toISOString();
  const tossRanks = await resolvedDependencies.getTossRanks(
    [...new Set(items.filter((item) => item.assetClass === "stock").map((item) => item.market))],
  ).catch(() => new Map<string, { rank: number; rankedAt: string | null }>());
  const baseItems = items.map((item) => {
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
      } satisfies Omit<WatchlistSummaryItem, "instrument" | "insights">;
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
      } satisfies Omit<WatchlistSummaryItem, "instrument" | "insights">;
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
    } satisfies Omit<WatchlistSummaryItem, "instrument" | "insights">;
  });
  const instruments = await mapWithConcurrency(baseItems, WATCHLIST_INSIGHT_CONCURRENCY, (item) =>
    resolveInstrumentDisplay({
      symbol: item.symbol,
      market: item.market,
      storedName: item.name,
    }),
  );
  const insights = await mapWithConcurrency(baseItems, WATCHLIST_INSIGHT_CONCURRENCY, async (item) => {
    if (item.assetClass === "crypto") return unsupportedInsights();
    const cacheKey = `${item.market}:${item.symbol}`;
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.insight;
    const now = resolvedDependencies.now();
    const [candlesResult, sentimentResult] = await Promise.allSettled([
      resolvedDependencies.getStockCandles(item.symbol),
      resolvedDependencies.getSentiment(item),
    ]);
    const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
    const technical = candlesResult.status === "fulfilled"
      ? technicalFromCandles(candles, now)
      : {
        label: "갱신 실패" as const,
        status: "error" as const,
        detail: "기술 요약을 불러오지 못했습니다.",
        generatedAt: null,
        error: errorText(candlesResult.reason instanceof Error ? candlesResult.reason : new Error(String(candlesResult.reason))),
      };
    const attention = candlesResult.status === "fulfilled"
      ? attentionFromCandles(candles, now, tossRanks.get(normalizeTossRankSymbol(item.symbol, item.market)))
      : {
        label: "갱신 실패" as const,
        status: "error" as const,
        source: "unavailable" as const,
        detail: "관심도를 불러오지 못했습니다.",
        rank: null,
        generatedAt: null,
        error: technical.error,
      };
    const sentiment = sentimentResult.status === "fulfilled"
      ? sentimentResult.value
      : {
        label: "갱신 실패" as const,
        status: "error" as const,
        painScore: null,
        gajuaScore: null,
        confidence: null,
        evidenceCount: null,
        generatedAt: null,
        error: errorText(sentimentResult.reason instanceof Error ? sentimentResult.reason : new Error(String(sentimentResult.reason))),
      };
    const insight = { technical, sentiment, attention } satisfies WatchlistInsights;
    insightCache.set(cacheKey, { expiresAt: Date.now() + WATCHLIST_INSIGHT_TTL_MS, insight });
    return insight;
  });
  return baseItems.map((item, index) => ({
    ...item,
    instrument: instruments[index],
    insights: insights[index],
  }));
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
