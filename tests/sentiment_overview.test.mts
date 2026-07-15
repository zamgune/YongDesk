import assert from "node:assert/strict";
import test from "node:test";

import { normalizeItems } from "../src/lib/community-pain/normalize.mts";
import type {
  CommunityPainSourceResult,
  CommunitySourceId,
} from "../src/lib/community-pain/types.mts";
import type { SymbolSearchItem } from "../src/lib/market/symbol-search.ts";
import {
  aggregateMarketSentiment,
  buildInstrumentSentiment,
  buildMarketSentimentBucket,
  resolveSentimentQueryTerms,
  type SentimentOverviewBucket,
  type SentimentOverviewDependencies,
  type SentimentOverviewRatios,
} from "../src/use-cases/market/get-sentiment-overview.ts";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");

const symbolItem = (overrides: Partial<SymbolSearchItem> = {}): SymbolSearchItem => ({
  symbol: "005930.KS",
  displaySymbol: "005930",
  market: "KOSPI",
  name: "삼성전자",
  nameKo: "삼성전자",
  nameEn: "Samsung Electronics",
  aliases: ["삼전"],
  currency: "KRW",
  assetType: "stock",
  source: "fallback",
  ...overrides,
});

const ratios = (
  bullishHype: number,
  bearishCriticism: number,
  mixed = 0,
  neutral = 0,
): SentimentOverviewRatios => ({ bullishHype, bearishCriticism, mixed, neutral });

const bucket = ({
  value,
  sampleCount = 5,
}: {
  value: SentimentOverviewRatios | null;
  sampleCount?: number;
}): SentimentOverviewBucket => ({
  id: "fixture",
  status: value ? "low_evidence" : "unavailable",
  ratios: value,
  sampleCount,
  uniqueAuthorCount: value ? sampleCount : null,
  effectiveWindowHours: 24,
  pain: value?.bearishCriticism ?? 0,
  fomo: value?.bullishHype ?? 0,
  toxicity: 0,
  sourceStats: [],
  evidence: [],
  generatedAt: new Date(NOW).toISOString(),
  stale: false,
});

const sourceResult = (
  id: CommunitySourceId,
  symbol: string,
  count = 5,
): CommunityPainSourceResult => {
  const rawItems = Array.from({ length: count }, (_, index) => ({
    sourceId: id,
    id: `${symbol}-${index}`,
    kind: "post" as const,
    title: `${symbol} 상승 기대 ${index}`,
    url: `https://example.com/${symbol}/${index}`,
    author: `${symbol}-author-${index}`,
    createdAt: new Date(NOW - index * 60_000).toISOString(),
    reactionCount: index,
  }));
  const items = normalizeItems(rawItems, [symbol]);
  return {
    id,
    label: id === "reddit" ? "Reddit" : "팍스넷 종목토론실",
    policyStatus: "allowed",
    status: "ok",
    itemCount: items.length,
    postCount: items.length,
    commentItemCount: 0,
    replyCount: 0,
    candidateCount: items.length,
    recentItemCount: items.length,
    confidenceWeight: id === "reddit" ? 0.72 : 1,
    dateParseCoverage: 1,
    items,
  };
};

const dependencies = (
  calls: Array<{ symbol: string; source: CommunitySourceId; summaryOnly: boolean }>,
): SentimentOverviewDependencies => ({
  async loadSymbols(
    options: Parameters<SentimentOverviewDependencies["loadSymbols"]>[0] = {},
  ) {
    const markets = options.markets ?? [];
    return {
      items: markets.includes("US")
        ? [symbolItem({
          symbol: "AAPL",
          displaySymbol: "AAPL",
          market: "US",
          name: "Apple Inc.",
          nameEn: "Apple Inc.",
          aliases: ["애플"],
          currency: "USD",
          source: "seed",
        })]
        : [symbolItem()],
      sources: {
        US: "seed",
        KOSPI: "fallback",
        KOSDAQ: "fallback",
        CRYPTO: "seed",
      },
      warnings: [],
    };
  },
  async collectCommunityPain(options) {
    const source = options.requestedSources?.[0] ?? "paxnet";
    calls.push({
      symbol: options.symbol,
      source,
      summaryOnly: Boolean(options.summaryOnly),
    });
    const result = sourceResult(source, options.symbol);
    return {
      symbol: options.symbol,
      canonicalSymbol: options.symbol.replace(/\.(KS|KQ)$/i, ""),
      market: options.market ?? "US",
      queryTerms: options.queryTerms ?? [options.symbol],
      sources: [result],
      allItems: result.items,
      sourceLabels: new Map([[result.id, result.label]]),
      nowTimestamp: options.nowTimestamp ?? NOW,
    };
  },
});

test("sentiment query terms include English names and aliases for cross-region search", () => {
  assert.deepEqual(
    resolveSentimentQueryTerms("005930.KS", "KR", [symbolItem()]),
    ["Samsung Electronics", "삼성전자", "삼전", "005930"],
  );
  assert.deepEqual(
    resolveSentimentQueryTerms("AAPL", "US", [symbolItem({
      symbol: "AAPL",
      displaySymbol: "AAPL",
      market: "US",
      name: "Apple Inc.",
      nameEn: "Apple Inc.",
      aliases: ["애플"],
      currency: "USD",
      source: "seed",
    })]),
    ["$AAPL", "AAPL", "Apple Inc.", "애플"],
  );
});

test("US instruments expose unsupported Korean coverage without collecting a substitute source", async () => {
  const calls: Array<{ symbol: string; source: CommunitySourceId; summaryOnly: boolean }> = [];
  const result = await buildInstrumentSentiment({
    symbol: "AAPL",
    market: "US",
    nowTimestamp: NOW,
    dependencies: dependencies(calls),
  });

  assert.equal(result.krCommunity.status, "unavailable");
  assert.equal(result.krCommunity.reason, "unsupported_source_coverage");
  assert.equal(result.krCommunity.ratios, null);
  assert.deepEqual(calls, [{ symbol: "AAPL", source: "reddit", summaryOnly: false }]);
  assert.equal(result.globalCommunity.status, "low_evidence");
  assert.equal(result.globalCommunity.ratios?.bullishHype, 100);
});

test("market aggregation equally weights symbols instead of pooling post counts", () => {
  const buckets = [
    { symbol: "HEAVY", bucket: bucket({ value: ratios(100, 0), sampleCount: 500 }) },
    ...Array.from({ length: 9 }, (_, index) => ({
      symbol: `LIGHT-${index}`,
      bucket: bucket({ value: ratios(0, 100), sampleCount: 5 }),
    })),
  ];
  const result = aggregateMarketSentiment({
    id: "market-us",
    buckets,
    rankedAt: new Date(NOW).toISOString(),
    nowTimestamp: NOW,
  });

  assert.equal(result.status, "low_evidence");
  assert.equal(result.coverageCount, 10);
  assert.deepEqual(result.ratios, ratios(10, 90));
  assert.equal(result.sampleCount, 545);
});

test("market readiness requires coverage and total evidence and keeps ratios at 100", () => {
  const ready = aggregateMarketSentiment({
    id: "market-kr",
    buckets: [
      ...Array.from({ length: 20 }, (_, index) => ({
        symbol: String(index),
        bucket: bucket({ value: ratios(34, 33, 33), sampleCount: 5 }),
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        symbol: `failed-${index}`,
        bucket: bucket({ value: null, sampleCount: 0 }),
      })),
    ],
    rankedAt: new Date(NOW).toISOString(),
    nowTimestamp: NOW,
  });
  const unavailable = aggregateMarketSentiment({
    id: "market-us",
    buckets: Array.from({ length: 9 }, (_, index) => ({
      symbol: String(index),
      bucket: bucket({ value: ratios(100, 0), sampleCount: 100 }),
    })),
    rankedAt: null,
    nowTimestamp: NOW,
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.coverageCount, 20);
  assert.equal(Object.values(ready.ratios ?? {}).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.ratios, null);
});

test("market collection uses the required source with summary-only top-level sampling", async () => {
  const calls: Array<{ symbol: string; source: CommunitySourceId; summaryOnly: boolean }> = [];
  const symbols = Array.from({ length: 30 }, (_, index) => `${String(index).padStart(6, "0")}.KS`);
  const result = await buildMarketSentimentBucket({
    id: "market-kr",
    market: "KR",
    symbols,
    rankedAt: new Date(NOW).toISOString(),
    nowTimestamp: NOW,
    dependencies: dependencies(calls),
  });

  assert.equal(calls.length, 30);
  assert(calls.every((call) => call.source === "paxnet" && call.summaryOnly));
  assert.equal(result.universeCount, 30);
  assert.equal(result.coverageCount, 30);
  assert.equal(result.status, "ready");
});
