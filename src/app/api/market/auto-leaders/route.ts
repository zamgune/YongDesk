import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getMarketDataProvider,
  type MarketAssetProfile,
  type MarketScreenerId,
  type MarketScreenerQuote,
} from "@/lib/market-data";
import {
  LEADER_UNIVERSES,
  getLeaderUniverse,
  type LeaderMarket,
  type LeaderSymbol,
} from "@/lib/market/leader-universes";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import {
  getMarketSession,
  getSessionSchedule,
  type CandidateSource,
  type CandidateSourceDetail,
  type LeaderResponse,
} from "@/lib/market/market-briefing-report";
import { loadSymbolMaster } from "@/lib/market/symbol-master";
import { scanLeaders } from "@/use-cases/market/scan-leaders";
import { getRequestUserContext } from "@/use-cases/security/request-context";

export const runtime = "nodejs";

type AutoLeaderResponse = LeaderResponse & {
  scanKey: string;
  tradingDate: string;
  generatedAt: string;
  nextRefreshAt: string;
  scanStatus: "ready" | "waiting-for-close";
  candidateSource: CandidateSource;
};

const marketData = getMarketDataProvider();
const CACHE_DIR = stockAnalysisStoragePath("market-scans");
const DEFAULT_LIMIT = 50;
const MIN_DYNAMIC_CANDIDATES = 12;

type AutoLeaderSymbol = LeaderSymbol & {
  candidateSourceDetail: CandidateSourceDetail;
};

const CURATED_COVERAGE: Record<LeaderMarket, AutoLeaderSymbol[]> = {
  US: [],
  KOSPI: [
    {
      symbol: "066570.KS",
      name: "LG전자",
      sector: "가전/전장",
      themes: ["가전", "전장", "로봇", "코스피 대형주"],
      candidateSourceDetail: "curated",
    },
  ],
  KOSDAQ: [],
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseLimit = (rawLimit: string | null) => {
  const limit = Number(rawLimit ?? DEFAULT_LIMIT);
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 10), 80);
};

const cachePath = (market: LeaderMarket, tradingDate: string, limit: number) =>
  join(CACHE_DIR, `${market}-${tradingDate}-${limit}.json`);

const readCache = async (market: LeaderMarket, tradingDate: string, limit: number) => {
  try {
    const cached = JSON.parse(await readFile(cachePath(market, tradingDate, limit), "utf8")) as AutoLeaderResponse;
    if (!cached.candidates.every((candidate) =>
      candidate.breakoutRule?.volumeConfirmation && candidate.tradeSetup && candidate.breakoutSignal,
    )) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
};

const writeCache = async (payload: AutoLeaderResponse) => {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      cachePath(payload.market, payload.tradingDate, payload.candidateSource.requested),
      JSON.stringify(payload),
    );
  } catch {
    // Runtime cache is best-effort. The API should still work on read-only hosts.
  }
};

const getQuoteText = (quote: MarketScreenerQuote, key: "shortName" | "longName" | "sector" | "industry" | "exchange") =>
  isString(quote[key]) ? quote[key] : null;

const getQuoteScore = (quote: MarketScreenerQuote) => {
  const volume = isNumber(quote.volume) ? quote.volume : 0;
  const averageVolume = isNumber(quote.averageVolume) ? quote.averageVolume : 0;
  const marketCap = isNumber(quote.marketCap) ? quote.marketCap : 0;
  const change = isNumber(quote.changePercent) ? quote.changePercent : 0;
  return Math.log10(Math.max(volume, averageVolume, 1)) * 2 +
    Math.log10(Math.max(marketCap, 1)) +
    change / 5;
};

const themeTranslations: Record<string, string> = {
  "Aerospace & Defense": "우주항공/방산",
  "Communication Services": "커뮤니케이션",
  "Computer Hardware": "하드웨어",
  "Consumer Cyclical": "경기소비재",
  "Consumer Defensive": "필수소비재",
  "Electrical Equipment & Parts": "전력기기",
  "Energy": "에너지",
  "Financial Services": "금융",
  "Healthcare": "헬스케어",
  "Industrials": "산업재",
  "Information Technology Services": "IT 서비스",
  "Real Estate": "부동산",
  "Semiconductor Equipment & Materials": "반도체 장비/소재",
  "Semiconductors": "반도체",
  "Software - Application": "응용 소프트웨어",
  "Software - Infrastructure": "인프라 소프트웨어",
  "Technology": "기술",
  "Utilities": "유틸리티",
};

const translateTheme = (value: string) => themeTranslations[value] ?? value;

const normalizeScreenerSymbol = (rawSymbol: string, market: LeaderMarket, exchange: string | null) => {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol || symbol.includes("=") || symbol.endsWith("-USD")) {
    return null;
  }
  if (market === "US") {
    if (/\.(KS|KQ)$/i.test(symbol) || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      return null;
    }
    return symbol;
  }
  if (market === "KOSPI") {
    if (/\.KS$/i.test(symbol)) {
      return symbol;
    }
    if (/^\d{6}$/.test(symbol) && exchange?.toUpperCase().includes("KSC")) {
      return `${symbol}.KS`;
    }
    return null;
  }
  if (/\.KQ$/i.test(symbol)) {
    return symbol;
  }
  if (/^\d{6}$/.test(symbol) && exchange?.toUpperCase().includes("KOE")) {
    return `${symbol}.KQ`;
  }
  return null;
};

const mergeCandidates = <T extends LeaderSymbol>(symbols: T[], limit: number) => {
  const seen = new Set<string>();
  return symbols.filter((item) => {
    if (seen.has(item.symbol)) {
      return false;
    }
    seen.add(item.symbol);
    return true;
  }).slice(0, limit);
};

const getAssetProfileTheme = (profile: MarketAssetProfile | null) => {
  const sector = profile?.sector ?? null;
  const industry = profile?.industry ?? null;
  return sector ?? industry
    ? {
      sector: translateTheme(sector ?? industry ?? "동적 후보"),
      themes: [sector, industry].filter(isString).map(translateTheme),
    }
    : null;
};

const enrichCandidates = async <T extends AutoLeaderSymbol>(candidates: T[], market: LeaderMarket) => {
  if (market !== "US") {
    return candidates;
  }
  const enriched: T[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(5, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      const candidate = candidates[index];
      try {
        const theme = getAssetProfileTheme(await marketData.getAssetProfile(candidate.symbol));
        enriched[index] = theme
          ? { ...candidate, sector: theme.sector, themes: theme.themes }
          : candidate;
      } catch {
        enriched[index] = candidate;
      }
    }
  });
  await Promise.all(workers);
  return enriched.map((candidate, index) => candidate ?? candidates[index]);
};

const fetchScreenerCandidates = async (market: LeaderMarket, limit: number) => {
  const region = market === "US" ? "US" : "KR";
  const lang = market === "US" ? "en-US" : "ko-KR";
  const screeners: MarketScreenerId[] = market === "US"
    ? ["most_actives", "day_gainers", "growth_technology_stocks"]
    : ["most_actives", "day_gainers"];
  const errors: string[] = [];
  const candidates: Array<AutoLeaderSymbol & { score: number }> = [];

  await Promise.all(
    screeners.map(async (scrIds) => {
      try {
        const quotes = await marketData.getScreenerCandidates({
          screenerId: scrIds,
          count: Math.max(limit, 50),
          region,
          lang,
        });
        quotes.forEach((quoteLike) => {
          const rawSymbol = quoteLike.symbol;
          const symbol = normalizeScreenerSymbol(rawSymbol, market, getQuoteText(quoteLike, "exchange"));
          if (!symbol) {
            return;
          }
          const sector = getQuoteText(quoteLike, "sector") ?? getQuoteText(quoteLike, "industry") ?? "동적 후보";
          candidates.push({
            symbol,
            name: getQuoteText(quoteLike, "longName") ?? getQuoteText(quoteLike, "shortName") ?? symbol,
            sector,
            themes: [sector],
            candidateSourceDetail: "dynamic",
            score: getQuoteScore(quoteLike),
          });
        });
      } catch (error) {
        errors.push(`${scrIds}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  const merged = mergeCandidates(
      candidates
        .toSorted((left, right) => right.score - left.score)
        .map((candidate) => ({
          symbol: candidate.symbol,
          name: candidate.name,
          sector: candidate.sector,
          themes: candidate.themes,
          candidateSourceDetail: candidate.candidateSourceDetail,
        })),
      limit,
    );

  return {
    candidates: await enrichCandidates(merged, market),
    errors,
  };
};

const fetchSymbolMasterCandidates = async (market: LeaderMarket, limit: number) => {
  try {
    const master = await loadSymbolMaster({ markets: [market] });
    if (master.sources[market] !== "cache") {
      return [];
    }
    return mergeCandidates(
      master.items
        .filter((item) => item.market === market)
        .slice(0, Math.min(limit, 20))
        .map((item) => ({
          symbol: item.symbol,
          name: item.name,
          sector: item.sector ?? "종목 마스터",
          themes: item.themes?.length ? item.themes : [item.sector ?? "종목 마스터"],
          candidateSourceDetail: "symbol-master" as const,
        })),
      Math.min(limit, 20),
    );
  } catch {
    return [];
  }
};

const buildAutoUniverse = async (market: LeaderMarket, limit: number) => {
  const dynamic = await fetchScreenerCandidates(market, limit);
  const dynamicCandidates =
    dynamic.candidates.length >= MIN_DYNAMIC_CANDIDATES
      ? dynamic.candidates
      : [];
  const symbolMasterCandidates = await fetchSymbolMasterCandidates(market, limit);
  const curated = CURATED_COVERAGE[market];
  const fallback = LEADER_UNIVERSES[market].map((item) => ({
    ...item,
    candidateSourceDetail: "fallback" as const,
  }));
  const symbols = mergeCandidates([
    ...dynamicCandidates,
    ...curated,
    ...symbolMasterCandidates,
    ...fallback,
  ], limit);
  const detailCounts = symbols.reduce(
    (counts, item) => ({
      ...counts,
      [item.candidateSourceDetail]: counts[item.candidateSourceDetail] + 1,
    }),
    {
      dynamic: 0,
      "symbol-master": 0,
      fallback: 0,
      curated: 0,
    } satisfies Record<CandidateSourceDetail, number>,
  );
  const sourceStatus =
    detailCounts.dynamic && symbols.some((item) => item.candidateSourceDetail !== "dynamic")
      ? "mixed"
      : detailCounts.dynamic
        ? "dynamic"
        : detailCounts.curated || detailCounts["symbol-master"]
          ? "mixed"
          : "fallback";

  return {
    symbols,
    candidateSource: {
      status: sourceStatus,
      label:
        sourceStatus === "dynamic"
          ? "동적 후보"
          : sourceStatus === "mixed"
            ? "동적/보강 후보"
            : "기본 유니버스",
      requested: limit,
      returned: dynamic.candidates.length,
      used: symbols.length,
      dynamicCount: detailCounts.dynamic,
      symbolMasterCount: detailCounts["symbol-master"],
      fallbackCount: detailCounts.fallback,
      curatedCount: detailCounts.curated,
      errors: dynamic.errors,
    } satisfies CandidateSource,
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const universe = getLeaderUniverse(url.searchParams.get("market") ?? "US");
  const { market } = universe;
  const limit = parseLimit(url.searchParams.get("limit"));
  const force = url.searchParams.get("force") === "1";
  const schedule = getSessionSchedule(getMarketSession(market));
  const cached = force ? null : await readCache(market, schedule.tradingDate, limit);

  if (cached) {
    return Response.json({
      ...cached,
      nextRefreshAt: schedule.nextRefreshAt,
      scanStatus: schedule.status,
    });
  }

  const { symbols, candidateSource } = await buildAutoUniverse(market, limit);
  const response = await scanLeaders(
    new Request(
      `http://stockanalysis.internal/api/market/leaders?market=${market}&top=4&days=430&symbols=${encodeURIComponent(
        symbols.map((item) => item.symbol).join(","),
      )}`,
    ),
    { userContext: getRequestUserContext(request) },
  );

  if (!response.ok) {
    return Response.json(
      { error: `Auto leaders failed with ${response.status}` },
      { status: response.status },
    );
  }

  const leaderData = (await response.json()) as LeaderResponse;
  const symbolMeta = new Map(symbols.map((item) => [item.symbol, item] as const));
  const payload: AutoLeaderResponse = {
    ...leaderData,
    candidates: leaderData.candidates.map((candidate) => {
      const meta = symbolMeta.get(candidate.symbol);
      return meta
        ? {
          ...candidate,
          name: meta.name,
          sector: meta.sector ?? candidate.sector,
          themes: meta.themes?.length ? meta.themes : candidate.themes,
          candidateSourceDetail: meta.candidateSourceDetail,
        }
        : candidate;
    }),
    errors: leaderData.errors.map((error) => ({
      ...error,
      name: symbolMeta.get(error.symbol)?.name ?? error.name,
    })),
    scanKey: `${market}:${schedule.tradingDate}:${limit}`,
    generatedAt: new Date().toISOString(),
    tradingDate: schedule.tradingDate,
    nextRefreshAt: schedule.nextRefreshAt,
    scanStatus: schedule.status,
    candidateSource: {
      ...candidateSource,
      analyzedCount: leaderData.candidates.length,
    },
  };

  await writeCache(payload);

  return Response.json(payload);
}
