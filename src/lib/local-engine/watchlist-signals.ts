import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ATR } from "technicalindicators";

import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import {
  assessCrashMarketContext,
  calculateCrashReversalSignal,
  type CrashMarketContext,
  type CrashReversalSignal,
} from "@/lib/market/crash-reversal-signal";
import type { MarketCandle } from "@/lib/market-data/types";
import { createTossClient, TossApiError, type TossCredentials } from "@/lib/toss/client";
import type {
  Candle,
  CandlePageResponse,
  MarketIndicatorCandle,
  MarketIndicatorCandlePageResponse,
} from "@/lib/toss/types";
import { listWatchlist, type WatchlistItem } from "./watchlist";

export type WatchlistSignalItem = {
  id: string;
  symbol: string;
  name: string | null;
  market: string;
  currency: "KRW";
  dataSource: "toss";
  generatedAt: string;
  quoteAt: string | null;
  stale: boolean;
  notificationEligible: boolean;
  notificationId: string | null;
  error: string | null;
  signal: CrashReversalSignal;
};

export type WatchlistSignalScanResponse = {
  generatedAt: string;
  monitoringStatus: "ready" | "credential-required" | "empty" | "error";
  monitoringMessage: string;
  marketContext: CrashMarketContext;
  items: WatchlistSignalItem[];
  orderSubmissionAttempted: false;
};

type SignalStore = WatchlistSignalScanResponse & {
  deliveredNotificationIds: Record<string, string>;
};

type SignalReader = {
  getCandles: (
    symbol: string,
    options: { interval: "1m" | "1d"; count?: number; before?: string; adjusted?: boolean },
  ) => Promise<CandlePageResponse>;
  getMarketIndicatorCandles: (
    symbol: "KOSPI" | "KOSDAQ",
    options: { interval: "1m" | "1d"; count?: number; before?: string },
  ) => Promise<MarketIndicatorCandlePageResponse>;
};

export type WatchlistSignalScanDependencies = {
  now?: () => Date;
  listItems?: () => Promise<WatchlistItem[]>;
  loadCredentials?: () => Promise<TossCredentials | null>;
  createReader?: (credentials: TossCredentials) => SignalReader;
  readStore?: () => Promise<SignalStore | null>;
  writeStore?: (store: SignalStore) => Promise<void>;
  requestSpacingMs?: number;
};

const SIGNAL_STORE_PATH = stockAnalysisStoragePath("watchlist", "crash-signals.json");
const DAILY_CACHE_TTL_MS = 10 * 60 * 1_000;
const dailyInputCache = new Map<string, {
  expiresAt: number;
  previousClose: number;
  dailyAtr14: number;
}>();

const unavailableMarketContext = (): CrashMarketContext => ({
  status: "unavailable",
  label: "KOSPI 확인 불가",
  changePct: null,
  recoveryPct: null,
  quoteAt: null,
});

const emptyResponse = (generatedAt: string): WatchlistSignalScanResponse => ({
  generatedAt,
  monitoringStatus: "empty",
  monitoringMessage: "감시할 한국 주식 관심종목이 없습니다.",
  marketContext: unavailableMarketContext(),
  items: [],
  orderSubmissionAttempted: false,
});

const readSignalStore = async (): Promise<SignalStore | null> => {
  try {
    const value = JSON.parse(await readFile(SIGNAL_STORE_PATH, "utf8")) as SignalStore;
    return Array.isArray(value.items) ? value : null;
  } catch {
    return null;
  }
};

const writeSignalStore = async (store: SignalStore) => {
  await mkdir(dirname(SIGNAL_STORE_PATH), { recursive: true });
  const temporaryPath = `${SIGNAL_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, SIGNAL_STORE_PATH);
};

const kstDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const kstSessionMinutes = (timestampSeconds: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestampSeconds * 1_000))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
};

const parseCandle = (candle: Candle | MarketIndicatorCandle): MarketCandle | null => {
  const timestamp = Date.parse(candle.timestamp);
  const open = Number(candle.openPrice);
  const high = Number(candle.highPrice);
  const low = Number(candle.lowPrice);
  const close = Number(candle.closePrice);
  const volume = Number(candle.volume);
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(open) || open <= 0 ||
    !Number.isFinite(high) || high <= 0 ||
    !Number.isFinite(low) || low <= 0 ||
    !Number.isFinite(close) || close <= 0 ||
    !Number.isFinite(volume) || volume < 0
  ) {
    return null;
  }
  return { time: Math.floor(timestamp / 1_000), open, high, low, close, volume };
};

export const aggregateClosedFiveMinuteCandles = (
  rawCandles: Array<Candle | MarketIndicatorCandle>,
  now: Date,
) => {
  const buckets = new Map<number, MarketCandle[]>();
  for (const raw of rawCandles) {
    const candle = parseCandle(raw);
    if (!candle) continue;
    const minutes = kstSessionMinutes(candle.time);
    if (minutes < 9 * 60 || minutes >= 15 * 60 + 30) continue;
    const bucket = Math.floor(candle.time / 300) * 300;
    const values = buckets.get(bucket) ?? [];
    values.push(candle);
    buckets.set(bucket, values);
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return [...buckets.entries()]
    .filter(([bucket]) => bucket + 300 <= nowSeconds)
    .toSorted(([left], [right]) => left - right)
    .map(([time, values]) => {
      const sorted = values.toSorted((left, right) => left.time - right.time);
      return {
        time,
        open: sorted[0].open,
        high: Math.max(...sorted.map((candle) => candle.high)),
        low: Math.min(...sorted.map((candle) => candle.low)),
        close: sorted.at(-1)!.close,
        volume: sorted.reduce((sum, candle) => sum + candle.volume, 0),
      } satisfies MarketCandle;
    });
};

const calculateDailyInputs = (rawCandles: Candle[], now: Date) => {
  const today = kstDateKey(now);
  const completed = rawCandles
    .map(parseCandle)
    .filter((candle): candle is MarketCandle => candle !== null)
    .filter((candle) => kstDateKey(new Date(candle.time * 1_000)) < today)
    .toSorted((left, right) => left.time - right.time);
  if (completed.length < 15) return null;
  const atr = ATR.calculate({
    high: completed.map((candle) => candle.high),
    low: completed.map((candle) => candle.low),
    close: completed.map((candle) => candle.close),
    period: 14,
  }).at(-1);
  const previousClose = completed.at(-1)?.close;
  if (!atr || !previousClose || atr <= 0 || previousClose <= 0) return null;
  return { previousClose, dailyAtr14: atr };
};

const unavailableSignal = (message: string): CrashReversalSignal => ({
  stage: "unavailable",
  confidence: "insufficient-data",
  label: "감시 불가",
  detail: message,
  reasons: [],
  blockers: [message],
  panicAt: null,
  confirmationAt: null,
  quoteAt: null,
  sessionChangePct: null,
  recentDropPct: null,
  volumeRatio: null,
  rsi14: null,
  rsi2: null,
  marketContext: unavailableMarketContext(),
  exitPlan: null,
  orderSubmissionAttempted: false,
});

const safeError = (error: unknown) => {
  if (error instanceof TossApiError) {
    return error.status === 429
      ? "Toss 요청 한도를 초과했습니다. Retry-After 이후 다시 감시합니다."
      : `Toss 시세 조회 실패 (${error.code})`;
  }
  return "Toss 시세를 불러오지 못했습니다.";
};

const createRateLimiter = (spacingMs: number) => {
  let nextRequestAt = 0;
  return async <T>(request: () => Promise<T>) => {
    const scheduledAt = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = scheduledAt + spacingMs;
    const delay = scheduledAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return request();
  };
};

const notificationId = (symbol: string, signal: CrashReversalSignal) =>
  signal.stage === "entry-ready" && signal.panicAt !== null && signal.confirmationAt !== null
    ? `${symbol}:${signal.panicAt}:${signal.confirmationAt}`
    : null;

const scanItem = async ({
  item,
  reader,
  now,
  marketContext,
  limited,
  previousNotificationId,
}: {
  item: WatchlistItem;
  reader: SignalReader;
  now: Date;
  marketContext: CrashMarketContext;
  limited: <T>(request: () => Promise<T>) => Promise<T>;
  previousNotificationId: string | undefined;
}): Promise<WatchlistSignalItem> => {
  const generatedAt = now.toISOString();
  try {
    const sourceSymbol = item.symbol.replace(/\.(?:KS|KQ)$/i, "");
    const minuteResponse = await limited(() => reader.getCandles(sourceSymbol, {
      interval: "1m",
      count: 200,
      adjusted: true,
    }));
    let dailyInputs = dailyInputCache.get(item.symbol);
    if (!dailyInputs || dailyInputs.expiresAt <= now.getTime()) {
      const dailyResponse = await limited(() => reader.getCandles(sourceSymbol, {
        interval: "1d",
        count: 40,
        adjusted: true,
      }));
      const calculated = calculateDailyInputs(dailyResponse.candles, now);
      dailyInputs = calculated ? { ...calculated, expiresAt: now.getTime() + DAILY_CACHE_TTL_MS } : undefined;
      if (dailyInputs) dailyInputCache.set(item.symbol, dailyInputs);
    }
    const candles5m = aggregateClosedFiveMinuteCandles(minuteResponse.candles, now);
    const quoteAtSeconds = candles5m.at(-1)?.time === undefined ? null : candles5m.at(-1)!.time + 300;
    const quoteAt = quoteAtSeconds === null ? null : new Date(quoteAtSeconds * 1_000).toISOString();
    const stale = quoteAtSeconds === null || now.getTime() - quoteAtSeconds * 1_000 > 7 * 60 * 1_000;
    const signal = calculateCrashReversalSignal({
      candles5m,
      previousClose: dailyInputs?.previousClose ?? null,
      dailyAtr14: dailyInputs?.dailyAtr14 ?? null,
      marketContext,
    });
    const id = notificationId(item.symbol, signal);
    return {
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      market: item.market,
      currency: "KRW",
      dataSource: "toss",
      generatedAt,
      quoteAt,
      stale,
      notificationEligible: !stale && id !== null && id !== previousNotificationId,
      notificationId: id,
      error: stale ? "Toss 확정 5분봉이 오래되어 알림을 중단했습니다." : null,
      signal: stale ? {
        ...signal,
        stage: "unavailable",
        confidence: "insufficient-data",
        label: "데이터 지연",
        detail: "신선한 Toss 확정 5분봉을 확인할 때까지 신호를 중단합니다.",
        blockers: [...signal.blockers, "Toss 확정 5분봉이 7분 이상 지연되었습니다."],
      } : signal,
    };
  } catch (error) {
    const message = safeError(error);
    return {
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      market: item.market,
      currency: "KRW",
      dataSource: "toss",
      generatedAt,
      quoteAt: null,
      stale: true,
      notificationEligible: false,
      notificationId: null,
      error: message,
      signal: unavailableSignal(message),
    };
  }
};

export const getStoredWatchlistSignals = async (): Promise<WatchlistSignalScanResponse> => {
  const stored = await readSignalStore();
  return stored ?? emptyResponse(new Date().toISOString());
};

export const scanWatchlistSignals = async (
  dependencies: WatchlistSignalScanDependencies = {},
): Promise<WatchlistSignalScanResponse> => {
  const now = (dependencies.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();
  const listItems = dependencies.listItems ?? (async () => (await listWatchlist()).items);
  const items = (await listItems()).filter((item) => item.assetClass === "stock" && item.market === "KR");
  if (!items.length) return emptyResponse(generatedAt);
  const loadCredentials = dependencies.loadCredentials ?? (
    () => loadDecryptedCredentials(process.env.STOCK_ANALYSIS_LOCAL_USER_ID?.trim() || "local-macos-user", "toss")
  );
  const credentials = await loadCredentials();
  if (!credentials) {
    return {
      generatedAt,
      monitoringStatus: "credential-required",
      monitoringMessage: "급락 감시는 검증된 Toss API 연결이 필요합니다.",
      marketContext: unavailableMarketContext(),
      items: items.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        market: item.market,
        currency: "KRW",
        dataSource: "toss",
        generatedAt,
        quoteAt: null,
        stale: true,
        notificationEligible: false,
        notificationId: null,
        error: "Toss API 연결 필요",
        signal: unavailableSignal("검증된 Toss API 연결이 필요합니다."),
      })),
      orderSubmissionAttempted: false,
    };
  }
  const reader = (dependencies.createReader ?? createTossClient)(credentials);
  const readStore = dependencies.readStore ?? readSignalStore;
  const writeStore = dependencies.writeStore ?? writeSignalStore;
  const previous = await readStore();
  const deliveredNotificationIds = { ...(previous?.deliveredNotificationIds ?? {}) };
  const limited = createRateLimiter(Math.max(0, dependencies.requestSpacingMs ?? 260));
  let marketContext = unavailableMarketContext();
  try {
    const response = await limited(() => reader.getMarketIndicatorCandles("KOSPI", {
      interval: "1m",
      count: 200,
    }));
    const candles5m = aggregateClosedFiveMinuteCandles(response.candles, now);
    const quoteAt = candles5m.at(-1)?.time === undefined
      ? null
      : new Date((candles5m.at(-1)!.time + 300) * 1_000).toISOString();
    const quoteAgeMs = quoteAt === null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(quoteAt);
    marketContext = quoteAgeMs > 7 * 60 * 1_000
      ? unavailableMarketContext()
      : assessCrashMarketContext(candles5m, quoteAt);
  } catch {
    marketContext = unavailableMarketContext();
  }
  const results: WatchlistSignalItem[] = [];
  for (const item of items) {
    const result = await scanItem({
      item,
      reader,
      now,
      marketContext,
      limited,
      previousNotificationId: deliveredNotificationIds[item.symbol],
    });
    if (result.notificationEligible && result.notificationId) {
      deliveredNotificationIds[item.symbol] = result.notificationId;
    }
    results.push(result);
  }
  const response: WatchlistSignalScanResponse = {
    generatedAt,
    monitoringStatus: results.some((item) => item.error === null) ? "ready" : "error",
    monitoringMessage: results.some((item) => item.signal.stage === "entry-ready")
      ? "매수 검토 가능 신호가 있습니다. 주문은 전송하지 않았습니다."
      : "관심종목 급락 반전 조건을 확인했습니다.",
    marketContext,
    items: results,
    orderSubmissionAttempted: false,
  };
  await writeStore({ ...response, deliveredNotificationIds });
  return response;
};
