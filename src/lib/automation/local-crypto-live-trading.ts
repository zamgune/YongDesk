import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export const LOCAL_CRYPTO_LIVE_TRADING_CONSENT = "코인 실거래 위험을 확인했습니다";
export const LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION = "코인 실거래 수동 주문 해제";
export const LOCAL_CRYPTO_LIVE_TRADING_AUTOMATION_CONFIRMATION = "코인 지정가 자동매매 해제";
export const LOCAL_CRYPTO_LIVE_TRADING_MAX_BUY_ORDER_KRW = 100_000;
export const LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW = 300_000;
export const LOCAL_CRYPTO_LIVE_ORDER_PREVIEW_TTL_MS = 10 * 60 * 1_000;
export const LOCAL_CRYPTO_AUTOMATION_MANUAL_ORDER_REQUIREMENT = 5;

export type CryptoLiveExchange = "upbit" | "bithumb";
export type CryptoLiveOrderSide = "buy" | "sell";
export type CryptoLiveOrderStatus =
  | "submission_pending"
  | "submitted"
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "unknown"
  | "rejected";

export type LocalCryptoLiveTradingPolicy = {
  installationId: string;
  exchange: CryptoLiveExchange;
  boundUserId: string | null;
  readinessVerifiedAt: string | null;
  bindingHash: string | null;
  userConsentAt: string | null;
  manualEnabled: boolean;
  automationEnabled: boolean;
  manualConfirmedOrderCount: number;
  restartReconciledAt: string | null;
  killSwitchVerifiedAt: string | null;
  dailyBuyKrwDate: string;
  dailyBuyKrwSubmitted: number;
  unknownLock: { attemptId: string; reason: string; lockedAt: string } | null;
};

export type LocalCryptoLiveOrderPreview = {
  id: string;
  userId: string;
  exchange: CryptoLiveExchange;
  source: "manual" | "automation";
  strategyKey: string | null;
  market: string;
  side: CryptoLiveOrderSide;
  volume: number;
  price: number;
  estimatedValue: number;
  clientOrderId: string;
  payloadHash: string;
  confirmationText: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type LocalCryptoLiveOrderAttempt = {
  id: string;
  userId: string;
  exchange: CryptoLiveExchange;
  source: "manual" | "automation";
  strategyKey: string | null;
  market: string;
  side: CryptoLiveOrderSide;
  volume: number;
  executedVolume: number;
  limitPrice: number;
  krwEquivalent: number;
  clientOrderId: string;
  payloadHash: string;
  previewId: string;
  status: CryptoLiveOrderStatus;
  brokerOrderId: string | null;
  createdAt: string;
  submissionStartedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

type CryptoLiveTradingStore = {
  schemaVersion: 2;
  policies: Record<CryptoLiveExchange, LocalCryptoLiveTradingPolicy>;
  previews: LocalCryptoLiveOrderPreview[];
  attempts: LocalCryptoLiveOrderAttempt[];
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "local-crypto-live-trading.json");
let storeQueue: Promise<void> = Promise.resolve();
const nowIso = () => new Date().toISOString();

export const kstDate = (date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const defaultPolicy = (exchange: CryptoLiveExchange): LocalCryptoLiveTradingPolicy => ({
  installationId: randomUUID(),
  exchange,
  boundUserId: null,
  readinessVerifiedAt: null,
  bindingHash: null,
  userConsentAt: null,
  manualEnabled: false,
  automationEnabled: false,
  manualConfirmedOrderCount: 0,
  restartReconciledAt: null,
  killSwitchVerifiedAt: null,
  dailyBuyKrwDate: kstDate(),
  dailyBuyKrwSubmitted: 0,
  unknownLock: null,
});

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizePolicy = (exchange: CryptoLiveExchange, raw: Partial<LocalCryptoLiveTradingPolicy> | null | undefined) => {
  const fallback = defaultPolicy(exchange);
  return {
    ...fallback,
    installationId: typeof raw?.installationId === "string" && raw.installationId ? raw.installationId : fallback.installationId,
    boundUserId: typeof raw?.boundUserId === "string" ? raw.boundUserId : null,
    readinessVerifiedAt: typeof raw?.readinessVerifiedAt === "string" ? raw.readinessVerifiedAt : null,
    bindingHash: typeof raw?.bindingHash === "string" ? raw.bindingHash : null,
    userConsentAt: typeof raw?.userConsentAt === "string" ? raw.userConsentAt : null,
    manualEnabled: raw?.manualEnabled === true && typeof raw?.readinessVerifiedAt === "string",
    automationEnabled: raw?.automationEnabled === true && typeof raw?.readinessVerifiedAt === "string",
    manualConfirmedOrderCount: Math.floor(numberOrZero(raw?.manualConfirmedOrderCount)),
    restartReconciledAt: typeof raw?.restartReconciledAt === "string" ? raw.restartReconciledAt : null,
    killSwitchVerifiedAt: typeof raw?.killSwitchVerifiedAt === "string" ? raw.killSwitchVerifiedAt : null,
    dailyBuyKrwDate: typeof raw?.dailyBuyKrwDate === "string" ? raw.dailyBuyKrwDate : fallback.dailyBuyKrwDate,
    dailyBuyKrwSubmitted: numberOrZero(raw?.dailyBuyKrwSubmitted),
    unknownLock: raw?.unknownLock && typeof raw.unknownLock.attemptId === "string" && typeof raw.unknownLock.reason === "string" && typeof raw.unknownLock.lockedAt === "string"
      ? raw.unknownLock
      : null,
  } satisfies LocalCryptoLiveTradingPolicy;
};

const normalizePreview = (raw: Partial<LocalCryptoLiveOrderPreview>): LocalCryptoLiveOrderPreview | null => {
  if (
    typeof raw.id !== "string" || typeof raw.userId !== "string" ||
    (raw.exchange !== "upbit" && raw.exchange !== "bithumb") ||
    (raw.side !== "buy" && raw.side !== "sell") ||
    typeof raw.market !== "string" || !Number.isFinite(raw.volume) || !Number.isFinite(raw.price) ||
    typeof raw.clientOrderId !== "string" || typeof raw.payloadHash !== "string" ||
    typeof raw.confirmationText !== "string" || typeof raw.createdAt !== "string" || typeof raw.expiresAt !== "string"
  ) return null;
  return {
    id: raw.id, userId: raw.userId, exchange: raw.exchange,
    source: raw.source === "automation" ? "automation" : "manual",
    strategyKey: typeof raw.strategyKey === "string" ? raw.strategyKey : null,
    market: raw.market, side: raw.side, volume: Number(raw.volume), price: Number(raw.price),
    estimatedValue: Number.isFinite(raw.estimatedValue) ? Number(raw.estimatedValue) : Number(raw.volume) * Number(raw.price),
    clientOrderId: raw.clientOrderId, payloadHash: raw.payloadHash, confirmationText: raw.confirmationText,
    createdAt: raw.createdAt, expiresAt: raw.expiresAt,
    consumedAt: typeof raw.consumedAt === "string" ? raw.consumedAt : null,
  };
};

const ATTEMPT_STATUSES = new Set<CryptoLiveOrderStatus>([
  "submission_pending", "submitted", "open", "partially_filled", "filled", "cancelled", "unknown", "rejected",
]);

const normalizeAttempt = (raw: Partial<LocalCryptoLiveOrderAttempt>): LocalCryptoLiveOrderAttempt | null => {
  if (
    typeof raw.id !== "string" || typeof raw.userId !== "string" ||
    (raw.exchange !== "upbit" && raw.exchange !== "bithumb") ||
    (raw.side !== "buy" && raw.side !== "sell") || typeof raw.market !== "string" ||
    !Number.isFinite(raw.volume) || !Number.isFinite(raw.limitPrice) ||
    typeof raw.clientOrderId !== "string" || typeof raw.payloadHash !== "string" ||
    typeof raw.previewId !== "string" || !ATTEMPT_STATUSES.has(raw.status as CryptoLiveOrderStatus) ||
    typeof raw.createdAt !== "string" || typeof raw.submissionStartedAt !== "string"
  ) return null;
  return {
    id: raw.id, userId: raw.userId, exchange: raw.exchange,
    source: raw.source === "automation" ? "automation" : "manual",
    strategyKey: typeof raw.strategyKey === "string" ? raw.strategyKey : null,
    market: raw.market, side: raw.side, volume: Number(raw.volume), executedVolume: numberOrZero(raw.executedVolume),
    limitPrice: Number(raw.limitPrice), krwEquivalent: numberOrZero(raw.krwEquivalent),
    clientOrderId: raw.clientOrderId, payloadHash: raw.payloadHash, previewId: raw.previewId,
    status: raw.status as CryptoLiveOrderStatus,
    brokerOrderId: typeof raw.brokerOrderId === "string" ? raw.brokerOrderId : null,
    createdAt: raw.createdAt, submissionStartedAt: raw.submissionStartedAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : raw.createdAt,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
};

const readStore = async (): Promise<CryptoLiveTradingStore> => {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<CryptoLiveTradingStore> & { policy?: unknown };
    // V1 QA approval is intentionally not inherited. Both live toggles fail closed after upgrade.
    const policies = raw.schemaVersion === 2 && raw.policies
      ? {
        upbit: normalizePolicy("upbit", raw.policies.upbit),
        bithumb: normalizePolicy("bithumb", raw.policies.bithumb),
      }
      : { upbit: defaultPolicy("upbit"), bithumb: defaultPolicy("bithumb") };
    return {
      schemaVersion: 2,
      policies,
      previews: Array.isArray(raw.previews) ? raw.previews.map(normalizePreview).filter((value): value is LocalCryptoLiveOrderPreview => value !== null) : [],
      attempts: Array.isArray(raw.attempts) ? raw.attempts.map(normalizeAttempt).filter((value): value is LocalCryptoLiveOrderAttempt => value !== null) : [],
    };
  } catch {
    return { schemaVersion: 2, policies: { upbit: defaultPolicy("upbit"), bithumb: defaultPolicy("bithumb") }, previews: [], attempts: [] };
  }
};

const writeStore = async (store: CryptoLiveTradingStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STORE_PATH);
};

const withStore = async <T>(operation: (store: CryptoLiveTradingStore) => Promise<T> | T): Promise<T> => {
  let release: (() => void) | undefined;
  const previous = storeQueue;
  storeQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  } finally {
    release?.();
  }
};

const resetDailyLimitIfNeeded = (policy: LocalCryptoLiveTradingPolicy, now = new Date()) => {
  const today = kstDate(now);
  if (policy.dailyBuyKrwDate !== today) {
    policy.dailyBuyKrwDate = today;
    policy.dailyBuyKrwSubmitted = 0;
  }
};

const isBoundTo = (policy: LocalCryptoLiveTradingPolicy, userId: string) => policy.boundUserId === userId;
const pruneExpiredPreviews = (store: CryptoLiveTradingStore) => {
  store.previews = store.previews.filter((preview) => preview.consumedAt !== null || Date.parse(preview.expiresAt) >= Date.now());
};
const snapshot = (store: CryptoLiveTradingStore, exchange: CryptoLiveExchange) => ({
  policy: { ...store.policies[exchange] },
  attempts: store.attempts.filter((attempt) => attempt.exchange === exchange).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
});

export const getLocalCryptoLiveTradingSnapshot = async (exchange: CryptoLiveExchange = "upbit") => withStore((store) => {
  resetDailyLimitIfNeeded(store.policies[exchange]);
  pruneExpiredPreviews(store);
  return snapshot(store, exchange);
});

export const getLocalCryptoLiveTradingGate = async ({
  userId, exchange = "upbit", source = "manual", credentialVerified, encryptionConfigured, killSwitchEngaged, workerPaused,
}: {
  userId: string; exchange?: CryptoLiveExchange; source?: "manual" | "automation";
  credentialVerified: boolean; encryptionConfigured: boolean; killSwitchEngaged: boolean; workerPaused: boolean;
}) => withStore((store) => {
  const policy = store.policies[exchange];
  resetDailyLimitIfNeeded(policy);
  const remainingDailyBuyKrw = Math.max(0, LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW - policy.dailyBuyKrwSubmitted);
  const closed = (reason: string) => ({ effective: false, reason, remainingDailyBuyKrw });
  if (!encryptionConfigured) return closed("코인 실거래에는 암호화 credential 저장소가 필요합니다.");
  if (!credentialVerified) return closed(`검증 완료된 ${exchange} API 키가 필요합니다.`);
  if (!isBoundTo(policy, userId) || !policy.readinessVerifiedAt || !policy.bindingHash) return closed(`현재 ${exchange} API의 자동 읽기 전용 점검이 필요합니다.`);
  if (!policy.userConsentAt) return closed("실거래 위험 이용 동의가 필요합니다.");
  if (policy.unknownLock) return closed(`결과 불명 주문이 있어 ${exchange} 주문 조회로 확인하기 전까지 잠급니다.`);
  if (killSwitchEngaged) return closed("긴급 중지가 켜져 있습니다.");
  if (workerPaused) return closed("워커 일시중지 상태입니다.");
  if (source === "manual" && !policy.manualEnabled) return closed(`${exchange} 수동 지정가 실거래 토글이 꺼져 있습니다.`);
  if (source === "automation") {
    if (!policy.automationEnabled) return closed(`${exchange} 자동 지정가 실거래 토글이 꺼져 있습니다.`);
    if (policy.manualConfirmedOrderCount < LOCAL_CRYPTO_AUTOMATION_MANUAL_ORDER_REQUIREMENT) return closed(`거래소 조회로 확인된 수동 주문 ${LOCAL_CRYPTO_AUTOMATION_MANUAL_ORDER_REQUIREMENT}건이 필요합니다.`);
    if (!policy.restartReconciledAt || !policy.killSwitchVerifiedAt) return closed("재시작 재조정과 kill switch 검증이 필요합니다.");
  }
  return { effective: true, reason: null, remainingDailyBuyKrw };
});

export const verifyLocalCryptoReadiness = async ({
  userId, exchange, bindingHash,
}: { userId: string; exchange: CryptoLiveExchange; bindingHash: string }) => withStore((store) => {
  const policy = store.policies[exchange];
  if (policy.bindingHash !== bindingHash || policy.boundUserId !== userId) {
    policy.userConsentAt = null;
    policy.manualEnabled = false;
    policy.automationEnabled = false;
    policy.manualConfirmedOrderCount = 0;
    policy.restartReconciledAt = null;
    policy.killSwitchVerifiedAt = null;
    policy.unknownLock = null;
  }
  policy.boundUserId = userId;
  policy.bindingHash = bindingHash;
  policy.readinessVerifiedAt = nowIso();
  return snapshot(store, exchange);
});

export const setLocalCryptoLiveTradingConsent = async ({
  userId, exchange, confirmation,
}: { userId: string; exchange: CryptoLiveExchange; confirmation: string }) => withStore((store) => {
  const policy = store.policies[exchange];
  if (!isBoundTo(policy, userId) || !policy.readinessVerifiedAt) throw new Error("자동 읽기 전용 점검을 먼저 완료하세요.");
  if (confirmation.trim() !== LOCAL_CRYPTO_LIVE_TRADING_CONSENT) throw new Error(`동의 문구 "${LOCAL_CRYPTO_LIVE_TRADING_CONSENT}"를 정확히 입력해야 합니다.`);
  policy.userConsentAt = nowIso();
  return snapshot(store, exchange);
});

export const setLocalCryptoManualLiveTrading = async ({
  userId, exchange = "upbit", enabled, confirmation,
}: { userId: string; exchange?: CryptoLiveExchange; enabled: boolean; confirmation?: string }) => withStore((store) => {
  const policy = store.policies[exchange];
  resetDailyLimitIfNeeded(policy);
  if (!enabled) {
    policy.manualEnabled = false;
    return snapshot(store, exchange);
  }
  if (!isBoundTo(policy, userId) || !policy.readinessVerifiedAt || !policy.userConsentAt) throw new Error("자동 읽기 전용 점검과 실거래 이용 동의가 필요합니다.");
  if (confirmation?.trim() !== LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION) throw new Error(`수동 주문 해제 문구 "${LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION}"를 정확히 입력해야 합니다.`);
  if (policy.unknownLock) throw new Error("결과 불명 주문이 있어 수동 실거래를 열 수 없습니다.");
  policy.manualEnabled = true;
  return snapshot(store, exchange);
});

export const setLocalCryptoAutomationLiveTrading = async ({
  userId, exchange, enabled, confirmation,
}: { userId: string; exchange: CryptoLiveExchange; enabled: boolean; confirmation?: string }) => withStore((store) => {
  const policy = store.policies[exchange];
  if (!enabled) {
    policy.automationEnabled = false;
    return snapshot(store, exchange);
  }
  if (!isBoundTo(policy, userId) || !policy.readinessVerifiedAt || !policy.userConsentAt) {
    throw new Error("현재 API의 readiness와 실거래 이용 동의가 필요합니다.");
  }
  if (!policy.manualEnabled || policy.manualConfirmedOrderCount < LOCAL_CRYPTO_AUTOMATION_MANUAL_ORDER_REQUIREMENT || !policy.restartReconciledAt || !policy.killSwitchVerifiedAt || policy.unknownLock) {
    throw new Error("수동 주문 5건, 재시작 재조정, kill switch 검증, 결과 불명 0건을 먼저 충족하세요.");
  }
  if (confirmation?.trim() !== LOCAL_CRYPTO_LIVE_TRADING_AUTOMATION_CONFIRMATION) throw new Error(`자동매매 해제 문구 "${LOCAL_CRYPTO_LIVE_TRADING_AUTOMATION_CONFIRMATION}"를 정확히 입력해야 합니다.`);
  policy.automationEnabled = true;
  return snapshot(store, exchange);
});

export const clearLocalCryptoLiveTradingBinding = async (exchange: CryptoLiveExchange) => withStore((store) => {
  const installationId = store.policies[exchange].installationId;
  store.policies[exchange] = { ...defaultPolicy(exchange), installationId };
  return snapshot(store, exchange);
});

export const recordLocalCryptoRecoveryProof = async ({ exchange, kind }: { exchange: CryptoLiveExchange; kind: "restart" | "kill-switch" }) => withStore((store) => {
  const policy = store.policies[exchange];
  if (kind === "restart") policy.restartReconciledAt = nowIso();
  else policy.killSwitchVerifiedAt = nowIso();
  return snapshot(store, exchange);
});

export const recordLocalCryptoOrderPreview = async ({
  userId, exchange = "upbit", source = "manual", strategyKey = null, market, side, volume, price, confirmationText, payloadHash,
}: {
  userId: string; exchange?: CryptoLiveExchange; source?: "manual" | "automation"; strategyKey?: string | null;
  market: string; side: CryptoLiveOrderSide; volume: number; price: number; confirmationText: string; payloadHash: string;
}) => withStore((store) => {
  pruneExpiredPreviews(store);
  if (strategyKey && store.attempts.some((attempt) => attempt.exchange === exchange && attempt.strategyKey === strategyKey && ["submission_pending", "submitted", "open", "partially_filled", "unknown"].includes(attempt.status))) {
    throw new Error("동일 전략·단계의 미체결 또는 결과 불명 주문이 있습니다.");
  }
  const createdAt = nowIso();
  const preview: LocalCryptoLiveOrderPreview = {
    id: randomUUID(), userId, exchange, source, strategyKey, market, side, volume, price,
    estimatedValue: volume * price, clientOrderId: `${exchange}-${randomUUID()}`, payloadHash, confirmationText,
    createdAt, expiresAt: new Date(Date.now() + LOCAL_CRYPTO_LIVE_ORDER_PREVIEW_TTL_MS).toISOString(), consumedAt: null,
  };
  store.previews.push(preview);
  return preview;
});

export const getLocalCryptoOrderPreview = async ({ userId, exchange = "upbit", previewId }: { userId: string; exchange?: CryptoLiveExchange; previewId: string }) => withStore((store) => {
  pruneExpiredPreviews(store);
  return store.previews.find((candidate) => candidate.id === previewId && candidate.userId === userId && candidate.exchange === exchange) ?? null;
});

export const beginLocalCryptoOrderSubmission = async ({
  userId, exchange = "upbit", previewId, confirmation,
}: { userId: string; exchange?: CryptoLiveExchange; previewId: string; confirmation: string }) => withStore((store) => {
  const policy = store.policies[exchange];
  resetDailyLimitIfNeeded(policy);
  pruneExpiredPreviews(store);
  const preview = store.previews.find((candidate) => candidate.id === previewId && candidate.userId === userId && candidate.exchange === exchange);
  if (!preview) throw new Error(`유효한 ${exchange} 주문 미리보기를 먼저 실행하세요.`);
  if (preview.consumedAt) throw new Error("이미 제출을 시도한 미리보기입니다. 같은 주문을 재제출하지 마세요.");
  if (confirmation.trim() !== preview.confirmationText) throw new Error(`표시된 ${exchange} 주문 요약과 동일한 확인 문구를 입력해야 합니다.`);
  if (!isBoundTo(policy, userId) || !policy.readinessVerifiedAt || !policy.userConsentAt || !(preview.source === "manual" ? policy.manualEnabled : policy.automationEnabled)) throw new Error(`${exchange} 실거래 활성화 상태를 다시 확인하세요.`);
  if (policy.unknownLock) throw new Error("결과 불명 주문이 있어 주문을 제출할 수 없습니다.");
  if (preview.side === "buy") {
    if (preview.estimatedValue > LOCAL_CRYPTO_LIVE_TRADING_MAX_BUY_ORDER_KRW) throw new Error("코인 매수 1건은 100,000원 이하만 허용됩니다.");
    if (policy.dailyBuyKrwSubmitted + preview.estimatedValue > LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW) throw new Error("KST 일일 코인 매수 한도를 초과합니다.");
    policy.dailyBuyKrwSubmitted += preview.estimatedValue;
  }
  preview.consumedAt = nowIso();
  const createdAt = nowIso();
  const attempt: LocalCryptoLiveOrderAttempt = {
    id: randomUUID(), userId, exchange, source: preview.source, strategyKey: preview.strategyKey,
    market: preview.market, side: preview.side, volume: preview.volume, executedVolume: 0,
    limitPrice: preview.price, krwEquivalent: preview.estimatedValue, clientOrderId: preview.clientOrderId,
    payloadHash: preview.payloadHash, previewId: preview.id, status: "submission_pending", brokerOrderId: null,
    createdAt, submissionStartedAt: createdAt, updatedAt: createdAt, completedAt: null, error: null,
  };
  store.attempts.push(attempt);
  return { preview: { ...preview }, attempt: { ...attempt } };
});

const updateAttempt = async (exchange: CryptoLiveExchange, attemptId: string, update: (attempt: LocalCryptoLiveOrderAttempt, store: CryptoLiveTradingStore) => void) => withStore((store) => {
  const attempt = store.attempts.find((candidate) => candidate.id === attemptId && candidate.exchange === exchange);
  if (!attempt) throw new Error("코인 실거래 주문 시도를 찾을 수 없습니다.");
  update(attempt, store);
  attempt.updatedAt = nowIso();
  return { ...attempt };
});

export const markLocalCryptoOrderSubmitted = (attemptId: string, brokerOrderId: string, exchange: CryptoLiveExchange = "upbit") =>
  updateAttempt(exchange, attemptId, (attempt) => { attempt.status = "submitted"; attempt.brokerOrderId = brokerOrderId; attempt.error = null; });
export const markLocalCryptoOrderRejected = (attemptId: string, error: string, exchange: CryptoLiveExchange = "upbit") =>
  updateAttempt(exchange, attemptId, (attempt) => { attempt.status = "rejected"; attempt.completedAt = nowIso(); attempt.error = error; });
export const markLocalCryptoOrderUnknown = (attemptId: string, error: string, exchange: CryptoLiveExchange = "upbit") =>
  updateAttempt(exchange, attemptId, (attempt, store) => {
    attempt.status = "unknown"; attempt.error = error;
    const policy = store.policies[exchange];
    policy.manualEnabled = false; policy.automationEnabled = false;
    policy.unknownLock = { attemptId, reason: error, lockedAt: nowIso() };
  });

export const reconcileLocalCryptoOrder = async ({
  exchange = "upbit", attemptId, brokerOrderId, state = "open", executedVolume = 0,
}: { exchange?: CryptoLiveExchange; attemptId: string; brokerOrderId: string; state?: CryptoLiveOrderStatus; executedVolume?: number }) =>
  updateAttempt(exchange, attemptId, (attempt, store) => {
    const previousStatus = attempt.status;
    attempt.status = state; attempt.brokerOrderId = brokerOrderId; attempt.executedVolume = Math.min(attempt.volume, Math.max(0, executedVolume)); attempt.error = null;
    if (["filled", "cancelled", "rejected"].includes(state)) attempt.completedAt = nowIso();
    const policy = store.policies[exchange];
    if (policy.unknownLock?.attemptId === attemptId) policy.unknownLock = null;
    if (attempt.source === "manual" && ["submission_pending", "submitted", "unknown"].includes(previousStatus) && !["submission_pending", "unknown", "rejected"].includes(state)) {
      policy.manualConfirmedOrderCount = Math.min(LOCAL_CRYPTO_AUTOMATION_MANUAL_ORDER_REQUIREMENT, policy.manualConfirmedOrderCount + 1);
    }
  });

export const findLocalCryptoUnknownAttempt = async (userId: string, exchange: CryptoLiveExchange = "upbit") => withStore((store) =>
  store.attempts.find((attempt) => attempt.userId === userId && attempt.exchange === exchange && attempt.status === "unknown") ?? null,
);

export const listLocalCryptoPendingAttempts = async (userId: string, exchange: CryptoLiveExchange) => withStore((store) =>
  store.attempts.filter((attempt) => attempt.userId === userId && attempt.exchange === exchange && ["submission_pending", "submitted", "open", "partially_filled", "unknown"].includes(attempt.status)),
);
