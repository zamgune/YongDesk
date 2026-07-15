import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSectorStrengthSnapshot,
  calculateSectorReturns,
  SECTOR_STRENGTH_MARKETS,
  type SectorStrengthResponse,
} from "../src/lib/market/sector-strength.ts";
import { confirmedDailyCandles } from "../src/lib/market/confirmed-daily-candles.ts";
import { resolvePlaybookExternalContext } from "../src/lib/market/playbook-external-context.ts";
import { createSectorStrengthService } from "../src/use-cases/market/get-sector-strength.ts";
import type {
  MarketCandleResponse,
  MarketDataProvider,
} from "../src/lib/market-data/types.ts";

const NOW = new Date("2026-07-15T15:00:00.000Z");

const candles = (count = 30, start = 100): MarketCandleResponse => ({
  timeZone: "America/New_York",
  candles: Array.from({ length: count }, (_, index) => ({
    time: Math.floor(new Date(`2026-06-${String(index + 1).padStart(2, "0")}T20:00:00.000Z`).getTime() / 1_000),
    open: start + index - 0.5,
    high: start + index + 1,
    low: start + index - 1,
    close: start + index,
    volume: 1_000 + index,
  })),
});

const mockProvider = (options: { failingSymbols?: Set<string>; benchmarkFailsAfter?: number } = {}) => {
  let benchmarkCalls = 0;
  const provider: MarketDataProvider = {
    async getCandles(symbol: string) {
      if (options.failingSymbols?.has(symbol)) throw new Error("fixture failure");
      if (symbol === "SPY") {
        benchmarkCalls += 1;
        if (options.benchmarkFailsAfter && benchmarkCalls > options.benchmarkFailsAfter) {
          throw new Error("benchmark unavailable");
        }
      }
      return candles(30, symbol === "SPY" ? 200 : 100);
    },
    async getExtendedQuote(symbol: string) {
      if (options.failingSymbols?.has(symbol)) throw new Error("fixture failure");
      return {
        symbol,
        regularMarketPrice: symbol === "SPY" ? 231 : 132,
        regularMarketPreviousClose: symbol === "SPY" ? 230 : 130,
        marketState: "REGULAR",
      };
    },
    async getQuote() { return null; },
    async getQuotes() { return []; },
    async getExtendedQuotes() { return []; },
    async getScreenerCandidates() { return []; },
    async getAssetProfile() { return null; },
  };
  return { provider, benchmarkCalls: () => benchmarkCalls };
};

test("confirmed daily candles exclude a Yahoo-style forming bar and expose exchange closeTime", () => {
  const now = new Date("2026-07-15T15:00:00.000Z");
  const previousOpen = Math.floor(Date.parse("2026-07-14T13:30:00.000Z") / 1_000);
  const formingOpen = Math.floor(Date.parse("2026-07-15T13:30:00.000Z") / 1_000);
  const source = [previousOpen, formingOpen].map((time, index) => ({
    time,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000,
  }));

  const result = confirmedDailyCandles(source, "US", now);

  assert.equal(result.length, 1);
  assert.equal(result[0].time, previousOpen);
  assert.equal(
    result[0].closeTime,
    Math.floor(Date.parse("2026-07-14T20:00:00.000Z") / 1_000),
  );
});

test("sector return calculation uses intraday quote for one day and confirmed candles for longer periods", () => {
  const source = candles(30, 100);
  const result = calculateSectorReturns(
    source.candles,
    {
      symbol: "XLK",
      regularMarketPrice: 135,
      regularMarketPreviousClose: 130,
      marketState: "REGULAR",
    },
    source.timeZone,
    NOW,
  );

  assert.equal(result.status, "intraday");
  assert.equal(result.returns.oneDay, 135 / 130 - 1);
  assert.equal(result.returns.oneWeek, 129 / 124 - 1);
  assert.equal(result.returns.oneMonth, 129 / 108 - 1);
});

test("sector snapshot subtracts benchmark and keeps partial ETF failures", async () => {
  const failed = SECTOR_STRENGTH_MARKETS.US.sectors[2].symbol;
  const { provider } = mockProvider({ failingSymbols: new Set([failed]) });
  const response = await buildSectorStrengthSnapshot("US", provider, NOW);

  assert.equal(response.marketState, "intraday");
  assert.equal(response.dataProvenance, "confirmed-daily-candles");
  assert.equal(response.candleAsOf, response.benchmark.candleAsOf);
  assert.equal(response.maxCandleAgeSeconds, response.benchmark.candleAgeSeconds);
  assert.equal(response.sectors.length, SECTOR_STRENGTH_MARKETS.US.sectors.length - 1);
  assert.deepEqual(response.errors.map((item) => item.symbol), [failed]);
  assert.equal(
    response.sectors[0].excessReturns.oneDay,
    response.sectors[0].returns.oneDay! - response.benchmark.returns.oneDay!,
  );
});

test("sector service caches results, throttles manual refresh, and returns stale last-good data", async () => {
  const state = mockProvider({ benchmarkFailsAfter: 1 });
  let now = NOW;
  const service = createSectorStrengthService(state.provider, () => now);

  const first = await service("US");
  now = new Date(NOW.getTime() + 1_000);
  const cached = await service("US");
  const throttled = await service("US", true);
  assert.equal(state.benchmarkCalls(), 1);
  assert.equal(cached.generatedAt, first.generatedAt);
  assert.equal(throttled.generatedAt, first.generatedAt);

  now = new Date(NOW.getTime() + 6_000);
  const stale = await service("US", true);
  assert.equal(stale.stale, true);
  assert.match(stale.errors.at(-1)?.message ?? "", /benchmark unavailable/);
});

test("sector market configuration has unique symbols and expected benchmarks", () => {
  assert.equal(SECTOR_STRENGTH_MARKETS.US.benchmark.symbol, "SPY");
  assert.equal(SECTOR_STRENGTH_MARKETS.KR.benchmark.symbol, "069500.KS");
  for (const config of Object.values(SECTOR_STRENGTH_MARKETS)) {
    const symbols = config.sectors.map((item) => item.symbol);
    assert.equal(new Set(symbols).size, symbols.length);
    assert(!symbols.includes(config.benchmark.symbol));
  }
});

const sectorSnapshot = (overrides: Partial<SectorStrengthResponse> = {}): SectorStrengthResponse => ({
  market: "US",
  generatedAt: NOW.toISOString(),
  asOf: NOW.toISOString(),
  dataProvenance: "confirmed-daily-candles",
  candleAsOf: NOW.toISOString(),
  maxCandleAgeSeconds: 0,
  marketState: "closed",
  benchmark: {
    id: "us-market",
    name: "S&P 500",
    symbol: "SPY",
    returns: { oneDay: 0.01, oneWeek: 0.02, oneMonth: 0.03 },
    excessReturns: { oneDay: 0, oneWeek: 0, oneMonth: 0 },
    quoteAt: NOW.toISOString(),
    candleAsOf: NOW.toISOString(),
    candleAgeSeconds: 0,
    status: "closed",
  },
  sectors: [{
    id: "technology",
    name: "기술",
    symbol: "XLK",
    returns: { oneDay: 0.02, oneWeek: 0.04, oneMonth: 0.08 },
    excessReturns: { oneDay: 0.01, oneWeek: 0.02, oneMonth: 0.05 },
    quoteAt: NOW.toISOString(),
    candleAsOf: NOW.toISOString(),
    candleAgeSeconds: 0,
    status: "closed",
  }],
  errors: [],
  stale: false,
  cacheAgeSeconds: 0,
  ...overrides,
});

const leadershipSnapshot = (overrides: Record<string, unknown> = {}) => ({
  market: "US" as const,
  generatedAt: NOW.toISOString(),
  strategy: { leaderCount: 4, minLeaderReturn50: null },
  marketHealth: {
    breadth: 0.68,
    averageReturn50: 0.09,
    pass: true,
    loadedSymbols: 20,
    totalSymbols: 22,
    timestampedSymbols: 20,
    coverageType: "curated-leader-universe",
    source: "leader-universes.static-curated",
    latestCandleAt: NOW.toISOString(),
    oldestLatestCandleAt: NOW.toISOString(),
    maxDataAgeSeconds: 0,
  },
  candidates: [{
    symbol: "AAPL",
    sector: "메가캡 플랫폼",
    rank: 2,
    return50: 0.17,
    dataProvenance: "market-data.confirmed-daily-candles",
    latestCandleAt: NOW.toISOString(),
    dataAgeSeconds: 0,
  }],
  ...overrides,
});

test("playbook context rejects curated breadth while preserving fresh sector and curated leader provenance", () => {
  const context = resolvePlaybookExternalContext({
    symbol: "AAPL",
    market: "US",
    generatedAt: NOW.toISOString(),
    leadership: leadershipSnapshot(),
    sectorStrength: sectorSnapshot(),
    assetProfile: { sector: "Technology", industry: "Consumer Electronics" },
  });

  assert.equal(context.market?.status, "unavailable");
  assert.equal(context.market?.source, "market-breadth.unavailable");
  assert.equal(context.market?.asOf, NOW.toISOString());
  assert.equal(context.market?.dataAgeSeconds, 0);
  assert.match(context.market?.reason ?? "", /선택편향/);
  assert.equal(context.sector?.status, "pass");
  assert.equal(context.sector?.source, "sector-strength.US.XLK");
  assert.equal(context.sector?.asOf, NOW.toISOString());
  assert.equal(context.sector?.dataAgeSeconds, 0);
  assert.match(context.sector?.reason ?? "", /5\.00%p/);
  assert.equal(context.leader50?.status, "pass");
  assert.equal(context.leader50?.source, "market-leaders.curated-return50-rank");
  assert.equal(context.leader50?.dataAgeSeconds, 0);
  assert.match(context.leader50?.label ?? "", /2위/);
});

test("playbook context keeps missing mappings, stale strength, and thin breadth unavailable", () => {
  const missingMapping = resolvePlaybookExternalContext({
    symbol: "AAPL",
    market: "US",
    generatedAt: NOW.toISOString(),
    leadership: leadershipSnapshot(),
    sectorStrength: sectorSnapshot(),
    assetProfile: { sector: "Unmapped Sector" },
  });
  assert.equal(missingMapping.sector?.status, "unavailable");
  assert.equal(missingMapping.sector?.source, "sector-strength.mapping");

  const staleSector = resolvePlaybookExternalContext({
    symbol: "AAPL",
    market: "US",
    generatedAt: NOW.toISOString(),
    leadership: leadershipSnapshot(),
    sectorStrength: sectorSnapshot({ stale: true }),
    assetProfile: { sector: "Technology" },
  });
  assert.equal(staleSector.sector?.status, "unavailable");

  const thinBreadth = resolvePlaybookExternalContext({
    symbol: "AAPL",
    market: "US",
    generatedAt: NOW.toISOString(),
    leadership: leadershipSnapshot({
      marketHealth: {
        breadth: 1,
        averageReturn50: 0.2,
        pass: true,
        loadedSymbols: 5,
        totalSymbols: 22,
        timestampedSymbols: 5,
        coverageType: "curated-leader-universe",
        source: "leader-universes.static-curated",
        latestCandleAt: NOW.toISOString(),
        oldestLatestCandleAt: NOW.toISOString(),
        maxDataAgeSeconds: 0,
      },
    }),
    sectorStrength: sectorSnapshot(),
    assetProfile: { sector: "Technology" },
  });
  assert.equal(thinBreadth.market?.status, "unavailable");
  assert.equal(thinBreadth.leader50?.status, "unavailable");
});

test("playbook context fails closed when leader or sector candles are stale despite fresh response timestamps", () => {
  const staleAt = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1_000).toISOString();
  const staleLeadership = leadershipSnapshot({
    marketHealth: {
      ...leadershipSnapshot().marketHealth,
      latestCandleAt: staleAt,
      oldestLatestCandleAt: staleAt,
      maxDataAgeSeconds: 5 * 24 * 60 * 60,
    },
    candidates: [{
      ...leadershipSnapshot().candidates[0],
      latestCandleAt: staleAt,
      dataAgeSeconds: 5 * 24 * 60 * 60,
    }],
  });
  const staleSectorBase = sectorSnapshot();
  const staleSector = sectorSnapshot({
    generatedAt: NOW.toISOString(),
    asOf: NOW.toISOString(),
    candleAsOf: staleAt,
    maxCandleAgeSeconds: 5 * 24 * 60 * 60,
    benchmark: {
      ...staleSectorBase.benchmark,
      candleAsOf: staleAt,
      candleAgeSeconds: 5 * 24 * 60 * 60,
    },
    sectors: staleSectorBase.sectors.map((item) => ({
      ...item,
      candleAsOf: staleAt,
      candleAgeSeconds: 5 * 24 * 60 * 60,
    })),
  });

  const context = resolvePlaybookExternalContext({
    symbol: "AAPL",
    market: "US",
    generatedAt: NOW.toISOString(),
    leadership: staleLeadership,
    sectorStrength: staleSector,
    assetProfile: { sector: "Technology" },
  });

  assert.equal(context.market?.status, "unavailable");
  assert.equal(context.leader50?.status, "unavailable");
  assert.equal(context.leader50?.asOf, staleAt);
  assert.equal(context.leader50?.dataAgeSeconds, 5 * 24 * 60 * 60);
  assert.match(context.leader50?.reason ?? "", /stale/);
  assert.equal(context.sector?.status, "unavailable");
  assert.equal(context.sector?.asOf, staleAt);
  assert.equal(context.sector?.dataAgeSeconds, 5 * 24 * 60 * 60);
  assert.match(context.sector?.reason ?? "", /stale/);
});
