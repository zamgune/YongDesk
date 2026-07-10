import { loadSymbolMaster } from "@/lib/market/symbol-master";
import { searchSymbolItems, type SymbolSearchMarket } from "@/lib/market/symbol-search";

const DEFAULT_MARKETS: SymbolSearchMarket[] = ["US", "KOSPI", "KOSDAQ", "CRYPTO"];

const parseMarkets = (value: string | null): SymbolSearchMarket[] => {
  if (!value) {
    return DEFAULT_MARKETS;
  }
  const markets = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is SymbolSearchMarket =>
      item === "US" || item === "KOSPI" || item === "KOSDAQ" || item === "CRYPTO",
    );
  return markets.length ? markets : DEFAULT_MARKETS;
};

const parseLimit = (value: string | null) => {
  const limit = Number(value ?? 12);
  if (!Number.isFinite(limit)) {
    return 12;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), 30);
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const markets = parseMarkets(url.searchParams.get("markets"));
  const limit = parseLimit(url.searchParams.get("limit"));

  if (!query.trim()) {
    return Response.json({
      query,
      markets,
      matches: [],
      warnings: [],
    });
  }

  const master = await loadSymbolMaster({ markets });
  const matches = searchSymbolItems(master.items, query, { markets, limit });
  const responseItems = matches.map((match) => ({
    ...match.item,
    score: match.score,
    matchedBy: match.matchedBy,
  }));

  return Response.json(
    {
      query,
      markets,
      matches: responseItems,
      sources: master.sources,
      warnings: master.warnings.slice(0, 6),
    },
    {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
