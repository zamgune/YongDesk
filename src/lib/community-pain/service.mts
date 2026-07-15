import {
  COMMUNITY_CACHE_TTL_SECONDS,
  COMMUNITY_FALLBACK_LOOKBACK_HOURS,
  COMMUNITY_LOOKBACK_HOURS,
  DEFAULT_ITEM_LIMIT,
} from "./config.mts";
import { buildQueryTerms, normalizeCommunitySymbol, summarizeText } from "./normalize.mts";
import {
  buildSnippetReason,
  itemHasGajuaSignal,
  itemHasPainSignal,
  scoreCommunityPain,
} from "./scoring.mts";
import { selectCommunitySources } from "./sources.mts";
import { mapWithConcurrency } from "./adapters/shared.mts";
import type {
  CommunityPainResponse,
  CommunityPainSourceResult,
  CommunitySourceId,
  NormalizedCommunityItem,
  SourceFetchContext,
} from "./types.mts";

export type GetCommunityPainOptions = {
  symbol: string;
  market?: string;
  includeBroad?: boolean;
  includeSpikeSources?: boolean;
  requestedSources?: CommunitySourceId[];
  limit?: number;
  queryTerms?: string[];
  summaryOnly?: boolean;
  nowTimestamp?: number;
};

export type CommunityPainCollection = {
  symbol: string;
  canonicalSymbol: string;
  market: string;
  queryTerms: string[];
  sources: CommunityPainSourceResult[];
  allItems: NormalizedCommunityItem[];
  sourceLabels: Map<string, string>;
  nowTimestamp: number;
};

const pickSnippets = (
  items: NormalizedCommunityItem[],
  sourceLabels: Map<string, string>,
) =>
  [...items]
    .sort((left, right) => right.engagement - left.engagement)
    .slice(0, 6)
    .map((item) => ({
      sourceId: item.sourceId,
      sourceLabel: sourceLabels.get(item.sourceId) ?? item.sourceId,
      title: summarizeText(item.title, 120),
      url: item.url,
      reason: buildSnippetReason(item),
      engagement: item.engagement,
      kind: item.kind ?? "post",
    }));

export const collectCommunityPain = async ({
  symbol,
  market = "US",
  includeBroad = false,
  includeSpikeSources = false,
  requestedSources,
  limit = DEFAULT_ITEM_LIMIT,
  queryTerms: requestedQueryTerms,
  summaryOnly = false,
  nowTimestamp = Date.now(),
}: GetCommunityPainOptions): Promise<CommunityPainCollection> => {
  const canonicalSymbol = normalizeCommunitySymbol(symbol, market);
  const queryTerms = requestedQueryTerms?.map((term) => term.trim()).filter(Boolean) ??
    buildQueryTerms(symbol, market);
  const context: SourceFetchContext = {
    symbol,
    canonicalSymbol,
    market,
    queryTerms,
    includeBroad,
    includeSpikeSources,
    limit,
    lookbackHours: COMMUNITY_LOOKBACK_HOURS,
    collectionWindowHours: COMMUNITY_FALLBACK_LOOKBACK_HOURS,
    nowTimestamp,
    sinceTimestamp: nowTimestamp - COMMUNITY_FALLBACK_LOOKBACK_HOURS * 60 * 60 * 1000,
    primarySinceTimestamp: nowTimestamp - COMMUNITY_LOOKBACK_HOURS * 60 * 60 * 1000,
    summaryOnly,
  };
  const adapters = selectCommunitySources({
    requestedSources,
    includeBroad,
    includeSpikeSources,
  });
  const sources = await mapWithConcurrency(
    adapters,
    (adapter) => adapter.fetchItems(context),
    2,
  );
  const sourceLabels = new Map(sources.map((source) => [source.id, source.label]));
  const allItems = sources.flatMap((source) => source.items);

  return {
    symbol,
    canonicalSymbol,
    market,
    queryTerms,
    sources,
    allItems,
    sourceLabels,
    nowTimestamp,
  };
};

export const getCommunityPain = async (
  options: GetCommunityPainOptions,
): Promise<CommunityPainResponse> => {
  const collection = await collectCommunityPain(options);
  const {
    symbol,
    canonicalSymbol,
    market,
    queryTerms,
    sources,
    allItems,
    sourceLabels,
    nowTimestamp,
  } = collection;
  const scored = scoreCommunityPain(sources);

  return {
    symbol,
    canonicalSymbol,
    market,
    queryTerms,
    lookbackHours: COMMUNITY_LOOKBACK_HOURS,
    score: scored.score,
    painScore: scored.painScore,
    gajuaScore: scored.gajuaScore,
    divisionScore: scored.divisionScore,
    sentimentRegime: scored.sentimentRegime,
    level: scored.level,
    confidence: scored.confidence,
    verdict: scored.verdict,
    evidenceCount: allItems.length,
    postCount: allItems.filter((item) => (item.kind ?? "post") === "post").length,
    commentCount: allItems.filter((item) => item.kind === "comment").length,
    replyCount: allItems.filter((item) => item.kind === "reply").length,
    signalItemCount: scored.signalItemCount,
    collectionWindowHours: COMMUNITY_FALLBACK_LOOKBACK_HOURS,
    lowEvidence: scored.lowEvidence,
    qualityReasons: [
      ...(scored.lowEvidence ? ["표본 부족"] : []),
      ...(sources.filter((source) => source.status === "ok" && source.itemCount > 0).length === 1
        ? ["단일 소스"]
        : []),
    ],
    factors: scored.factors,
    gajuaFactors: scored.gajuaFactors,
    sourceStats: sources.map((source) => ({
      id: source.id,
      label: source.label,
      policyStatus: source.policyStatus,
      status: source.status,
      confidenceWeight: source.confidenceWeight,
      reason: source.reason,
      candidateCount: source.candidateCount,
      recentItemCount: source.recentItemCount,
      itemCount: source.itemCount,
      postCount: source.postCount,
      commentItemCount: source.commentItemCount,
      replyCount: source.replyCount,
      oldestItemAt: source.oldestItemAt,
      newestItemAt: source.newestItemAt,
      dateParseCoverage: source.dateParseCoverage,
      timedOut: Boolean(source.timedOut),
    })),
    snippets: pickSnippets(allItems, sourceLabels),
    painSnippets: pickSnippets(allItems.filter(itemHasPainSignal), sourceLabels),
    gajuaSnippets: pickSnippets(allItems.filter(itemHasGajuaSignal), sourceLabels),
    generatedAt: new Date(nowTimestamp).toISOString(),
    cacheTtlSeconds: COMMUNITY_CACHE_TTL_SECONDS,
  };
};
