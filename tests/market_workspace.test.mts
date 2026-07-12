import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMarketWorkspaceRequest,
  type OfficialSeriesProvider,
  yahooCandleCloseTime,
} from "../src/lib/local-engine/market-workspace.ts";
import type { CandleSeriesSnapshot, OfficialTimeframe } from "../src/lib/market-data/official-types.ts";
import type { GetCandlesOptions, MarketCandleResponse } from "../src/lib/market-data/types.ts";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const { handleLocalEngineRequest } = await import("../scripts/local_engine.mts");

test("Yahoo fallback clamps partial hourly bars and daily bars to the real session close", () => {
  const krHourly = Math.floor(Date.parse("2026-07-10T06:00:00.000Z") / 1_000);
  const krDaily = Math.floor(Date.parse("2026-07-10T00:00:00.000Z") / 1_000);
  const usSummerHourly = Math.floor(Date.parse("2026-07-09T19:30:00.000Z") / 1_000);
  const usSummerDaily = Math.floor(Date.parse("2026-07-09T13:30:00.000Z") / 1_000);
  const usWinterDaily = Math.floor(Date.parse("2026-01-09T14:30:00.000Z") / 1_000);

  assert.equal(
    yahooCandleCloseTime(krHourly, "1h", "KOSPI"),
    Math.floor(Date.parse("2026-07-10T06:30:00.000Z") / 1_000),
  );
  assert.equal(
    yahooCandleCloseTime(krDaily, "1d", "KOSPI"),
    Math.floor(Date.parse("2026-07-10T06:30:00.000Z") / 1_000),
  );
  assert.equal(
    yahooCandleCloseTime(usSummerHourly, "1h", "US"),
    Math.floor(Date.parse("2026-07-09T20:00:00.000Z") / 1_000),
  );
  assert.equal(
    yahooCandleCloseTime(usSummerDaily, "1d", "US"),
    Math.floor(Date.parse("2026-07-09T20:00:00.000Z") / 1_000),
  );
  assert.equal(
    yahooCandleCloseTime(usWinterDaily, "1d", "US"),
    Math.floor(Date.parse("2026-01-09T21:00:00.000Z") / 1_000),
  );
});

type WorkspaceTestPayload = {
  symbol: string;
  analysisSymbol: string;
  requestedSymbol: string;
  dataSource: string;
  planMode?: string;
  currentPrice?: number;
  market: string;
  currency: string;
  analyses: {
    oneHour: { timeframe: string; latestClose: number | null; dataSource?: string };
    fourHour: { timeframe: string; latestClose: number | null } | null;
    daily: { timeframe: string; latestClose: number | null };
  };
  horizonPlans: Array<{
    entryPrice: number;
    status: string;
    planMode?: string;
    currentPrice?: number;
    managementState?: {
      state: string;
      currentPrice: number;
      averagePrice: number;
      invalidationPrice: number;
      reentryConfirmationPrice: number;
      actions: string[];
    } | null;
    basis: {
      timeframeLabel: string;
      support: number | null;
      quoteAt: string;
      dataSource?: string;
      weeklySma60?: number | null;
    };
    stop: { isBrokerStopEligible: boolean; price?: number | null };
    takeProfits?: Array<{ price: number }>;
  }>;
  warnings: string[];
  orderSubmissionAttempted: boolean;
};

const makeSnapshot = (
  symbol: string,
  timeframe: OfficialTimeframe,
  source: "upbit" | "toss" = "upbit",
): CandleSeriesSnapshot => {
  const seconds = timeframe === "1h"
    ? 3_600
    : timeframe === "4h"
      ? 14_400
      : timeframe === "1d"
        ? 86_400
        : 604_800;
  const nowSeconds = Math.floor(NOW.getTime() / 1_000);
  const base = nowSeconds - seconds * 3;
  return {
    symbol,
    sourceSymbol: source === "upbit" ? "KRW-BTC" : "005930",
    market: source === "upbit" ? "CRYPTO" : "KOSPI",
    currency: "KRW",
    dataSource: source,
    timeframe,
    sessionPolicy: source === "upbit" ? "continuous" : "regular",
    fetchedAt: NOW.toISOString(),
    quoteAt: new Date((base + seconds * 2) * 1_000).toISOString(),
    stale: false,
    candles: [
      {
        time: base,
        closeTime: base + seconds,
        open: 100,
        high: 104,
        low: 98,
        close: 102,
        volume: 150,
        isClosed: true,
        isPartialSessionBar: false,
      },
      {
        time: base + seconds,
        closeTime: base + seconds * 2,
        open: 102,
        high: 108,
        low: 101,
        close: 106,
        volume: 210,
        isClosed: true,
        isPartialSessionBar: false,
      },
      {
        time: nowSeconds,
        closeTime: nowSeconds + seconds,
        open: 106,
        high: 110,
        low: 105,
        close: 109,
        volume: 30,
        isClosed: false,
        isPartialSessionBar: false,
      },
    ],
    warnings: ["형성 중인 마지막 봉은 분석 계산에서 제외됩니다."],
  };
};

const fixtureOfficialProvider = (source: "upbit" | "toss" = "upbit") => {
  const calls: OfficialTimeframe[] = [];
  const provider: OfficialSeriesProvider = {
    loadSeries: async (symbol, timeframe) => {
      calls.push(timeframe);
      return makeSnapshot(symbol, timeframe, source);
    },
  };
  return { provider, calls };
};

const fixtureYahooProvider = () => {
  const calls: GetCandlesOptions["interval"][] = [];
  const getCandles = async (_symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse> => {
    calls.push(options.interval);
    const seconds = options.interval === "1h" ? 3_600 : options.interval === "1d" ? 86_400 : 604_800;
    const nowSeconds = Math.floor(NOW.getTime() / 1_000);
    return {
      timeZone: "Asia/Seoul",
      candles: [
        { time: nowSeconds - seconds * 3, open: 100, high: 104, low: 98, close: 102, volume: 150 },
        { time: nowSeconds - seconds * 2, open: 102, high: 108, low: 101, close: 106, volume: 210 },
        { time: nowSeconds - Math.floor(seconds / 2), open: 106, high: 110, low: 105, close: 109, volume: 30 },
      ],
    };
  };
  return { provider: { getCandles }, calls };
};

const fixtureAnalyze = async (options: {
  symbol: string;
  timeframe: OfficialTimeframe;
  days: number;
  marketData: { getCandles(symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse> };
  metadata: {
    market: string;
    currency: "KRW" | "USD";
    dataSource: string;
    quoteAt?: string | null;
    stale?: boolean;
  };
}) => {
  const period1 = new Date("2023-01-01T00:00:00.000Z");
  const period2 = NOW;
  const interval = options.timeframe === "4h" ? "1h" : options.timeframe;
  const [primary] = await Promise.all([
    options.marketData.getCandles(options.symbol, { period1, period2, interval }),
    options.marketData.getCandles(options.symbol, { period1, period2, interval: "1wk" }),
  ]);
  const expectedPrimaryCount = options.metadata.dataSource === "yahoo" && options.timeframe === "1d"
    ? 3
    : 2;
  assert.equal(
    primary.candles.length,
    expectedPrimaryCount,
    "형성 중인 봉은 제외하되 이미 마감된 일봉은 같은 날 포함해야 한다",
  );
  const latest = primary.candles.at(-1)!;
  return {
    symbol: options.symbol,
    market: options.metadata.market,
    currency: options.metadata.currency,
    dataSource: options.metadata.dataSource,
    timeframe: options.timeframe,
    quoteAt: options.metadata.quoteAt ?? new Date(latest.time * 1_000).toISOString(),
    generatedAt: NOW.toISOString(),
    stale: options.metadata.stale ?? false,
    candles: primary.candles,
    breakoutRule: { status: "breakout-ready" },
    tradeSetup: { failureLevel: options.timeframe === "1d" ? 91 : 99 },
    signalReliability: { grade: "medium" },
    analysisBasis: {
      atr14: options.timeframe === "1d" ? 4 : 2,
      sma20: 96,
      sma200: 80,
      tenMonthAverage: 82,
      hma20: 105,
      hma50: 100,
      adx14: 31,
      choppiness14: 48,
      volumeRatio20: 1.4,
      recentLow20: options.timeframe === "1d" ? 90 : 98,
      recentHigh20: 125,
      chandelierLong: 94,
      weeklySma20: 88,
      weeklySma60: 76,
      trendUp: true,
    },
  };
};

test("crypto workspace uses Upbit 1h/4h/1d fixtures and never submits an order", async () => {
  const upbit = fixtureOfficialProvider("upbit");
  let credentialReads = 0;
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=KRW-BTC&assetClass=crypto&source=auto",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      upbitProvider: upbit.provider,
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => {
        credentialReads += 1;
        return null;
      },
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.symbol, "KRW-BTC");
  assert.equal(payload.analysisSymbol, "BTC-USD");
  assert.equal(payload.requestedSymbol, "KRW-BTC");
  assert.equal(payload.dataSource, "upbit");
  assert.equal(payload.currency, "KRW");
  assert.equal(payload.analyses.oneHour.timeframe, "1h");
  assert.equal(payload.analyses.fourHour.timeframe, "4h");
  assert.equal(payload.analyses.daily.timeframe, "1d");
  assert.equal(payload.analyses.oneHour.latestClose, 106);
  assert.equal(payload.analyses.fourHour.latestClose, 106);
  assert.equal(payload.analyses.daily.latestClose, 106);
  assert.equal(payload.horizonPlans[0].basis.timeframeLabel, "4시간봉 방향 · 1시간봉 진입");
  assert.equal(payload.horizonPlans[1].basis.timeframeLabel, "일봉 방향 · 4시간봉 진입 · 1시간봉 재확인");
  assert.equal(payload.horizonPlans[1].basis.support, 91, "스윙 무효선은 tradeSetup.failureLevel을 사용해야 한다");
  assert.equal(payload.orderSubmissionAttempted, false);
  assert.ok(payload.horizonPlans.every((plan) => plan.stop.isBrokerStopEligible === false));
  assert.equal(credentialReads, 0, "Upbit public data must not require Toss credentials");
  assert.ok(upbit.calls.includes("1h"));
  assert.ok(upbit.calls.includes("4h"));
  assert.ok(upbit.calls.includes("1d"));
  assert.ok(upbit.calls.includes("1wk"));
});

test("stock auto source falls back to Yahoo and uses daily direction plus 1h entry", async () => {
  const yahoo = fixtureYahooProvider();
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=auto&entryPrice=107",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      yahooProvider: yahoo.provider,
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => null,
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.dataSource, "yahoo");
  assert.equal(payload.market, "KOSPI");
  assert.equal(payload.currency, "KRW");
  assert.equal(payload.analyses.fourHour, null);
  assert.equal(payload.horizonPlans[0].entryPrice, 107);
  assert.equal(payload.horizonPlans[0].basis.timeframeLabel, "일봉 위험 필터 · 1시간봉 진입");
  assert.equal(payload.horizonPlans[1].basis.timeframeLabel, "일봉 방향 · 1시간봉 진입");
  assert.ok(payload.warnings.some((warning: string) => warning.includes("Yahoo fallback")));
  assert.ok(payload.warnings.some((warning: string) => warning.includes("부분 4시간봉 왜곡")));
  assert.deepEqual(new Set(yahoo.calls), new Set(["1h", "1d", "1wk"]));
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("stock position management separates holding average from current market price", async () => {
  const yahoo = fixtureYahooProvider();
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=yahoo&entryPrice=120&planMode=position-management",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      yahooProvider: yahoo.provider,
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => null,
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;
  const long = payload.horizonPlans[2];

  assert.equal(response.status, 200);
  assert.equal(payload.planMode, "position-management");
  assert.equal(payload.currentPrice, 106);
  assert.equal(long.entryPrice, 120);
  assert.equal(long.currentPrice, 106);
  assert.equal(long.planMode, "position-management");
  assert.equal(long.managementState?.averagePrice, 120);
  assert.equal(long.managementState?.currentPrice, 106);
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("stock auto retries with Yahoo when configured Toss market data fails", async () => {
  const yahoo = fixtureYahooProvider();
  const clientId = "fixture-client";
  const clientSecret = "fixture-secret";
  const failingProvider: OfficialSeriesProvider = {
    loadSeries: async () => {
      throw new Error(`token request failed for ${clientId}:${clientSecret}`);
    },
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=auto",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      yahooProvider: yahoo.provider,
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => ({ clientId, clientSecret }),
      createTossProvider: () => failingProvider,
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.dataSource, "yahoo");
  assert.ok(payload.warnings.some((warning) => warning.includes("Toss 공식 시세 조회 실패")));
  assert.ok(payload.warnings.some((warning) => warning.includes("[REDACTED]")));
  assert.ok(payload.warnings.every((warning) => !warning.includes(clientId) && !warning.includes(clientSecret)));
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("stock auto supplements only an insufficient Toss hourly analysis with Yahoo", async () => {
  const toss = fixtureOfficialProvider("toss");
  const yahoo = fixtureYahooProvider();
  const analyze = async (options: Parameters<typeof fixtureAnalyze>[0]) => {
    const payload = await fixtureAnalyze(options);
    if (options.metadata.dataSource === "toss" && options.timeframe === "1h") {
      return {
        ...payload,
        analysisBasis: {
          ...payload.analysisBasis,
          atr14: null,
          closedCandleCount: 10,
        },
      };
    }
    return payload;
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=auto",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      createTossProvider: () => toss.provider,
      yahooProvider: yahoo.provider,
      analyze,
      loadTossCredentials: async () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }),
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.dataSource, "toss");
  assert.equal(payload.analyses.oneHour.dataSource, "yahoo");
  assert.equal(payload.horizonPlans[0].basis.dataSource, "yahoo+toss");
  assert.ok(payload.horizonPlans[0].stop);
  assert.ok(payload.warnings.some((warning) => warning.includes("해당 시간봉만 Yahoo")));
  assert.ok(yahoo.calls.includes("1h"));
  assert.ok(!yahoo.calls.includes("1d"));
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("stock auto supplements insufficient Toss long-history inputs with Yahoo daily data", async () => {
  const toss = fixtureOfficialProvider("toss");
  const yahoo = fixtureYahooProvider();
  const analyze = async (options: Parameters<typeof fixtureAnalyze>[0]) => {
    const payload = await fixtureAnalyze(options);
    if (options.metadata.dataSource === "toss" && options.timeframe === "1d") {
      return {
        ...payload,
        analysisBasis: { ...payload.analysisBasis, weeklySma60: null },
      };
    }
    return payload;
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=auto",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      createTossProvider: () => toss.provider,
      yahooProvider: yahoo.provider,
      analyze,
      loadTossCredentials: async () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }),
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.horizonPlans[2].basis.dataSource, "yahoo");
  assert.ok((payload.horizonPlans[2].basis.weeklySma60 ?? 0) > 0);
  assert.ok(payload.warnings.some((warning) => warning.includes("일봉만 Yahoo")));
  assert.ok(yahoo.calls.includes("1d"));
  assert.ok(!yahoo.calls.includes("1h"));
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("explicit Toss source keeps insufficient hourly inputs unavailable without Yahoo supplementation", async () => {
  const toss = fixtureOfficialProvider("toss");
  const yahoo = fixtureYahooProvider();
  const analyze = async (options: Parameters<typeof fixtureAnalyze>[0]) => {
    const payload = await fixtureAnalyze(options);
    if (options.metadata.dataSource === "toss" && options.timeframe === "1h") {
      return {
        ...payload,
        analysisBasis: { ...payload.analysisBasis, atr14: null, closedCandleCount: 10 },
      };
    }
    if (options.metadata.dataSource === "toss" && options.timeframe === "1d") {
      return {
        ...payload,
        analysisBasis: { ...payload.analysisBasis, weeklySma60: null },
      };
    }
    return payload;
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=toss",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      createTossProvider: () => toss.provider,
      yahooProvider: yahoo.provider,
      analyze,
      loadTossCredentials: async () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }),
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.horizonPlans[0].status, "unavailable");
  assert.equal(payload.horizonPlans[2].status, "wait");
  assert.ok((payload.horizonPlans[2].stop.price ?? 0) > 0);
  assert.deepEqual(yahoo.calls, []);
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("workspace requests 730 daily days for long-horizon indicators", async () => {
  const yahoo = fixtureYahooProvider();
  const requested: Array<{ timeframe: OfficialTimeframe; days: number }> = [];
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=AAPL&assetClass=stock&source=yahoo",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      yahooProvider: yahoo.provider,
      analyze: async (options) => {
        requested.push({ timeframe: options.timeframe, days: options.days });
        return fixtureAnalyze(options);
      },
      loadTossCredentials: async () => null,
    },
  });

  assert.equal(response.status, 200);
  assert.ok(requested.some((item) => item.timeframe === "1d" && item.days === 730));
});

test("a range-aware Yahoo fixture produces real 60-week inputs for the long plan", async () => {
  const provider = {
    getCandles: async (_symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse> => {
      const intervalSeconds = options.interval === "1h" ? 3_600 : options.interval === "1wk" ? 604_800 : 86_400;
      const count = options.interval === "1h" ? 160 : options.interval === "1wk" ? 104 : 730;
      const end = Math.floor(NOW.getTime() / 1_000) - intervalSeconds * 2;
      return {
        timeZone: "America/New_York",
        candles: Array.from({ length: count }, (_, index) => {
          const close = 200 - (count - index) * 0.05;
          return {
            time: end - intervalSeconds * (count - index),
            open: close - 0.4,
            high: close + 0.8,
            low: close - 0.8,
            close,
            volume: 100_000 + index * 100,
          };
        }),
      };
    },
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=AAPL&assetClass=stock&source=yahoo",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      yahooProvider: provider,
      loadTossCredentials: async () => null,
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;
  const longPlan = payload.horizonPlans[2];

  assert.equal(response.status, 200);
  assert.notEqual(longPlan.status, "unavailable", JSON.stringify(longPlan));
  assert.ok((longPlan.basis.weeklySma60 ?? 0) > 0);
  assert.ok((longPlan.stop.price ?? 0) > 0);
  assert.equal(longPlan.takeProfits?.length, 2);
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("stale 1h data blocks short horizons without blocking a fresh long plan", async () => {
  const provider: OfficialSeriesProvider = {
    loadSeries: async (symbol, timeframe) => ({
      ...makeSnapshot(symbol, timeframe, "toss"),
      stale: timeframe === "1h",
    }),
  };
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=toss",
  ), {
    userId: "fixture-user",
    dependencies: {
      now: () => NOW,
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }),
      createTossProvider: () => provider,
    },
  });
  const payload = await response.json() as WorkspaceTestPayload;

  assert.equal(response.status, 200);
  assert.equal(payload.horizonPlans[0].status, "wait");
  assert.equal(payload.horizonPlans[1].status, "wait");
  assert.equal(payload.horizonPlans[2].status, "actionable");
  assert.notEqual(
    payload.horizonPlans[0].basis.quoteAt,
    payload.horizonPlans[2].basis.quoteAt,
    "short and long plans should carry their own timeframe quote timestamps",
  );
});

test("explicit Toss source keeps provider failures fail-closed", async () => {
  const clientSecret = "fixture-secret";
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=toss",
  ), {
    userId: "fixture-user",
    dependencies: {
      analyze: fixtureAnalyze,
      loadTossCredentials: async () => ({ clientId: "fixture-client", clientSecret }),
      createTossProvider: () => ({
        loadSeries: async () => {
          throw new Error(`official candle error ${clientSecret}`);
        },
      }),
    },
  });
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.equal(payload.orderSubmissionAttempted, false);
  assert.ok(!String(payload.error).includes(clientSecret));
});

test("explicit Toss source fails safely without credentials", async () => {
  const response = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=toss",
  ), {
    userId: "fixture-user",
    dependencies: { loadTossCredentials: async () => null },
  });
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 409);
  assert.equal(payload.orderSubmissionAttempted, false);
  assert.match(String(payload.error), /자격증명/);
});

test("workspace rejects incompatible source and invalid entry price before data access", async () => {
  const incompatible = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=AAPL&assetClass=stock&source=upbit",
  ), { userId: "fixture-user" });
  const invalidEntry = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=KRW-BTC&assetClass=crypto&entryPrice=0",
  ), { userId: "fixture-user" });
  const unsupportedQuote = await handleMarketWorkspaceRequest(new Request(
    "http://127.0.0.1/api/local/analysis/workspace?symbol=BTC-ETH&assetClass=crypto&source=upbit",
  ), { userId: "fixture-user" });

  assert.equal(incompatible.status, 400);
  assert.equal(invalidEntry.status, 400);
  assert.equal(unsupportedQuote.status, 400);
  assert.match(String((await unsupportedQuote.json() as { error?: string }).error), /KRW 마켓/);
});

test("local engine wires the workspace route and validates it before network access", async () => {
  const response = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/analysis/workspace?symbol=005930.KS&assetClass=invalid",
  ));
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 400);
  assert.equal(payload.orderSubmissionAttempted, false);
});

test("local engine fixture mode returns stock and crypto workspaces without network credentials", async () => {
  const previous = process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE;
  process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE = "1";
  try {
    const [stockResponse, cryptoResponse] = await Promise.all([
      handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/analysis/workspace?symbol=005930.KS&assetClass=stock&source=auto",
      )),
      handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/analysis/workspace?symbol=KRW-BTC&assetClass=crypto&source=auto",
      )),
    ]);
    const stock = await stockResponse.json() as WorkspaceTestPayload;
    const crypto = await cryptoResponse.json() as WorkspaceTestPayload;

    assert.equal(stockResponse.status, 200);
    assert.equal(cryptoResponse.status, 200);
    assert.equal(stock.dataSource, "fixture");
    assert.equal(crypto.dataSource, "fixture");
    assert.equal(stock.symbol, "005930.KS");
    assert.equal(crypto.symbol, "KRW-BTC");
    assert.equal(crypto.analysisSymbol, "BTC-USD");
    assert.ok(stock.analyses.oneHour.latestClose);
    assert.ok(crypto.analyses.fourHour?.latestClose);
    assert.ok(stock.warnings.some((warning) => warning.includes("테스트 fixture")));
    assert.ok(crypto.warnings.some((warning) => warning.includes("테스트 fixture")));
    assert.equal(stock.orderSubmissionAttempted, false);
    assert.equal(crypto.orderSubmissionAttempted, false);
  } finally {
    if (previous === undefined) {
      delete process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE;
    } else {
      process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE = previous;
    }
  }
});
