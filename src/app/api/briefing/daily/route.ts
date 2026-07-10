import {
  buildChartBriefing,
  buildDailyBriefing,
  type BriefingMarketData,
  type BriefingRow,
} from "@/lib/market/briefing";
import {
  getLeaderUniverse,
  type LeaderMarket,
  type LeaderSymbol,
} from "@/lib/market/leader-universes";
import { analyzeSymbol } from "@/use-cases/market/analyze-symbol";
import { getRequestUserContext } from "@/use-cases/security/request-context";

const DEFAULT_MARKETS: LeaderMarket[] = ["US", "KOSPI", "KOSDAQ"];

const inferMarket = (symbol: string): LeaderMarket | "US" =>
  symbol.endsWith(".KS") ? "KOSPI" : symbol.endsWith(".KQ") ? "KOSDAQ" : "US";

const normalizeSymbol = (rawSymbol: string, market: string) => {
  const trimmed = rawSymbol.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  if (market === "US" || /\.(KS|KQ)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.${market === "KOSPI" ? "KS" : "KQ"}`;
};

const parseMarkets = (rawMarkets: string | null) => {
  if (!rawMarkets) {
    return DEFAULT_MARKETS;
  }
  const markets = rawMarkets
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter((market): market is LeaderMarket =>
      market === "US" || market === "KOSPI" || market === "KOSDAQ",
    );
  return markets.length ? markets : DEFAULT_MARKETS;
};

const parseSymbols = (url: URL): Array<LeaderSymbol & { market: LeaderMarket }> => {
  const rawSymbols = url.searchParams.get("symbols");
  if (rawSymbols) {
    const seen = new Set<string>();
    return rawSymbols
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
      .map((symbol) => {
        const market = inferMarket(symbol);
        return {
          symbol: normalizeSymbol(symbol, market),
          name: symbol,
          market,
        };
      })
      .filter((item) => {
        if (!item.symbol || seen.has(item.symbol)) {
          return false;
        }
        seen.add(item.symbol);
        return true;
      })
      .slice(0, 24);
  }

  const top = Number(url.searchParams.get("top") ?? 6);
  return parseMarkets(url.searchParams.get("markets")).flatMap((market) =>
    getLeaderUniverse(market).symbols.slice(0, top).map((item) => ({
      ...item,
      market,
    })),
  );
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  mapper: (value: T) => Promise<R>,
  concurrency = 4,
) => {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = url.searchParams.get("days") ?? "365";
  const timeframe = url.searchParams.get("tf") ?? "1d";
  const symbols = parseSymbols(url);

  if (!symbols.length) {
    return Response.json({ error: "No symbols to brief." }, { status: 400 });
  }

  const rows = await mapWithConcurrency(
    symbols,
    async (item): Promise<BriefingRow & { error?: string }> => {
      try {
        const marketResponse = await analyzeSymbol(
          new Request(
            `http://stockanalysis.internal/api/market/${encodeURIComponent(item.symbol)}?days=${encodeURIComponent(days)}&tf=${encodeURIComponent(timeframe)}`,
          ),
          { params: { symbol: item.symbol } },
          { userContext: getRequestUserContext(request) },
        );
        if (!marketResponse.ok) {
          throw new Error(`Market data failed with ${marketResponse.status}`);
        }
        const data = (await marketResponse.json()) as BriefingMarketData;
        return {
          symbol: item.symbol,
          normalizedSymbol: item.symbol,
          market: item.market,
          name: item.name,
          data,
        };
      } catch (error) {
        return {
          symbol: item.symbol,
          normalizedSymbol: item.symbol,
          market: item.market,
          name: item.name,
          data: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );
  const loadedRows = rows.filter((row) => row.data);
  const briefing = buildDailyBriefing(loadedRows);
  const reports = loadedRows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    briefing: buildChartBriefing(row),
  }));

  return Response.json({
    generatedAt: new Date().toISOString(),
    universe: {
      total: symbols.length,
      loaded: loadedRows.length,
      markets: [...new Set(symbols.map((item) => item.market))],
    },
    sourceFrame: {
      style: "us-plus-report-inspired",
      sections: ["시장 상황", "주도 후보", "관찰 후보", "위험 후보", "오늘의 트레이딩 스토리"],
    },
    briefing,
    reports,
    errors: rows
      .filter((row) => row.error)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        error: row.error,
      })),
  });
}
