import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";

await rm(join(process.cwd(), ".cache", "stock-analysis"), { recursive: true, force: true });
process.env.STOCK_ANALYSIS_STORAGE_ROOT = await mkdtemp(join(tmpdir(), "stock-analysis-local-engine-"));
process.env.STOCK_ANALYSIS_RUNTIME = "macos-local";
process.env.STOCK_ANALYSIS_DISABLE_MARKET_SNAPSHOT = "1";
process.env.STOCK_ANALYSIS_SIDECAR_BUILD_ID = "test-sidecar-build";
process.env.STOCK_ANALYSIS_SKIP_AUTO_READINESS = "1";
process.env.BROKER_CREDENTIAL_ENC_KEY = `test:${Buffer.alloc(32, 7).toString("base64")}`;

const { handleLocalEngineRequest, startLocalEngineServer } = await import("../scripts/local_engine.mts");
const {
  DEFAULT_OFFICIAL_NEWS_SOURCES,
  fetchOfficialNewsEvents,
  parseOfficialRss,
} = await import("../src/lib/local-engine/news.ts");
const { clearTossTokenCache } = await import("../src/lib/toss/client.ts");
const { LocalAutomationScheduler } = await import("../src/lib/automation/local-scheduler.ts");
const {
  beginLocalCryptoOrderSubmission,
  clearLocalCryptoLiveTradingBinding,
  getLocalCryptoLiveTradingSnapshot,
  markLocalCryptoOrderUnknown,
  reconcileLocalCryptoOrder,
  recordLocalCryptoOrderPreview,
  recordLocalCryptoRecoveryProof,
  setLocalCryptoAutomationLiveTrading,
  setLocalCryptoLiveTradingConsent,
  setLocalCryptoManualLiveTrading,
  verifyLocalCryptoReadiness,
} = await import("../src/lib/automation/local-crypto-live-trading.ts");
const { consentLocalLiveTrading, getLocalLiveTradingSnapshot, verifyLocalManualReadiness } = await import("../src/lib/automation/local-live-trading.ts");
const {
  getPaperTradingStorageRootForUser,
  readPaperTradingState,
  writePaperTradingState,
} = await import("../src/lib/paper-trading/state-store.ts");
const {
  WATCHLIST_MAX_ITEMS,
  summarizeWatchlistItems,
} = await import("../src/lib/local-engine/watchlist.ts");
const {
  clearInstrumentDisplayCache,
  resolveInstrumentDisplay,
} = await import("../src/lib/market/instrument-display.ts");
const {
  normalizeCryptoRealPortfolio,
  normalizeTossRealPortfolio,
} = await import("../src/lib/local-engine/real-portfolio.ts");

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });

const withMockFetch = async (
  responses: Response[],
  run: (calls: FetchCall[]) => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }
    return response;
  }) as typeof fetch;
  clearTossTokenCache();
  try {
    await run(calls);
  } finally {
    clearTossTokenCache();
    globalThis.fetch = originalFetch;
  }
};

test("local engine health returns sidecar metadata", async () => {
  const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/health"));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    ok?: boolean;
    engine?: string;
    version?: string;
    pid?: number;
    workingDirectory?: string;
    sidecarBuildId?: string;
    tossOpenApi?: { specVersion?: string; baseUrl?: string; requiredOperationCount?: number };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.engine, "stock-analysis-local-engine");
  const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version?: string };
  assert.equal(payload.version, packageJson.version);
  assert.equal(payload.pid, process.pid);
  assert.equal(payload.workingDirectory, process.cwd());
  assert.equal(payload.sidecarBuildId, "test-sidecar-build");
  assert.equal(payload.tossOpenApi?.specVersion, "1.2.2");
  assert.equal(payload.tossOpenApi?.baseUrl, "https://openapi.tossinvest.com");
  assert.ok((payload.tossOpenApi?.requiredOperationCount ?? 0) >= 20);
});

test("local engine exposes Toss OpenAPI contract metadata", async () => {
  const response = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/local/toss/openapi-contract"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    specVersion?: string;
    baseUrl?: string;
    requiredOperationCount?: number;
    accountHeaderOperationCount?: number;
    requiredOperations?: Array<{ path?: string; method?: string; accountHeader?: boolean }>;
  };
  assert.equal(payload.specVersion, "1.2.2");
  assert.equal(payload.baseUrl, "https://openapi.tossinvest.com");
  assert.ok((payload.requiredOperationCount ?? 0) >= 20);
  assert.ok((payload.accountHeaderOperationCount ?? 0) >= 8);
  assert.ok(payload.requiredOperations?.some((operation) =>
    operation.path === "/api/v1/orders" &&
    operation.method === "post" &&
    operation.accountHeader === true,
  ));
});

test("local engine rejects unsupported routes", async () => {
  const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/missing"));
  assert.equal(response.status, 404);
});

test("local engine exposes community sentiment through the sidecar contract", async () => {
  const response = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/community-pain/NVDA?market=US&sources=blind",
  ));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    symbol?: string;
    sentimentRegime?: string;
    lowEvidence?: boolean;
    sourceStats?: Array<{ id?: string; status?: string }>;
  };
  assert.equal(payload.symbol, "NVDA");
  assert.equal(payload.sentimentRegime, "low_evidence");
  assert.equal(payload.lowEvidence, true);
  assert.deepEqual(payload.sourceStats, [{
    id: "blind",
    label: "블라인드",
    policyStatus: "spike",
    status: "spike-only",
    confidenceWeight: 0.35,
    reason: "공개 웹 접근이 차단되어 자동 수집하지 않습니다.",
    candidateCount: 0,
    recentItemCount: 0,
    itemCount: 0,
    postCount: 0,
    commentItemCount: 0,
    replyCount: 0,
    dateParseCoverage: 0,
    timedOut: false,
  }]);
});

test("local engine rejects invalid community sentiment inputs", async () => {
  const missingSymbol = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/community-pain/%20?market=US&sources=blind",
  ));
  assert.equal(missingSymbol.status, 400);

  const invalidMarket = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/community-pain/NVDA?market=%40%40&sources=blind",
  ));
  assert.equal(invalidMarket.status, 400);
});

test("local engine community refresh bypasses a completed cache entry", async () => {
  const endpoint = "http://127.0.0.1:38771/api/community-pain/CACHE1?market=US&sources=blind";
  const firstResponse = await handleLocalEngineRequest(new Request(endpoint));
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json() as { generatedAt?: string };

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cachedResponse = await handleLocalEngineRequest(new Request(endpoint));
  const cached = await cachedResponse.json() as { generatedAt?: string };
  assert.equal(cached.generatedAt, first.generatedAt);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const refreshedResponse = await handleLocalEngineRequest(new Request(`${endpoint}&refresh=1`));
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json() as { generatedAt?: string };
  assert.notEqual(refreshed.generatedAt, first.generatedAt);
});

test("local engine searches Korean symbols with bilingual names", async () => {
  const response = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/symbol-search?q=%EC%82%BC%EC%84%B1&markets=KOSPI,KOSDAQ&limit=5",
  ));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    matches?: Array<{ symbol?: string; displaySymbol?: string; nameKo?: string; nameEn?: string }>;
  };
  assert.equal(payload.matches?.[0]?.symbol, "005930.KS");
  assert.equal(payload.matches?.[0]?.displaySymbol, "005930");
  assert.equal(payload.matches?.[0]?.nameKo, "삼성전자");
  assert.equal(payload.matches?.[0]?.nameEn, "Samsung Electronics");
});

test("instrument display prefers master names and keeps a safe fallback", async () => {
  clearInstrumentDisplayCache();
  const korea = await resolveInstrumentDisplay({ symbol: "005930.KS", market: "KR" });
  const unitedStates = await resolveInstrumentDisplay({ symbol: "AAPL", market: "US" });
  const stored = await resolveInstrumentDisplay({ symbol: "UNKNOWN", market: "US", storedName: "저장한 이름" });
  const unknown = await resolveInstrumentDisplay({ symbol: "ZZZZ", market: "US" });

  assert.equal(korea.code, "005930");
  assert.notEqual(korea.primaryName, "005930");
  assert.equal(unitedStates.code, "AAPL");
  assert.ok(unitedStates.primaryName.length > 0);
  assert.deepEqual(stored, { primaryName: "저장한 이름", code: "UNKNOWN", market: "US", source: "stored-name" });
  assert.deepEqual(unknown, { primaryName: "ZZZZ", code: "ZZZZ", market: "US", source: "symbol" });
});

test("local chart returns each requested candle timeframe without external data in fixture mode", async () => {
  const previousFixtureMode = process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE;
  process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE = "1";
  try {
    const stockResponse = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/chart?symbol=005930.KS&assetClass=stock&tf=15m",
    ));
    assert.equal(stockResponse.status, 200);
    const stock = await stockResponse.json() as {
      timeframe?: string;
      currency?: string;
      candles?: unknown[];
      indicators?: { sma?: Record<string, unknown[]>; rsi?: unknown[] };
      signals?: Array<{ time?: number; price?: number | null }>;
    };
    assert.equal(stock.timeframe, "15m");
    assert.equal(stock.currency, "KRW");
    assert.equal(stock.candles?.length, 180);
    assert.equal(stock.indicators?.sma?.["5"]?.length, 176);
    assert.equal(stock.indicators?.sma?.["20"]?.length, 161);
    assert.equal(stock.indicators?.sma?.["60"]?.length, 121);
    assert.equal(stock.indicators?.rsi?.length, 166);
    assert.ok(stock.signals?.every((signal) => typeof signal.time === "number" && "price" in signal));

    const cryptoResponse = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/chart?symbol=KRW-BTC&assetClass=crypto&tf=5m",
    ));
    assert.equal(cryptoResponse.status, 200);
    const crypto = await cryptoResponse.json() as {
      timeframe?: string;
      currency?: string;
      dataSource?: string;
      indicators?: { sma?: Record<string, unknown[]>; rsi?: unknown[] };
      signals?: unknown[];
      breakoutSignal?: unknown;
    };
    assert.equal(crypto.timeframe, "5m");
    assert.equal(crypto.currency, "KRW");
    assert.equal(crypto.dataSource, "fixture");
    assert.equal(crypto.indicators?.sma?.["60"]?.length, 121);
    assert.equal(crypto.indicators?.rsi?.length, 166);
    assert.deepEqual(crypto.signals, []);
    assert.equal(crypto.breakoutSignal, null);
  } finally {
    if (previousFixtureMode === undefined) delete process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE;
    else process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE = previousFixtureMode;
  }
});

test("local watchlist stores unique items, enforces its limit, and isolates summary failures", async () => {
  const create = async (payload: Record<string, unknown>) =>
    handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));

  const firstResponse = await create({ symbol: "005930", assetClass: "stock", market: "KR", name: "삼성전자" });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json() as { items?: Array<{ id?: string; symbol?: string }> };
  assert.equal(first.items?.[0]?.symbol, "005930.KS");
  const id = first.items?.[0]?.id;
  assert.ok(id);

  const duplicate = await create({ symbol: "005930.KS", assetClass: "stock", market: "KR" });
  assert.equal(duplicate.status, 201);
  assert.equal((await duplicate.json() as { items?: unknown[] }).items?.length, 1);

  for (let index = 1; index < WATCHLIST_MAX_ITEMS; index += 1) {
    const response = await create({ symbol: `ITEM${index}`, assetClass: "stock", market: "US" });
    assert.equal(response.status, 201);
  }
  const overLimit = await create({ symbol: "OVERLIMIT", assetClass: "stock", market: "US" });
  assert.equal(overLimit.status, 409);

  const summary = await summarizeWatchlistItems([
    { id: "stock-ok", symbol: "AAPL", name: "Apple", assetClass: "stock", market: "US", addedAt: "2026-07-11T00:00:00.000Z" },
    { id: "stock-fail", symbol: "FAIL", name: null, assetClass: "stock", market: "US", addedAt: "2026-07-11T00:00:00.000Z" },
    { id: "crypto-ok", symbol: "KRW-BTC", name: "Bitcoin", assetClass: "crypto", market: "CRYPTO", addedAt: "2026-07-11T00:00:00.000Z" },
  ], {
    now: () => new Date("2026-07-11T00:00:10.000Z"),
    getStockQuotes: async () => new Map([
      ["AAPL", { symbol: "AAPL", price: 200, changePercent: 1.5 }],
      ["FAIL", new Error("provider unavailable")],
    ]),
    getCryptoQuotes: async () => new Map([
      ["KRW-BTC", { price: 150_000_000, quoteAt: "2026-07-11T00:00:00.000Z" }],
    ]),
    getStockCandles: async (symbol) => {
      if (symbol === "FAIL") throw new Error("daily candles unavailable");
      return Array.from({ length: 220 }, (_, index) => ({
        time: 1_700_000_000 + index * 86_400,
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100 + index,
        volume: index === 219 ? 2_000 : 1_000,
      }));
    },
    getSentiment: async (item) => item.symbol === "AAPL" ? {
      label: "공포" as const,
      status: "ok" as const,
      painScore: 64,
      gajuaScore: 8,
      confidence: 72,
      evidenceCount: 18,
      generatedAt: "2026-07-11T00:00:00.000Z",
      error: null,
    } : {
      label: "근거 부족" as const,
      status: "low-evidence" as const,
      painScore: 0,
      gajuaScore: 0,
      confidence: 0,
      evidenceCount: 0,
      generatedAt: "2026-07-11T00:00:00.000Z",
      error: null,
    },
    getTossRanks: async () => new Map([
      ["AAPL", { rank: 4, rankedAt: "2026-07-11T00:00:00.000Z" }],
    ]),
  });
  assert.equal(summary[0]?.price, 200);
  assert.equal(summary[0]?.changePercent, 1.5);
  assert.equal(summary[1]?.error, "provider unavailable");
  assert.equal(summary[1]?.stale, true);
  assert.equal(summary[2]?.dataSource, "upbit");
  assert.equal(summary[2]?.currency, "KRW");
  assert.equal(summary[0]?.insights.technical.label, "상승 우세");
  assert.equal(summary[0]?.insights.sentiment.label, "공포");
  assert.equal(summary[0]?.insights.attention.label, "토스 체결 관심");
  assert.equal(summary[0]?.insights.attention.rank, 4);
  assert.equal(summary[1]?.insights.technical.label, "갱신 실패");
  assert.equal(summary[1]?.insights.sentiment.label, "근거 부족");
  assert.equal(summary[2]?.insights.sentiment.label, "지원 준비");
  assert.equal(summary[2]?.insights.attention.label, "지원 준비");

  const deleted = await handleLocalEngineRequest(new Request(
    `http://127.0.0.1:38771/api/local/watchlist/${id}`,
    { method: "DELETE" },
  ));
  assert.equal(deleted.status, 200);
});

test("watchlist insight falls back to volume attention when Toss ranking is unavailable", async () => {
  const items = await summarizeWatchlistItems([
    { id: "rate-limit", symbol: "RATELIMIT", name: "Rate Limit", assetClass: "stock", market: "US", addedAt: "2026-07-11T00:00:00.000Z" },
  ], {
    now: () => new Date("2026-07-11T00:00:10.000Z"),
    getStockQuotes: async () => new Map([["RATELIMIT", { symbol: "RATELIMIT", price: 200, changePercent: 1.5 }]]),
    getCryptoQuotes: async () => new Map(),
    getStockCandles: async () => Array.from({ length: 220 }, (_, index) => ({
      time: 1_700_000_000 + index * 86_400,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: index === 219 ? 2_000 : 1_000,
    })),
    getSentiment: async () => ({
      label: "Reddit 연결 필요" as const,
      status: "unavailable" as const,
      painScore: null,
      gajuaScore: null,
      confidence: null,
      evidenceCount: null,
      generatedAt: "2026-07-11T00:00:00.000Z",
      error: null,
    }),
    getTossRanks: async () => { throw new Error("rate-limit-exceeded"); },
  });

  assert.equal(items[0]?.insights.sentiment.label, "Reddit 연결 필요");
  assert.equal(items[0]?.insights.attention.source, "volume-ratio");
  assert.equal(items[0]?.insights.attention.label, "관심 높음");
});

test("local engine exposes fail-closed crypto exchange setup", async () => {
  const stateResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/crypto-exchanges",
  ));
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json() as {
    exchanges?: Array<{ exchange?: string; credential?: unknown; contract?: { baseUrl?: string } }>;
  };
  assert.deepEqual(state.exchanges?.map((item) => item.exchange), ["upbit", "bithumb"]);
  assert.equal(state.exchanges?.[0]?.credential, null);
  assert.equal(state.exchanges?.[0]?.contract?.baseUrl, "https://api.upbit.com");

  const readinessResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/readiness?market=KRW-BTC",
  ));
  assert.equal(readinessResponse.status, 200);
  const readiness = await readinessResponse.json() as {
    ready?: boolean;
    readonlyChecks?: Record<string, boolean>;
    orderSubmissionAttempted?: boolean;
  };
  assert.equal(readiness.ready, false);
  assert.equal(readiness.readonlyChecks?.ticker, false);
  assert.equal(readiness.readonlyChecks?.orderConstraints, false);
  assert.equal(readiness.orderSubmissionAttempted, false);

  const precheckResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/orders/precheck",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: "KRW-BTC", side: "buy", volume: 0.001, price: 100_000_000 }),
    },
  ));
  assert.equal(precheckResponse.status, 412);
  const precheck = await precheckResponse.json() as { orderSubmissionAttempted?: boolean };
  assert.equal(precheck.orderSubmissionAttempted, false);
});

test("real portfolio normalizes Toss multi-currency holdings without treating buying power as cash", () => {
  const provider = normalizeTossRealPortfolio([{
    account: { accountNo: "1234567890", accountSeq: 7, accountType: "BROKERAGE" },
    maskedAccount: "******7890",
    holdings: {
      marketValue: { krw: "125000", usd: "220" },
      profitLoss: { krw: "25000", usd: "20" },
      items: [{
        symbol: "005930",
        name: "삼성전자",
        marketCountry: "KR",
        currency: "KRW",
        quantity: "1",
        lastPrice: "125000",
        averagePurchasePrice: "100000",
        marketValue: { krw: "125000" },
        profitLoss: { krw: "25000" },
        cost: { krw: "100000" },
      }],
    },
    buyingPower: {
      KRW: { currency: "KRW", cashBuyingPower: "300000" },
      USD: { currency: "USD", cashBuyingPower: "75" },
    },
    openOrders: [],
    errors: [],
  }], "2026-07-11T00:00:00.000Z");
  assert.equal(provider.connectionStatus, "connected");
  assert.equal(provider.accounts[0]?.maskedAccount, "******7890");
  assert.equal(provider.accounts[0]?.balances[0]?.total, null);
  assert.equal(provider.accounts[0]?.balances[0]?.buyingPower, 300000);
  assert.equal(provider.positions[0]?.symbol, "005930");
  assert.equal(provider.positions[0]?.marketValue, 125000);
  assert.equal(provider.totalsByCurrency.find((total) => total.currency === "KRW")?.profitLoss, 25000);
});

test("real portfolio preserves locked crypto and unpriced assets", () => {
  const provider = normalizeCryptoRealPortfolio({
    exchange: "bithumb",
    accounts: [
      { currency: "KRW", balance: "50000", locked: "10000" },
      { currency: "BTC", balance: "0.01", locked: "0.002", avg_buy_price: "100000000", unit_currency: "KRW" },
      { currency: "NOQUOTE", balance: "3", locked: "1", avg_buy_price: "20", unit_currency: "KRW" },
    ],
    tickers: [{ market: "KRW-BTC", tradePrice: 120000000, timestamp: Date.now(), tradeTimestamp: null }],
    openOrders: [{
      orderId: "bithumb-order-1",
      clientOrderId: "client-1",
      market: "KRW-BTC",
      side: "bid",
      state: "wait",
      price: 110000000,
      volume: 0.001,
      executedVolume: 0,
    }],
    generatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.equal(provider.accounts[0]?.balances[0]?.total, 60000);
  assert.equal(provider.positions.find((position) => position.symbol === "KRW-BTC")?.lockedQuantity, 0.002);
  assert.equal(provider.positions.find((position) => position.symbol === "KRW-NOQUOTE")?.valuationSupported, false);
  assert.equal(provider.partial, true);
  assert.equal(provider.openOrders[0]?.clientOrderId, "client-1");
});

test("real portfolio endpoint is fail-closed and never attempts orders without credentials", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `real-portfolio-empty-${Date.now()}`;
  try {
    const response = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/portfolio/real?refresh=1",
    ));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      providers?: Array<{ provider?: string; connectionStatus?: string }>;
      orderSubmissionAttempted?: boolean;
    };
    assert.deepEqual(payload.providers?.map((provider) => provider.provider), ["toss", "upbit", "bithumb"]);
    assert.equal(payload.providers?.every((provider) => provider.connectionStatus === "disconnected"), true);
    assert.equal(payload.orderSubmissionAttempted, false);
    assert.doesNotMatch(JSON.stringify(payload), /clientSecret|secretKey|access_token|accountNo/);
  } finally {
    if (previousUserId === undefined) delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    else process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
  }
});

test("legacy QA approvals never migrate into live trading toggles", async () => {
  const root = process.env.STOCK_ANALYSIS_STORAGE_ROOT!;
  const directory = join(root, "automation-platform");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "local-crypto-live-trading.json"), JSON.stringify({
    policy: { installationId: "legacy-crypto", boundUserId: "legacy", boundExchange: "upbit", qaApprovedAt: new Date().toISOString(), manualEnabled: true },
    previews: [], attempts: [],
  }));
  await writeFile(join(directory, "local-live-trading.json"), JSON.stringify({
    version: 1,
    policy: { installationId: "legacy-toss", boundUserId: "legacy", boundAccountSeq: 1, manualQaApprovedAt: new Date().toISOString(), manualEnabled: true, automationEnabled: true },
    attempts: [],
  }));
  const [crypto, toss] = await Promise.all([
    getLocalCryptoLiveTradingSnapshot("upbit"),
    getLocalLiveTradingSnapshot(),
  ]);
  assert.equal(crypto.policy.readinessVerifiedAt, null);
  assert.equal(crypto.policy.manualEnabled, false);
  assert.equal(crypto.policy.automationEnabled, false);
  assert.equal(toss.policy.readinessVerifiedAt, null);
  assert.equal(toss.policy.manualEnabled, false);
  assert.equal(toss.policy.automationEnabled, false);
});

test("release mode hides developer QA endpoints", async () => {
  const previous = process.env.STOCK_ANALYSIS_DEVELOPER_MODE;
  delete process.env.STOCK_ANALYSIS_DEVELOPER_MODE;
  try {
    for (const path of ["/api/local/live-trading/qa", "/api/local/crypto-exchanges/upbit/live-trading/qa"]) {
      const response = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771${path}`, { method: "POST" }));
      assert.equal(response.status, 404);
    }
  } finally {
    if (previous === undefined) delete process.env.STOCK_ANALYSIS_DEVELOPER_MODE;
    else process.env.STOCK_ANALYSIS_DEVELOPER_MODE = previous;
  }
});

test("crypto credential registration records automatic read-only readiness without orders", async () => {
  const previousSkip = process.env.STOCK_ANALYSIS_SKIP_AUTO_READINESS;
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  delete process.env.STOCK_ANALYSIS_SKIP_AUTO_READINESS;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `auto-readiness-${Date.now()}`;
  const timestamp = Date.now();
  try {
    await withMockFetch([
      Response.json([{ currency: "KRW", balance: "1000000", locked: "0" }]),
      Response.json([{ currency: "KRW", balance: "1000000", locked: "0" }]),
      Response.json({ bid_fee: "0.0005", ask_fee: "0.0005", market: { bid: { min_total: "5000" }, ask: { min_total: "5000" } } }),
      Response.json([{ market: "KRW-BTC", trade_price: 100_000_000, timestamp }]),
      Response.json([{ market: "KRW-BTC", quote_currency: "KRW", tick_size: "1000" }]),
    ], async (calls) => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey: "auto-ready-access", secretKey: "auto-ready-secret" }),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json() as { readiness?: { ready?: boolean }; orderSubmissionAttempted?: boolean };
      assert.equal(payload.readiness?.ready, true);
      assert.equal(payload.orderSubmissionAttempted, false);
      assert.equal(calls.some((call) => call.init?.method === "POST"), false);
    });
    const state = await getLocalCryptoLiveTradingSnapshot("upbit");
    assert.ok(state.policy.readinessVerifiedAt);
    assert.equal(state.policy.manualEnabled, false);
    assert.equal(state.policy.automationEnabled, false);
  } finally {
    if (previousSkip === undefined) delete process.env.STOCK_ANALYSIS_SKIP_AUTO_READINESS;
    else process.env.STOCK_ANALYSIS_SKIP_AUTO_READINESS = previousSkip;
    if (previousUserId === undefined) delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    else process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
  }
});

test("Upbit readiness uses official tick size and response timestamp freshness", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-upbit-readiness-${Date.now()}`;
  const responseTimestamp = Date.now();
  try {
    await withMockFetch([
      Response.json([{ currency: "KRW", balance: "10000000", locked: "0" }]),
      Response.json([{ currency: "KRW", balance: "10000000", locked: "0" }]),
      Response.json({
        bid_fee: "0.0005",
        ask_fee: "0.0005",
        market: {
          id: "KRW-BTC",
          bid: { min_total: "5000" },
          ask: { min_total: "5000" },
        },
      }),
      Response.json([{
        market: "KRW-BTC",
        trade_price: 100_000_000,
        timestamp: responseTimestamp,
        trade_timestamp: responseTimestamp - 5 * 60 * 1_000,
      }]),
      Response.json([{
        market: "KRW-BTC",
        quote_currency: "KRW",
        tick_size: "1000",
        supported_levels: ["0", "10000"],
      }]),
    ], async (calls) => {
      const credentialResponse = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/credentials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessKey: "upbit-access", secretKey: "upbit-secret" }),
        },
      ));
      assert.equal(credentialResponse.status, 200);

      const readinessResponse = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/readiness?market=KRW-BTC",
      ));
      assert.equal(readinessResponse.status, 200);
      const readiness = await readinessResponse.json() as {
        ready?: boolean;
        ticker?: { fresh?: boolean; lastTradeTimestamp?: string | null };
        orderConstraints?: { bid?: { priceUnit?: number }; ask?: { priceUnit?: number } };
      };
      assert.equal(readiness.ready, true);
      assert.equal(readiness.ticker?.fresh, true);
      assert.ok(readiness.ticker?.lastTradeTimestamp);
      assert.equal(readiness.orderConstraints?.bid?.priceUnit, 1000);
      assert.equal(readiness.orderConstraints?.ask?.priceUnit, 1000);
      assert.ok(calls.some((call) => call.url.includes("/v1/orderbook/instruments?markets=KRW-BTC")));
    });
  } finally {
    if (previousUserId === undefined) delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    else process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
  }
});

test("Upbit manual live orders require automatic readiness and consent, persist before submit, and reconcile unknown results", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-upbit-live-${Date.now()}`;
  const responseTimestamp = Date.now();
  const accounts = [{ currency: "KRW", balance: "10000000", locked: "0" }];
  const chance = {
    bid_fee: "0.0005",
    ask_fee: "0.0005",
    market: {
      id: "KRW-BTC",
      bid: { min_total: "5000" },
      ask: { min_total: "5000" },
    },
  };
  const ticker = [{
    market: "KRW-BTC",
    trade_price: 100_000_000,
    timestamp: responseTimestamp,
    trade_timestamp: responseTimestamp,
  }];
  const instrument = [{
    market: "KRW-BTC",
    quote_currency: "KRW",
    tick_size: "1000",
    supported_levels: ["0", "10000"],
  }];
  const readonlyPrecheckResponses = () => [
    Response.json(accounts),
    Response.json(chance),
    Response.json(ticker),
    Response.json(instrument),
  ];
  const livePrecheckRequest = () => new Request(
    "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/orders/live-precheck",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: "KRW-BTC", side: "buy", volume: 0.001, price: 100_000_000 }),
    },
  );
  try {
    await withMockFetch([Response.json(accounts)], async () => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/credentials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessKey: "upbit-live-access", secretKey: "upbit-live-secret" }),
        },
      ));
      assert.equal(response.status, 200, await response.clone().text());
    });

    await verifyLocalCryptoReadiness({ userId: process.env.STOCK_ANALYSIS_LOCAL_USER_ID!, exchange: "upbit", bindingHash: "test-upbit-binding" });
    await withMockFetch([], async (calls) => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading/consent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "코인 실거래 위험을 확인했습니다" }),
        },
      ));
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json() as { liveTrading?: { policy?: { readinessVerifiedAt?: string | null; userConsentAt?: string | null; manualEnabled?: boolean } } };
      assert.ok(payload.liveTrading?.policy?.readinessVerifiedAt);
      assert.ok(payload.liveTrading?.policy?.userConsentAt);
      assert.equal(payload.liveTrading?.policy?.manualEnabled, false);
      assert.equal(calls.some((call) => call.init?.method === "POST"), false);
    });

    const enableResponse = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, confirmation: "코인 실거래 수동 주문 해제" }),
      },
    ));
    assert.equal(enableResponse.status, 200);

    await withMockFetch([Response.json(accounts)], async () => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/credentials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessKey: "upbit-live-access-replaced", secretKey: "upbit-live-secret-replaced" }),
        },
      ));
      assert.equal(response.status, 200);
    });
    const reRegisteredStateResponse = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading",
    ));
    const reRegisteredState = await reRegisteredStateResponse.json() as {
      liveTrading?: { effective?: boolean; policy?: { readinessVerifiedAt?: string | null; manualEnabled?: boolean } };
    };
    assert.equal(reRegisteredStateResponse.status, 200);
    assert.equal(reRegisteredState.liveTrading?.effective, false);
    assert.equal(reRegisteredState.liveTrading?.policy?.readinessVerifiedAt, null);
    assert.equal(reRegisteredState.liveTrading?.policy?.manualEnabled, false);

    await verifyLocalCryptoReadiness({ userId: process.env.STOCK_ANALYSIS_LOCAL_USER_ID!, exchange: "upbit", bindingHash: "test-upbit-binding-replaced" });
    await withMockFetch([], async () => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading/consent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "코인 실거래 위험을 확인했습니다" }),
        },
      ));
      assert.equal(response.status, 200);
    });
    const reEnableResponse = await handleLocalEngineRequest(new Request(
      "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, confirmation: "코인 실거래 수동 주문 해제" }),
      },
    ));
    assert.equal(reEnableResponse.status, 200);

    let preview: { id: string; confirmationText: string } | undefined;
    await withMockFetch(readonlyPrecheckResponses(), async (calls) => {
      const response = await handleLocalEngineRequest(livePrecheckRequest());
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        submitReady?: boolean;
        preview?: { id?: string; confirmationText?: string };
        orderSubmissionAttempted?: boolean;
      };
      assert.equal(payload.submitReady, true);
      assert.equal(payload.orderSubmissionAttempted, false);
      assert.ok(payload.preview?.id);
      assert.ok(payload.preview?.confirmationText);
      preview = payload.preview?.id && payload.preview.confirmationText
        ? { id: payload.preview.id, confirmationText: payload.preview.confirmationText }
        : undefined;
      assert.equal(calls.some((call) => call.url.endsWith("/v1/orders") && call.init?.method === "POST"), false);
    });
    assert.ok(preview);

    await withMockFetch([...readonlyPrecheckResponses(), Response.json({ uuid: "upbit-live-order-1", identifier: "ignored" }, { status: 201 })], async (calls) => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/orders/live-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previewId: preview?.id, confirmation: preview?.confirmationText }),
        },
      ));
      assert.equal(response.status, 201);
      const payload = await response.json() as { status?: string; orderSubmissionAttempted?: boolean; attempt?: { status?: string; brokerOrderId?: string } };
      assert.equal(payload.status, "submitted");
      assert.equal(payload.orderSubmissionAttempted, true);
      assert.equal(payload.attempt?.status, "submitted");
      assert.equal(payload.attempt?.brokerOrderId, "upbit-live-order-1");
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/orders") && call.init?.method === "POST").length, 1);
    });

    let unknownPreview: { id: string; confirmationText: string } | undefined;
    await withMockFetch(readonlyPrecheckResponses(), async () => {
      const response = await handleLocalEngineRequest(livePrecheckRequest());
      assert.equal(response.status, 200);
      const payload = await response.json() as { preview?: { id?: string; confirmationText?: string } };
      unknownPreview = payload.preview?.id && payload.preview.confirmationText
        ? { id: payload.preview.id, confirmationText: payload.preview.confirmationText }
        : undefined;
    });
    assert.ok(unknownPreview);

    await withMockFetch([...readonlyPrecheckResponses(), jsonResponse({ error: { name: "too_many_requests" } }, { status: 429 })], async (calls) => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/orders/live-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previewId: unknownPreview?.id, confirmation: unknownPreview?.confirmationText }),
        },
      ));
      assert.equal(response.status, 202);
      const payload = await response.json() as { status?: string; attempt?: { status?: string } };
      assert.equal(payload.status, "unknown");
      assert.equal(payload.attempt?.status, "unknown");
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/orders") && call.init?.method === "POST").length, 1);
    });

    await withMockFetch([Response.json({ uuid: "upbit-live-order-unknown", identifier: "reconciled" })], async (calls) => {
      const response = await handleLocalEngineRequest(new Request(
        "http://127.0.0.1:38771/api/local/crypto-exchanges/upbit/live-trading/reconcile",
        { method: "POST" },
      ));
      assert.equal(response.status, 200);
      const payload = await response.json() as { status?: string; attempt?: { status?: string; brokerOrderId?: string } };
      assert.equal(payload.status, "reconciled");
      assert.equal(payload.attempt?.status, "open");
      assert.equal(payload.attempt?.brokerOrderId, "upbit-live-order-unknown");
      assert.match(calls[0]?.url ?? "", /\/v1\/order\?identifier=/);
      assert.equal(calls[0]?.init?.method, "GET");
    });
  } finally {
    if (previousUserId === undefined) delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    else process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
  }
});

test("Bithumb manual live limit order uses the shared ledger and client_order_id", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-bithumb-live-${Date.now()}`;
  const accounts = [{ currency: "KRW", balance: "1000000", locked: "0" }];
  const chance = { bid_fee: "0.0004", ask_fee: "0.0004", market: { bid: { min_total: "5000", price_unit: "1000" }, ask: { min_total: "5000", price_unit: "1000" } } };
  const ticker = [{ market: "KRW-BTC", trade_price: 50_000_000, timestamp: Date.now() }];
  const precheckResponses = () => [Response.json(accounts), Response.json(chance), Response.json(ticker)];
  try {
    await withMockFetch([Response.json(accounts)], async () => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/credentials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey: "bithumb-live-access", secretKey: "bithumb-live-secret" }),
      }));
      assert.equal(response.status, 200);
    });
    await verifyLocalCryptoReadiness({ userId: process.env.STOCK_ANALYSIS_LOCAL_USER_ID, exchange: "bithumb", bindingHash: "test-bithumb-binding" });
    const consent = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/live-trading/consent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "코인 실거래 위험을 확인했습니다" }),
    }));
    assert.equal(consent.status, 200, await consent.clone().text());
    const enabled = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/live-trading", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, confirmation: "코인 실거래 수동 주문 해제" }),
    }));
    assert.equal(enabled.status, 200, await enabled.clone().text());
    let preview: { id: string; confirmationText: string } | undefined;
    await withMockFetch(precheckResponses(), async () => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/orders/live-precheck", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: "KRW-BTC", side: "buy", volume: 0.001, price: 50_000_000 }),
      }));
      const payload = await response.json() as { preview?: { id?: string; confirmationText?: string } };
      assert.equal(response.status, 200);
      assert.ok(payload.preview?.id && payload.preview.confirmationText);
      preview = { id: payload.preview.id, confirmationText: payload.preview.confirmationText };
    });
    await withMockFetch([...precheckResponses(), Response.json({ order_id: "bithumb-live-order-1", client_order_id: "bithumb-client" }, { status: 201 })], async (calls) => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/crypto-exchanges/bithumb/orders/live-submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview?.id, confirmation: preview?.confirmationText }),
      }));
      assert.equal(response.status, 201, await response.clone().text());
      const submitCall = calls.find((call) => call.url.endsWith("/v2/orders") && call.init?.method === "POST");
      assert.ok(submitCall);
      const body = JSON.parse(String(submitCall?.init?.body)) as Record<string, unknown>;
      assert.equal(body.order_type, "limit");
      assert.equal(typeof body.client_order_id, "string");
    });
  } finally {
    if (previousUserId === undefined) delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    else process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
  }
});

test("crypto automation unlock requires five exchange-confirmed manual orders and recovery proofs", async () => {
  const userId = `crypto-automation-policy-${Date.now()}`;
  const exchange = "bithumb" as const;
  await clearLocalCryptoLiveTradingBinding(exchange);
  await verifyLocalCryptoReadiness({ userId, exchange, bindingHash: "automation-binding" });
  await setLocalCryptoLiveTradingConsent({ userId, exchange, confirmation: "코인 실거래 위험을 확인했습니다" });
  await setLocalCryptoManualLiveTrading({ userId, exchange, enabled: true, confirmation: "코인 실거래 수동 주문 해제" });
  await assert.rejects(
    setLocalCryptoAutomationLiveTrading({ userId, exchange, enabled: true, confirmation: "코인 지정가 자동매매 해제" }),
    /수동 주문 5건/,
  );
  for (let index = 0; index < 5; index += 1) {
    const confirmationText = `manual-confirm-${index}`;
    const preview = await recordLocalCryptoOrderPreview({
      userId, exchange, market: "KRW-BTC", side: "sell", volume: 0.0001, price: 50_000_000,
      confirmationText, payloadHash: `hash-${index}`,
    });
    const { attempt } = await beginLocalCryptoOrderSubmission({ userId, exchange, previewId: preview.id, confirmation: confirmationText });
    await reconcileLocalCryptoOrder({ exchange, attemptId: attempt.id, brokerOrderId: `broker-${index}`, state: "open" });
  }
  await recordLocalCryptoRecoveryProof({ exchange, kind: "restart" });
  await recordLocalCryptoRecoveryProof({ exchange, kind: "kill-switch" });
  const enabled = await setLocalCryptoAutomationLiveTrading({ userId, exchange, enabled: true, confirmation: "코인 지정가 자동매매 해제" });
  assert.equal(enabled.policy.automationEnabled, true);
  assert.equal(enabled.policy.manualConfirmedOrderCount, 5);

  const preview = await recordLocalCryptoOrderPreview({
    userId, exchange, source: "automation", strategyKey: "strategy-1:buy-1",
    market: "KRW-BTC", side: "sell", volume: 0.0001, price: 50_000_000,
    confirmationText: "automation-confirm", payloadHash: "automation-hash",
  });
  const { attempt } = await beginLocalCryptoOrderSubmission({ userId, exchange, previewId: preview.id, confirmation: "automation-confirm" });
  await markLocalCryptoOrderUnknown(attempt.id, "timeout", exchange);
  const locked = await getLocalCryptoLiveTradingSnapshot(exchange);
  assert.equal(locked.policy.automationEnabled, false);
  assert.ok(locked.policy.unknownLock);
});

test("local engine server logs sanitized request status", async () => {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  const server = await startLocalEngineServer(0);
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/automation/health?clientSecret=hidden`);
    assert.equal(response.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      messages.some((message) => message.includes("[local-engine] GET /api/automation/health -> 200")),
      "server should log method, path, status, and duration",
    );
    assert.equal(
      messages.some((message) => message.includes("clientSecret=hidden")),
      false,
      "server should not log query strings",
    );
  } finally {
    console.log = originalLog;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("local engine persists continuous automation scheduler settings", async () => {
  const initialResponse = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/local/automation/scheduler"),
  );
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json() as {
    scheduler?: { enabled?: boolean; intervalSeconds?: number; lastStatus?: string };
  };
  assert.equal(initial.scheduler?.enabled, false);
  assert.equal(initial.scheduler?.intervalSeconds, 60);
  assert.equal(initial.scheduler?.lastStatus, "never");

  const invalidResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/automation/scheduler",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, intervalSeconds: 10 }),
    },
  ));
  assert.equal(invalidResponse.status, 400);

  const enabledResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/automation/scheduler",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, intervalSeconds: 90 }),
    },
  ));
  assert.equal(enabledResponse.status, 200);
  const enabled = await enabledResponse.json() as {
    scheduler?: { enabled?: boolean; intervalSeconds?: number; updatedBy?: string };
  };
  assert.equal(enabled.scheduler?.enabled, true);
  assert.equal(enabled.scheduler?.intervalSeconds, 90);
  assert.equal(enabled.scheduler?.updatedBy, "local-engine-api");

  const disabledResponse = await handleLocalEngineRequest(new Request(
    "http://127.0.0.1:38771/api/local/automation/scheduler",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, intervalSeconds: 90 }),
    },
  ));
  assert.equal(disabledResponse.status, 200);
});

test("continuous automation scheduler records cycles and prevents overlap", async () => {
  let releaseCycle: (() => void) | null = null;
  let cycleCalls = 0;
  const scheduler = new LocalAutomationScheduler(async () => {
    cycleCalls += 1;
    await new Promise<void>((resolve) => {
      releaseCycle = resolve;
    });
    return { status: "success", message: "paper 자동화 cycle 완료" };
  });
  try {
    await scheduler.configure(true, 30);
    const firstRun = scheduler.runNow("manual");
    const waitStartedAt = Date.now();
    while (cycleCalls === 0 && Date.now() - waitStartedAt < 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const overlapping = await scheduler.runNow("manual");
    assert.match(overlapping.lastMessage ?? "", /아직 실행 중/);
    assert.equal(cycleCalls, 1);
    releaseCycle?.();
    const completed = await firstRun;
    assert.equal(completed.lastStatus, "success");
    assert.equal(completed.lastMessage, "paper 자동화 cycle 완료");
    assert.ok(completed.lastStartedAt);
    assert.ok(completed.lastCompletedAt);
    assert.ok(completed.nextRunAt);
  } finally {
    scheduler.stop();
    await scheduler.configure(false, 30);
  }
});

test("local engine self-test reports app readiness without live submit", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-self-test-${Date.now()}`;
  const rss = `
    <rss><channel><item>
      <title>Federal Reserve issues FOMC rate policy statement</title>
      <link>https://www.federalreserve.gov/example-self-test</link>
      <pubDate>Tue, 07 Jul 2026 19:00:00 GMT</pubDate>
      <description>Monetary policy and inflation outlook.</description>
    </item></channel></rss>
  `;
  try {
    await withMockFetch([
      new Response(rss, { status: 200 }),
      new Response(rss, { status: 200 }),
      new Response(rss, { status: 200 }),
    ], async (calls) => {
      const response = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/self-test"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        overall?: string;
        summary?: { total?: number; pass?: number; warn?: number; fail?: number; blockingFailures?: number };
        checks?: Array<{ id?: string; status?: string; blocking?: boolean; summary?: string; action?: string }>;
      };
      assert.equal(payload.overall, "warn");
      assert.ok((payload.summary?.total ?? 0) >= 15);
      assert.ok((payload.summary?.pass ?? 0) >= 11);
      assert.equal(payload.summary?.fail, 0);
      assert.equal(payload.summary?.blockingFailures, 0);
      assert.ok(payload.checks?.some((check) => check.id === "official-news" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "market-analysis-action" && check.status === "warn"));
      assert.ok(payload.checks?.some((check) => check.id === "daily-briefing-action" && check.status === "warn"));
      assert.ok(payload.checks?.some((check) => check.id === "terminal-dashboard" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "paper-run-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "strategy-store" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "strategy-simulation-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "toss-openapi-contract" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "strategy-crud-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "strategy-edit-invalidation-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "strategy-backup-import-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "automation-enabled-strategy-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "automation-cycle-dry-run" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) => check.id === "order-sync-ledger" && check.status === "pass"));
      assert.ok(payload.checks?.some((check) =>
        check.id === "toss-readonly-precheck" &&
        check.status === "pass" &&
        /credential 없음/.test(check.summary ?? "") &&
        /주문 제출 없이/.test(check.action ?? "")
      ));
      assert.ok(payload.checks?.some((check) => check.id === "toss-live-gate" && check.status === "warn"));
      assert.equal(calls.length, DEFAULT_OFFICIAL_NEWS_SOURCES.length);
      assert.equal(JSON.stringify(payload).includes("test:"), false);
      const strategiesResponse = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/strategy-configs"),
      );
      const strategiesPayload = await strategiesResponse.json() as { configs?: Array<{ id?: string; name?: string }> };
      assert.equal(strategiesPayload.configs?.some((config) => config.id?.startsWith("self-test-magic-split-")), false);
    });
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine paper store stays under configured storage root", async () => {
  const configuredRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  assert.ok(configuredRoot);

  const storageRoot = getPaperTradingStorageRootForUser("local-macos-user");
  const relativePath = relative(configuredRoot, storageRoot);
  assert.equal(relativePath.startsWith(".."), false);
  assert.match(relativePath, /^paper-trading[\/\\]users[\/\\]local-macos-user$/);
  assert.equal(storageRoot.includes(`${process.cwd()}/.cache`), false);

  const { storagePath } = await readPaperTradingState(storageRoot);
  const stateRelativePath = relative(configuredRoot, storagePath);
  assert.equal(stateRelativePath.startsWith(".."), false);
  assert.match(stateRelativePath, /^paper-trading[\/\\]users[\/\\]local-macos-user[\/\\]state\.json$/);
});

test("local engine paper trading dry run does not persist state", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  const userId = `local-engine-paper-dry-run-${Date.now()}`;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = userId;
  try {
    const storageRoot = getPaperTradingStorageRootForUser(userId);
    const { state: before } = await readPaperTradingState(storageRoot);
    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: "US", source: "manual", dryRun: true }),
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      dryRun?: boolean;
      run?: { id?: string; session?: string };
      orders?: unknown[];
      executions?: unknown[];
      snapshotPath?: string | null;
      state?: unknown;
    };
    assert.equal(payload.dryRun, true);
    assert.equal(payload.run?.session, "US");
    assert.equal(payload.snapshotPath, null);
    assert.ok(Array.isArray(payload.orders));
    assert.ok(Array.isArray(payload.executions));

    const { state: after } = await readPaperTradingState(storageRoot);
    assert.deepEqual(after, before);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine submits selected OrderIntent to paper state", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  const userId = `local-engine-paper-order-intent-${Date.now()}`;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = userId;
  try {
    const storageRoot = getPaperTradingStorageRootForUser(userId);
    const { state: before } = await readPaperTradingState(storageRoot);
    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/order-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: "US",
        orderIntent: {
          id: "intent-zxorder",
          symbol: "ZXORDER",
          side: "buy",
          type: "limit",
          quantity: 4,
          limitPrice: 25.5,
          stopPrice: 23.1,
          currency: "USD",
        },
      }),
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      dryRun?: boolean;
      run?: { summary?: string; ordersCount?: number; executionsCount?: number };
      orders?: Array<{ symbol?: string; quantity?: number; price?: number; status?: string }>;
      executions?: unknown[];
      snapshotPath?: string | null;
      auditEntry?: { title?: string; orderIntentId?: string };
    };
    assert.equal(payload.dryRun, false);
    assert.match(payload.run?.summary ?? "", /ZXORDER/);
    assert.equal(payload.run?.ordersCount, 1);
    assert.equal(payload.run?.executionsCount, 1);
    assert.equal(payload.orders?.[0]?.symbol, "ZXORDER");
    assert.equal(payload.orders?.[0]?.quantity, 4);
    assert.equal(payload.orders?.[0]?.price, 25.5);
    assert.equal(payload.orders?.[0]?.status, "filled");
    assert.equal(payload.executions?.length, 1);
    assert.ok(payload.snapshotPath);
    assert.equal(payload.auditEntry?.title, "모의 주문 실행");
    assert.equal(payload.auditEntry?.orderIntentId, "intent-zxorder");

    const { state: after } = await readPaperTradingState(storageRoot);
    assert.equal(after.accounts.US.cash, before.accounts.US.cash - (4 * 25.5));
    assert.ok(after.positions.some((position) =>
      position.symbol === "ZXORDER" &&
      position.quantity === 4 &&
      position.averagePrice === 25.5,
    ));
    assert.ok(after.orders.some((order) => order.symbol === "ZXORDER"));

    const stateResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/paper-trading/state"),
    );
    assert.equal(stateResponse.status, 200);
    const statePayload = await stateResponse.json() as {
      repaired?: boolean;
      storagePath?: string;
      state?: {
        positions?: Array<{ symbol?: string; quantity?: number }>;
        orders?: Array<{ symbol?: string; status?: string }>;
      };
    };
    assert.equal(statePayload.repaired, false);
    assert.ok(statePayload.storagePath?.endsWith("state.json"));
    assert.ok(statePayload.state?.positions?.some((position) =>
      position.symbol === "ZXORDER" &&
      position.quantity === 4,
    ));
    assert.ok(statePayload.state?.orders?.some((order) =>
      order.symbol === "ZXORDER" &&
      order.status === "filled",
    ));

    const dashboardResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/dashboard/terminal?symbol=ZXORDER&session=US"),
    );
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json() as {
      auditTrail?: Array<{ title?: string }>;
      replayEvents?: Array<{ kind?: string; title?: string }>;
    };
    assert.ok(dashboard.auditTrail?.some((entry) => entry.title === "모의 주문 실행"));
    assert.ok(dashboard.replayEvents?.some((event) => event.kind === "paper-order"));
    assert.ok(dashboard.replayEvents?.some((event) => event.kind === "paper-execution"));
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine resets paper trading state", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  const userId = `local-engine-paper-reset-${Date.now()}`;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = userId;
  try {
    const storageRoot = getPaperTradingStorageRootForUser(userId);
    const orderResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/order-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: "US",
        orderIntent: {
          id: "intent-reset",
          symbol: "ZXRESET",
          side: "buy",
          type: "limit",
          quantity: 3,
          limitPrice: 12.5,
          stopPrice: 11.2,
          currency: "USD",
        },
      }),
    }));
    assert.equal(orderResponse.status, 200);

    const { state: changed } = await readPaperTradingState(storageRoot);
    assert.ok(changed.positions.some((position) => position.symbol === "ZXRESET"));
    assert.ok(changed.orders.some((order) => order.symbol === "ZXRESET"));

    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/reset", {
      method: "POST",
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      reset?: boolean;
      repaired?: boolean;
      storagePath?: string;
      state?: {
        accounts?: {
          US?: { cash?: number };
          KR?: { cash?: number };
        };
        positions?: unknown[];
        orders?: unknown[];
        executions?: unknown[];
      };
    };
    assert.equal(payload.reset, true);
    assert.equal(payload.repaired, false);
    assert.ok(payload.storagePath?.endsWith("state.json"));
    assert.equal(payload.state?.accounts?.US?.cash, 10_000);
    assert.equal(payload.state?.accounts?.KR?.cash, 10_000_000);
    assert.deepEqual(payload.state?.positions, []);
    assert.deepEqual(payload.state?.orders, []);
    assert.deepEqual(payload.state?.executions, []);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine automation dry run reports readiness without Toss network", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-automation-dry-run-${Date.now()}`;
  try {
    await withMockFetch([], async (calls) => {
      let strategyId: string | undefined;
      try {
        const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        }));
        assert.equal(response.status, 200);
        const payload = await response.json() as {
          dryRun?: boolean;
          result?: {
            status?: string;
            reason?: string;
            liveTradingEnabled?: boolean;
            strategies?: number;
            triggers?: number;
            orders?: number;
            submitted?: number;
            blocked?: number;
            evaluations?: unknown[];
          };
        };
        assert.equal(payload.dryRun, true);
        assert.equal(payload.result?.status, "skipped");
        assert.equal(payload.result?.reason, "no-enabled-strategies");
        assert.equal(payload.result?.liveTradingEnabled, false);
        assert.equal(payload.result?.strategies, 0);
        assert.equal(payload.result?.triggers, 0);
        assert.equal(payload.result?.orders, 0);
        assert.equal(payload.result?.submitted, 0);
        assert.deepEqual(payload.result?.evaluations, []);

        const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "ZXAUTO 자동화 dry-run 전략",
            symbol: "ZXAUTO",
            market: "US",
            preset: "magic-split",
            mode: "percent-grid",
            currentPrice: 99,
            grid: {
              basePrice: 100,
              rungs: [
                { index: 1, buyDropPct: 1, sellRisePct: 1, notional: 1000 },
                { index: 2, buyDropPct: 2, sellRisePct: 1.2, notional: 1000 },
              ],
            },
            riskLimits: {
              maxDailyBuys: 4,
              maxDailySells: 4,
              maxPositionValue: 2500,
              maxLossPct: 10,
              maxHoldHours: 8760,
            },
            exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
          }),
        }));
        assert.equal(createResponse.status, 201);
        const created = await createResponse.json() as { config?: { id?: string } };
        strategyId = created.config?.id;
        assert.ok(strategyId);

        const simulateResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/simulate`, {
          method: "POST",
        }));
        assert.equal(simulateResponse.status, 200);

        const enableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "enabled" }),
        }));
        assert.equal(enableResponse.status, 200);

        const activeResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        }));
        assert.equal(activeResponse.status, 200);
        const activePayload = await activeResponse.json() as {
          dryRun?: boolean;
          result?: {
            status?: string;
            reason?: string;
            liveTradingEnabled?: boolean;
            strategies?: number;
            triggers?: number;
            orders?: number;
            submitted?: number;
            blocked?: number;
            evaluations?: Array<{
              symbol?: string;
              triggers?: number;
              orders?: Array<{ status?: string; message?: string }>;
              summary?: { headline?: string; blockedOrders?: number };
            }>;
          };
        };
        assert.equal(activePayload.dryRun, true);
        assert.equal(activePayload.result?.status, "preview");
        assert.equal(activePayload.result?.reason, "paper-preview-no-credentials");
        assert.equal(activePayload.result?.liveTradingEnabled, false);
        assert.equal(activePayload.result?.strategies, 1);
        assert.equal(activePayload.result?.triggers, 1);
        assert.equal(activePayload.result?.orders, 1);
        assert.equal(activePayload.result?.submitted, 0);
        assert.equal(activePayload.result?.blocked, 1);
        assert.equal(activePayload.result?.evaluations?.length, 1);
        assert.equal(activePayload.result?.evaluations?.[0]?.symbol, "ZXAUTO");
        assert.equal(activePayload.result?.evaluations?.[0]?.triggers, 1);
        assert.equal(activePayload.result?.evaluations?.[0]?.orders?.[0]?.status, "blocked");
        assert.match(activePayload.result?.evaluations?.[0]?.orders?.[0]?.message ?? "", /실거래 비활성/);
        assert.equal(activePayload.result?.evaluations?.[0]?.summary?.blockedOrders, 1);

        const actualResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }));
        assert.equal(actualResponse.status, 200);
        const actualPayload = await actualResponse.json() as {
          result?: {
            status?: string;
            reason?: string;
            liveTradingEnabled?: boolean;
            strategies?: number;
            triggers?: number;
            submitted?: number;
            newFills?: number;
            safety?: string;
          };
        };
        assert.equal(actualPayload.result?.status, "ran");
        assert.equal(actualPayload.result?.reason, "paper-automation-no-credentials");
        assert.equal(actualPayload.result?.liveTradingEnabled, false);
        assert.equal(actualPayload.result?.strategies, 1);
        assert.equal(actualPayload.result?.triggers, 1);
        assert.equal(actualPayload.result?.submitted, 1);
        assert.equal(actualPayload.result?.newFills, 1);
        assert.match(actualPayload.result?.safety ?? "", /모의 계좌/);
        assert.equal(calls.length, 0);
      } finally {
        if (strategyId) {
          await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
            method: "DELETE",
          }));
        }
      }
    });
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine exposes manual order sync without submitting broker orders", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-order-sync-${Date.now()}`;
  try {
    const snapshotResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/local/orders/sync"),
    );
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json() as {
      summary?: { orders?: number; openOrders?: number; fills?: number };
      orders?: unknown[];
      fills?: unknown[];
    };
    assert.equal(snapshot.summary?.orders, 0);
    assert.equal(snapshot.summary?.openOrders, 0);
    assert.equal(snapshot.summary?.fills, 0);
    assert.deepEqual(snapshot.orders, []);
    assert.deepEqual(snapshot.fills, []);

    await withMockFetch([], async (calls) => {
      const syncResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }));
      assert.equal(syncResponse.status, 200);
      const payload = await syncResponse.json() as {
        status?: string;
        reason?: string;
        synced?: number;
        updates?: number;
        newFills?: number;
        logs?: unknown[];
        summary?: { orders?: number; openOrders?: number; fills?: number };
      };
      assert.equal(payload.status, "skipped");
      assert.equal(payload.reason, "no-credentials");
      assert.equal(payload.synced, 0);
      assert.equal(payload.updates, 0);
      assert.equal(payload.newFills, 0);
      assert.deepEqual(payload.logs, []);
      assert.equal(payload.summary?.orders, 0);
      assert.equal(payload.summary?.openOrders, 0);
      assert.equal(payload.summary?.fills, 0);
      assert.equal(calls.length, 0);
    });
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine cleans stale internal self-test strategies before automation", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-self-test-cleanup-${Date.now()}`;
  try {
    const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "self-test-magic-split-stale",
        name: "Self-test 순환분할 3차",
        symbol: "NVDA",
        market: "US",
        preset: "magic-split",
        mode: "percent-grid",
        currentPrice: 204,
        grid: {
          basePrice: 204,
          rungs: [
            { index: 1, buyDropPct: 1, sellRisePct: 1.2, notional: 500 },
            { index: 2, buyDropPct: 3, sellRisePct: 1.6, notional: 700 },
            { index: 3, buyDropPct: 5, sellRisePct: 2, notional: 900 },
          ],
        },
        riskLimits: {
          maxDailyBuys: 3,
          maxDailySells: 3,
          maxPositionValue: 2500,
          maxLossPct: 12,
          maxHoldHours: 120,
        },
        exitRules: { takeProfitPct: 4, stopLossPct: 8, rescueMode: "disable-only" },
      }),
    }));
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { config?: { id?: string; name?: string } };
    const strategyId = created.config?.id;
    assert.ok(strategyId);
    assert.equal(created.config?.name, "Self-test 순환분할 3차");

    const simulateResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/simulate`, {
      method: "POST",
    }));
    assert.equal(simulateResponse.status, 200);

    const enableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "enabled" }),
    }));
    assert.equal(enableResponse.status, 200);

    const cycleResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    }));
    assert.equal(cycleResponse.status, 200);
    const cycle = await cycleResponse.json() as { result?: { strategies?: number; reason?: string; evaluations?: unknown[] } };
    assert.equal(cycle.result?.strategies, 0);
    assert.equal(cycle.result?.reason, "no-enabled-strategies");
    assert.deepEqual(cycle.result?.evaluations, []);

    const listResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/local/strategy-configs"),
    );
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json() as { configs?: Array<{ id?: string; name?: string }> };
    assert.equal(list.configs?.some((config) => config.id?.startsWith("self-test-") || config.name?.startsWith("Self-test ")), false);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine persists kill switch and blocks local execution endpoints", async () => {
  const configuredRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  assert.ok(configuredRoot);
  try {
    const engageResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/kill-switch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engaged: true, reason: "테스트 긴급 중지", updatedBy: "test" }),
    }));
    assert.equal(engageResponse.status, 200);
    const engaged = await engageResponse.json() as {
      killSwitch?: { engaged?: boolean; reason?: string | null; updatedBy?: string; blocks?: string[] };
    };
    assert.equal(engaged.killSwitch?.engaged, true);
    assert.equal(engaged.killSwitch?.reason, "테스트 긴급 중지");
    assert.equal(engaged.killSwitch?.updatedBy, "test");
    assert.deepEqual(engaged.killSwitch?.blocks, ["paper-trading", "automation-cycle"]);

    const storeText = await readFile(join(configuredRoot, "automation-platform", "kill-switch.json"), "utf8");
    assert.match(storeText, /테스트 긴급 중지/);

    const getResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/kill-switch"));
    assert.equal(getResponse.status, 200);
    const current = await getResponse.json() as { killSwitch?: { engaged?: boolean } };
    assert.equal(current.killSwitch?.engaged, true);

    const paperResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: "US", source: "manual" }),
    }));
    assert.equal(paperResponse.status, 423);
    const paperPayload = await paperResponse.json() as { error?: string; killSwitch?: { engaged?: boolean } };
    assert.match(paperPayload.error ?? "", /긴급 중지/);
    assert.equal(paperPayload.killSwitch?.engaged, true);

    const paperIntentResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/order-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: "US",
        orderIntent: {
          symbol: "ZXKILL",
          side: "buy",
          type: "limit",
          quantity: 1,
          limitPrice: 10,
          currency: "USD",
        },
      }),
    }));
    assert.equal(paperIntentResponse.status, 423);
    const paperIntentPayload = await paperIntentResponse.json() as { error?: string; killSwitch?: { engaged?: boolean } };
    assert.match(paperIntentPayload.error ?? "", /긴급 중지/);
    assert.equal(paperIntentPayload.killSwitch?.engaged, true);

    const automationResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    assert.equal(automationResponse.status, 423);
    const automationPayload = await automationResponse.json() as { error?: string; killSwitch?: { engaged?: boolean } };
    assert.match(automationPayload.error ?? "", /긴급 중지/);
    assert.equal(automationPayload.killSwitch?.engaged, true);
  } finally {
    const releaseResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/kill-switch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engaged: false, updatedBy: "test" }),
    }));
    assert.equal(releaseResponse.status, 200);
  }
});

test("local engine persists worker pause and blocks automation cycles", async () => {
  const configuredRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  assert.ok(configuredRoot);
  try {
    const pauseResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/worker-control", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true, reason: "테스트 워커 일시중지", updatedBy: "test" }),
    }));
    assert.equal(pauseResponse.status, 200);
    const paused = await pauseResponse.json() as {
      workerControl?: { paused?: boolean; reason?: string | null; updatedBy?: string };
    };
    assert.equal(paused.workerControl?.paused, true);
    assert.equal(paused.workerControl?.reason, "테스트 워커 일시중지");
    assert.equal(paused.workerControl?.updatedBy, "test");

    const storeText = await readFile(join(configuredRoot, "automation-platform", "worker-control.json"), "utf8");
    assert.match(storeText, /테스트 워커 일시중지/);

    const getResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/worker-control"));
    assert.equal(getResponse.status, 200);
    const current = await getResponse.json() as { workerControl?: { paused?: boolean } };
    assert.equal(current.workerControl?.paused, true);

    const automationResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    assert.equal(automationResponse.status, 423);
    const automationPayload = await automationResponse.json() as { error?: string; workerControl?: { paused?: boolean } };
    assert.match(automationPayload.error ?? "", /워커 일시중지/);
    assert.equal(automationPayload.workerControl?.paused, true);
  } finally {
    const resumeResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/worker-control", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: false, updatedBy: "test" }),
    }));
    assert.equal(resumeResponse.status, 200);
  }
});

test("local engine exposes empty local broker credential state", async () => {
  const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials"));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    credential?: unknown;
    accounts?: unknown[];
    accountPreference?: unknown;
    accountsError?: string | null;
  };
  assert.equal(payload.credential, null);
  assert.deepEqual(payload.accounts, []);
  assert.equal(payload.accountPreference, null);
  assert.equal(payload.accountsError, null);
});

test("local engine exposes Toss readiness fail-closed without credentials", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-toss-readiness-empty-${Date.now()}`;
  try {
    await withMockFetch([], async (calls) => {
      const response = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/toss/readiness?symbol=NVDA"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        ok?: boolean;
        status?: string;
        orderSubmissionAttempted?: boolean;
        accountHeaderVerified?: boolean;
        credentials?: { present?: boolean };
        automationReady?: boolean;
        guidance?: string[];
      };
      assert.equal(payload.ok, false);
      assert.equal(payload.status, "credential-missing");
      assert.equal(payload.orderSubmissionAttempted, false);
      assert.equal(payload.accountHeaderVerified, false);
      assert.equal(payload.credentials?.present, false);
      assert.equal(payload.automationReady, false);
      assert.ok(payload.guidance?.some((entry) => entry.includes("주문 생성")));
      assert.equal(calls.length, 0);
    });
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine Toss readiness uses stored credentials for read-only account checks", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-toss-readiness-ready-${Date.now()}`;
  try {
    await withMockFetch([
      jsonResponse({ access_token: "test-access-token-readiness", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({
        result: [
          {
            accountNo: "1234567890",
            accountSeq: 77,
            accountType: "BROKERAGE",
          },
        ],
      }),
      jsonResponse({
        result: [
          {
            accountNo: "1234567890",
            accountSeq: 77,
            accountType: "BROKERAGE",
          },
        ],
      }),
      jsonResponse({ result: { items: [] } }),
      jsonResponse({ result: { orders: [], nextCursor: null, hasNext: false } }),
    ], async (calls) => {
      const credentialResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "readiness-client", clientSecret: "readiness-secret" }),
      }));
      assert.equal(credentialResponse.status, 200);

      const readinessResponse = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/toss/readiness?symbol=NVDA"),
      );
      assert.equal(readinessResponse.status, 200);
      const payload = await readinessResponse.json() as {
        ok?: boolean;
        status?: string;
        orderSubmissionAttempted?: boolean;
        accountHeaderVerified?: boolean;
        selectedAccount?: { accountSeq?: number; accountNoMasked?: string };
        readonlyChecks?: { token?: boolean; accounts?: boolean; holdings?: boolean; openOrders?: boolean };
        automationAccountSelected?: boolean;
        automationReady?: boolean;
      };
      assert.equal(payload.ok, true);
      assert.equal(payload.status, "account-ready");
      assert.equal(payload.orderSubmissionAttempted, false);
      assert.equal(payload.accountHeaderVerified, true);
      assert.equal(payload.selectedAccount?.accountSeq, 77);
      assert.equal(payload.selectedAccount?.accountNoMasked, "****-7890");
      assert.equal(payload.readonlyChecks?.token, true);
      assert.equal(payload.readonlyChecks?.accounts, true);
      assert.equal(payload.readonlyChecks?.holdings, true);
      assert.equal(payload.readonlyChecks?.openOrders, true);
      assert.equal(payload.automationAccountSelected, true);
      assert.equal(payload.automationReady, true);

      assert.equal(calls.length, 5);
      assert.match(calls[0]?.url ?? "", /\/oauth2\/token$/);
      assert.match(calls[1]?.url ?? "", /\/api\/v1\/accounts$/);
      assert.match(calls[2]?.url ?? "", /\/api\/v1\/accounts$/);
      assert.match(calls[3]?.url ?? "", /\/api\/v1\/holdings\?symbol=NVDA$/);
      assert.equal((calls[3]?.init?.headers as Record<string, string>)["X-Tossinvest-Account"], "77");
      assert.match(calls[4]?.url ?? "", /\/api\/v1\/orders\?status=OPEN&symbol=NVDA$/);
      assert.equal((calls[4]?.init?.headers as Record<string, string>)["X-Tossinvest-Account"], "77");
      assert.equal(calls.some((call) => call.url.endsWith("/api/v1/orders") && call.init?.method === "POST"), false);
    });
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine exposes local broker diagnostics without secrets", async () => {
  const previousSkipEgress = process.env.STOCK_ANALYSIS_SKIP_EGRESS_CHECK;
  const previousEgressOverride = process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE;
  const previousLiveTrading = process.env.ENABLE_LIVE_TRADING;
  delete process.env.STOCK_ANALYSIS_SKIP_EGRESS_CHECK;
  delete process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE;
  delete process.env.ENABLE_LIVE_TRADING;
  try {
    await withMockFetch([], async (calls) => {
      const response = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/broker/diagnostics"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        credential?: unknown;
        egress?: { status?: string; ip?: string | null; message?: string };
        liveGate?: {
          enableLiveTrading?: boolean;
          credentialEncryptionConfigured?: boolean;
          accountPreferenceSelected?: boolean;
          liveTradingEffective?: boolean;
          rawLiveTradingEffective?: boolean;
          gateStatus?: number;
          gateReason?: string | null;
          killSwitchEngaged?: boolean;
          workerPaused?: boolean;
          automationQueueReady?: boolean;
        };
        readinessItems?: Array<{ id?: string; status?: string }>;
        guidance?: string[];
      };
      assert.equal(payload.credential, null);
      assert.equal(payload.egress?.status, "not-requested");
      assert.equal(payload.egress?.ip, null);
      assert.match(payload.egress?.message ?? "", /버튼/);
      assert.equal(calls.length, 0);
      assert.equal(payload.liveGate?.enableLiveTrading, false);
      assert.equal(payload.liveGate?.credentialEncryptionConfigured, true);
      assert.equal(payload.liveGate?.accountPreferenceSelected, false);
      assert.equal(payload.liveGate?.liveTradingEffective, false);
      assert.equal(payload.liveGate?.rawLiveTradingEffective, false);
      assert.equal(payload.liveGate?.gateStatus, 423);
      assert.match(payload.liveGate?.gateReason ?? "", /Toss API 키|선택.*계좌/);
      assert.equal(payload.liveGate?.killSwitchEngaged, false);
      assert.equal(payload.liveGate?.workerPaused, false);
      assert.equal(payload.liveGate?.automationQueueReady, false);
      assert.ok(payload.readinessItems?.some((item) => item.id === "broker-credential-status"));
      assert.ok(payload.guidance?.some((entry) => entry.includes("허용 IP")));
      assert.ok(payload.guidance?.some((entry) => entry.includes("긴급 중지")));
      assert.ok(payload.guidance?.some((entry) => entry.includes("워커")));
      assert.equal(JSON.stringify(payload).includes("test:"), false);
    });

    await withMockFetch([
      jsonResponse({ ip: "203.0.113.10" }),
    ], async (calls) => {
      const response = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/broker/diagnostics?includeEgress=1"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        egress?: { status?: string; ip?: string | null; message?: string };
      };
      assert.equal(payload.egress?.status, "checked");
      assert.equal(payload.egress?.ip, "203.0.113.10");
      assert.match(payload.egress?.message ?? "", /허용 IP/);
      assert.equal(calls.length, 1);
      assert.match(calls[0]?.url ?? "", /api\.ipify\.org/);
    });

    process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE = "198.51.100.42";
    await withMockFetch([], async (calls) => {
      const response = await handleLocalEngineRequest(
        new Request("http://127.0.0.1:38771/api/local/broker/diagnostics?includeEgress=1"),
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        egress?: { status?: string; ip?: string | null; message?: string };
      };
      assert.equal(payload.egress?.status, "checked");
      assert.equal(payload.egress?.ip, "198.51.100.42");
      assert.match(payload.egress?.message ?? "", /override/);
      assert.equal(calls.length, 0);
    });
  } finally {
    if (previousSkipEgress === undefined) {
      delete process.env.STOCK_ANALYSIS_SKIP_EGRESS_CHECK;
    } else {
      process.env.STOCK_ANALYSIS_SKIP_EGRESS_CHECK = previousSkipEgress;
    }
    if (previousEgressOverride === undefined) {
      delete process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE;
    } else {
      process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE = previousEgressOverride;
    }
    if (previousLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = previousLiveTrading;
    }
  }
});

test("local engine rejects incomplete local broker credential registration", async () => {
  const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "", clientSecret: "" }),
  }));
  assert.equal(response.status, 400);
  const payload = await response.json() as { error?: string };
  assert.match(payload.error ?? "", /clientId/);
});

test("local engine does not persist rejected Toss broker credentials", async () => {
  await withMockFetch([
    jsonResponse({
      error: "invalid_client",
      error_description: "invalid test credential",
    }, { status: 401 }),
  ], async (calls) => {
    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "bad-client", clientSecret: "bad-secret" }),
    }));
    assert.equal(response.status, 401);
    const payload = await response.json() as { error?: string; code?: string };
    assert.equal(payload.code, "invalid_client");
    assert.match(payload.error ?? "", /토스 검증 실패/);
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? "", /\/oauth2\/token$/);
  });

  const storedResponse = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/local/broker/credentials"),
  );
  assert.equal(storedResponse.status, 200);
  const stored = await storedResponse.json() as { credential?: unknown; accounts?: unknown[]; accountPreference?: unknown };
  assert.equal(stored.credential, null);
  assert.deepEqual(stored.accounts, []);
  assert.equal(stored.accountPreference, null);
});

test("local engine keeps Toss manual live policy OFF until readiness and consent", async () => {
  const previousLiveTrading = process.env.ENABLE_LIVE_TRADING;
  process.env.ENABLE_LIVE_TRADING = "true";
  try {
    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }));
    assert.equal(response.status, 412);
    const payload = await response.json() as { error?: string; orderSubmissionAttempted?: boolean };
    assert.match(payload.error ?? "", /선택.*계좌/);

    const stateResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/local/live-trading"),
    );
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json() as {
      liveTrading?: { masterEnabled?: boolean; featureEnabled?: boolean; effective?: boolean; localRuntime?: boolean };
    };
    assert.equal(state.liveTrading?.masterEnabled, false);
    assert.equal(state.liveTrading?.featureEnabled, false);
    assert.equal(state.liveTrading?.effective, false);
    assert.equal(state.liveTrading?.localRuntime, true);
  } finally {
    if (previousLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = previousLiveTrading;
    }
  }
});

test("local engine exposes holdings and precheck safely without Toss credentials", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-no-toss-${Date.now()}`;
  try {
    const holdingsResponse = await handleLocalEngineRequest(
      new Request("http://127.0.0.1:38771/api/local/holdings?symbol=NVDA"),
    );
    assert.equal(holdingsResponse.status, 200);
    const holdings = await holdingsResponse.json() as {
      linked?: boolean;
      held?: boolean;
      symbol?: string;
      message?: string;
    };
    assert.equal(holdings.linked, false);
    assert.equal(holdings.held, false);
    assert.equal(holdings.symbol, "NVDA");
    assert.match(holdings.message ?? "", /credential/);

    const precheckResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/orders/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "NVDA", side: "buy", quantity: 1, price: 100, currency: "USD" }),
    }));
    assert.equal(precheckResponse.status, 412);
    const precheck = await precheckResponse.json() as { error?: string };
    assert.match(precheck.error ?? "", /Toss credential/);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine previews Toss order precheck without submitting live orders", async () => {
  const previousLiveTrading = process.env.ENABLE_LIVE_TRADING;
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  delete process.env.ENABLE_LIVE_TRADING;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-precheck-${Date.now()}`;
  try {
    await withMockFetch([
      jsonResponse({ access_token: "test-access-token-precheck", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({
        result: [
          {
            accountNo: "1234567890",
            accountSeq: 77,
            accountType: "BROKERAGE",
          },
        ],
      }),
      jsonResponse({ result: { currency: "USD", cashBuyingPower: "1000" } }),
      jsonResponse({
        result: {
          baseCurrency: "USD",
          quoteCurrency: "KRW",
          rate: "1300",
          midRate: "1300",
          basisPoint: "0",
          rateChangeType: "UNCHANGED",
          validFrom: "2020-01-01T00:00:00.000Z",
          validUntil: "2030-01-01T00:00:00.000Z",
        },
      }),
    ], async (calls) => {
      const credentialResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "precheck-client", clientSecret: "precheck-secret" }),
      }));
      assert.equal(credentialResponse.status, 200);

      const precheckResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/orders/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "AAPL", side: "buy", quantity: 2, price: 100, currency: "USD" }),
      }));
      assert.equal(precheckResponse.status, 200);
      const payload = await precheckResponse.json() as {
        ok?: boolean;
        submitReady?: boolean;
        available?: number;
        accountSeq?: number;
        blockers?: string[];
        warnings?: string[];
        preview?: { ok?: boolean; submittedAt?: string | null; brokerOrderId?: string };
        liveTradingGate?: { effective?: boolean; masterEnabled?: boolean };
        message?: string;
      };
      assert.equal(payload.ok, true);
      assert.equal(payload.submitReady, false);
      assert.equal(payload.available, 1000);
      assert.equal(payload.accountSeq, 77);
      assert.equal(payload.preview?.ok, false);
      assert.equal(payload.preview?.submittedAt, null);
      assert.equal(payload.preview?.brokerOrderId, undefined);
      assert.equal(payload.liveTradingGate?.effective, false);
      assert.equal(payload.liveTradingGate?.masterEnabled, true);
      assert.ok(payload.blockers?.some((blocker) => /실거래|읽기 전용|이용 동의/.test(blocker)));
      assert.match(payload.message ?? "", /완료되지/);
      assert.equal(calls.length, 4);
      assert.match(calls[2]?.url ?? "", /\/api\/v1\/buying-power/);
      assert.match(calls[3]?.url ?? "", /\/api\/v1\/exchange-rate/);
      assert.equal(calls.some((call) => call.url.includes("/api/v1/orders")), false);
    });
  } finally {
    if (previousLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = previousLiveTrading;
    }
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine persists before Toss submit and locks unknown requests without retry", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-live-submit-${Date.now()}`;
  const account = {
    accountNo: "1234567890",
    accountSeq: 81,
    accountType: "BROKERAGE",
  };
  const usdKrw = {
    result: {
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      rate: "1300",
      midRate: "1300",
      basisPoint: "0",
      rateChangeType: "UNCHANGED",
      validFrom: "2020-01-01T00:00:00.000Z",
      validUntil: "2030-01-01T00:00:00.000Z",
    },
  };
  try {
    await withMockFetch([
      jsonResponse({ access_token: "live-submit-registration", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({ result: [account] }),
    ], async () => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "live-submit-client", clientSecret: "live-submit-secret" }),
      }));
      assert.equal(response.status, 200);
    });

    await verifyLocalManualReadiness({ userId: process.env.STOCK_ANALYSIS_LOCAL_USER_ID!, accountSeq: 81, bindingHash: "test-toss-binding" });
    await consentLocalLiveTrading({ userId: process.env.STOCK_ANALYSIS_LOCAL_USER_ID!, accountSeq: 81, confirmation: "주식 실거래 위험을 확인했습니다" });

    const toggleResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, confirmation: "실거래 수동 주문 해제" }),
    }));
    assert.equal(toggleResponse.status, 200);

    const precheck = async () => {
      let preview: { id: string; clientOrderId: string } | undefined;
      let confirmationText: string | undefined;
      await withMockFetch([
        jsonResponse({ access_token: `live-submit-precheck-${Date.now()}`, token_type: "Bearer", expires_in: 3600 }),
        jsonResponse({ result: { currency: "USD", cashBuyingPower: "1000" } }),
        jsonResponse(usdKrw),
      ], async (calls) => {
        const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/orders/precheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: "AAPL", side: "buy", quantity: 1, price: 10, currency: "USD", accountSeq: 81 }),
        }));
        assert.equal(response.status, 200);
        const payload = await response.json() as {
          submitReady?: boolean;
          preview?: { id?: string; clientOrderId?: string };
          confirmationText?: string;
        };
        assert.equal(payload.submitReady, true);
        assert.equal(calls.length, 3);
        preview = payload.preview?.id && payload.preview.clientOrderId
          ? { id: payload.preview.id, clientOrderId: payload.preview.clientOrderId }
          : undefined;
        confirmationText = payload.confirmationText;
      });
      assert.ok(preview);
      assert.ok(confirmationText);
      return { preview, confirmationText };
    };

    const first = await precheck();
    await withMockFetch([
      jsonResponse({ access_token: "live-submit-order", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({ result: { currency: "USD", cashBuyingPower: "1000" } }),
      jsonResponse(usdKrw),
      jsonResponse({ result: { orderId: "toss-order-1", clientOrderId: first.preview.clientOrderId } }),
    ], async (calls) => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-orders/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: first.preview.id, confirmation: first.confirmationText }),
      }));
      assert.equal(response.status, 201);
      const payload = await response.json() as { status?: string; attempt?: { status?: string; brokerOrderId?: string } };
      assert.equal(payload.status, "submitted");
      assert.equal(payload.attempt?.status, "submitted");
      assert.equal(payload.attempt?.brokerOrderId, "toss-order-1");
      assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/orders") && call.init?.method === "POST").length, 1);
    });

    const second = await precheck();
    await withMockFetch([
      jsonResponse({ access_token: "live-submit-unknown", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({ result: { currency: "USD", cashBuyingPower: "1000" } }),
      jsonResponse(usdKrw),
      jsonResponse({ error: { code: "request-in-progress", message: "pending" } }, { status: 409 }),
    ], async (calls) => {
      const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-orders/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: second.preview.id, confirmation: second.confirmationText }),
      }));
      assert.equal(response.status, 202);
      const payload = await response.json() as { status?: string; attempt?: { status?: string } };
      assert.equal(payload.status, "unknown");
      assert.equal(payload.attempt?.status, "unknown");
      assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/orders") && call.init?.method === "POST").length, 1);
    });

    const stateResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading"));
    const state = await stateResponse.json() as { liveTrading?: { effective?: boolean; policy?: { unknownLock?: unknown } } };
    assert.equal(state.liveTrading?.effective, false);
    assert.ok(state.liveTrading?.policy?.unknownLock);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine requires readiness and consent after credential verification", async () => {
  const previousLiveTrading = process.env.ENABLE_LIVE_TRADING;
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.ENABLE_LIVE_TRADING = "true";
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-qa-required-${Date.now()}`;
  try {
    await withMockFetch([
      jsonResponse({ access_token: "test-access-token-live", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse({
        result: [
          {
            accountNo: "1234567890",
            accountSeq: 7,
            accountType: "BROKERAGE",
          },
        ],
      }),
    ], async () => {
      const credentialResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "live-client", clientSecret: "live-secret" }),
      }));
      assert.equal(credentialResponse.status, 200);
      const credentialPayload = await credentialResponse.json() as {
        accountPreference?: { accountSeq?: number; accountNo?: string };
      };
      assert.equal(credentialPayload.accountPreference?.accountSeq, 7);
      assert.equal(credentialPayload.accountPreference?.accountNo, "******7890");
    });

    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }));
    assert.equal(response.status, 423);
    const payload = await response.json() as {
      error?: string;
      orderSubmissionAttempted?: boolean;
    };
    assert.match(payload.error ?? "", /읽기 전용 점검|이용 동의/);

    const offResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }));
    assert.equal(offResponse.status, 200);
    const offPayload = await offResponse.json() as { liveTrading?: { effective?: boolean; featureEnabled?: boolean } };
    assert.equal(offPayload.liveTrading?.effective, false);
    assert.equal(offPayload.liveTrading?.featureEnabled, false);
  } finally {
    if (previousLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = previousLiveTrading;
    }
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine saves explicit Toss automation account preference", async () => {
  const previousLiveTrading = process.env.ENABLE_LIVE_TRADING;
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  process.env.ENABLE_LIVE_TRADING = "true";
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = `local-engine-account-${Date.now()}`;
  const accounts = {
    result: [
      {
        accountNo: "111122223333",
        accountSeq: 10,
        accountType: "BROKERAGE",
      },
      {
        accountNo: "9999888877776666",
        accountSeq: 20,
        accountType: "BROKERAGE",
      },
    ],
  };

  try {
    await withMockFetch([
      jsonResponse({ access_token: "test-access-token-multi", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse(accounts),
      jsonResponse(accounts),
    ], async () => {
      const credentialResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "multi-client", clientSecret: "multi-secret" }),
      }));
      assert.equal(credentialResponse.status, 200);
      const credentialPayload = await credentialResponse.json() as {
        accounts?: unknown[];
        accountPreference?: unknown;
      };
      assert.equal(credentialPayload.accounts?.length, 2);
      assert.equal(credentialPayload.accountPreference, null);

      const blockedToggle = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }));
      assert.equal(blockedToggle.status, 412);
      const blockedPayload = await blockedToggle.json() as { error?: string; orderSubmissionAttempted?: boolean };
      assert.match(blockedPayload.error ?? "", /선택.*계좌/);

      const preferenceResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/broker/account-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountSeq: 20 }),
      }));
      assert.equal(preferenceResponse.status, 200);
      const preferencePayload = await preferenceResponse.json() as {
        accountPreference?: { accountSeq?: number; accountNo?: string; accountType?: string };
        accountsError?: string | null;
      };
      assert.equal(preferencePayload.accountPreference?.accountSeq, 20);
      assert.equal(preferencePayload.accountPreference?.accountNo, "************6666");
      assert.equal(preferencePayload.accountPreference?.accountType, "BROKERAGE");
      assert.equal(preferencePayload.accountsError, null);
    });

    const response = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }));
    assert.equal(response.status, 423);
    const payload = await response.json() as { error?: string; orderSubmissionAttempted?: boolean };
    assert.match(payload.error ?? "", /읽기 전용 점검|이용 동의/);
  } finally {
    if (previousLiveTrading === undefined) {
      delete process.env.ENABLE_LIVE_TRADING;
    } else {
      process.env.ENABLE_LIVE_TRADING = previousLiveTrading;
    }
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local engine manages local automation strategy configs", async () => {
  const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "ZXSTRAT 분할 전략",
      symbol: "ZXSTRAT",
      market: "US",
      preset: "magic-split",
      mode: "percent-grid",
      currentPrice: 100,
      grid: {
        basePrice: 100,
        rungs: [
          { index: 1, buyDropPct: 1, sellRisePct: 1, notional: 1000 },
          { index: 2, buyDropPct: 2, sellRisePct: 1.2, notional: 1000 },
        ],
      },
      riskLimits: {
        maxDailyBuys: 4,
        maxDailySells: 4,
        maxPositionValue: 2500,
        maxLossPct: 10,
        maxHoldHours: 8760,
      },
      exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    }),
  }));
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as {
    config?: {
      id?: string;
      status?: string;
      preset?: string;
      currentConfigHash?: string;
      automationReadiness?: {
        paperAutomationReady?: boolean;
        liveSubmissionReady?: boolean;
        blockers?: string[];
      };
    };
  };
  assert.equal(created.config?.status, "draft");
  assert.equal(created.config?.preset, "magic-split");
  assert.ok(created.config?.id);
  assert.ok(created.config?.currentConfigHash);
  assert.equal(created.config?.automationReadiness?.paperAutomationReady, false);
  assert.equal(created.config?.automationReadiness?.liveSubmissionReady, false);
  assert.ok(created.config?.automationReadiness?.blockers?.some((blocker) => blocker.includes("시뮬레이션")));
  const strategyId = created.config?.id;
  assert.ok(strategyId);

  const blockedEnableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  }));
  assert.equal(blockedEnableResponse.status, 428);

  const simulateResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/simulate`, {
    method: "POST",
  }));
  assert.equal(simulateResponse.status, 200);
  const simulated = await simulateResponse.json() as {
    result?: { riskCheck?: { passed?: boolean }; orderIntents?: unknown[] };
    config?: {
      lastSimulation?: { passed?: boolean };
      automationReadiness?: {
        paperAutomationReady?: boolean;
        liveSubmissionReady?: boolean;
        liveBlockers?: string[];
      };
    };
  };
  assert.equal(simulated.result?.riskCheck?.passed, true);
  assert.ok((simulated.result?.orderIntents?.length ?? 0) >= 2);
  assert.equal(simulated.config?.lastSimulation?.passed, true);
  assert.equal(simulated.config?.automationReadiness?.paperAutomationReady, true);
  assert.equal(simulated.config?.automationReadiness?.liveSubmissionReady, false);
  assert.ok((simulated.config?.automationReadiness?.liveBlockers?.length ?? 0) >= 1);

  const tickPreviewResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/tick-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "entry-trigger" }),
  }));
  assert.equal(tickPreviewResponse.status, 200);
  const tickPreview = await tickPreviewResponse.json() as {
    dryRun?: boolean;
    scenario?: string;
    marketPrice?: number;
    originalStatus?: string;
    summary?: {
      headline?: string;
      action?: string;
      safety?: string;
      nextEntryPrice?: number | null;
      triggerDistancePct?: number | null;
      blockedOrders?: number;
      rejectedOrders?: number;
      errorOrders?: number;
      nextAction?: string;
      blockers?: string[];
    };
    result?: {
      triggers?: number;
      orders?: Array<{ status?: string; side?: string; message?: string }>;
      logs?: Array<{ level?: string; message?: string }>;
    };
  };
  assert.equal(tickPreview.dryRun, true);
  assert.equal(tickPreview.scenario, "entry-trigger");
  assert.equal(tickPreview.originalStatus, "draft");
  assert.equal(tickPreview.marketPrice, 99);
  assert.equal(tickPreview.summary?.action, "buy");
  assert.equal(tickPreview.summary?.safety, "dry-run: broker 제출 없음");
  assert.equal(tickPreview.summary?.nextEntryPrice, 99);
  assert.equal(tickPreview.summary?.triggerDistancePct, 0);
  assert.ok((tickPreview.summary?.blockedOrders ?? 0) >= 1);
  assert.equal(tickPreview.summary?.rejectedOrders, 0);
  assert.equal(tickPreview.summary?.errorOrders, 0);
  assert.match(tickPreview.summary?.headline ?? "", /조건 발동/);
  assert.match(tickPreview.summary?.nextAction ?? "", /모의 자동화/);
  assert.ok(tickPreview.summary?.blockers?.some((message) => message.includes("실거래 비활성")));
  assert.ok((tickPreview.result?.triggers ?? 0) >= 1);
  assert.ok(tickPreview.result?.orders?.some((order) =>
    order.status === "blocked" &&
    order.side === "buy" &&
    order.message?.includes("실거래 비활성"),
  ));
  assert.ok(tickPreview.result?.logs?.some((log) => log.message?.includes("실거래 비활성")));

  const enableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  }));
  assert.equal(enableResponse.status, 200);
  const enabled = await enableResponse.json() as {
    config?: {
      status?: string;
      automationReadiness?: {
        paperAutomationReady?: boolean;
        liveSubmissionReady?: boolean;
      };
    };
  };
  assert.equal(enabled.config?.status, "enabled");
  assert.equal(enabled.config?.automationReadiness?.paperAutomationReady, true);
  assert.equal(enabled.config?.automationReadiness?.liveSubmissionReady, false);

  const editResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "ZXSTRAT 분할 전략 수정",
      symbol: "ZXSTRAT",
      market: "US",
      preset: "magic-split",
      mode: "percent-grid",
      orderSizing: { mode: "quantity", quantity: 2 },
      currentPrice: 101,
      grid: {
        basePrice: 101,
        rungs: [
          { index: 1, buyDropPct: 1.5, sellRisePct: 1, notional: 800 },
          { index: 2, buyDropPct: 3, sellRisePct: 1.2, notional: 800 },
        ],
      },
      riskLimits: {
        maxDailyBuys: 3,
        maxDailySells: 3,
        maxPositionValue: 1800,
        maxLossPct: 9,
        maxHoldHours: 8760,
      },
      exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    }),
  }));
  assert.equal(editResponse.status, 200);
  const edited = await editResponse.json() as {
    config?: {
      status?: string;
      name?: string;
      currentPrice?: number;
      lastSimulation?: unknown;
      orderSizing?: { mode?: string; quantity?: number };
      grid?: { basePrice?: number; rungs?: Array<{ buyDropPct?: number; notional?: number }> };
      automationReadiness?: {
        paperAutomationReady?: boolean;
        liveSubmissionReady?: boolean;
        blockers?: string[];
      };
    };
  };
  assert.equal(edited.config?.status, "draft");
  assert.equal(edited.config?.name, "ZXSTRAT 분할 전략 수정");
  assert.equal(edited.config?.currentPrice, 101);
  assert.deepEqual(edited.config?.orderSizing, { mode: "quantity", quantity: 2 });
  assert.equal(edited.config?.grid?.basePrice, 101);
  assert.equal(edited.config?.grid?.rungs?.[0]?.buyDropPct, 1.5);
  assert.equal(edited.config?.grid?.rungs?.[0]?.notional, 800);
  assert.equal(edited.config?.lastSimulation, undefined);
  assert.equal(edited.config?.automationReadiness?.paperAutomationReady, false);
  assert.equal(edited.config?.automationReadiness?.liveSubmissionReady, false);
  assert.ok(edited.config?.automationReadiness?.blockers?.some((blocker) => blocker.includes("시뮬레이션")));

  const blockedReenableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  }));
  assert.equal(blockedReenableResponse.status, 428);

  const listResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs"));
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json() as {
    configs?: Array<{
      id?: string;
      name?: string;
      status?: string;
      preset?: string;
      instrument?: { primaryName?: string; code?: string; market?: string };
      automationReadiness?: { paperAutomationReady?: boolean; liveSubmissionReady?: boolean };
    }>;
  };
  assert.ok(listed.configs?.some((config) =>
    config.id === strategyId &&
    config.name === "ZXSTRAT 분할 전략 수정" &&
    config.status === "draft" &&
    config.preset === "magic-split" &&
    config.instrument?.code === "ZXSTRAT" &&
    config.automationReadiness?.paperAutomationReady === false &&
    config.automationReadiness?.liveSubmissionReady === false,
  ));

  const exportResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs/export"));
  assert.equal(exportResponse.status, 200);
  const exported = await exportResponse.json() as {
    schemaVersion?: number;
    safety?: {
      credentialsIncluded?: boolean;
      accountPreferenceIncluded?: boolean;
      importedStatus?: string;
      importedSimulation?: string;
    };
    configs?: Array<{
      sourceId?: string;
      name?: string;
      status?: string;
      lastSimulation?: unknown;
      orderSizing?: { mode?: string; quantity?: number };
      riskLimits?: { maxLossPct?: number };
    }>;
  };
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.safety?.credentialsIncluded, false);
  assert.equal(exported.safety?.accountPreferenceIncluded, false);
  assert.equal(exported.safety?.importedStatus, "draft");
  assert.equal(exported.safety?.importedSimulation, "discarded");
  const exportedConfig = exported.configs?.find((config) => config.sourceId === strategyId);
  assert.equal(exportedConfig?.name, "ZXSTRAT 분할 전략 수정");
  assert.equal(exportedConfig?.status, undefined);
  assert.equal(exportedConfig?.lastSimulation, undefined);
  assert.deepEqual(exportedConfig?.orderSizing, { mode: "quantity", quantity: 2 });

  const importResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...exported,
      configs: [{
        ...exportedConfig,
        id: "should-not-survive",
        status: "enabled",
        lastSimulation: {
          configHash: "unsafe",
          passed: true,
          blockers: [],
          warnings: [],
          expectedReturnPct: 999,
          expectedLossPct: 0,
          summary: "unsafe imported simulation",
          simulatedAt: "2026-07-09T00:00:00.000Z",
        },
      }],
    }),
  }));
  assert.equal(importResponse.status, 200);
  const imported = await importResponse.json() as {
    imported?: number;
    status?: string;
    safety?: {
      enabledStrategiesImported?: number;
      lastSimulationDiscarded?: boolean;
      liveTradingChanged?: boolean;
    };
    configs?: Array<{
      id?: string;
      status?: string;
      name?: string;
      lastSimulation?: unknown;
      orderSizing?: { mode?: string; quantity?: number };
      automationReadiness?: { paperAutomationReady?: boolean };
    }>;
  };
  assert.equal(imported.imported, 1);
  assert.equal(imported.status, "draft");
  assert.equal(imported.safety?.enabledStrategiesImported, 0);
  assert.equal(imported.safety?.lastSimulationDiscarded, true);
  assert.equal(imported.safety?.liveTradingChanged, false);
  assert.ok(imported.configs?.[0]?.id?.startsWith("imported-"));
  assert.notEqual(imported.configs?.[0]?.id, "should-not-survive");
  assert.equal(imported.configs?.[0]?.status, "draft");
  assert.equal(imported.configs?.[0]?.lastSimulation, undefined);
  assert.deepEqual(imported.configs?.[0]?.orderSizing, { mode: "quantity", quantity: 2 });
  assert.equal(imported.configs?.[0]?.automationReadiness?.paperAutomationReady, false);

  const legacyImportResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      configs: [exportedConfig],
    }),
  }));
  assert.equal(legacyImportResponse.status, 200);
  const legacyImported = await legacyImportResponse.json() as {
    schemaVersion?: number;
    configs?: Array<{ status?: string; orderSizing?: unknown; lastSimulation?: unknown }>;
  };
  assert.equal(legacyImported.schemaVersion, 1);
  assert.equal(legacyImported.configs?.[0]?.status, "draft");
  assert.equal(legacyImported.configs?.[0]?.orderSizing, undefined);
  assert.equal(legacyImported.configs?.[0]?.lastSimulation, undefined);

  const configuredRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  assert.ok(configuredRoot);
  const storePath = join(configuredRoot, "automation-platform", "store.json");
  const storeText = await readFile(storePath, "utf8");
  assert.match(storeText, new RegExp(strategyId));
  const legacyCacheText = await readFile(
    join(process.cwd(), ".cache", "stock-analysis", "automation-platform", "store.json"),
    "utf8",
  ).catch(() => "");
  assert.equal(legacyCacheText.includes(strategyId), false);
});

test("local automation cycle records enabled strategy orders into paper state without Toss credentials", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  const userId = `local-paper-auto-${Date.now()}`;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = userId;
  try {
    const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ZXPAUTO 순환분할 paper",
        symbol: "ZXPAUTO",
        market: "US",
        preset: "magic-split",
        mode: "percent-grid",
        currentPrice: 99,
        grid: {
          basePrice: 100,
          rungs: [
            { index: 1, buyDropPct: 1, sellRisePct: 1, notional: 1000 },
          ],
        },
        riskLimits: {
          maxDailyBuys: 4,
          maxDailySells: 4,
          maxPositionValue: 2500,
          maxLossPct: 10,
          maxHoldHours: 8760,
        },
        exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
      }),
    }));
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { config?: { id?: string } };
    const strategyId = created.config?.id;
    assert.ok(strategyId);

    const simulateResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/simulate`, {
      method: "POST",
    }));
    assert.equal(simulateResponse.status, 200);

    const enableResponse = await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "enabled" }),
    }));
    assert.equal(enableResponse.status, 200);

    const cycleResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    assert.equal(cycleResponse.status, 200);
    const cycle = await cycleResponse.json() as {
      result?: {
        status?: string;
        reason?: string;
        liveTradingEnabled?: boolean;
        strategies?: number;
        triggers?: number;
        submitted?: number;
        newFills?: number;
        evaluations?: Array<{ symbol?: string; orders?: Array<{ status?: string }> }>;
        safety?: string;
      };
    };
    assert.equal(cycle.result?.status, "ran");
    assert.equal(cycle.result?.reason, "paper-automation-no-credentials");
    assert.equal(cycle.result?.liveTradingEnabled, false);
    assert.equal(cycle.result?.strategies, 1);
    assert.ok((cycle.result?.triggers ?? 0) >= 1);
    assert.ok((cycle.result?.submitted ?? 0) >= 1);
    assert.ok((cycle.result?.newFills ?? 0) >= 1);
    assert.match(cycle.result?.safety ?? "", /모의 계좌/);
    assert.ok(cycle.result?.evaluations?.some((evaluation) =>
      evaluation.symbol === "ZXPAUTO" &&
      evaluation.orders?.some((order) => order.status === "submitted")
    ));

    const storageRoot = getPaperTradingStorageRootForUser(userId);
    const { state } = await readPaperTradingState(storageRoot);
    assert.ok(state.orders.some((order) =>
      order.symbol === "ZXPAUTO" &&
      order.side === "buy" &&
      order.reason.includes("ZXPAUTO 순환분할 paper")
    ));
    assert.ok(state.executions.some((execution) => execution.symbol === "ZXPAUTO"));
    assert.ok(state.positions.some((position) => position.symbol === "ZXPAUTO" && position.quantity > 0));
    assert.ok((state.accounts.US.cash ?? 0) < 10_000);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("local automation cycle liquidates a stopped paper position and disables the strategy", async () => {
  const previousUserId = process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
  const userId = `local-paper-stop-${Date.now()}`;
  process.env.STOCK_ANALYSIS_LOCAL_USER_ID = userId;
  try {
    const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ZXSTOP paper 손절",
        symbol: "ZXSTOP",
        market: "US",
        preset: "magic-split",
        mode: "percent-grid",
        orderSizing: { mode: "quantity", quantity: 2 },
        currentPrice: 90,
        grid: {
          basePrice: 100,
          rungs: [{ index: 1, buyDropPct: 1, sellRisePct: 10, notional: 198 }],
        },
        riskLimits: {
          maxDailyBuys: 4,
          maxDailySells: 4,
          maxPositionValue: 500,
          maxLossPct: 20,
          maxHoldHours: 8760,
        },
        exitRules: { takeProfitPct: 10, stopLossPct: 5, rescueMode: "cancel-and-liquidate" },
      }),
    }));
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { config?: { id?: string } };
    const strategyId = created.config?.id;
    assert.ok(strategyId);

    const simulateResponse = await handleLocalEngineRequest(new Request(
      `http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}/simulate`,
      { method: "POST" },
    ));
    assert.equal(simulateResponse.status, 200);
    const enableResponse = await handleLocalEngineRequest(new Request(
      `http://127.0.0.1:38771/api/local/strategy-configs/${strategyId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "enabled" }),
      },
    ));
    assert.equal(enableResponse.status, 200);

    const firstCycle = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    assert.equal(firstCycle.status, 200);
    let paperState = await readPaperTradingState(getPaperTradingStorageRootForUser(userId));
    assert.equal(paperState.state.positions.find((position) => position.symbol === "ZXSTOP")?.quantity, 2);

    const secondCycle = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    assert.equal(secondCycle.status, 200);
    const stopped = await secondCycle.json() as {
      result?: {
        evaluations?: Array<{
          strategyId?: string;
          strategyTransition?: { status?: string; reason?: string; completed?: boolean };
        }>;
      };
    };
    assert.ok(stopped.result?.evaluations?.some((evaluation) =>
      evaluation.strategyId === strategyId
      && evaluation.strategyTransition?.status === "disabled"
      && evaluation.strategyTransition.reason === "stop-loss"
      && evaluation.strategyTransition.completed === true
    ));

    paperState = await readPaperTradingState(getPaperTradingStorageRootForUser(userId));
    assert.equal(paperState.state.positions.some((position) => position.symbol === "ZXSTOP"), false);
    assert.ok(paperState.state.executions.some((execution) =>
      execution.symbol === "ZXSTOP" && execution.side === "sell" && execution.quantity === 2
    ));

    const listResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs"));
    const listed = await listResponse.json() as {
      configs?: Array<{ id?: string; status?: string; lastSimulation?: unknown }>;
    };
    const stoppedConfig = listed.configs?.find((config) => config.id === strategyId);
    assert.equal(stoppedConfig?.status, "disabled");
    assert.equal(stoppedConfig?.lastSimulation, undefined);
  } finally {
    if (previousUserId === undefined) {
      delete process.env.STOCK_ANALYSIS_LOCAL_USER_ID;
    } else {
      process.env.STOCK_ANALYSIS_LOCAL_USER_ID = previousUserId;
    }
  }
});

test("terminal dashboard returns P0/P1 macOS workspace data", async () => {
  const response = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/dashboard/terminal?symbol=NVDA&session=US"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    symbol?: string;
    orderIntent?: { symbol?: string; status?: string };
    riskCheck?: { passed?: boolean; blockers?: string[] };
    auditTrail?: unknown[];
    riskScenarios?: unknown[];
    watchlistAlerts?: unknown[];
    watchlistAlertEvaluations?: Array<{ state?: string; scope?: string }>;
    newsCredibility?: unknown[];
    preTradeChecklist?: unknown[];
    replayEvents?: Array<{ kind?: string }>;
    playbook?: { symbol?: string; workerMode?: string };
  };
  assert.equal(payload.symbol, "NVDA");
  assert.equal(payload.orderIntent?.symbol, "NVDA");
  assert.equal(payload.orderIntent?.status, "draft");
  assert.equal(payload.riskCheck?.passed, false);
  assert.match(payload.riskCheck?.blockers?.join(" ") ?? "", /실거래 주문/);
  assert.ok((payload.auditTrail?.length ?? 0) >= 4);
  assert.ok((payload.riskScenarios?.length ?? 0) >= 4);
  assert.ok((payload.watchlistAlerts?.length ?? 0) >= 4);
  assert.ok((payload.watchlistAlertEvaluations?.length ?? 0) >= 4);
  assert.equal(payload.watchlistAlertEvaluations?.some((event) => event.state === "unsupported"), false);
  assert.ok(payload.watchlistAlertEvaluations?.some((event) =>
    event.scope === "earnings" && (event.state === "limited" || event.state === "triggered")
  ));
  assert.ok((payload.newsCredibility?.length ?? 0) >= 4);
  assert.ok((payload.preTradeChecklist?.length ?? 0) >= 4);
  assert.ok((payload.replayEvents?.length ?? 0) >= 4);
  assert.ok(payload.replayEvents?.some((event) => event.kind === "candle"));
  assert.equal(payload.playbook?.symbol, "NVDA");
  assert.equal(payload.playbook?.workerMode, "paper-only");
});

test("terminal dashboard includes paper order and execution replay events", async () => {
  const storageRoot = getPaperTradingStorageRootForUser("local-macos-user");
  const { state } = await readPaperTradingState(storageRoot);
  const now = new Date("2026-07-08T10:15:00.000Z").toISOString();
  await writePaperTradingState({
    ...state,
    positions: [{
      id: "paper-position-zxtest",
      session: "US",
      market: "US",
      symbol: "ZXTEST",
      name: "ZX Test",
      quantity: 5,
      averagePrice: 98,
      lastPrice: 97.2,
      currency: "USD",
      openedAt: now,
      updatedAt: now,
      completedStages: [],
    }],
    orders: [{
      id: "paper-order-zxtest",
      runId: "paper-run-zxtest",
      session: "US",
      market: "US",
      symbol: "ZXTEST",
      name: "ZX Test",
      side: "buy",
      type: "market",
      quantity: 5,
      price: 97.2,
      currency: "USD",
      status: "filled",
      reason: "대시보드 리플레이 테스트",
      strategyVersion: "test",
      createdAt: now,
    }],
    executions: [{
      id: "paper-execution-zxtest",
      runId: "paper-run-zxtest",
      orderId: "paper-order-zxtest",
      session: "US",
      market: "US",
      symbol: "ZXTEST",
      side: "buy",
      quantity: 5,
      price: 97.2,
      currency: "USD",
      realizedPnl: 0,
      executedAt: now,
    }],
  }, storageRoot);

  const response = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/dashboard/terminal?symbol=ZXTEST&session=US"),
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    replayEvents?: Array<{ kind?: string }>;
    watchlistAlertEvaluations?: Array<{ scope?: string; state?: string; triggered?: boolean }>;
  };
  assert.ok(payload.replayEvents?.some((event) => event.kind === "paper-order"));
  assert.ok(payload.replayEvents?.some((event) => event.kind === "paper-execution"));
  assert.ok(payload.watchlistAlertEvaluations?.some((event) =>
    event.scope === "position-risk" &&
    event.state === "triggered" &&
    event.triggered === true,
  ));
});

test("terminal dashboard playbook can be saved and read back", async () => {
  const saveResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/dashboard/playbook?symbol=AMD", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thesis: "테스트 플레이북 가설",
      entryRule: "테스트 진입 규칙",
      invalidationRule: "테스트 무효화 규칙",
      addRule: "테스트 추가 규칙",
      trimRule: "테스트 축소 규칙",
      target: "테스트 목표",
      workerMode: "manual-approval",
    }),
  }));
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json() as { symbol?: string; thesis?: string; workerMode?: string };
  assert.equal(saved.symbol, "AMD");
  assert.equal(saved.thesis, "테스트 플레이북 가설");
  assert.equal(saved.workerMode, "manual-approval");

  const dashboardResponse = await handleLocalEngineRequest(
    new Request("http://127.0.0.1:38771/api/dashboard/terminal?symbol=AMD&session=US"),
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json() as { playbook?: { thesis?: string; workerMode?: string } };
  assert.equal(dashboard.playbook?.thesis, "테스트 플레이북 가설");
  assert.equal(dashboard.playbook?.workerMode, "manual-approval");
});

test("official RSS parser extracts and classifies market events", () => {
  const [source] = DEFAULT_OFFICIAL_NEWS_SOURCES;
  const events = parseOfficialRss(source, `
    <rss><channel><item>
      <title>Federal Reserve issues FOMC rate policy statement</title>
      <link>https://www.federalreserve.gov/example</link>
      <pubDate>Tue, 07 Jul 2026 19:00:00 GMT</pubDate>
      <description>Monetary policy and inflation outlook.</description>
    </item></channel></rss>
  `);
  assert.equal(events.length, 1);
  assert.equal(events[0].importance, "high");
  assert.deepEqual(events[0].tags.includes("rate-policy"), true);
  assert.equal(events[0].sourceId, source.id);
});

test("official RSS fetch applies timeout and reports source errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS;
  process.env.STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS = "5";
  let sawAbortSignal = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    sawAbortSignal = signal instanceof AbortSignal;
    await new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    throw new Error("fetch should abort before resolving");
  }) as typeof fetch;
  try {
    const source = {
      ...DEFAULT_OFFICIAL_NEWS_SOURCES[0],
      id: "timeout-source",
      url: "https://example.invalid/rss.xml",
    };
    const result = await fetchOfficialNewsEvents([source]);
    assert.equal(sawAbortSignal, true);
    assert.equal(result.events.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].sourceId, "timeout-source");
    assert.match(result.errors[0].message, /timeout after 5ms/);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS;
    } else {
      process.env.STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS = originalTimeout;
    }
    globalThis.fetch = originalFetch;
  }
});

test("crypto strategy runs through shared paper automation without exchange submit", async () => {
  await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/live-trading", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  }));
  const createResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/local/strategy-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "KRW-BTC Upbit paper 순환분할",
      symbol: "KRW-BTC",
      market: "CRYPTO",
      executionVenue: "upbit",
      preset: "magic-split",
      mode: "percent-grid",
      currentPrice: 98_000_000,
      supportPrice: 95_000_000,
      resistancePrice: 105_000_000,
      grid: {
        basePrice: 100_000_000,
        rungs: [{ index: 1, buyDropPct: 1, sellRisePct: 1, notional: 10_000 }],
      },
      riskLimits: { maxDailyBuys: 3, maxDailySells: 3, maxPositionValue: 100_000, maxLossPct: 20, maxHoldHours: 8760 },
      exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    }),
  }));
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { config?: { id?: string; market?: string; executionVenue?: string } };
  const id = created.config?.id;
  assert.ok(id);
  assert.equal(created.config?.market, "CRYPTO");
  assert.equal(created.config?.executionVenue, "upbit");

  const simulationResponse = await handleLocalEngineRequest(new Request(
    `http://127.0.0.1:38771/api/local/strategy-configs/${id}/simulate`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  ));
  assert.equal(simulationResponse.status, 200);
  const enableResponse = await handleLocalEngineRequest(new Request(
    `http://127.0.0.1:38771/api/local/strategy-configs/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "enabled" }) },
  ));
  assert.equal(enableResponse.status, 200);

  const cycleResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }));
  assert.equal(cycleResponse.status, 200);
  const cycle = await cycleResponse.json() as {
    result?: { evaluations?: Array<{ strategyId?: string; orders?: Array<{ status?: string }> }> };
  };
  const evaluation = cycle.result?.evaluations?.find((item) => item.strategyId === id);
  assert.ok(evaluation);
  assert.ok(evaluation.orders?.some((order) => order.status === "submitted"));

  const stateResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/paper-trading/state"));
  const paper = await stateResponse.json() as { state?: { positions?: Array<{ symbol?: string; market?: string }> } };
  assert.ok(
    paper.state?.positions?.some((position) => position.symbol === "KRW-BTC" && position.market === "CRYPTO"),
    JSON.stringify({ evaluation, positions: paper.state?.positions }),
  );

  const previousLive = process.env.ENABLE_LIVE_TRADING;
  const previousCryptoLive = process.env.ENABLE_CRYPTO_LIVE_TRADING;
  try {
    process.env.ENABLE_LIVE_TRADING = "true";
    process.env.ENABLE_CRYPTO_LIVE_TRADING = "true";
    const blockedLiveResponse = await handleLocalEngineRequest(new Request("http://127.0.0.1:38771/api/automation/cycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    const blockedLive = await blockedLiveResponse.json() as {
      result?: {
        cryptoAutomation?: {
          reason?: string;
          liveTradingEnabled?: boolean;
          submitted?: number;
          evaluations?: Array<{ strategyId?: string; status?: string; blockers?: string[] }>;
        };
      };
    };
    assert.equal(blockedLive.result?.cryptoAutomation?.submitted, 0);
    assert.equal(blockedLive.result?.cryptoAutomation?.liveTradingEnabled, false);
    assert.equal(blockedLive.result?.cryptoAutomation?.reason, "crypto-live-automation");
  } finally {
    if (previousLive === undefined) delete process.env.ENABLE_LIVE_TRADING;
    else process.env.ENABLE_LIVE_TRADING = previousLive;
    if (previousCryptoLive === undefined) delete process.env.ENABLE_CRYPTO_LIVE_TRADING;
    else process.env.ENABLE_CRYPTO_LIVE_TRADING = previousCryptoLive;
  }

  await handleLocalEngineRequest(new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${id}`, { method: "DELETE" }));
});
