import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSectorStrengthSnapshot,
  calculateSectorReturns,
  SECTOR_STRENGTH_MARKETS,
} from "../src/lib/market/sector-strength.ts";
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
