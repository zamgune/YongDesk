import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export const LOCAL_CRYPTO_LIVE_TRADING_QA_CONFIRMATION = "코인 실거래 QA 승인";
export const LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION = "코인 실거래 수동 주문 해제";
export const LOCAL_CRYPTO_LIVE_TRADING_MAX_BUY_ORDER_KRW = 100_000;
export const LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW = 300_000;
export const LOCAL_CRYPTO_LIVE_ORDER_PREVIEW_TTL_MS = 10 * 60 * 1_000;

export type CryptoLiveOrderSide = "buy" | "sell";
export type CryptoLiveOrderStatus = "submission_pending" | "submitted" | "unknown" | "rejected" | "reconciled";

export type LocalCryptoLiveTradingPolicy = {
  installationId: string;
  boundUserId: string | null;
  boundExchange: "upbit" | null;
  qaApprovedAt: string | null;
  manualEnabled: boolean;
  dailyBuyKrwDate: string;
  dailyBuyKrwSubmitted: number;
  unknownLock: { attemptId: string; reason: string; lockedAt: string } | null;
};

export type LocalCryptoLiveOrderPreview = {
  id: string;
  userId: string;
  exchange: "upbit";
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
  exchange: "upbit";
  market: string;
  side: CryptoLiveOrderSide;
  volume: number;
  limitPrice: number;
  krwEquivalent: number;
  clientOrderId: string;
  payloadHash: string;
  previewId: string;
  status: CryptoLiveOrderStatus;
  brokerOrderId: string | null;
  createdAt: string;
  submissionStartedAt: string;
  completedAt: string | null;
  error: string | null;
};

type CryptoLiveTradingStore = {
  policy: LocalCryptoLiveTradingPolicy;
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

const defaultPolicy = (): LocalCryptoLiveTradingPolicy => ({
  installationId: randomUUID(),
  boundUserId: null,
  boundExchange: null,
  qaApprovedAt: null,
  manualEnabled: false,
  dailyBuyKrwDate: kstDate(),
  dailyBuyKrwSubmitted: 0,
  unknownLock: null,
});

const normalizePolicy = (raw: Partial<LocalCryptoLiveTradingPolicy> | null | undefined): LocalCryptoLiveTradingPolicy => {
  const fallback = defaultPolicy();
  const dailyBuyKrwSubmitted = Number(raw?.dailyBuyKrwSubmitted);
  return {
    ...fallback,
    ...raw,
    installationId: typeof raw?.installationId === "string" && raw.installationId ? raw.installationId : fallback.installationId,
    boundUserId: typeof raw?.boundUserId === "string" ? raw.boundUserId : null,
    boundExchange: raw?.boundExchange === "upbit" ? "upbit" : null,
    qaApprovedAt: typeof raw?.qaApprovedAt === "string" ? raw.qaApprovedAt : null,
    manualEnabled: raw?.manualEnabled === true,
    dailyBuyKrwDate: typeof raw?.dailyBuyKrwDate === "string" ? raw.dailyBuyKrwDate : fallback.dailyBuyKrwDate,
    dailyBuyKrwSubmitted: Number.isFinite(dailyBuyKrwSubmitted) && dailyBuyKrwSubmitted >= 0 ? dailyBuyKrwSubmitted : 0,
    unknownLock: raw?.unknownLock && typeof raw.unknownLock.attemptId === "string" && typeof raw.unknownLock.reason === "string" && typeof raw.unknownLock.lockedAt === "string"
      ? raw.unknownLock
      : null,
  };
};

const normalizePreview = (raw: Partial<LocalCryptoLiveOrderPreview>): LocalCryptoLiveOrderPreview | null => {
  if (
    typeof raw.id !== "string" ||
    typeof raw.userId !== "string" ||
    raw.exchange !== "upbit" ||
    typeof raw.market !== "string" ||
    (raw.side !== "buy" && raw.side !== "sell") ||
    !Number.isFinite(raw.volume) ||
    !Number.isFinite(raw.price) ||
    !Number.isFinite(raw.estimatedValue) ||
    typeof raw.clientOrderId !== "string" ||
    typeof raw.payloadHash !== "string" ||
    typeof raw.confirmationText !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.expiresAt !== "string"
  ) return null;
  return {
    id: raw.id,
    userId: raw.userId,
    exchange: "upbit",
    market: raw.market,
    side: raw.side,
    volume: Number(raw.volume),
    price: Number(raw.price),
    estimatedValue: Number(raw.estimatedValue),
    clientOrderId: raw.clientOrderId,
    payloadHash: raw.payloadHash,
    confirmationText: raw.confirmationText,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    consumedAt: typeof raw.consumedAt === "string" ? raw.consumedAt : null,
  };
};

const normalizeAttempt = (raw: Partial<LocalCryptoLiveOrderAttempt>): LocalCryptoLiveOrderAttempt | null => {
  if (
    typeof raw.id !== "string" ||
    typeof raw.userId !== "string" ||
    raw.exchange !== "upbit" ||
    typeof raw.market !== "string" ||
    (raw.side !== "buy" && raw.side !== "sell") ||
    !Number.isFinite(raw.volume) ||
    !Number.isFinite(raw.limitPrice) ||
    !Number.isFinite(raw.krwEquivalent) ||
    typeof raw.clientOrderId !== "string" ||
    typeof raw.payloadHash !== "string" ||
    typeof raw.previewId !== "string" ||
    !["submission_pending", "submitted", "unknown", "rejected", "reconciled"].includes(String(raw.status)) ||
    typeof raw.createdAt !== "string" ||
    typeof raw.submissionStartedAt !== "string"
  ) return null;
  return {
    id: raw.id,
    userId: raw.userId,
    exchange: "upbit",
    market: raw.market,
    side: raw.side,
    volume: Number(raw.volume),
    limitPrice: Number(raw.limitPrice),
    krwEquivalent: Number(raw.krwEquivalent),
    clientOrderId: raw.clientOrderId,
    payloadHash: raw.payloadHash,
    previewId: raw.previewId,
    status: raw.status as CryptoLiveOrderStatus,
    brokerOrderId: typeof raw.brokerOrderId === "string" ? raw.brokerOrderId : null,
    createdAt: raw.createdAt,
    submissionStartedAt: raw.submissionStartedAt,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
};

const readStore = async (): Promise<CryptoLiveTradingStore> => {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<CryptoLiveTradingStore>;
    return {
      policy: normalizePolicy(raw.policy),
      previews: Array.isArray(raw.previews) ? raw.previews.map((value) => normalizePreview(value)).filter((value): value is LocalCryptoLiveOrderPreview => value !== null) : [],
      attempts: Array.isArray(raw.attempts) ? raw.attempts.map((value) => normalizeAttempt(value)).filter((value): value is LocalCryptoLiveOrderAttempt => value !== null) : [],
    };
  } catch {
    return { policy: defaultPolicy(), previews: [], attempts: [] };
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

const isBoundTo = (policy: LocalCryptoLiveTradingPolicy, userId: string) =>
  policy.boundUserId === userId && policy.boundExchange === "upbit";

const pruneExpiredPreviews = (store: CryptoLiveTradingStore, now = Date.now()) => {
  store.previews = store.previews.filter((preview) => preview.consumedAt !== null || Date.parse(preview.expiresAt) >= now);
};

const snapshot = (store: CryptoLiveTradingStore) => ({
  policy: { ...store.policy },
  attempts: [...store.attempts].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
});

export const getLocalCryptoLiveTradingSnapshot = async () => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  pruneExpiredPreviews(store);
  return snapshot(store);
});

export const getLocalCryptoLiveTradingGate = async ({
  userId,
  credentialVerified,
  encryptionConfigured,
  killSwitchEngaged,
  workerPaused,
}: {
  userId: string;
  credentialVerified: boolean;
  encryptionConfigured: boolean;
  killSwitchEngaged: boolean;
  workerPaused: boolean;
}) => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  const remainingDailyBuyKrw = Math.max(0, LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW - store.policy.dailyBuyKrwSubmitted);
  if (!encryptionConfigured) return { effective: false, reason: "코인 실거래에는 암호화 credential 저장소가 필요합니다.", remainingDailyBuyKrw };
  if (!credentialVerified) return { effective: false, reason: "검증 완료된 Upbit API 키가 필요합니다.", remainingDailyBuyKrw };
  if (!isBoundTo(store.policy, userId) || !store.policy.qaApprovedAt) return { effective: false, reason: "현재 설치와 Upbit API에 읽기 전용 QA 승인이 필요합니다.", remainingDailyBuyKrw };
  if (store.policy.unknownLock) return { effective: false, reason: "결과 불명 주문이 있어 Upbit 주문 조회로 확인하기 전까지 실거래를 잠급니다.", remainingDailyBuyKrw };
  if (killSwitchEngaged) return { effective: false, reason: "긴급 중지가 켜져 있습니다.", remainingDailyBuyKrw };
  if (workerPaused) return { effective: false, reason: "워커 일시중지 상태입니다.", remainingDailyBuyKrw };
  if (!store.policy.manualEnabled) return { effective: false, reason: "코인 수동 실거래 토글이 꺼져 있습니다.", remainingDailyBuyKrw };
  return { effective: true, reason: null, remainingDailyBuyKrw };
});

export const approveLocalCryptoManualQa = async ({ userId, confirmation }: { userId: string; confirmation: string }) => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (confirmation.trim() !== LOCAL_CRYPTO_LIVE_TRADING_QA_CONFIRMATION) {
    throw new Error(`QA 승인 문구 \"${LOCAL_CRYPTO_LIVE_TRADING_QA_CONFIRMATION}\"를 정확히 입력해야 합니다.`);
  }
  if (store.policy.unknownLock && !isBoundTo(store.policy, userId)) {
    throw new Error("결과 불명 주문이 있어 다른 Upbit API로 QA 바인딩을 변경할 수 없습니다. 주문 조회로 먼저 확인하세요.");
  }
  if (!isBoundTo(store.policy, userId)) {
    store.policy.boundUserId = userId;
    store.policy.boundExchange = "upbit";
    store.policy.manualEnabled = false;
    store.policy.unknownLock = null;
  }
  store.policy.qaApprovedAt = nowIso();
  return snapshot(store);
});

export const setLocalCryptoManualLiveTrading = async ({ userId, enabled, confirmation }: { userId: string; enabled: boolean; confirmation?: string }) => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (!enabled) {
    store.policy.manualEnabled = false;
    return snapshot(store);
  }
  if (!isBoundTo(store.policy, userId) || !store.policy.qaApprovedAt) {
    throw new Error("현재 설치와 Upbit API에서 완료된 읽기 전용 QA 승인이 필요합니다.");
  }
  if (confirmation?.trim() !== LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION) {
    throw new Error(`수동 주문 해제 문구 \"${LOCAL_CRYPTO_LIVE_TRADING_MANUAL_CONFIRMATION}\"를 정확히 입력해야 합니다.`);
  }
  if (store.policy.unknownLock) throw new Error("결과 불명 주문이 있어 수동 실거래를 열 수 없습니다.");
  store.policy.manualEnabled = true;
  return snapshot(store);
});

export const clearLocalCryptoManualLiveTradingBinding = async () => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  store.policy.boundUserId = null;
  store.policy.boundExchange = null;
  store.policy.qaApprovedAt = null;
  store.policy.manualEnabled = false;
  return snapshot(store);
});

export const recordLocalCryptoOrderPreview = async ({
  userId,
  market,
  side,
  volume,
  price,
  confirmationText,
  payloadHash,
}: {
  userId: string;
  market: string;
  side: CryptoLiveOrderSide;
  volume: number;
  price: number;
  confirmationText: string;
  payloadHash: string;
}) => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  pruneExpiredPreviews(store);
  const createdAt = nowIso();
  const preview: LocalCryptoLiveOrderPreview = {
    id: randomUUID(),
    userId,
    exchange: "upbit",
    market,
    side,
    volume,
    price,
    estimatedValue: volume * price,
    clientOrderId: `upbit-${randomUUID()}`,
    payloadHash,
    confirmationText,
    createdAt,
    expiresAt: new Date(Date.now() + LOCAL_CRYPTO_LIVE_ORDER_PREVIEW_TTL_MS).toISOString(),
    consumedAt: null,
  };
  store.previews.push(preview);
  return preview;
});

export const getLocalCryptoOrderPreview = async ({ userId, previewId }: { userId: string; previewId: string }) => withStore(async (store) => {
  pruneExpiredPreviews(store);
  const preview = store.previews.find((candidate) => candidate.id === previewId && candidate.userId === userId);
  return preview ? { ...preview } : null;
});

export const beginLocalCryptoOrderSubmission = async ({
  userId,
  previewId,
  confirmation,
}: {
  userId: string;
  previewId: string;
  confirmation: string;
}) => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  pruneExpiredPreviews(store);
  const preview = store.previews.find((candidate) => candidate.id === previewId && candidate.userId === userId);
  if (!preview) throw new Error("유효한 Upbit 주문 미리보기를 먼저 실행하세요.");
  if (preview.consumedAt) throw new Error("이미 제출을 시도한 미리보기입니다. 같은 주문을 재제출하지 마세요.");
  if (Date.parse(preview.expiresAt) < Date.now()) throw new Error("주문 미리보기 유효 시간이 지났습니다. 다시 사전검증하세요.");
  if (confirmation.trim() !== preview.confirmationText) throw new Error("표시된 Upbit 주문 요약과 동일한 확인 문구를 입력해야 합니다.");
  if (!isBoundTo(store.policy, userId) || !store.policy.qaApprovedAt || !store.policy.manualEnabled) {
    throw new Error("Upbit 읽기 전용 QA와 수동 실거래 토글을 다시 확인해야 합니다.");
  }
  if (store.policy.unknownLock) {
    throw new Error("결과 불명 주문이 있어 Upbit 주문 조회로 확인하기 전까지 주문을 제출할 수 없습니다.");
  }
  if (preview.side === "buy") {
    if (preview.estimatedValue > LOCAL_CRYPTO_LIVE_TRADING_MAX_BUY_ORDER_KRW) {
      throw new Error(`코인 매수 1건은 ${LOCAL_CRYPTO_LIVE_TRADING_MAX_BUY_ORDER_KRW.toLocaleString("ko-KR")}원 이하만 허용됩니다.`);
    }
    if (store.policy.dailyBuyKrwSubmitted + preview.estimatedValue > LOCAL_CRYPTO_LIVE_TRADING_MAX_DAILY_BUY_KRW) {
      throw new Error("KST 일일 코인 매수 한도를 초과합니다. 취소·매도로 한도가 복구되지 않습니다.");
    }
    store.policy.dailyBuyKrwSubmitted += preview.estimatedValue;
  }
  preview.consumedAt = nowIso();
  const attempt: LocalCryptoLiveOrderAttempt = {
    id: randomUUID(),
    userId,
    exchange: "upbit",
    market: preview.market,
    side: preview.side,
    volume: preview.volume,
    limitPrice: preview.price,
    krwEquivalent: preview.estimatedValue,
    clientOrderId: preview.clientOrderId,
    payloadHash: preview.payloadHash,
    previewId: preview.id,
    status: "submission_pending",
    brokerOrderId: null,
    createdAt: nowIso(),
    submissionStartedAt: nowIso(),
    completedAt: null,
    error: null,
  };
  store.attempts.push(attempt);
  return { preview: { ...preview }, attempt: { ...attempt } };
});

const updateAttempt = async (attemptId: string, update: (attempt: LocalCryptoLiveOrderAttempt, store: CryptoLiveTradingStore) => void) => withStore(async (store) => {
  const attempt = store.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error("코인 실거래 주문 시도를 찾을 수 없습니다.");
  update(attempt, store);
  return { ...attempt };
});

export const markLocalCryptoOrderSubmitted = (attemptId: string, brokerOrderId: string) =>
  updateAttempt(attemptId, (attempt) => {
    attempt.status = "submitted";
    attempt.brokerOrderId = brokerOrderId;
    attempt.completedAt = nowIso();
    attempt.error = null;
  });

export const markLocalCryptoOrderRejected = (attemptId: string, error: string) =>
  updateAttempt(attemptId, (attempt) => {
    attempt.status = "rejected";
    attempt.completedAt = nowIso();
    attempt.error = error;
  });

export const markLocalCryptoOrderUnknown = (attemptId: string, error: string) =>
  updateAttempt(attemptId, (attempt, store) => {
    attempt.status = "unknown";
    attempt.completedAt = nowIso();
    attempt.error = error;
    store.policy.manualEnabled = false;
    store.policy.unknownLock = { attemptId, reason: error, lockedAt: nowIso() };
  });

export const reconcileLocalCryptoOrder = async ({
  attemptId,
  brokerOrderId,
}: {
  attemptId: string;
  brokerOrderId: string;
}) => updateAttempt(attemptId, (attempt, store) => {
  attempt.status = "reconciled";
  attempt.brokerOrderId = brokerOrderId;
  attempt.completedAt = nowIso();
  attempt.error = null;
  if (store.policy.unknownLock?.attemptId === attemptId) store.policy.unknownLock = null;
});

export const findLocalCryptoUnknownAttempt = async (userId: string) => withStore(async (store) =>
  store.attempts.find((attempt) => attempt.userId === userId && attempt.status === "unknown") ?? null,
);
