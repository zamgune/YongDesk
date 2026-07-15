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
import { buildCrashReversalTradePlan } from "@/lib/market/trade-playbook";
import {
  loadPlaybookExternalContext,
  unavailablePlaybookExternalContext,
  type PlaybookExternalContext,
  type PlaybookExternalContextInput,
} from "@/lib/market/playbook-external-context";
import {
  EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
  type PlaybookCalibrationRegistry,
} from "@/lib/market/playbook-calibrations";
import type { TradePlaybookPlan } from "@/domain/market-playbook";
import type { MarketCandle } from "@/lib/market-data/types";
import { createTossClient, TossApiError, type TossCredentials } from "@/lib/toss/client";
import type {
  Candle,
  CandlePageResponse,
  KrMarketCalendarResponse,
  KrMarketDay,
  MarketIndicatorCandle,
  MarketIndicatorCandlePageResponse,
} from "@/lib/toss/types";
import { listWatchlist, type WatchlistItem } from "./watchlist";
import { loadPlaybookCalibrationRegistry } from "./playbook-calibration-registry";

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
  tradePlan: TradePlaybookPlan;
};

export type WatchlistSignalScanResponse = {
  generatedAt: string;
  monitoringStatus: "ready" | "credential-required" | "empty" | "error";
  monitoringMessage: string;
  marketContext: CrashMarketContext;
  items: WatchlistSignalItem[];
  isBrokerStopEligible: false;
  orderSubmissionAttempted: false;
};

export type WatchlistVolumeReferenceStore = {
  version: 1;
  updatedAt: string;
  candlesBySymbol: Record<string, MarketCandle[]>;
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
  getKrMarketCalendar: (date?: string) => Promise<KrMarketCalendarResponse>;
};

export type WatchlistSignalScanDependencies = {
  now?: () => Date;
  listItems?: () => Promise<WatchlistItem[]>;
  loadCredentials?: () => Promise<TossCredentials | null>;
  createReader?: (credentials: TossCredentials) => SignalReader;
  readStore?: () => Promise<SignalStore | null>;
  writeStore?: (store: SignalStore) => Promise<void>;
  readVolumeReferenceStore?: () => Promise<WatchlistVolumeReferenceStore | null>;
  writeVolumeReferenceStore?: (store: WatchlistVolumeReferenceStore) => Promise<void>;
  loadPlaybookExternalContext?: (
    input: PlaybookExternalContextInput,
  ) => Promise<PlaybookExternalContext>;
  loadCalibrationRegistry?: () => Promise<PlaybookCalibrationRegistry>;
  requestSpacingMs?: number;
};

const SIGNAL_STORE_PATH = stockAnalysisStoragePath("watchlist", "crash-signals.json");
const VOLUME_REFERENCE_STORE_PATH = stockAnalysisStoragePath("watchlist", "crash-volume-reference.json");
const DAILY_CACHE_TTL_MS = 10 * 60 * 1_000;
const SIGNAL_FRESHNESS_MS = 7 * 60 * 1_000;
const MAX_VOLUME_REFERENCE_SESSIONS = 30;
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
  isBrokerStopEligible: false,
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

const readVolumeReferenceStore = async (): Promise<WatchlistVolumeReferenceStore | null> => {
  try {
    const value = JSON.parse(await readFile(VOLUME_REFERENCE_STORE_PATH, "utf8")) as WatchlistVolumeReferenceStore;
    return value.version === 1 && value.candlesBySymbol && typeof value.candlesBySymbol === "object"
      ? value
      : null;
  } catch {
    return null;
  }
};

const writeVolumeReferenceStore = async (store: WatchlistVolumeReferenceStore) => {
  await mkdir(dirname(VOLUME_REFERENCE_STORE_PATH), { recursive: true });
  const temporaryPath = `${VOLUME_REFERENCE_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, VOLUME_REFERENCE_STORE_PATH);
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

export const retainVolumeReferenceCandles = (
  candles: MarketCandle[],
  maxSessions = MAX_VOLUME_REFERENCE_SESSIONS,
) => {
  const deduped = new Map<number, MarketCandle>();
  for (const candle of candles) {
    if (
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) && candle.open > 0 &&
      Number.isFinite(candle.high) && candle.high > 0 &&
      Number.isFinite(candle.low) && candle.low > 0 &&
      Number.isFinite(candle.close) && candle.close > 0 &&
      Number.isFinite(candle.volume) && candle.volume >= 0
    ) {
      deduped.set(candle.time, candle);
    }
  }
  const sorted = [...deduped.values()].toSorted((left, right) => left.time - right.time);
  const retainedDates = [...new Set(sorted.map((candle) =>
    kstDateKey(new Date(candle.time * 1_000))))]
    .slice(-Math.max(1, Math.floor(maxSessions)));
  const retainedDateSet = new Set(retainedDates);
  return sorted.filter((candle) => retainedDateSet.has(kstDateKey(new Date(candle.time * 1_000))));
};

export const selectPriorVolumeReferenceCandles = (
  candles: MarketCandle[],
  now: Date,
) => {
  const currentDate = kstDateKey(now);
  return retainVolumeReferenceCandles(candles).filter((candle) =>
    kstDateKey(new Date(candle.time * 1_000)) < currentDate);
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

export type ClosedFiveMinuteCandleSessions = {
  currentSessionCandles: MarketCandle[];
  priorSessionReferenceCandles: MarketCandle[];
};

export type KrSessionWindow = {
  date: string;
  startTime: number | null;
  endTime: number | null;
};

const parseKrSessionTime = (date: string, value: string) => {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return Math.floor(direct / 1_000);
  const normalized = value.trim().length === 5 ? `${value}:00` : value.trim();
  const local = Date.parse(`${date}T${normalized}+09:00`);
  return Number.isFinite(local) ? Math.floor(local / 1_000) : null;
};

const krSessionWindow = (day: KrMarketDay): KrSessionWindow => {
  const regular = day.integrated?.regularMarket ?? null;
  if (!regular) return { date: day.date, startTime: null, endTime: null };
  return {
    date: day.date,
    startTime: parseKrSessionTime(day.date, regular.startTime),
    endTime: parseKrSessionTime(day.date, regular.endTime),
  };
};

export const krSessionWindowsFromCalendar = (
  calendar: KrMarketCalendarResponse,
): KrSessionWindow[] => [
  krSessionWindow(calendar.previousBusinessDay),
  krSessionWindow(calendar.today),
  krSessionWindow(calendar.nextBusinessDay),
];

export const partitionClosedFiveMinuteCandles = (
  rawCandles: Array<Candle | MarketIndicatorCandle>,
  now: Date,
  sessionWindows?: readonly KrSessionWindow[],
): ClosedFiveMinuteCandleSessions => {
  const schedule = sessionWindows
    ? new Map(sessionWindows.map((window) => [window.date, window]))
    : null;
  const buckets = new Map<number, MarketCandle[]>();
  const deduped = new Map<number, MarketCandle>();
  for (const raw of rawCandles) {
    const candle = parseCandle(raw);
    if (!candle) continue;
    deduped.set(candle.time, candle);
  }
  for (const candle of deduped.values()) {
    if (candle.time % 60 !== 0) continue;
    const date = kstDateKey(new Date(candle.time * 1_000));
    const session = schedule?.get(date);
    if (schedule) {
      if (
        !session ||
        session.startTime === null ||
        session.endTime === null ||
        candle.time < session.startTime ||
        candle.time >= session.endTime
      ) continue;
    } else {
      const minutes = kstSessionMinutes(candle.time);
      if (minutes < 9 * 60 || minutes >= 15 * 60 + 30) continue;
    }
    const bucket = Math.floor(candle.time / 300) * 300;
    const values = buckets.get(bucket) ?? [];
    values.push(candle);
    buckets.set(bucket, values);
  }
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const closedCandles = [...buckets.entries()]
    .filter(([bucket, values]) => {
      const times = values.map((candle) => candle.time).toSorted((left, right) => left - right);
      return bucket + 300 <= nowSeconds &&
        times.length === 5 &&
        times.every((time, index) => time === bucket + index * 60);
    })
    .toSorted(([left], [right]) => left - right)
    .map(([time, values]) => {
      const sorted = values.toSorted((left, right) => left.time - right.time);
      return {
        time,
        closeTime: time + 300,
        open: sorted[0].open,
        high: Math.max(...sorted.map((candle) => candle.high)),
        low: Math.min(...sorted.map((candle) => candle.low)),
        close: sorted.at(-1)!.close,
        volume: sorted.reduce((sum, candle) => sum + candle.volume, 0),
      } satisfies MarketCandle;
    });
  const currentDate = kstDateKey(now);
  return {
    currentSessionCandles: closedCandles.filter((candle) =>
      kstDateKey(new Date(candle.time * 1_000)) === currentDate),
    priorSessionReferenceCandles: closedCandles.filter((candle) =>
      kstDateKey(new Date(candle.time * 1_000)) < currentDate),
  };
};

export const aggregateClosedFiveMinuteCandles = (
  rawCandles: Array<Candle | MarketIndicatorCandle>,
  now: Date,
) => partitionClosedFiveMinuteCandles(rawCandles, now).currentSessionCandles;

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

const requiredEntryGateKinds = [
  "data",
  "market",
  "sector",
  "setup",
  "trigger",
  "liquidity",
  "risk",
  "reward",
] as const;

export const isWatchlistTradePlanEntryEligible = (
  plan: TradePlaybookPlan | null | undefined,
) => plan !== null &&
  plan !== undefined &&
  plan.id === "kr-intraday-crash-reversal" &&
  plan.stage === "calibrated" &&
  plan.action === "entry-ready" &&
  plan.calibration.status === "calibrated" &&
  plan.riskPlan.riskStatus === "valid" &&
  plan.blockers.length === 0 &&
  plan.isBrokerStopEligible === false &&
  plan.orderSubmissionAttempted === false &&
  plan.riskPlan.isBrokerStopEligible === false &&
  plan.riskPlan.orderSubmissionAttempted === false &&
  requiredEntryGateKinds.every((kind) => plan.gates.some((item) => item.kind === kind)) &&
  plan.gates.every((item) =>
    !item.blocking && (item.status === "pass" || item.status === "warning"));

const notificationId = (symbol: string, signal: CrashReversalSignal) =>
  signal.panicAt !== null && signal.confirmationAt !== null
    ? `${symbol}:${signal.panicAt}:${signal.confirmationAt}`
    : null;

const scanItem = async ({
  item,
  reader,
  now,
  marketContext,
  limited,
  previousNotificationId,
  volumeReferenceCandles,
  recordClosedCandles,
  sessionWindows,
  externalContext,
  calibrationRegistry,
}: {
  item: WatchlistItem;
  reader: SignalReader;
  now: Date;
  marketContext: CrashMarketContext;
  limited: <T>(request: () => Promise<T>) => Promise<T>;
  previousNotificationId: string | undefined;
  volumeReferenceCandles: MarketCandle[];
  recordClosedCandles: (candles: MarketCandle[]) => void;
  sessionWindows: readonly KrSessionWindow[];
  externalContext: PlaybookExternalContext;
  calibrationRegistry: PlaybookCalibrationRegistry;
}): Promise<WatchlistSignalItem> => {
  const generatedAt = now.toISOString();
  try {
    const sourceSymbol = item.symbol.replace(/\.(?:KS|KQ)$/i, "");
    const minuteResponse = await limited(() => reader.getCandles(sourceSymbol, {
      interval: "1m",
      count: 200,
      adjusted: true,
    }));
    const partitionedCandles = partitionClosedFiveMinuteCandles(
      minuteResponse.candles,
      now,
      sessionWindows,
    );
    const candles5m = partitionedCandles.currentSessionCandles;
    const priorSessionReferenceCandles = selectPriorVolumeReferenceCandles([
      ...volumeReferenceCandles,
      ...partitionedCandles.priorSessionReferenceCandles,
    ], now);
    recordClosedCandles([
      ...partitionedCandles.priorSessionReferenceCandles,
      ...partitionedCandles.currentSessionCandles,
    ]);
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
    const quoteAtSeconds = candles5m.at(-1)?.time === undefined ? null : candles5m.at(-1)!.time + 300;
    const quoteAt = quoteAtSeconds === null ? null : new Date(quoteAtSeconds * 1_000).toISOString();
    const stale = quoteAtSeconds === null || now.getTime() - quoteAtSeconds * 1_000 > 7 * 60 * 1_000;
    const signal = calculateCrashReversalSignal({
      candles5m,
      priorSessionReferenceCandles5m: priorSessionReferenceCandles,
      requireTimeOfDayVolumeReference: true,
      previousClose: dailyInputs?.previousClose ?? null,
      dailyAtr14: dailyInputs?.dailyAtr14 ?? null,
      marketContext,
    });
    const outputSignal: CrashReversalSignal = stale ? {
      ...signal,
      stage: "unavailable",
      confidence: "insufficient-data",
      label: "데이터 지연",
      detail: "신선한 Toss 확정 5분봉을 확인할 때까지 신호를 중단합니다.",
      blockers: [...signal.blockers, "Toss 확정 5분봉이 7분 이상 지연되었습니다."],
    } : signal;
    const id = notificationId(item.symbol, outputSignal);
    const tradePlan = buildCrashReversalTradePlan(outputSignal, generatedAt, {
      externalContext,
      calibrationRegistry,
    });
    const notificationEligible = !stale &&
      id !== null &&
      id !== previousNotificationId &&
      outputSignal.orderSubmissionAttempted === false &&
      outputSignal.exitPlan?.isBrokerStopEligible === false &&
      isWatchlistTradePlanEntryEligible(tradePlan);
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
      notificationEligible,
      notificationId: id,
      error: stale ? "Toss 확정 5분봉이 오래되어 알림을 중단했습니다." : null,
      signal: outputSignal,
      tradePlan,
    };
  } catch (error) {
    const message = safeError(error);
    const signal = unavailableSignal(message);
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
      signal,
      tradePlan: buildCrashReversalTradePlan(signal, generatedAt, {
        externalContext,
        calibrationRegistry,
      }),
    };
  }
};

export const failCloseStoredWatchlistSignals = (
  stored: WatchlistSignalScanResponse,
  now: Date,
): WatchlistSignalScanResponse => ({
  ...stored,
  monitoringMessage: stored.items.length === 0
    ? stored.monitoringMessage
    : "저장된 마지막 결과입니다. 현재 승인·시장·섹터 게이트를 재검증하지 않아 알림 후보로 사용하지 않습니다.",
  marketContext: unavailableMarketContext(),
  items: stored.items.map((item) => {
    const quoteTime = item.quoteAt === null ? Number.NaN : Date.parse(item.quoteAt);
    const quoteAgeMs = now.getTime() - quoteTime;
    const stale = item.stale ||
      !Number.isFinite(quoteTime) ||
      quoteAgeMs < 0 ||
      quoteAgeMs > SIGNAL_FRESHNESS_MS;
    const staleBlocker = "저장된 확정 5분봉이 현재 시각 기준 7분 이상 지연되었습니다.";
    const signal: CrashReversalSignal = stale ? {
      ...item.signal,
      stage: "unavailable",
      confidence: "insufficient-data",
      label: "저장 데이터 지연",
      detail: "새 스캔에서 확정 5분봉과 외부 게이트를 다시 확인할 때까지 신호를 중단합니다.",
      blockers: [...new Set([...item.signal.blockers, staleBlocker])],
    } : item.signal;
    return {
      ...item,
      stale,
      notificationEligible: false,
      notificationId: null,
      error: stale ? staleBlocker : item.error,
      signal,
      tradePlan: buildCrashReversalTradePlan(signal, now.toISOString()),
    };
  }),
  isBrokerStopEligible: false,
  orderSubmissionAttempted: false,
});

export const getStoredWatchlistSignals = async (
  now: () => Date = () => new Date(),
): Promise<WatchlistSignalScanResponse> => {
  const stored = await readSignalStore();
  const currentTime = now();
  if (!stored) return emptyResponse(currentTime.toISOString());
  const response: WatchlistSignalScanResponse = {
    generatedAt: stored.generatedAt,
    monitoringStatus: stored.monitoringStatus,
    monitoringMessage: stored.monitoringMessage,
    marketContext: stored.marketContext,
    items: stored.items,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
  return failCloseStoredWatchlistSignals(response, currentTime);
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
      items: items.map((item) => {
        const signal = unavailableSignal("검증된 Toss API 연결이 필요합니다.");
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
          error: "Toss API 연결 필요",
          signal,
          tradePlan: buildCrashReversalTradePlan(signal, generatedAt),
        };
      }),
      isBrokerStopEligible: false,
      orderSubmissionAttempted: false,
    };
  }
  const reader = (dependencies.createReader ?? createTossClient)(credentials);
  const readStore = dependencies.readStore ?? readSignalStore;
  const writeStore = dependencies.writeStore ?? writeSignalStore;
  const readReferences = dependencies.readVolumeReferenceStore ?? readVolumeReferenceStore;
  const writeReferences = dependencies.writeVolumeReferenceStore ?? writeVolumeReferenceStore;
  const previous = await readStore();
  const previousReferences = await readReferences();
  const candlesBySymbol = Object.fromEntries(
    Object.entries(previousReferences?.candlesBySymbol ?? {})
      .filter((entry): entry is [string, MarketCandle[]] => Array.isArray(entry[1]))
      .map(([symbol, candles]) => [symbol, retainVolumeReferenceCandles(candles)]),
  );
  const deliveredNotificationIds = { ...(previous?.deliveredNotificationIds ?? {}) };
  const limited = createRateLimiter(Math.max(0, dependencies.requestSpacingMs ?? 260));
  const externalContextLoader = dependencies.loadPlaybookExternalContext ??
    (dependencies.createReader === undefined ? loadPlaybookExternalContext : null);
  const calibrationRegistryLoader = dependencies.loadCalibrationRegistry ??
    (dependencies.createReader === undefined
      ? async () => (await loadPlaybookCalibrationRegistry()).registry
      : null);
  let calibrationRegistry = EMPTY_PLAYBOOK_CALIBRATION_REGISTRY;
  if (calibrationRegistryLoader) {
    try {
      calibrationRegistry = await calibrationRegistryLoader();
    } catch {
      calibrationRegistry = EMPTY_PLAYBOOK_CALIBRATION_REGISTRY;
    }
  }
  let sessionWindows: KrSessionWindow[] = [];
  try {
    const calendar = await limited(() => reader.getKrMarketCalendar(kstDateKey(now)));
    sessionWindows = krSessionWindowsFromCalendar(calendar);
  } catch {
    sessionWindows = [];
  }
  let marketContext = unavailableMarketContext();
  try {
    const response = await limited(() => reader.getMarketIndicatorCandles("KOSPI", {
      interval: "1m",
      count: 200,
    }));
    const candles5m = sessionWindows.length > 0
      ? partitionClosedFiveMinuteCandles(response.candles, now, sessionWindows).currentSessionCandles
      : [];
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
    let externalContext = unavailablePlaybookExternalContext(
      generatedAt,
      "관심종목 급락 감시에 실제 시장 breadth·섹터 상대강도 loader가 연결되지 않았습니다.",
    );
    if (externalContextLoader) {
      try {
        externalContext = await externalContextLoader({
          symbol: item.symbol,
          market: item.symbol.toUpperCase().endsWith(".KQ") ? "KOSDAQ" : "KOSPI",
          generatedAt,
        });
      } catch (error) {
        externalContext = unavailablePlaybookExternalContext(
          generatedAt,
          `외부 게이트 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const result = await scanItem({
      item,
      reader,
      now,
      marketContext,
      limited,
      previousNotificationId: deliveredNotificationIds[item.symbol],
      volumeReferenceCandles: candlesBySymbol[item.symbol] ?? [],
      recordClosedCandles: (candles) => {
        candlesBySymbol[item.symbol] = retainVolumeReferenceCandles([
          ...(candlesBySymbol[item.symbol] ?? []),
          ...candles,
        ]);
      },
      sessionWindows,
      externalContext,
      calibrationRegistry,
    });
    if (result.notificationEligible && result.notificationId) {
      deliveredNotificationIds[item.symbol] = result.notificationId;
    }
    results.push(result);
  }
  const response: WatchlistSignalScanResponse = {
    generatedAt,
    monitoringStatus: results.some((item) => item.error === null) ? "ready" : "error",
    monitoringMessage: results.some((item) =>
      !item.stale &&
      item.signal.orderSubmissionAttempted === false &&
      item.signal.exitPlan?.isBrokerStopEligible === false &&
      isWatchlistTradePlanEntryEligible(item.tradePlan))
      ? "매수 검토 가능 신호가 있습니다. 주문은 전송하지 않았습니다."
      : results.some((item) => item.tradePlan.action === "watch")
        ? "급락반등 후보가 있지만 검증 승격 또는 현재 게이트 확인 전이므로 알림하지 않습니다."
        : "관심종목 급락 반전 조건을 확인했습니다.",
    marketContext,
    items: results,
    isBrokerStopEligible: false,
    orderSubmissionAttempted: false,
  };
  await writeReferences({
    version: 1,
    updatedAt: generatedAt,
    candlesBySymbol,
  });
  await writeStore({ ...response, deliveredNotificationIds });
  return response;
};
