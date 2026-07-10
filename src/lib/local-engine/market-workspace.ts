import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { calculateHorizonExitPlans, type HorizonPlanContext, type PlanReliabilityGrade } from "@/lib/market/horizon-exit-plans";
import { getMarketDataProvider, type GetCandlesOptions, type MarketCandleResponse, type MarketDataProvider } from "@/lib/market-data";
import type { CandleSeriesSnapshot, OfficialTimeframe } from "@/lib/market-data/official-types";
import { TossMarketDataProvider } from "@/lib/market-data/toss";
import { normalizeUpbitMarket, UpbitMarketDataProvider } from "@/lib/market-data/upbit";
import { createTossClient, type TossCredentials } from "@/lib/toss/client";
import { analyzeSymbol } from "@/use-cases/market/analyze-symbol";

export type MarketWorkspaceAssetClass = "stock" | "crypto";
export type MarketWorkspaceSource = "auto" | "toss" | "yahoo" | "upbit";
type ResolvedMarketWorkspaceSource = Exclude<MarketWorkspaceSource, "auto"> | "fixture";

type JsonObject = Record<string, unknown>;

type AnalysisPayload = JsonObject & {
  symbol?: string;
  market?: string;
  currency?: "KRW" | "USD";
  dataSource?: string;
  timeframe?: string;
  quoteAt?: string | null;
  generatedAt?: string;
  latestClose?: number | null;
  candles?: unknown[];
  breakoutRule?: JsonObject;
  signalReliability?: JsonObject;
  analysisBasis?: JsonObject;
  tradeSetup?: JsonObject;
};

export type OfficialSeriesProvider = {
  loadSeries(
    symbol: string,
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ): Promise<CandleSeriesSnapshot>;
};

type AnalysisRunOptions = {
  symbol: string;
  timeframe: OfficialTimeframe;
  days: number;
  marketData: Pick<MarketDataProvider, "getCandles">;
  preAggregatedTimeframe?: "4h";
  metadata: {
    market: "KOSPI" | "KOSDAQ" | "US" | "CRYPTO";
    currency: "KRW" | "USD";
    dataSource: string;
    quoteAt?: string | null;
    stale?: boolean;
  };
};

export type MarketWorkspaceDependencies = {
  now?: () => Date;
  loadTossCredentials?: (userId: string) => Promise<TossCredentials | null>;
  createTossProvider?: (credentials: TossCredentials) => OfficialSeriesProvider;
  upbitProvider?: OfficialSeriesProvider;
  yahooProvider?: Pick<MarketDataProvider, "getCandles">;
  analyze?: (options: AnalysisRunOptions) => Promise<AnalysisPayload>;
  fixtureMode?: boolean;
  fixtureProvider?: OfficialSeriesProvider;
};

export type MarketWorkspaceHandlerOptions = {
  userId: string;
  dependencies?: MarketWorkspaceDependencies;
};

type AnalysisResult = {
  payload: AnalysisPayload;
  snapshot: CandleSeriesSnapshot | null;
};

class WorkspaceRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sharedUpbitProvider = new UpbitMarketDataProvider();

const yahooSessionPolicy = (market: AnalysisRunOptions["metadata"]["market"]) => market === "US"
  ? { timeZone: "America/New_York", closeMinutes: 16 * 60 }
  : { timeZone: "Asia/Seoul", closeMinutes: 15 * 60 + 30 };

const zonedDateParts = (timestampSeconds: number, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestampSeconds * 1_000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
};

const zonedDateTimeToUnix = ({
  year,
  month,
  day,
  hour,
  minute,
  timeZone,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) => {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedDateParts(Math.floor(candidate / 1_000), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate += targetAsUtc - actualAsUtc;
  }
  return Math.floor(candidate / 1_000);
};

export const yahooCandleCloseTime = (
  candleTime: number,
  interval: GetCandlesOptions["interval"],
  market: AnalysisRunOptions["metadata"]["market"],
) => {
  if (interval === "1wk") return candleTime + 7 * 24 * 60 * 60;
  const policy = yahooSessionPolicy(market);
  const localDate = zonedDateParts(candleTime, policy.timeZone);
  const sessionClose = zonedDateTimeToUnix({
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour: Math.floor(policy.closeMinutes / 60),
    minute: policy.closeMinutes % 60,
    timeZone: policy.timeZone,
  });
  if (interval === "1d") return sessionClose;
  const nominalClose = candleTime + 60 * 60;
  return sessionClose > candleTime ? Math.min(nominalClose, sessionClose) : nominalClose;
};

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;

const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

const asText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const latestCandleClose = (analysis: AnalysisPayload | null) => {
  if (!analysis || !Array.isArray(analysis.candles)) return null;
  const latest = asObject(analysis.candles.at(-1));
  return asNumber(latest?.close);
};

const marketForStock = (symbol: string): "KOSPI" | "KOSDAQ" | "US" => {
  const normalized = symbol.trim().toUpperCase();
  if (/^\d{6}\.KQ$/.test(normalized)) return "KOSDAQ";
  if (/^\d{6}(?:\.KS)?$/.test(normalized)) return "KOSPI";
  return "US";
};

const normalizeCryptoAnalysisSymbol = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  const upbit = normalized.match(/^(?:KRW|BTC|USDT)-([A-Z0-9]+)$/);
  if (upbit?.[1]) return `${upbit[1]}-USD`;
  if (/(?:-USD|-USDT|-USDC)$/i.test(normalized)) return normalized;
  const base = normalized.replace(/[^A-Z0-9]/g, "");
  return `${base || "BTC"}-USD`;
};

const stripOfficialMetadata = (snapshot: CandleSeriesSnapshot): MarketCandleResponse => ({
  candles: snapshot.candles
    .filter((candle) => candle.isClosed && !candle.isPartialSessionBar)
    .map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
  timeZone: snapshot.market === "US" ? "America/New_York" : "Asia/Seoul",
});

const snapshotCacheKey = (
  symbol: string,
  timeframe: OfficialTimeframe,
  options: { period1: Date; period2: Date },
) => [
  symbol,
  timeframe,
  options.period1.toISOString().slice(0, 10),
  options.period2.toISOString().slice(0, 10),
].join(":");

const createOfficialAnalysisProvider = ({
  provider,
  symbol,
  primaryTimeframe,
  snapshotCache,
  onPrimarySnapshot,
}: {
  provider: OfficialSeriesProvider;
  symbol: string;
  primaryTimeframe: OfficialTimeframe;
  snapshotCache: Map<string, Promise<CandleSeriesSnapshot>>;
  onPrimarySnapshot?: (snapshot: CandleSeriesSnapshot) => void;
}) => {
  let primarySnapshot: CandleSeriesSnapshot | null = null;

  const load = (
    timeframe: OfficialTimeframe,
    options: { period1: Date; period2: Date },
  ) => {
    const key = snapshotCacheKey(symbol, timeframe, options);
    let pending = snapshotCache.get(key);
    if (!pending) {
      pending = provider.loadSeries(symbol, timeframe, options);
      snapshotCache.set(key, pending);
    }
    return pending;
  };

  const marketData: Pick<MarketDataProvider, "getCandles"> = {
    getCandles: async (_symbol: string, options: GetCandlesOptions) => {
      const requestedTimeframe: OfficialTimeframe = options.interval === "1wk"
        ? "1wk"
        : primaryTimeframe === "4h" && options.interval === "1h"
          ? "4h"
          : options.interval;
      const snapshot = await load(requestedTimeframe, options);
      if (requestedTimeframe === primaryTimeframe) {
        primarySnapshot = snapshot;
        onPrimarySnapshot?.(snapshot);
      }
      return stripOfficialMetadata(snapshot);
    },
  };

  return {
    marketData,
    getPrimarySnapshot: () => primarySnapshot,
  };
};

const createClosedCandleYahooProvider = (
  provider: Pick<MarketDataProvider, "getCandles">,
  now: () => Date,
  market: AnalysisRunOptions["metadata"]["market"],
): Pick<MarketDataProvider, "getCandles"> => ({
  getCandles: async (symbol, options) => {
    const response = await provider.getCandles(symbol, options);
    const nowSeconds = Math.floor(now().getTime() / 1000);
    return {
      ...response,
      candles: response.candles.filter(
        (candle) => yahooCandleCloseTime(candle.time, options.interval, market) <= nowSeconds,
      ),
    };
  },
});

const defaultAnalyze = async (options: AnalysisRunOptions): Promise<AnalysisPayload> => {
  const endpoint = new URL(`http://127.0.0.1/api/market/${encodeURIComponent(options.symbol)}`);
  endpoint.searchParams.set("tf", options.timeframe);
  endpoint.searchParams.set("days", String(options.days));
  const response = await analyzeSymbol(
    new Request(endpoint),
    { params: { symbol: options.symbol } },
    {
      marketData: options.marketData,
      preAggregatedTimeframe: options.preAggregatedTimeframe,
      metadata: options.metadata,
    },
  );
  const payload = await response.json().catch(() => null) as AnalysisPayload | null;
  if (!response.ok || !payload) {
    throw new WorkspaceRequestError(
      response.status,
      asText(payload?.error) ?? `${options.timeframe} 분석 데이터를 계산하지 못했습니다.`,
    );
  }
  return payload;
};

const officialAnalysis = async ({
  provider,
  snapshotCache,
  symbol,
  timeframe,
  days,
  metadata,
  analyze,
  dataSourceOverride,
}: {
  provider: OfficialSeriesProvider;
  snapshotCache: Map<string, Promise<CandleSeriesSnapshot>>;
  symbol: string;
  timeframe: OfficialTimeframe;
  days: number;
  metadata: AnalysisRunOptions["metadata"];
  analyze: (options: AnalysisRunOptions) => Promise<AnalysisPayload>;
  dataSourceOverride?: string;
}): Promise<AnalysisResult> => {
  const analysisMetadata: AnalysisRunOptions["metadata"] = { ...metadata };
  const tracked = createOfficialAnalysisProvider({
    provider,
    symbol,
    primaryTimeframe: timeframe,
    snapshotCache,
    onPrimarySnapshot: (snapshot) => {
      analysisMetadata.market = snapshot.market;
      analysisMetadata.currency = snapshot.currency;
      analysisMetadata.dataSource = dataSourceOverride ?? snapshot.dataSource;
      analysisMetadata.quoteAt = snapshot.quoteAt;
      analysisMetadata.stale = snapshot.stale;
    },
  });
  const payload = await analyze({
    symbol,
    timeframe,
    days,
    marketData: tracked.marketData,
    preAggregatedTimeframe: timeframe === "4h" ? "4h" : undefined,
    metadata: analysisMetadata,
  });
  return { payload, snapshot: tracked.getPrimarySnapshot() };
};

const yahooAnalysis = async ({
  provider,
  symbol,
  timeframe,
  days,
  metadata,
  analyze,
  now,
}: {
  provider: Pick<MarketDataProvider, "getCandles">;
  symbol: string;
  timeframe: "1h" | "1d";
  days: number;
  metadata: AnalysisRunOptions["metadata"];
  analyze: (options: AnalysisRunOptions) => Promise<AnalysisPayload>;
  now: () => Date;
}): Promise<AnalysisResult> => {
  const analysisMetadata: AnalysisRunOptions["metadata"] = { ...metadata };
  const trackedProvider: Pick<MarketDataProvider, "getCandles"> = {
    getCandles: async (requestedSymbol, options) => {
      const response = await provider.getCandles(requestedSymbol, options);
      if (options.interval === timeframe) {
        const latest = response.candles.at(-1);
        if (latest) {
          const closeTime = yahooCandleCloseTime(latest.time, timeframe, analysisMetadata.market);
          const age = now().getTime() - closeTime * 1_000;
          const staleThresholdHours = timeframe === "1h" ? 8 : 96;
          analysisMetadata.quoteAt = new Date(closeTime * 1_000).toISOString();
          analysisMetadata.stale = age > staleThresholdHours * 60 * 60 * 1_000;
        }
      }
      return response;
    },
  };
  return {
    payload: await analyze({
      symbol,
      timeframe,
      days,
      marketData: trackedProvider,
      metadata: analysisMetadata,
    }),
    snapshot: null,
  };
};

const getBasis = (analysis: AnalysisPayload | null) =>
  asObject(analysis?.analysisBasis);

const getReliabilityGrade = (analysis: AnalysisPayload | null): PlanReliabilityGrade => {
  const reliability = asObject(analysis?.signalReliability);
  const grade = asText(reliability?.grade);
  return grade === "high" || grade === "medium" || grade === "low" || grade === "insufficient-data"
    ? grade
    : "insufficient-data";
};

const getMarketGate = (analysis: AnalysisPayload | null) => {
  const breakout = asObject(analysis?.breakoutRule);
  const status = asText(breakout?.status);
  if (!status) return null;
  return status !== "risk-off" && status !== "avoid";
};

const getTrendQuality = (analysis: AnalysisPayload | null) => {
  const basis = getBasis(analysis);
  const adx = asNumber(basis?.adx14);
  const choppiness = asNumber(basis?.choppiness14);
  if (adx === null || choppiness === null) return null;
  return adx >= 25 && choppiness <= 61.8;
};

const buildHorizonContext = ({
  symbol,
  assetClass,
  entryPrice,
  stale,
  staleByHorizon,
  quoteAtByHorizon,
  dataSource,
  market,
  currency,
  quoteAt,
  generatedAt,
  oneHour,
  fourHour,
  daily,
}: {
  symbol: string;
  assetClass: MarketWorkspaceAssetClass;
  entryPrice: number;
  stale: boolean;
  staleByHorizon: HorizonPlanContext["staleByHorizon"];
  quoteAtByHorizon: HorizonPlanContext["quoteAtByHorizon"];
  dataSource: string;
  market: string;
  currency: "KRW" | "USD";
  quoteAt: string;
  generatedAt: string;
  oneHour: AnalysisPayload;
  fourHour: AnalysisPayload | null;
  daily: AnalysisPayload;
}): HorizonPlanContext => {
  const oneHourBasis = getBasis(oneHour);
  const fourHourBasis = getBasis(fourHour);
  const dailyBasis = getBasis(daily);
  const dailyTradeSetup = asObject(daily.tradeSetup);
  const oneHourTrend = asBoolean(oneHourBasis?.trendUp);
  const fourHourTrend = asBoolean(fourHourBasis?.trendUp);
  const dailyTrend = asBoolean(dailyBasis?.trendUp);

  return {
    symbol,
    market,
    currency,
    dataSource,
    quoteAt,
    generatedAt,
    entryPrice,
    stale,
    staleByHorizon,
    quoteAtByHorizon,
    reliabilityGrade: getReliabilityGrade(daily),
    day: {
      atr14: asNumber(oneHourBasis?.atr14),
      recentLow20: asNumber(oneHourBasis?.recentLow20),
      resistance: asNumber(oneHourBasis?.recentHigh20),
      higherTimeframe: assetClass === "crypto" ? "4h" : "1d",
      higherTimeframeTrendUp: assetClass === "crypto" ? fourHourTrend : dailyTrend,
      entryTrendUp: oneHourTrend,
      trendQualityPassed: getTrendQuality(oneHour),
      volumeConfirmed: (() => {
        const ratio = asNumber(oneHourBasis?.volumeRatio20);
        return ratio === null ? null : ratio >= 1;
      })(),
      latestBarClosed: true,
    },
    swing: {
      atr14Daily: asNumber(dailyBasis?.atr14),
      failureLevel: asNumber(dailyTradeSetup?.failureLevel) ?? asNumber(dailyBasis?.recentLow20),
      resistance: asNumber(dailyBasis?.recentHigh20),
      sma20: asNumber(dailyBasis?.sma20),
      chandelierLong: asNumber(dailyBasis?.chandelierLong),
      marketGatePassed: getMarketGate(daily),
      dailyTrendUp: dailyTrend,
      entryTimeframe: assetClass === "crypto" ? "4h" : "1h",
      entryTrendUp: assetClass === "crypto" ? fourHourTrend : oneHourTrend,
      confirmationTimeframe: assetClass === "crypto" ? "1h" : null,
      confirmationTrendUp: assetClass === "crypto" ? oneHourTrend : null,
      latestBarClosed: true,
    },
    long: {
      sma200: asNumber(dailyBasis?.sma200),
      tenMonthAverage: asNumber(dailyBasis?.tenMonthAverage),
      weeklySma20: asNumber(dailyBasis?.weeklySma20),
      weeklySma60: asNumber(dailyBasis?.weeklySma60),
      marketGatePassed: getMarketGate(daily),
      latestBarClosed: true,
    },
  };
};

const uniqueWarnings = (warnings: Array<string | null | undefined>) =>
  [...new Set(warnings.filter((warning): warning is string => Boolean(warning)))];

const safeProviderFailure = (error: unknown, credentials: TossCredentials | null) => {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [credentials?.clientId, credentials?.clientSecret]) {
    if (secret) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message
    .replace(/(client[_ -]?secret|access[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 240);
};

const withLatestClose = (analysis: AnalysisPayload) => ({
  ...analysis,
  latestClose: latestCandleClose(analysis),
});

const latestQuoteAt = (analyses: Array<AnalysisPayload | null>) => analyses
  .map((analysis) => asText(analysis?.quoteAt))
  .filter((value): value is string => value !== null)
  .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

const isYahooStale = (analysis: AnalysisPayload, now: Date, thresholdHours: number) => {
  const quoteAt = asText(analysis.quoteAt);
  if (!quoteAt) return true;
  const age = now.getTime() - Date.parse(quoteAt);
  return !Number.isFinite(age) || age > thresholdHours * 60 * 60 * 1_000;
};

const FIXTURE_NOW = new Date("2026-07-10T12:00:00.000Z");

const fixtureStepSeconds: Record<OfficialTimeframe, number> = {
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1wk": 7 * 24 * 60 * 60,
};

const createFixtureSeriesProvider = (): OfficialSeriesProvider => ({
  loadSeries: async (symbol, timeframe, options) => {
    const isCrypto = /(?:^KRW-|-(?:USD|USDT|USDC)$)/i.test(symbol);
    const market = isCrypto
      ? "CRYPTO" as const
      : /\.KQ$/i.test(symbol)
        ? "KOSDAQ" as const
        : /^\d{6}(?:\.KS)?$/i.test(symbol)
          ? "KOSPI" as const
          : "US" as const;
    const currency = market === "US" ? "USD" as const : "KRW" as const;
    const dataSource = isCrypto ? "upbit" as const : "toss" as const;
    const step = fixtureStepSeconds[timeframe];
    const period1 = Math.floor(options.period1.getTime() / 1_000);
    const period2 = Math.floor(options.period2.getTime() / 1_000);
    const available = Math.max(1, Math.floor((period2 - period1) / step));
    const count = Math.min(900, available);
    const start = period2 - count * step;
    const priceScale = isCrypto ? 100_000_000 : market === "US" ? 200 : 75_000;
    const candles = Array.from({ length: count }, (_, index) => {
      const trend = 0.72 + index / Math.max(count - 1, 1) * 0.28;
      const wave = Math.sin(index / 11) * 0.004;
      const close = priceScale * (trend + wave);
      const open = close * (1 - Math.sin(index / 5) * 0.002);
      return {
        time: start + index * step,
        closeTime: start + (index + 1) * step,
        open,
        high: Math.max(open, close) * 1.006,
        low: Math.min(open, close) * 0.994,
        close,
        volume: 1_000 + (index % 20) * 35 + (index === count - 1 ? 800 : 0),
        isClosed: true,
        isPartialSessionBar: false,
      };
    });
    const lastClosed = candles.at(-1);
    return {
      symbol: symbol.trim().toUpperCase(),
      sourceSymbol: isCrypto ? `KRW-${symbol.split("-")[0]}` : symbol.replace(/\.(?:KS|KQ)$/i, ""),
      market,
      currency,
      dataSource,
      timeframe,
      sessionPolicy: isCrypto ? "continuous" : "regular",
      fetchedAt: FIXTURE_NOW.toISOString(),
      quoteAt: lastClosed ? new Date(lastClosed.closeTime * 1_000).toISOString() : null,
      stale: false,
      candles,
      warnings: ["테스트 fixture 데이터입니다. 실제 투자 판단이나 주문에 사용하지 마세요."],
    };
  },
});

export const createMarketWorkspaceFixtureDependencies = (): MarketWorkspaceDependencies => ({
  now: () => new Date(FIXTURE_NOW),
  fixtureMode: true,
  fixtureProvider: createFixtureSeriesProvider(),
});

export const buildMarketWorkspace = async (
  request: Request,
  options: MarketWorkspaceHandlerOptions,
) => {
  const url = new URL(request.url);
  const symbolInput = (url.searchParams.get("symbol") ?? "").trim();
  const assetClassInput = url.searchParams.get("assetClass");
  const sourceInput = url.searchParams.get("source") ?? "auto";
  const entryPriceInput = url.searchParams.get("entryPrice");

  if (!symbolInput || symbolInput.length > 32) {
    throw new WorkspaceRequestError(400, "유효한 symbol 값이 필요합니다.");
  }
  if (assetClassInput !== "stock" && assetClassInput !== "crypto") {
    throw new WorkspaceRequestError(400, "assetClass는 stock 또는 crypto여야 합니다.");
  }
  if (!new Set<MarketWorkspaceSource>(["auto", "toss", "yahoo", "upbit"]).has(sourceInput as MarketWorkspaceSource)) {
    throw new WorkspaceRequestError(400, "source는 auto, toss, yahoo, upbit 중 하나여야 합니다.");
  }

  const assetClass = assetClassInput;
  const requestedSource = sourceInput as MarketWorkspaceSource;
  if (assetClass === "stock" && requestedSource === "upbit") {
    throw new WorkspaceRequestError(400, "주식 분석에는 upbit source를 사용할 수 없습니다.");
  }
  if (assetClass === "crypto" && requestedSource !== "auto" && requestedSource !== "upbit") {
    throw new WorkspaceRequestError(400, "크립토 분석에는 upbit source를 사용하세요.");
  }
  if (assetClass === "crypto" && !/^KRW-[A-Z0-9]+$/i.test(symbolInput)) {
    throw new WorkspaceRequestError(400, "현재 크립토 분석은 Upbit KRW 마켓(예: KRW-BTC)만 지원합니다.");
  }

  const parsedEntryPrice = entryPriceInput === null ? null : Number(entryPriceInput);
  if (entryPriceInput !== null && !isFinitePositive(parsedEntryPrice)) {
    throw new WorkspaceRequestError(400, "entryPrice는 0보다 큰 숫자여야 합니다.");
  }

  const dependencies = options.dependencies ?? {};
  const fixtureMode = dependencies.fixtureMode === true && Boolean(dependencies.fixtureProvider);
  const now = dependencies.now ?? (() => new Date());
  const analyze = dependencies.analyze ?? defaultAnalyze;
  const loadCredentials = dependencies.loadTossCredentials ?? (
    (userId: string) => loadDecryptedCredentials(userId, "toss")
  );
  const createTossProvider = dependencies.createTossProvider ?? (
    (credentials: TossCredentials) => new TossMarketDataProvider({
      reader: createTossClient(credentials),
    })
  );
  const symbol = assetClass === "crypto"
    ? normalizeCryptoAnalysisSymbol(symbolInput)
    : symbolInput.toUpperCase();
  const stockMarket = assetClass === "stock" ? marketForStock(symbol) : "CRYPTO";
  const fallbackCurrency = stockMarket === "US" ? "USD" : "KRW";
  const snapshotCache = new Map<string, Promise<CandleSeriesSnapshot>>();

  let source: ResolvedMarketWorkspaceSource;
  let officialProvider: OfficialSeriesProvider | null = null;
  let tossCredentials: TossCredentials | null = null;
  let tossFallbackWarning: string | null = null;
  if (fixtureMode) {
    source = "fixture";
    officialProvider = dependencies.fixtureProvider ?? null;
  } else if (assetClass === "crypto") {
    source = "upbit";
    officialProvider = dependencies.upbitProvider ?? sharedUpbitProvider;
  } else if (requestedSource === "yahoo") {
    source = "yahoo";
  } else {
    const credentials = await loadCredentials(options.userId);
    if (credentials) {
      tossCredentials = credentials;
      source = "toss";
      officialProvider = createTossProvider(credentials);
    } else if (requestedSource === "toss") {
      throw new WorkspaceRequestError(409, "Toss API 자격증명이 없습니다. 설정에서 연결하거나 source=auto를 사용하세요.");
    } else {
      source = "yahoo";
    }
  }

  let oneHourResult: AnalysisResult;
  let fourHourResult: AnalysisResult | null = null;
  let dailyResult: AnalysisResult;
  const runYahooAnalyses = async () => {
    const metadata: AnalysisRunOptions["metadata"] = {
      market: stockMarket,
      currency: fallbackCurrency,
      dataSource: "yahoo",
    };
    const yahooProvider = createClosedCandleYahooProvider(
      dependencies.yahooProvider ?? getMarketDataProvider(),
      now,
      stockMarket,
    );
    return Promise.all([
      yahooAnalysis({ provider: yahooProvider, symbol, timeframe: "1h", days: 30, metadata, analyze, now }),
      yahooAnalysis({ provider: yahooProvider, symbol, timeframe: "1d", days: 365, metadata, analyze, now }),
    ]);
  };

  if (officialProvider) {
    const metadata: AnalysisRunOptions["metadata"] = {
      market: stockMarket,
      currency: fallbackCurrency,
      dataSource: source,
    };
    try {
      const [oneHour, daily, fourHour] = await Promise.all([
        officialAnalysis({
          provider: officialProvider,
          snapshotCache,
          symbol,
          timeframe: "1h",
          days: 30,
          metadata,
          analyze,
          dataSourceOverride: source === "fixture" ? "fixture" : undefined,
        }),
        officialAnalysis({
          provider: officialProvider,
          snapshotCache,
          symbol,
          timeframe: "1d",
          days: 365,
          metadata,
          analyze,
          dataSourceOverride: source === "fixture" ? "fixture" : undefined,
        }),
        assetClass === "crypto"
          ? officialAnalysis({
            provider: officialProvider,
            snapshotCache,
            symbol,
            timeframe: "4h",
            days: 90,
            metadata,
            analyze,
            dataSourceOverride: source === "fixture" ? "fixture" : undefined,
          })
          : Promise.resolve(null),
      ]);
      oneHourResult = oneHour;
      dailyResult = daily;
      fourHourResult = fourHour;
    } catch (error) {
      if (assetClass === "stock" && source === "toss" && requestedSource === "auto") {
        const reason = safeProviderFailure(error, tossCredentials);
        tossFallbackWarning = `Toss 공식 시세 조회 실패로 Yahoo fallback을 사용했습니다: ${reason}`;
        source = "yahoo";
        [oneHourResult, dailyResult] = await runYahooAnalyses();
      } else if (source === "toss") {
        throw new WorkspaceRequestError(
          502,
          `Toss 공식 시세 조회에 실패했습니다: ${safeProviderFailure(error, tossCredentials)}`,
        );
      } else {
        throw error;
      }
    }
  } else {
    [oneHourResult, dailyResult] = await runYahooAnalyses();
  }

  const oneHour = oneHourResult.payload;
  const fourHour = fourHourResult?.payload ?? null;
  const daily = dailyResult.payload;
  const primarySnapshot = oneHourResult.snapshot;
  const resolvedMarket = asText(daily.market) ?? primarySnapshot?.market ?? stockMarket;
  const resolvedCurrency = (daily.currency === "KRW" || daily.currency === "USD")
    ? daily.currency
    : primarySnapshot?.currency ?? fallbackCurrency;
  const quoteAt = latestQuoteAt([oneHour, fourHour, daily]);
  if (!quoteAt) {
    throw new WorkspaceRequestError(422, "확정된 최근 봉의 기준 시각을 확인할 수 없습니다.");
  }
  const entryPrice = parsedEntryPrice
    ?? latestCandleClose(oneHour)
    ?? latestCandleClose(daily);
  if (!isFinitePositive(entryPrice)) {
    throw new WorkspaceRequestError(422, "확정된 최근 종가 또는 유효한 entryPrice가 필요합니다.");
  }

  const officialSnapshots = [
    oneHourResult.snapshot,
    fourHourResult?.snapshot ?? null,
    dailyResult.snapshot,
  ].filter((snapshot): snapshot is CandleSeriesSnapshot => snapshot !== null);
  const oneHourStale = asBoolean(oneHour.stale)
    ?? (source === "yahoo" ? isYahooStale(oneHour, now(), 8) : oneHourResult.snapshot?.stale ?? true);
  const fourHourStale = fourHour
    ? asBoolean(fourHour.stale) ?? fourHourResult?.snapshot?.stale ?? true
    : false;
  const dailyStale = asBoolean(daily.stale)
    ?? (source === "yahoo" ? isYahooStale(daily, now(), 96) : dailyResult.snapshot?.stale ?? true);
  const staleByHorizon: NonNullable<HorizonPlanContext["staleByHorizon"]> = {
    day: oneHourStale || (assetClass === "crypto" ? fourHourStale : dailyStale),
    swing: dailyStale || oneHourStale || (assetClass === "crypto" && fourHourStale),
    long: dailyStale,
  };
  const stale = Object.values(staleByHorizon).some(Boolean);
  const quoteAtByHorizon: NonNullable<HorizonPlanContext["quoteAtByHorizon"]> = {
    day: asText(oneHour.quoteAt) ?? quoteAt,
    swing: assetClass === "crypto"
      ? asText(fourHour?.quoteAt) ?? asText(oneHour.quoteAt) ?? quoteAt
      : asText(oneHour.quoteAt) ?? quoteAt,
    long: asText(daily.quoteAt) ?? quoteAt,
  };
  const generatedAt = now().toISOString();
  const horizonContext = buildHorizonContext({
    symbol,
    assetClass,
    entryPrice,
    stale,
    staleByHorizon,
    quoteAtByHorizon,
    dataSource: source,
    market: resolvedMarket,
    currency: resolvedCurrency,
    quoteAt,
    generatedAt,
    oneHour,
    fourHour,
    daily,
  });
  const warnings = uniqueWarnings([
    ...officialSnapshots.flatMap((snapshot) => snapshot.warnings),
    tossFallbackWarning,
    source === "yahoo" && !tossFallbackWarning
      ? "Toss API가 연결되지 않아 Yahoo fallback 데이터를 사용했습니다. 실제 주문 전 공식 시세로 다시 확인하세요."
      : null,
    source === "fixture"
      ? "테스트 fixture 모드입니다. 네트워크·자격증명 없이 UI 흐름만 검증하며 실제 투자 판단에 사용할 수 없습니다."
      : null,
    assetClass === "stock"
      ? "주식은 6.5시간 정규장의 부분 4시간봉 왜곡을 피하기 위해 일봉 방향과 1시간봉 진입을 사용합니다."
      : "크립토는 일봉 방향, 4시간봉 진입, 1시간봉 재확인을 사용합니다.",
    stale ? "최근 확정 봉이 오래되어 신규 진입 상태는 보수적으로 해석해야 합니다." : null,
  ]);

  return {
    symbol: assetClass === "crypto" ? normalizeUpbitMarket(symbolInput) : symbol,
    analysisSymbol: symbol,
    requestedSymbol: symbolInput.toUpperCase(),
    assetClass,
    market: resolvedMarket,
    currency: resolvedCurrency,
    dataSource: source,
    quoteAt,
    generatedAt,
    stale,
    analyses: {
      oneHour: withLatestClose(oneHour),
      fourHour: fourHour ? withLatestClose(fourHour) : null,
      daily: withLatestClose(daily),
    },
    horizonPlans: calculateHorizonExitPlans(horizonContext),
    warnings,
    orderSubmissionAttempted: false,
  };
};

export const handleMarketWorkspaceRequest = async (
  request: Request,
  options: MarketWorkspaceHandlerOptions,
): Promise<Response> => {
  try {
    const payload = await buildMarketWorkspace(request, options);
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof WorkspaceRequestError ? error.status : 500;
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
      orderSubmissionAttempted: false,
    }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
};
