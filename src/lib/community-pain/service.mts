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
  CommunitySourceId,
  NormalizedCommunityItem,
  SourceFetchContext,
} from "./types.mts";

type GetCommunityPainOptions = {
  symbol: string;
  market?: string;
  includeBroad?: boolean;
  includeSpikeSources?: boolean;
  requestedSources?: CommunitySourceId[];
  limit?: number;
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

export const getCommunityPain = async ({
  symbol,
  market = "US",
  includeBroad = false,
  includeSpikeSources = false,
  requestedSources,
  limit = DEFAULT_ITEM_LIMIT,
}: GetCommunityPainOptions): Promise<CommunityPainResponse> => {
  const canonicalSymbol = normalizeCommunitySymbol(symbol, market);
  const queryTerms = buildQueryTerms(symbol, market);
  const nowTimestamp = Date.now();
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
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: COMMUNITY_CACHE_TTL_SECONDS,
  };
};
