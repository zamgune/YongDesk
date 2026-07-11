import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

/**
 * macOS 단일 설치용 실거래 정책/시도 원장.
 *
 * 이 파일은 Supabase와 독립적이다. 주문 전송 직전의 상태를 먼저 원자적으로
 * 기록하고, 결과가 불명확하면 어떤 재시도도 하지 않은 채 전체 실거래를 잠근다.
 */

export const LOCAL_LIVE_TRADING_CONSENT_CONFIRMATION = "주식 실거래 위험을 확인했습니다";
export const LOCAL_LIVE_TRADING_MANUAL_CONFIRMATION = "실거래 수동 주문 해제";
export const LOCAL_LIVE_TRADING_AUTOMATION_CONFIRMATION = "자동화 실거래 해제";
export const LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW = 100_000;
export const LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW = 300_000;
export const LOCAL_LIVE_TRADING_REQUIRED_MANUAL_ORDERS = 5;

export type LiveOrderSource = "manual" | "automation";
export type LiveOrderAttemptStatus =
  | "prepared"
  | "submission_pending"
  | "submitted"
  | "unknown"
  | "rejected"
  | "reconciled";

export type LiveTradingPolicy = {
  installationId: string;
  boundUserId: string | null;
  boundAccountSeq: number | null;
  readinessVerifiedAt: string | null;
  bindingHash: string | null;
  userConsentAt: string | null;
  manualEnabled: boolean;
  automationEnabled: boolean;
  dailyBuyKrwDate: string;
  dailyBuyKrwSubmitted: number;
  lastReconciliationAt: string | null;
  safetyGateVerifiedAt: string | null;
  unknownLock: {
    attemptId: string;
    reason: string;
    lockedAt: string;
  } | null;
};

export type LiveOrderAttempt = {
  id: string;
  userId: string;
  accountSeq: number;
  source: LiveOrderSource;
  previewId: string | null;
  clientOrderId: string;
  payloadHash: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  currency: "KRW" | "USD";
  krwEquivalent: number;
  exchangeRate: number | null;
  status: LiveOrderAttemptStatus;
  brokerOrderId: string | null;
  createdAt: string;
  submissionStartedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type LiveOrderSubmissionResult = {
  status: "submitted" | "unknown" | "rejected";
  orderSubmissionAttempted: true;
  attempt: LiveOrderAttempt;
  error?: string;
  brokerOrderId?: string;
  remainingDailyBuyKrw?: number;
};

export type LocalLiveTradingSnapshot = {
  policy: LiveTradingPolicy;
  attempts: LiveOrderAttempt[];
  automationEligibility: {
    eligible: boolean;
    manualLimitOrders: number;
    reconciliationRecorded: boolean;
    safetyGateVerified: boolean;
    unresolvedUnknown: number;
    blockers: string[];
  };
};

type LiveTradingStore = {
  version: 2;
  policy: LiveTradingPolicy;
  attempts: LiveOrderAttempt[];
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "local-live-trading.json");
let storeQueue: Promise<void> = Promise.resolve();

const nowIso = () => new Date().toISOString();

export const kstDate = (date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const defaultPolicy = (): LiveTradingPolicy => ({
  installationId: randomUUID(),
  boundUserId: null,
  boundAccountSeq: null,
  readinessVerifiedAt: null,
  bindingHash: null,
  userConsentAt: null,
  manualEnabled: false,
  automationEnabled: false,
  dailyBuyKrwDate: kstDate(),
  dailyBuyKrwSubmitted: 0,
  lastReconciliationAt: null,
  safetyGateVerifiedAt: null,
  unknownLock: null,
});

const normalizePolicy = (raw: Partial<LiveTradingPolicy> | null | undefined): LiveTradingPolicy => {
  const fallback = defaultPolicy();
  const dailyBuyKrwSubmitted = Number(raw?.dailyBuyKrwSubmitted);
  return {
    ...fallback,
    ...raw,
    installationId: typeof raw?.installationId === "string" && raw.installationId ? raw.installationId : fallback.installationId,
    boundUserId: typeof raw?.boundUserId === "string" ? raw.boundUserId : null,
    boundAccountSeq: Number.isInteger(raw?.boundAccountSeq) && Number(raw?.boundAccountSeq) > 0
      ? Number(raw?.boundAccountSeq)
      : null,
    readinessVerifiedAt: typeof raw?.readinessVerifiedAt === "string" ? raw.readinessVerifiedAt : null,
    bindingHash: typeof raw?.bindingHash === "string" ? raw.bindingHash : null,
    userConsentAt: typeof raw?.userConsentAt === "string" ? raw.userConsentAt : null,
    manualEnabled: raw?.manualEnabled === true && typeof raw?.readinessVerifiedAt === "string",
    automationEnabled: raw?.automationEnabled === true && typeof raw?.readinessVerifiedAt === "string",
    dailyBuyKrwDate: typeof raw?.dailyBuyKrwDate === "string" ? raw.dailyBuyKrwDate : fallback.dailyBuyKrwDate,
    dailyBuyKrwSubmitted: Number.isFinite(dailyBuyKrwSubmitted) && dailyBuyKrwSubmitted >= 0 ? dailyBuyKrwSubmitted : 0,
    lastReconciliationAt: typeof raw?.lastReconciliationAt === "string" ? raw.lastReconciliationAt : null,
    safetyGateVerifiedAt: typeof raw?.safetyGateVerifiedAt === "string" ? raw.safetyGateVerifiedAt : null,
    unknownLock: raw?.unknownLock && typeof raw.unknownLock.attemptId === "string" && typeof raw.unknownLock.reason === "string" && typeof raw.unknownLock.lockedAt === "string"
      ? raw.unknownLock
      : null,
  };
};

const normalizeAttempt = (raw: Partial<LiveOrderAttempt>): LiveOrderAttempt | null => {
  if (
    typeof raw.id !== "string" ||
    typeof raw.userId !== "string" ||
    !Number.isInteger(raw.accountSeq) ||
    (raw.source !== "manual" && raw.source !== "automation") ||
    typeof raw.clientOrderId !== "string" ||
    typeof raw.payloadHash !== "string" ||
    typeof raw.symbol !== "string" ||
    (raw.side !== "buy" && raw.side !== "sell") ||
    !Number.isFinite(raw.quantity) ||
    !Number.isFinite(raw.limitPrice) ||
    (raw.currency !== "KRW" && raw.currency !== "USD") ||
    !Number.isFinite(raw.krwEquivalent) ||
    !["prepared", "submission_pending", "submitted", "unknown", "rejected", "reconciled"].includes(String(raw.status)) ||
    typeof raw.createdAt !== "string"
  ) {
    return null;
  }
  const accountSeq = Number(raw.accountSeq);
  return {
    id: raw.id,
    userId: raw.userId,
    accountSeq,
    source: raw.source,
    previewId: typeof raw.previewId === "string" ? raw.previewId : null,
    clientOrderId: raw.clientOrderId,
    payloadHash: raw.payloadHash,
    symbol: raw.symbol,
    side: raw.side,
    quantity: Number(raw.quantity),
    limitPrice: Number(raw.limitPrice),
    currency: raw.currency,
    krwEquivalent: Number(raw.krwEquivalent),
    exchangeRate: Number.isFinite(raw.exchangeRate) ? Number(raw.exchangeRate) : null,
    status: raw.status as LiveOrderAttemptStatus,
    brokerOrderId: typeof raw.brokerOrderId === "string" ? raw.brokerOrderId : null,
    createdAt: raw.createdAt,
    submissionStartedAt: typeof raw.submissionStartedAt === "string" ? raw.submissionStartedAt : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
};

const readStore = async (): Promise<LiveTradingStore> => {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<LiveTradingStore>;
    return {
      version: 2,
      policy: parsed.version === 2 ? normalizePolicy(parsed.policy) : defaultPolicy(),
      attempts: Array.isArray(parsed.attempts)
        ? parsed.attempts.map((attempt) => normalizeAttempt(attempt as Partial<LiveOrderAttempt>)).filter((attempt): attempt is LiveOrderAttempt => attempt !== null)
        : [],
    };
  } catch {
    return { version: 2, policy: defaultPolicy(), attempts: [] };
  }
};

const writeStore = async (store: LiveTradingStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STORE_PATH);
};

const withStore = async <T>(operation: (store: LiveTradingStore) => Promise<T> | T): Promise<T> => {
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

const resetDailyLimitIfNeeded = (policy: LiveTradingPolicy, now = new Date()) => {
  const today = kstDate(now);
  if (policy.dailyBuyKrwDate !== today) {
    policy.dailyBuyKrwDate = today;
    policy.dailyBuyKrwSubmitted = 0;
  }
};

const isBoundTo = (policy: LiveTradingPolicy, userId: string, accountSeq: number) =>
  policy.boundUserId === userId && policy.boundAccountSeq === accountSeq;

const automationEligibility = (store: LiveTradingStore): LocalLiveTradingSnapshot["automationEligibility"] => {
  const manualAttempts = store.attempts.filter((attempt) =>
    attempt.source === "manual" &&
    attempt.brokerOrderId !== null &&
    (attempt.status === "submitted" || attempt.status === "reconciled"),
  );
  const manualLimitOrders = manualAttempts.length;
  const latestManualSubmittedAt = manualAttempts
    .map((attempt) => attempt.completedAt ?? attempt.submissionStartedAt ?? attempt.createdAt)
    .toSorted((left, right) => right.localeCompare(left))[0] ?? null;
  const unresolvedUnknown = store.attempts.filter((attempt) => attempt.status === "unknown").length;
  const blockers: string[] = [];
  if (manualLimitOrders < LOCAL_LIVE_TRADING_REQUIRED_MANUAL_ORDERS) {
    blockers.push(`수동 지정가 주문 ${LOCAL_LIVE_TRADING_REQUIRED_MANUAL_ORDERS}건이 필요합니다. 현재 ${manualLimitOrders}건입니다.`);
  }
  if (!store.policy.lastReconciliationAt || (latestManualSubmittedAt && store.policy.lastReconciliationAt <= latestManualSubmittedAt)) {
    blockers.push("앱 재시작 후 주문 상태 재조정 기록이 필요합니다.");
  }
  if (!store.policy.safetyGateVerifiedAt) {
    blockers.push("kill switch와 worker pause 차단 점검 기록이 필요합니다.");
  }
  if (unresolvedUnknown > 0 || store.policy.unknownLock) {
    blockers.push("결과 불명 주문이 있어 자동화 실거래를 열 수 없습니다.");
  }
  return {
    eligible: blockers.length === 0,
    manualLimitOrders,
    reconciliationRecorded: !!store.policy.lastReconciliationAt,
    safetyGateVerified: !!store.policy.safetyGateVerifiedAt,
    unresolvedUnknown,
    blockers,
  };
};

const snapshot = (store: LiveTradingStore): LocalLiveTradingSnapshot => ({
  policy: { ...store.policy },
  attempts: [...store.attempts].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  automationEligibility: automationEligibility(store),
});

export const getLocalLiveTradingSnapshot = async (): Promise<LocalLiveTradingSnapshot> =>
  withStore(async (store) => {
    resetDailyLimitIfNeeded(store.policy);
    return snapshot(store);
  });

const resetBinding = (policy: LiveTradingPolicy, userId: string, accountSeq: number) => {
  policy.boundUserId = userId;
  policy.boundAccountSeq = accountSeq;
  policy.readinessVerifiedAt = null;
  policy.bindingHash = null;
  policy.userConsentAt = null;
  policy.manualEnabled = false;
  policy.automationEnabled = false;
  policy.lastReconciliationAt = null;
  policy.safetyGateVerifiedAt = null;
  policy.unknownLock = null;
};

export const verifyLocalManualReadiness = async ({
  userId,
  accountSeq,
  bindingHash,
}: {
  userId: string;
  accountSeq: number;
  bindingHash: string;
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (!isBoundTo(store.policy, userId, accountSeq) || store.policy.bindingHash !== bindingHash) {
    if (store.policy.unknownLock) {
      throw new Error("결과 불명 주문이 있어 다른 계좌로 readiness 바인딩을 변경할 수 없습니다. Toss 주문 이력을 먼저 확인하세요.");
    }
    resetBinding(store.policy, userId, accountSeq);
  }
  store.policy.bindingHash = bindingHash;
  store.policy.readinessVerifiedAt = nowIso();
  return snapshot(store);
});

export const consentLocalLiveTrading = async ({
  userId,
  accountSeq,
  confirmation,
}: {
  userId: string;
  accountSeq: number;
  confirmation: string;
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  if (!isBoundTo(store.policy, userId, accountSeq) || !store.policy.readinessVerifiedAt) {
    throw new Error("자동 읽기 전용 점검을 먼저 완료하세요.");
  }
  if (confirmation.trim() !== LOCAL_LIVE_TRADING_CONSENT_CONFIRMATION) {
    throw new Error(`동의 문구 \"${LOCAL_LIVE_TRADING_CONSENT_CONFIRMATION}\"를 정확히 입력해야 합니다.`);
  }
  store.policy.userConsentAt = nowIso();
  return snapshot(store);
});

export const setLocalManualLiveTrading = async ({
  userId,
  accountSeq,
  enabled,
  confirmation,
}: {
  userId: string;
  accountSeq: number;
  enabled: boolean;
  confirmation?: string;
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (!enabled) {
    store.policy.manualEnabled = false;
    store.policy.automationEnabled = false;
    return snapshot(store);
  }
  if (!isBoundTo(store.policy, userId, accountSeq) || !store.policy.readinessVerifiedAt || !store.policy.userConsentAt) {
    throw new Error("현재 설치와 선택 계좌의 자동 읽기 전용 점검 및 실거래 이용 동의가 필요합니다.");
  }
  if (confirmation?.trim() !== LOCAL_LIVE_TRADING_MANUAL_CONFIRMATION) {
    throw new Error(`수동 주문 해제 문구 \"${LOCAL_LIVE_TRADING_MANUAL_CONFIRMATION}\"를 정확히 입력해야 합니다.`);
  }
  if (store.policy.unknownLock) {
    throw new Error("결과 불명 주문이 있어 수동 실거래를 열 수 없습니다.");
  }
  store.policy.manualEnabled = true;
  return snapshot(store);
});

export const setLocalAutomationLiveTrading = async ({
  userId,
  accountSeq,
  enabled,
  confirmation,
}: {
  userId: string;
  accountSeq: number;
  enabled: boolean;
  confirmation?: string;
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (!enabled) {
    store.policy.automationEnabled = false;
    return snapshot(store);
  }
  if (!isBoundTo(store.policy, userId, accountSeq) || !store.policy.manualEnabled) {
    throw new Error("현재 설치·선택 계좌의 수동 실거래가 먼저 활성화되어야 합니다.");
  }
  if (confirmation?.trim() !== LOCAL_LIVE_TRADING_AUTOMATION_CONFIRMATION) {
    throw new Error(`자동화 실거래 해제 문구 \"${LOCAL_LIVE_TRADING_AUTOMATION_CONFIRMATION}\"를 정확히 입력해야 합니다.`);
  }
  const eligibility = automationEligibility(store);
  if (!eligibility.eligible) {
    throw new Error(eligibility.blockers.join(" "));
  }
  store.policy.automationEnabled = true;
  return snapshot(store);
});

export const recordLocalLiveReconciliation = async ({
  accountSeq,
  syncedBrokerOrderIds,
}: {
  accountSeq: number;
  syncedBrokerOrderIds: readonly string[];
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  const known = new Set(syncedBrokerOrderIds);
  for (const attempt of store.attempts) {
    if (attempt.accountSeq !== accountSeq || !attempt.brokerOrderId || !known.has(attempt.brokerOrderId)) continue;
    if (attempt.status === "submitted") {
      attempt.status = "reconciled";
      attempt.completedAt = nowIso();
    }
  }
  const unresolvedUnknown = store.attempts.some((attempt) => attempt.status === "unknown");
  if (!unresolvedUnknown) {
    store.policy.lastReconciliationAt = nowIso();
    store.policy.unknownLock = null;
  }
  return snapshot(store);
});

export const recordLocalLiveSafetyProof = async ({
  killSwitchEngaged,
  workerPaused,
}: {
  killSwitchEngaged: boolean;
  workerPaused: boolean;
}): Promise<LocalLiveTradingSnapshot> => withStore(async (store) => {
  if (!killSwitchEngaged || !workerPaused) {
    throw new Error("kill switch와 worker pause가 모두 차단 상태인 점검 결과가 필요합니다.");
  }
  store.policy.safetyGateVerifiedAt = nowIso();
  return snapshot(store);
});

export type LocalLiveTradingGate = {
  effective: boolean;
  reason: string | null;
  remainingDailyBuyKrw: number;
};

export const getLocalLiveTradingGate = async ({
  userId,
  accountSeq,
  source,
  globalGateOpen,
  globalGateReason,
  killSwitchEngaged,
  workerPaused,
}: {
  userId: string;
  accountSeq: number;
  source: LiveOrderSource;
  globalGateOpen: boolean;
  globalGateReason: string | null;
  killSwitchEngaged: boolean;
  workerPaused: boolean;
}): Promise<LocalLiveTradingGate> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  const remainingDailyBuyKrw = Math.max(0, LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW - store.policy.dailyBuyKrwSubmitted);
  if (!globalGateOpen) return { effective: false, reason: globalGateReason ?? "실거래 기본 게이트가 닫혀 있습니다.", remainingDailyBuyKrw };
  if (!isBoundTo(store.policy, userId, accountSeq) || !store.policy.readinessVerifiedAt || !store.policy.bindingHash) return { effective: false, reason: "현재 설치와 선택 계좌의 자동 읽기 전용 점검이 필요합니다.", remainingDailyBuyKrw };
  if (!store.policy.userConsentAt) return { effective: false, reason: "주식 실거래 위험 이용 동의가 필요합니다.", remainingDailyBuyKrw };
  if (store.policy.unknownLock) return { effective: false, reason: "결과 불명 주문이 있어 운영자 확인 전까지 실거래를 잠급니다.", remainingDailyBuyKrw };
  if (killSwitchEngaged) return { effective: false, reason: "긴급 중지가 켜져 있습니다.", remainingDailyBuyKrw };
  if (workerPaused) return { effective: false, reason: "워커 일시중지 상태입니다.", remainingDailyBuyKrw };
  if (source === "manual" && !store.policy.manualEnabled) return { effective: false, reason: "수동 실거래 토글이 꺼져 있습니다.", remainingDailyBuyKrw };
  if (source === "automation" && !store.policy.automationEnabled) return { effective: false, reason: "자동화 실거래 토글이 꺼져 있습니다.", remainingDailyBuyKrw };
  return { effective: true, reason: null, remainingDailyBuyKrw };
});

export const prepareLocalLiveOrderAttempt = async ({
  userId,
  accountSeq,
  source,
  previewId,
  clientOrderId,
  payloadHash,
  symbol,
  side,
  quantity,
  limitPrice,
  currency,
  krwEquivalent,
  exchangeRate,
}: Omit<LiveOrderAttempt, "id" | "status" | "brokerOrderId" | "createdAt" | "submissionStartedAt" | "completedAt" | "error">): Promise<LiveOrderAttempt> => withStore(async (store) => {
  resetDailyLimitIfNeeded(store.policy);
  if (!Number.isFinite(krwEquivalent) || krwEquivalent <= 0) throw new Error("유효한 KRW 환산 주문금액이 필요합니다.");
  if (store.attempts.some((attempt) => attempt.clientOrderId === clientOrderId)) {
    throw new Error("동일 clientOrderId 주문 시도가 이미 기록되어 있습니다. 재제출하지 마세요.");
  }
  if (side === "buy") {
    if (krwEquivalent > LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW) {
      throw new Error(`매수 1건은 ${LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW.toLocaleString("ko-KR")}원 이하만 허용됩니다.`);
    }
    if (store.policy.dailyBuyKrwSubmitted + krwEquivalent > LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW) {
      throw new Error("KST 일일 매수 한도를 초과합니다. 취소·매도로 한도가 복구되지 않습니다.");
    }
    // POST 전 영속화하는 순간부터 보수적으로 누적한다. timeout/중단에도 한도를 되돌리지 않는다.
    store.policy.dailyBuyKrwSubmitted += krwEquivalent;
  }
  const attempt: LiveOrderAttempt = {
    id: randomUUID(),
    userId,
    accountSeq,
    source,
    previewId,
    clientOrderId,
    payloadHash,
    symbol,
    side,
    quantity,
    limitPrice,
    currency,
    krwEquivalent,
    exchangeRate,
    status: "submission_pending",
    brokerOrderId: null,
    createdAt: nowIso(),
    submissionStartedAt: nowIso(),
    completedAt: null,
    error: null,
  };
  store.attempts.push(attempt);
  return attempt;
});

const updateAttempt = async (
  attemptId: string,
  update: (attempt: LiveOrderAttempt, store: LiveTradingStore) => void,
): Promise<LiveOrderAttempt> => withStore(async (store) => {
  const attempt = store.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error("실거래 주문 시도를 찾을 수 없습니다.");
  update(attempt, store);
  return { ...attempt };
});

export const markLocalLiveOrderSubmitted = (attemptId: string, brokerOrderId: string) =>
  updateAttempt(attemptId, (attempt) => {
    attempt.status = "submitted";
    attempt.brokerOrderId = brokerOrderId;
    attempt.completedAt = nowIso();
    attempt.error = null;
  });

export const markLocalLiveOrderRejected = (attemptId: string, error: string) =>
  updateAttempt(attemptId, (attempt) => {
    attempt.status = "rejected";
    attempt.completedAt = nowIso();
    attempt.error = error;
  });

export const markLocalLiveOrderUnknown = (attemptId: string, error: string) =>
  updateAttempt(attemptId, (attempt, store) => {
    attempt.status = "unknown";
    attempt.completedAt = nowIso();
    attempt.error = error;
    store.policy.automationEnabled = false;
    store.policy.unknownLock = { attemptId, reason: error, lockedAt: nowIso() };
  });
