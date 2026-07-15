import { mapWithConcurrency } from "../../lib/community-pain/adapters/shared.mts";
import {
  buildCommunitySentimentDistribution,
  classifyCommunityPost,
} from "../../lib/community-pain/distribution.mts";
import { normalizeCommunitySymbol } from "../../lib/community-pain/normalize.mts";
import { scoreCommunityPain } from "../../lib/community-pain/scoring.mts";
import {
  collectCommunityPain,
  type CommunityPainCollection,
  type GetCommunityPainOptions,
} from "../../lib/community-pain/service.mts";
import type { CommunitySourceId } from "../../lib/community-pain/types.mts";
import { loadSymbolMaster } from "@/lib/market/symbol-master";
import { stripMarketSuffix, type SymbolSearchItem } from "@/lib/market/symbol-search";

export type SentimentOverviewMarket = "KR" | "US";
export type SentimentOverviewStatus =
  | "ready"
  | "low_evidence"
  | "unavailable"
  | "configuration_required"
  | "warming"
  | "error";

export type SentimentOverviewRatios = {
  bullishHype: number;
  bearishCriticism: number;
  mixed: number;
  neutral: number;
};

export type SentimentOverviewSourceStat = {
  id: string;
  label: string;
  status: string;
  reason?: string;
  itemCount: number;
};

export type SentimentOverviewEvidence = {
  classification: string;
  sourceId: string;
  sourceLabel: string;
  title: string;
  url: string;
  engagement: number;
  symbol?: string;
};

export type SentimentOverviewBucket = {
  id: string;
  status: SentimentOverviewStatus;
  ratios: SentimentOverviewRatios | null;
  sampleCount: number;
  uniqueAuthorCount: number | null;
  effectiveWindowHours: 24 | 72;
  pain: number;
  fomo: number;
  toxicity: number;
  sourceStats: SentimentOverviewSourceStat[];
  evidence: SentimentOverviewEvidence[];
  reason?: string;
  generatedAt: string;
  stale: boolean;
};

export type SentimentMarketBucket = SentimentOverviewBucket & {
  basis: "toss_market_trading_amount_1d";
  universeCount: 30;
  coverageCount: number;
  bullishBreadth: number;
  bearishBreadth: number;
  rankedAt: string | null;
};

export type SentimentMarketComparison = {
  status: SentimentOverviewStatus;
  reason?: string;
  kr: SentimentMarketBucket | null;
  us: SentimentMarketBucket | null;
  generatedAt: string;
  stale: boolean;
};

export type SentimentOverviewResponse = {
  symbol: string;
  canonicalSymbol: string;
  symbolMarket: SentimentOverviewMarket;
  generatedAt: string;
  stale: boolean;
  instrument: {
    krCommunity: SentimentOverviewBucket;
    globalCommunity: SentimentOverviewBucket;
  };
  marketComparison: SentimentMarketComparison;
};

type CollectCommunityPain = (options: GetCommunityPainOptions) => Promise<CommunityPainCollection>;

export type SentimentOverviewDependencies = {
  collectCommunityPain: CollectCommunityPain;
  loadSymbols: typeof loadSymbolMaster;
};

const defaultDependencies: SentimentOverviewDependencies = {
  collectCommunityPain,
  loadSymbols: loadSymbolMaster,
};

const normalizeMarket = (market: string): SentimentOverviewMarket =>
  market.trim().toUpperCase().startsWith("K") ? "KR" : "US";

const uniqueTerms = (values: Array<string | undefined>) => [
  ...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
];

const findInstrument = (
  symbol: string,
  market: SentimentOverviewMarket,
  items: SymbolSearchItem[],
) => {
  const canonical = normalizeCommunitySymbol(symbol, market);
  return items.find((item) =>
    (market === "US" ? item.market === "US" : item.market === "KOSPI" || item.market === "KOSDAQ") &&
    stripMarketSuffix(item.symbol).toUpperCase() === canonical.toUpperCase()
  );
};

export const resolveSentimentQueryTerms = (
  symbol: string,
  market: SentimentOverviewMarket,
  items: SymbolSearchItem[],
) => {
  const canonical = normalizeCommunitySymbol(symbol, market);
  const instrument = findInstrument(symbol, market, items);
  if (market === "US") {
    return uniqueTerms([
      canonical ? `$${canonical}` : undefined,
      canonical,
      instrument?.nameEn,
      instrument?.name,
      ...(instrument?.aliases ?? []),
    ]);
  }
  return uniqueTerms([
    instrument?.nameEn,
    instrument?.name,
    instrument?.nameKo,
    ...(instrument?.aliases ?? []),
    canonical,
  ]);
};

const sourceStatus = (collection: CommunityPainCollection): SentimentOverviewStatus | null => {
  if (collection.allItems.length) return null;
  if (collection.sources.some((source) => source.status === "configuration-required")) {
    return "configuration_required";
  }
  if (collection.sources.some((source) => source.status === "error")) return "error";
  return null;
};

const sourceReason = (collection: CommunityPainCollection) =>
  collection.sources.find((source) => source.reason)?.reason;

const mapEvidence = (
  evidence: ReturnType<typeof buildCommunitySentimentDistribution>["evidence"],
  collection: CommunityPainCollection,
  symbol?: string,
): SentimentOverviewEvidence[] => {
  const labels = new Map(collection.sources.map((source) => [source.id, source.label]));
  return evidence.map((item) => ({
    classification: item.category,
    sourceId: item.sourceId,
    sourceLabel: labels.get(item.sourceId) ?? item.sourceId,
    title: item.title,
    url: item.url,
    engagement: item.engagement,
    ...(symbol ? { symbol } : {}),
  }));
};

const mapSupportingEvidence = (
  collection: CommunityPainCollection,
  queryTerms: string[],
  symbol?: string,
): SentimentOverviewEvidence[] => {
  const labels = new Map(collection.sources.map((source) => [source.id, source.label]));
  const categoryCounts = new Map<string, number>();
  return collection.allItems
    .toSorted((left, right) => right.engagement - left.engagement)
    .map((item) => ({ item, classification: classifyCommunityPost(item, queryTerms) }))
    .filter(({ classification }) => {
      const count = categoryCounts.get(classification.category) ?? 0;
      if (count >= 3) return false;
      categoryCounts.set(classification.category, count + 1);
      return true;
    })
    .map(({ item, classification }) => ({
      classification: classification.category,
      sourceId: item.sourceId,
      sourceLabel: labels.get(item.sourceId) ?? item.sourceId,
      title: item.title,
      url: item.url,
      engagement: item.engagement,
      ...(symbol ? { symbol } : {}),
    }));
};

const mapRatios = (
  ratios: ReturnType<typeof buildCommunitySentimentDistribution>["ratios"],
): SentimentOverviewRatios | null => ratios
  ? {
    bullishHype: ratios.bullish_hype,
    bearishCriticism: ratios.bearish_criticism,
    mixed: ratios.mixed,
    neutral: ratios.neutral,
  }
  : null;

const buildBucket = async ({
  id,
  symbol,
  market,
  source,
  queryTerms,
  summaryOnly,
  nowTimestamp,
  dependencies,
}: {
  id: string;
  symbol: string;
  market: SentimentOverviewMarket;
  source: CommunitySourceId;
  queryTerms: string[];
  summaryOnly: boolean;
  nowTimestamp: number;
  dependencies: SentimentOverviewDependencies;
}): Promise<SentimentOverviewBucket> => {
  const collection = await dependencies.collectCommunityPain({
    symbol,
    market,
    requestedSources: [source],
    queryTerms,
    limit: summaryOnly ? 20 : 60,
    summaryOnly,
    nowTimestamp,
  });
  const distribution = buildCommunitySentimentDistribution(collection.allItems, {
    nowTimestamp,
    queryTerms,
  });
  const scored = scoreCommunityPain(collection.sources);
  const override = sourceStatus(collection);
  return {
    id,
    status: override ?? distribution.status,
    ratios: override ? null : mapRatios(distribution.ratios),
    sampleCount: distribution.sampleCount,
    uniqueAuthorCount: distribution.uniqueAuthorCount,
    effectiveWindowHours: distribution.effectiveWindowHours,
    pain: summaryOnly ? distribution.pain : scored.painScore,
    fomo: summaryOnly ? distribution.fomo : scored.gajuaScore,
    toxicity: distribution.toxicity,
    sourceStats: collection.sources.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      reason: item.reason,
      itemCount: item.itemCount,
    })),
    evidence: summaryOnly
      ? mapEvidence(distribution.evidence, collection, symbol)
      : mapSupportingEvidence(collection, queryTerms, symbol),
    reason: override ? sourceReason(collection) : distribution.reason,
    generatedAt: new Date(nowTimestamp).toISOString(),
    stale: false,
  };
};

export const unavailableSentimentBucket = (
  id: string,
  reason: string,
  nowTimestamp = Date.now(),
): SentimentOverviewBucket => ({
  id,
  status: "unavailable",
  ratios: null,
  sampleCount: 0,
  uniqueAuthorCount: null,
  effectiveWindowHours: 24,
  pain: 0,
  fomo: 0,
  toxicity: 0,
  sourceStats: [],
  evidence: [],
  reason,
  generatedAt: new Date(nowTimestamp).toISOString(),
  stale: false,
});

export const buildInstrumentSentiment = async ({
  symbol,
  market,
  nowTimestamp = Date.now(),
  dependencies = defaultDependencies,
}: {
  symbol: string;
  market: string;
  nowTimestamp?: number;
  dependencies?: SentimentOverviewDependencies;
}) => {
  const symbolMarket = normalizeMarket(market);
  const masterMarkets = symbolMarket === "KR" ? ["KOSPI", "KOSDAQ"] as const : ["US"] as const;
  const master = await dependencies.loadSymbols({ markets: [...masterMarkets] });
  const terms = resolveSentimentQueryTerms(symbol, symbolMarket, master.items);
  const krCommunity = symbolMarket === "US"
    ? unavailableSentimentBucket(
      "instrument-kr",
      "unsupported_source_coverage",
      nowTimestamp,
    )
    : buildBucket({
      id: "instrument-kr",
      symbol,
      market: symbolMarket,
      source: "paxnet",
      queryTerms: terms,
      summaryOnly: false,
      nowTimestamp,
      dependencies,
    });
  const globalCommunity = buildBucket({
    id: "instrument-global",
    symbol,
    market: symbolMarket,
    source: "reddit",
    queryTerms: terms,
    summaryOnly: false,
    nowTimestamp,
    dependencies,
  });
  const [kr, global] = await Promise.all([krCommunity, globalCommunity]);
  return { krCommunity: kr, globalCommunity: global };
};

const largestRemainderRatios = (values: number[]): number[] => {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0, 0];
  const scaled = values.map((value) => value / total * 100);
  const base = scaled.map(Math.floor);
  const remaining = 100 - base.reduce((sum, value) => sum + value, 0);
  const order = scaled
    .map((value, index) => ({ index, remainder: value - base[index] }))
    .toSorted((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) base[order[index].index] += 1;
  return base;
};

const average = (values: number[]) => values.length
  ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  : 0;

const aggregateSourceStats = (
  buckets: Array<{ bucket: SentimentOverviewBucket }>,
): SentimentOverviewSourceStat[] => {
  const grouped = new Map<string, {
    label: string;
    itemCount: number;
    successCount: number;
    failureCount: number;
    reasons: string[];
  }>();
  for (const source of buckets.flatMap((entry) => entry.bucket.sourceStats)) {
    const current = grouped.get(source.id) ?? {
      label: source.label,
      itemCount: 0,
      successCount: 0,
      failureCount: 0,
      reasons: [],
    };
    current.itemCount += source.itemCount;
    if (source.status === "ok") current.successCount += 1;
    if (["error", "configuration-required"].includes(source.status)) {
      current.failureCount += 1;
      if (source.reason) current.reasons.push(source.reason);
    }
    grouped.set(source.id, current);
  }
  return [...grouped.entries()].map(([id, source]) => ({
    id,
    label: source.label,
    status: source.failureCount
      ? source.successCount ? "partial" : "error"
      : source.successCount ? "ok" : "empty",
    reason: source.failureCount
      ? `${source.failureCount}개 종목 소스 조회 실패${source.reasons[0] ? ` · ${source.reasons[0]}` : ""}`
      : undefined,
    itemCount: source.itemCount,
  }));
};

export const aggregateMarketSentiment = ({
  id,
  buckets,
  rankedAt,
  nowTimestamp = Date.now(),
}: {
  id: "market-kr" | "market-us";
  buckets: Array<{ symbol: string; bucket: SentimentOverviewBucket }>;
  rankedAt: string | null;
  nowTimestamp?: number;
}): SentimentMarketBucket => {
  const eligible = buckets.filter((entry) => entry.bucket.ratios !== null);
  const rawRatios = [
    eligible.reduce((sum, entry) => sum + entry.bucket.ratios!.bullishHype, 0),
    eligible.reduce((sum, entry) => sum + entry.bucket.ratios!.bearishCriticism, 0),
    eligible.reduce((sum, entry) => sum + entry.bucket.ratios!.mixed, 0),
    eligible.reduce((sum, entry) => sum + entry.bucket.ratios!.neutral, 0),
  ];
  const rounded = largestRemainderRatios(rawRatios);
  const sampleCount = eligible.reduce((sum, entry) => sum + entry.bucket.sampleCount, 0);
  const coverageCount = eligible.length;
  const status: SentimentOverviewStatus = coverageCount >= 20 && sampleCount >= 100
    ? "ready"
    : coverageCount >= 10 && sampleCount >= 50
      ? "low_evidence"
      : "unavailable";
  const evidence = eligible
    .flatMap((entry) => entry.bucket.evidence.map((item) => ({ ...item, symbol: entry.symbol })))
    .toSorted((left, right) => right.engagement - left.engagement)
    .slice(0, 12);
  const uniqueAuthors = eligible.map((entry) => entry.bucket.uniqueAuthorCount);
  return {
    id,
    status,
    ratios: status === "unavailable" ? null : {
      bullishHype: rounded[0],
      bearishCriticism: rounded[1],
      mixed: rounded[2],
      neutral: rounded[3],
    },
    sampleCount,
    uniqueAuthorCount: uniqueAuthors.every((value) => value !== null)
      ? uniqueAuthors.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    effectiveWindowHours: eligible.some((entry) => entry.bucket.effectiveWindowHours === 72) ? 72 : 24,
    pain: average(eligible.map((entry) => entry.bucket.pain)),
    fomo: average(eligible.map((entry) => entry.bucket.fomo)),
    toxicity: average(eligible.map((entry) => entry.bucket.toxicity)),
    sourceStats: aggregateSourceStats(buckets),
    evidence,
    reason: status === "unavailable"
      ? `시장 표본이 부족합니다. 유효 종목 ${coverageCount}/30, 반응 ${sampleCount}건입니다.`
      : status === "low_evidence"
        ? `유효 종목 ${coverageCount}/30으로 참고용 표본입니다.`
        : undefined,
    generatedAt: new Date(nowTimestamp).toISOString(),
    stale: false,
    basis: "toss_market_trading_amount_1d",
    universeCount: 30,
    coverageCount,
    bullishBreadth: eligible.filter((entry) =>
      entry.bucket.ratios!.bullishHype > entry.bucket.ratios!.bearishCriticism
    ).length,
    bearishBreadth: eligible.filter((entry) =>
      entry.bucket.ratios!.bearishCriticism > entry.bucket.ratios!.bullishHype
    ).length,
    rankedAt,
  };
};

export const buildMarketSentimentBucket = async ({
  id,
  market,
  symbols,
  rankedAt,
  nowTimestamp = Date.now(),
  dependencies = defaultDependencies,
}: {
  id: "market-kr" | "market-us";
  market: SentimentOverviewMarket;
  symbols: string[];
  rankedAt: string | null;
  nowTimestamp?: number;
  dependencies?: SentimentOverviewDependencies;
}): Promise<SentimentMarketBucket> => {
  const masterMarkets = market === "KR" ? ["KOSPI", "KOSDAQ"] as const : ["US"] as const;
  const master = await dependencies.loadSymbols({ markets: [...masterMarkets] });
  const source: CommunitySourceId = market === "KR" ? "paxnet" : "reddit";
  const selected = symbols.slice(0, 30);
  const buckets = await mapWithConcurrency(
    selected,
    async (symbol) => ({
      symbol,
      bucket: await buildBucket({
        id: `${id}:${symbol}`,
        symbol,
        market,
        source,
        queryTerms: resolveSentimentQueryTerms(symbol, market, master.items),
        summaryOnly: true,
        nowTimestamp,
        dependencies,
      }),
    }),
    2,
  );
  return aggregateMarketSentiment({ id, buckets, rankedAt, nowTimestamp });
};

export const buildMarketSentimentComparison = async ({
  krSymbols,
  usSymbols,
  krRankedAt,
  usRankedAt,
  nowTimestamp = Date.now(),
  dependencies = defaultDependencies,
}: {
  krSymbols: string[];
  usSymbols: string[];
  krRankedAt: string | null;
  usRankedAt: string | null;
  nowTimestamp?: number;
  dependencies?: SentimentOverviewDependencies;
}): Promise<SentimentMarketComparison> => {
  const [kr, us] = await Promise.all([
    buildMarketSentimentBucket({
      id: "market-kr",
      market: "KR",
      symbols: krSymbols,
      rankedAt: krRankedAt,
      nowTimestamp,
      dependencies,
    }),
    buildMarketSentimentBucket({
      id: "market-us",
      market: "US",
      symbols: usSymbols,
      rankedAt: usRankedAt,
      nowTimestamp,
      dependencies,
    }),
  ]);
  const status: SentimentOverviewStatus = kr.status === "unavailable" || us.status === "unavailable"
    ? "unavailable"
    : kr.status === "low_evidence" || us.status === "low_evidence"
      ? "low_evidence"
      : "ready";
  return {
    status,
    reason: status === "unavailable"
      ? "한국·미국 시장 표본이 모두 준비돼야 시장 비교를 표시합니다."
      : status === "low_evidence"
        ? "일부 시장 표본이 적어 참고용으로만 표시합니다."
        : undefined,
    kr,
    us,
    generatedAt: new Date(nowTimestamp).toISOString(),
    stale: false,
  };
};

export const configurationRequiredMarketComparison = (
  reason: string,
  nowTimestamp = Date.now(),
): SentimentMarketComparison => ({
  status: "configuration_required",
  reason,
  kr: null,
  us: null,
  generatedAt: new Date(nowTimestamp).toISOString(),
  stale: false,
});

export const warmingMarketComparison = (nowTimestamp = Date.now()): SentimentMarketComparison => ({
  status: "warming",
  reason: "한국·미국 거래대금 상위 30종목의 민심을 집계하고 있습니다.",
  kr: null,
  us: null,
  generatedAt: new Date(nowTimestamp).toISOString(),
  stale: false,
});
