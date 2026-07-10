import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { AutomationStrategyConfig } from "../src/domain/automation.ts";
import type {
  PaperAccount,
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PaperTradingMarket,
  PaperTradingRunSource,
  PaperTradingSession,
} from "../src/domain/paper-trading.ts";
import type { Currency } from "../src/domain/portfolio.ts";
import type { BrokerOrderRequest, OrderSide, OrderType } from "../src/domain/trading.ts";
import type { UserContext } from "../src/domain/user.ts";
import type { BrokerPort } from "../src/ports/broker.ts";
import { createTossBroker, LiveTradingDisabledError } from "../src/adapters/toss/toss-broker.ts";
import { createCryptoBroker } from "../src/adapters/crypto/crypto-broker.ts";
import { parseStrategyConfigPayload } from "../src/lib/automation/http.ts";
import {
  getAutomationHealthSnapshot,
  getAutomationReadinessSnapshot,
} from "../src/lib/automation/readiness.ts";
import {
  getAutomationKillSwitchState,
  setAutomationKillSwitchState,
  type AutomationKillSwitchState,
} from "../src/lib/automation/kill-switch.ts";
import {
  getAutomationWorkerControlState,
  setAutomationWorkerControlState,
  type AutomationWorkerControlState,
} from "../src/lib/automation/worker-control.ts";
import {
  LOCAL_AUTOMATION_MAX_INTERVAL_SECONDS,
  LOCAL_AUTOMATION_MIN_INTERVAL_SECONDS,
  LocalAutomationScheduler,
  configureLocalAutomationScheduler,
  getLocalAutomationSchedulerState,
} from "../src/lib/automation/local-scheduler.ts";
import { isCredentialEncryptionConfigured } from "../src/lib/security/crypto.ts";
import {
  LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
  LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW,
  approveLocalManualQa,
  getLocalLiveTradingGate,
  getLocalLiveTradingSnapshot,
  markLocalLiveOrderRejected,
  markLocalLiveOrderSubmitted,
  markLocalLiveOrderUnknown,
  prepareLocalLiveOrderAttempt,
  recordLocalLiveReconciliation,
  recordLocalLiveSafetyProof,
  setLocalAutomationLiveTrading,
  setLocalManualLiveTrading,
  type LiveOrderSource,
} from "../src/lib/automation/local-live-trading.ts";
import {
  cryptoExchangeContract,
  getCryptoAccounts,
  getCryptoOrderConstraints,
  getCryptoOrderChance,
  getCryptoTicker,
  getUpbitOrderbookInstrument,
  previewCryptoLimitOrder,
  type CryptoExchange,
} from "../src/lib/crypto-exchange/client.ts";
import { loadSymbolMaster } from "../src/lib/market/symbol-master.ts";
import { resolveInstrumentDisplay } from "../src/lib/market/instrument-display.ts";
import {
  searchSymbolItems,
  type SymbolSearchMarket,
} from "../src/lib/market/symbol-search.ts";
import {
  getStrategyConfigHash,
  simulateAutomationStrategy,
  toAutomationLastSimulation,
  validateStrategyConfig,
} from "../src/lib/automation/simulation.ts";
import {
  deleteStrategyConfig,
  findStrategyConfig,
  grantAutomationFeature,
  listStrategyConfigs,
  revokeAutomationFeature,
  saveAutomationSimulation,
  upsertStrategyConfig,
} from "../src/lib/automation/store.ts";
import {
  deleteBrokerCredentials,
  getBrokerCredentialView,
  loadDecryptedCredentials,
  saveBrokerCredentials,
} from "../src/lib/broker/credential-store.ts";
import {
  applySyncUpdates,
  listFills,
  listOpenTrackedOrders,
  listTrackedOrders,
  getOrderPreview,
  markOrderPreviewSubmitted,
  recordOrderPreview,
  recordSubmittedOrder,
  verifyOrderPreview,
} from "../src/lib/automation/order-tracker.ts";
import { syncOrderFills } from "../src/use-cases/trading/sync-order-fills.ts";
import {
  deleteBrokerAccountPreference,
  getBrokerAccountPreference,
  saveBrokerAccountPreference,
} from "../src/lib/broker/account-preferences.ts";
import { getSupabaseAdminConfig } from "../src/lib/supabase/config.ts";
import {
  applyPaperTradingRunResult,
  getPaperTradingStorageRootForUser,
  readPaperTradingState,
  resetPaperTradingState,
  writePaperTradingRunSnapshot,
  writePaperTradingState,
} from "../src/lib/paper-trading/state-store.ts";
import { pollOfficialNews } from "../src/lib/local-engine/news.ts";
import {
  createMarketWorkspaceFixtureDependencies,
  handleMarketWorkspaceRequest,
} from "../src/lib/local-engine/market-workspace.ts";
import {
  fixtureLocalChartResponse,
  handleLocalCryptoChartRequest,
  LOCAL_CHART_TIMEFRAMES,
} from "../src/lib/local-engine/chart-data.ts";
import {
  COMMUNITY_CACHE_MAX_ENTRIES,
  COMMUNITY_CACHE_TTL_SECONDS,
} from "../src/lib/community-pain/config.mts";
import { getCommunityPain } from "../src/lib/community-pain/service.mts";
import type {
  CommunityPainResponse,
  CommunitySourceId,
} from "../src/lib/community-pain/types.mts";
import {
  appendTerminalDashboardOperatorAction,
  buildTerminalDashboardSnapshot,
  saveTerminalDashboardPlaybook,
} from "../src/lib/local-engine/dashboard.ts";
import {
  addWatchlistItem,
  getWatchlistSummary,
  listWatchlist,
  removeWatchlistItem,
  WatchlistRequestError,
} from "../src/lib/local-engine/watchlist.ts";
import { buildPaperTradingCandidates } from "../src/use-cases/trading/build-paper-trading-candidates.ts";
import {
  PAPER_STRATEGY_VERSION,
  runPaperTradingDaily,
  type RunPaperTradingDailyResult,
} from "../src/use-cases/trading/run-paper-trading-daily.ts";
import { runUserAutomationCycle } from "../src/use-cases/trading/run-automation-cycle.ts";
import {
  runAutomationWorkerTick,
  type AutomationWorkerTickResult,
} from "../src/use-cases/trading/run-automation-worker.ts";
import { checkTossLiveReadiness } from "./check_toss_live_readiness.mts";
import { createTossClient, formatTossApiError, TossApiError } from "../src/lib/toss/client.ts";
import { TOSS_OPENAPI_CONTRACT } from "../src/lib/toss/contract.ts";
import type { Account, TossCurrency } from "../src/lib/toss/types.ts";
import { createOrderIntent } from "../src/use-cases/trading/create-order-intent.ts";
import { createOrderPrecheck, inferCurrency } from "../src/use-cases/trading/precheck-order.ts";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type LocalSelfTestStatus = "pass" | "warn" | "fail";

type LocalSelfTestCheck = {
  id: string;
  label: string;
  status: LocalSelfTestStatus;
  summary: string;
  action: string;
  blocking: boolean;
  durationMs: number;
};

type AutomationDryRunEvaluation = {
  strategyId: string;
  name: string;
  symbol: string;
  mode: string;
  marketPrice: number | null;
  triggers: number;
  orders: AutomationWorkerTickResult["orders"];
  logs: AutomationWorkerTickResult["logs"];
  strategyTransition?: AutomationWorkerTickResult["strategyTransition"];
  summary: Record<string, unknown>;
};

const ENGINE_NAME = "stock-analysis-local-engine";
const ENGINE_VERSION = (() => {
  try {
    const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "development";
  } catch {
    return "development";
  }
})();
const DEFAULT_PORT = 38771;
const CRYPTO_LIVE_AUTOMATION_SUPPORTED = false;
const CRYPTO_TICKER_MAX_AGE_MS = 60_000;
const DEFAULT_SYMBOL_MARKETS: SymbolSearchMarket[] = ["US", "KOSPI", "KOSDAQ", "CRYPTO"];
const COMMUNITY_SOURCE_IDS = new Set<CommunitySourceId>([
  "paxnet",
  "bobaedream",
  "reddit",
  "threads",
  "blind",
  "naver_finance",
  "clien",
]);
const COMMUNITY_TRANSIENT_FAILURE_CACHE_TTL_SECONDS = 60;
const localCommunityCache = new Map<string, { expiresAt: number; payload: CommunityPainResponse }>();
const localCommunityInFlight = new Map<string, Promise<CommunityPainResponse>>();
const localUserId = () => process.env.STOCK_ANALYSIS_LOCAL_USER_ID?.trim() || "local-macos-user";
let localAutomationScheduler: LocalAutomationScheduler | null = null;

const getLiveTradingGate = async (
  userId: string,
  source: LiveOrderSource = "manual",
  accountSeqOverride?: number,
) => {
  const [credential, accountPreference, killSwitch, workerControl, snapshot] = await Promise.all([
    getBrokerCredentialView(userId, "toss"),
    getBrokerAccountPreference(userId, "toss"),
    getAutomationKillSwitchState(),
    getAutomationWorkerControlState(),
    getLocalLiveTradingSnapshot(),
  ]);
  const accountSeq = accountSeqOverride ?? accountPreference?.accountSeq ?? null;
  const baseReason = process.env.STOCK_ANALYSIS_RUNTIME !== "macos-local"
    ? "실거래는 macOS 로컬 sidecar에서만 허용됩니다."
    : !process.env.STOCK_ANALYSIS_STORAGE_ROOT?.trim()
      ? "실거래 정책 저장소가 설정되지 않았습니다."
      : !isCredentialEncryptionConfigured()
        ? "실거래에는 암호화 credential 저장소가 필요합니다."
        : credential?.status !== "verified"
          ? "검증 완료된 Toss API 키가 필요합니다."
          : !accountSeq
            ? "실거래에는 선택한 Toss BROKERAGE 계좌가 필요합니다."
            : null;
  const baseOpen = baseReason === null;
  const policyGate = accountSeq
    ? await getLocalLiveTradingGate({
      userId,
      accountSeq,
      source,
      globalGateOpen: baseOpen,
      globalGateReason: baseReason,
      killSwitchEngaged: killSwitch.engaged,
      workerPaused: workerControl.paused,
    })
    : { effective: false, reason: baseReason ?? "선택 계좌가 필요합니다.", remainingDailyBuyKrw: 0 };
  const userEnabled = source === "automation"
    ? snapshot.policy.automationEnabled
    : snapshot.policy.manualEnabled;
  return {
    userEnabled,
    masterEnabled: baseOpen,
    effective: policyGate.effective,
    status: policyGate.effective ? 200 : 423,
    reason: policyGate.reason,
    accountSeq,
    remainingDailyBuyKrw: policyGate.remainingDailyBuyKrw,
    policy: snapshot.policy,
    automationEligibility: snapshot.automationEligibility,
  };
};

const parseSymbolMarkets = (value: string | null): SymbolSearchMarket[] => {
  if (!value) {
    return DEFAULT_SYMBOL_MARKETS;
  }
  const markets = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is SymbolSearchMarket =>
      item === "US" || item === "KOSPI" || item === "KOSDAQ" || item === "CRYPTO",
    );
  return markets.length ? markets : DEFAULT_SYMBOL_MARKETS;
};

const searchLocalSymbols = async (url: URL) => {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const markets = parseSymbolMarkets(url.searchParams.get("markets"));
  const requestedLimit = Number(url.searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 30)
    : 12;
  if (!query) {
    return jsonResponse({ query, markets, matches: [], warnings: [] });
  }
  const master = await loadSymbolMaster({ markets });
  return jsonResponse({
    query,
    markets,
    matches: searchSymbolItems(master.items, query, { markets, limit }).map((match) => ({
      ...match.item,
      score: match.score,
      matchedBy: match.matchedBy,
    })),
    sources: master.sources,
    warnings: master.warnings.slice(0, 6),
  });
};

const isCryptoExchange = (value: string): value is CryptoExchange =>
  value === "upbit" || value === "bithumb";

const userContext = (): UserContext & { userId: string; authenticated: true } => ({
  userId: localUserId(),
  authenticated: true,
  roles: ["member"],
  permissions: [],
});

const jsonResponse = (payload: JsonValue, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(payload, {
    ...init,
    headers,
  });
};

const errorResponse = (error: unknown, status = 500) =>
  jsonResponse({
    error: error instanceof Error ? error.message : String(error),
  }, { status });

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isPaperSession = (value: unknown): value is PaperTradingSession =>
  value === "US" || value === "KR";

const isPaperRunSource = (value: unknown): value is PaperTradingRunSource =>
  value === "manual" || value === "script" || value === "codex-automation";

const createScanFailureResult = ({
  session,
  source,
  account,
  positions,
  today,
  error,
}: {
  session: PaperTradingSession;
  source: PaperTradingRunSource;
  account: PaperAccount | null;
  positions: PaperPosition[];
  today?: string;
  error: unknown;
}): RunPaperTradingDailyResult => {
  const now = new Date().toISOString();
  const result = runPaperTradingDaily({
    session,
    account,
    positions,
    entryCandidates: [],
    today,
    now,
    source,
  });
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...result,
    run: {
      ...result.run,
      summary: `${session} 후보 스캔 실패: 주문 없이 로그만 저장했습니다.`,
    },
    logs: [
      {
        id: `paper-log-${crypto.randomUUID()}`,
        runId: result.run.id,
        session,
        source,
        level: "error",
        message: `후보 스캔 실패로 페이퍼 주문을 만들지 않았습니다. ${message}`,
        strategyVersion: PAPER_STRATEGY_VERSION,
        createdAt: now,
      },
      ...result.logs,
    ],
  };
};

const readJsonBody = async (request: Request) =>
  (await request.json().catch(() => ({}))) as Record<string, unknown>;

const killSwitchBlockResponse = (state: AutomationKillSwitchState, scope: "paper-trading" | "automation-cycle") =>
  jsonResponse({
    error: scope === "paper-trading"
      ? "긴급 중지 상태라 모의 주문 실행을 차단했습니다."
      : "긴급 중지 상태라 자동화 큐 실행을 차단했습니다.",
    killSwitch: state,
  }, { status: 423 });

const workerPausedResponse = (state: AutomationWorkerControlState) =>
  jsonResponse({
    error: "워커 일시중지 상태라 자동화 큐 실행을 차단했습니다.",
    workerControl: state,
  }, { status: 423 });

const tossOpenApiContractSummary = () => {
  const accountHeaderOperationCount = TOSS_OPENAPI_CONTRACT.requiredOperations
    .filter((operation) => operation.accountHeader).length;
  return {
    specVersion: TOSS_OPENAPI_CONTRACT.specVersion,
    baseUrl: TOSS_OPENAPI_CONTRACT.baseUrl,
    docsUrl: TOSS_OPENAPI_CONTRACT.docsUrl,
    openApiJsonUrl: TOSS_OPENAPI_CONTRACT.openApiJsonUrl,
    accountHeaderName: TOSS_OPENAPI_CONTRACT.accountHeaderName,
    requiredOperationCount: TOSS_OPENAPI_CONTRACT.requiredOperations.length,
    accountHeaderOperationCount,
    requiredOperations: TOSS_OPENAPI_CONTRACT.requiredOperations,
    guidance: [
      "이 앱은 Toss OpenAPI 계약 메타데이터를 기준으로 계좌 헤더와 주문 schema를 검증합니다.",
      "최신 공식 스펙과의 drift는 npm run toss:contract로 확인하세요.",
      "실계좌 조회와 주문 사전검증은 사용자가 명시적으로 누른 버튼에서만 실행합니다.",
    ],
  };
};

const runPaperTrading = async (request: Request) => {
  const killSwitch = await getAutomationKillSwitchState();
  if (killSwitch.engaged) {
    return killSwitchBlockResponse(killSwitch, "paper-trading");
  }
  const payload = await readJsonBody(request);
  const dryRun = payload.dryRun === true;
  const session = isPaperSession(payload.session) ? payload.session : "US";
  const source = isPaperRunSource(payload.source) ? payload.source : "manual";
  const context = userContext();
  const storageRoot = getPaperTradingStorageRootForUser(context.userId);
  const { state } = await readPaperTradingState(storageRoot);
  const account = state.accounts[session] ?? null;
  const positions = state.positions.filter((position) => position.session === session);
  const today = new Date().toISOString().slice(0, 10);
  let result: RunPaperTradingDailyResult;
  try {
    const entryCandidates = dryRun && marketSnapshotChecksDisabled()
      ? []
      : await buildPaperTradingCandidates(session, { userContext: context });
    result = runPaperTradingDaily({
      session,
      account,
      positions,
      entryCandidates,
      today,
      source,
    });
  } catch (error) {
    result = createScanFailureResult({
      session,
      source,
      account,
      positions,
      today,
      error,
    });
  }
  if (dryRun) {
    return jsonResponse({
      ...result,
      dryRun: true,
      state,
      snapshotPath: null,
    });
  }
  const nextState = applyPaperTradingRunResult(state, session, result);
  await writePaperTradingState(nextState, storageRoot);
  const snapshotPath = await writePaperTradingRunSnapshot(result, storageRoot);
  return jsonResponse({
    ...result,
    dryRun: false,
    state: nextState,
    snapshotPath,
  });
};

const getPaperTradingStateResponse = async () => {
  const context = userContext();
  const storageRoot = getPaperTradingStorageRootForUser(context.userId);
  const { state, repaired, storagePath } = await readPaperTradingState(storageRoot);
  return jsonResponse({
    state,
    repaired,
    storagePath,
  });
};

const resetPaperTradingStateResponse = async () => {
  const context = userContext();
  const storageRoot = getPaperTradingStorageRootForUser(context.userId);
  const { state, storagePath } = await resetPaperTradingState(storageRoot);
  return jsonResponse({
    state,
    repaired: false,
    storagePath,
    reset: true,
  });
};

const isOrderSide = (value: unknown): value is OrderSide =>
  value === "buy" || value === "sell";

const isOrderType = (value: unknown): value is OrderType =>
  value === "market" || value === "limit" || value === "stop-limit";

const isCurrency = (value: unknown): value is Currency =>
  value === "USD" || value === "KRW";

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const positiveIntegerValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  if (parsed === null) {
    return null;
  }
  const integer = Math.floor(parsed);
  return integer > 0 ? integer : null;
};

const positiveMoneyValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const normalizePaperOrderSymbol = (value: unknown) => {
  const symbol = typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 16)
    : "";
  return symbol || null;
};

const marketForPaperOrder = (session: PaperTradingSession, fallback?: PaperTradingMarket): PaperTradingMarket =>
  fallback ?? (session === "KR" ? "KOSPI" : "US");

const makePaperId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const resultSummaryForLog = (
  symbol: string,
  side: OrderSide,
  quantity: number,
  price: number,
  currency: Currency,
  dryRun: boolean,
) =>
  `${symbol} OrderIntent 모의 ${side === "buy" ? "매수" : "매도"} ${quantity}주 @ ${price.toFixed(2)} ${currency}${dryRun ? " dry-run" : ""}`;

const submitPaperOrderIntent = async (request: Request) => {
  const killSwitch = await getAutomationKillSwitchState();
  if (killSwitch.engaged) {
    return killSwitchBlockResponse(killSwitch, "paper-trading");
  }

  const payload = await readJsonBody(request);
  const sourcePayload = typeof payload.orderIntent === "object" && payload.orderIntent !== null
    ? payload.orderIntent as Record<string, unknown>
    : payload;
  const dryRun = payload.dryRun === true;
  const session = isPaperSession(payload.session) ? payload.session : "US";
  const symbol = normalizePaperOrderSymbol(sourcePayload.symbol);
  const side = isOrderSide(sourcePayload.side) ? sourcePayload.side : null;
  const type = isOrderType(sourcePayload.type) ? sourcePayload.type : "limit";
  const quantity = positiveIntegerValue(sourcePayload.quantity);
  const price = positiveMoneyValue(sourcePayload.limitPrice) ?? positiveMoneyValue(sourcePayload.price);
  const stopPrice = positiveMoneyValue(sourcePayload.stopPrice);
  const intentId = typeof sourcePayload.id === "string" ? sourcePayload.id.slice(0, 120) : undefined;

  if (!symbol) {
    return jsonResponse({ error: "모의 주문에 사용할 종목 코드가 필요합니다." }, { status: 400 });
  }
  if (!side) {
    return jsonResponse({ error: "모의 주문 방향은 buy 또는 sell이어야 합니다." }, { status: 400 });
  }
  if (!quantity) {
    return jsonResponse({ error: "모의 주문 수량은 1주 이상이어야 합니다." }, { status: 400 });
  }
  if (!price) {
    return jsonResponse({ error: "모의 주문에는 양수 가격이 필요합니다." }, { status: 400 });
  }

  const context = userContext();
  const storageRoot = getPaperTradingStorageRootForUser(context.userId);
  const { state } = await readPaperTradingState(storageRoot);
  const account = state.accounts[session];
  const currency = isCurrency(sourcePayload.currency) ? sourcePayload.currency : account.currency;
  if (currency !== account.currency) {
    return jsonResponse({
      error: `모의 계좌 통화(${account.currency})와 OrderIntent 통화(${currency})가 일치하지 않습니다.`,
    }, { status: 400 });
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const runId = makePaperId("paper-run-intent");
  const sessionPositions = state.positions
    .filter((position) => position.session === session)
    .map((position) => ({
      ...position,
      symbol: position.symbol.trim().toUpperCase(),
      completedStages: position.completedStages ?? [],
    }));
  const otherPositions = state.positions.filter((position) => position.session !== session);
  const existing = sessionPositions.find((position) => position.symbol === symbol);
  const orderValue = quantity * price;
  let cash = account.cash;
  let realizedPnl = account.realizedPnl;
  let nextSessionPositions = [...sessionPositions];
  let market = marketForPaperOrder(session, existing?.market);
  let realizedOnExecution = 0;

  if (side === "buy") {
    if (cash < orderValue) {
      return jsonResponse({
        error: `모의 계좌 현금 부족: 필요 ${orderValue.toFixed(2)} ${account.currency}, 보유 ${cash.toFixed(2)} ${account.currency}`,
      }, { status: 409 });
    }
    cash -= orderValue;
    if (existing) {
      const totalQuantity = existing.quantity + quantity;
      const averagePrice = ((existing.averagePrice * existing.quantity) + orderValue) / totalQuantity;
      nextSessionPositions = nextSessionPositions.map((position) =>
        position.id === existing.id
          ? {
            ...position,
            quantity: totalQuantity,
            averagePrice,
            lastPrice: price,
            updatedAt: now,
          }
          : position,
      );
      market = existing.market;
    } else {
      nextSessionPositions.push({
        id: makePaperId("paper-position"),
        session,
        market,
        symbol,
        quantity,
        averagePrice: price,
        lastPrice: price,
        currency: account.currency,
        openedAt: now,
        updatedAt: now,
        completedStages: [],
      });
    }
  } else {
    if (!existing) {
      return jsonResponse({ error: `${symbol} 모의 포지션이 없어 매도 주문을 실행할 수 없습니다.` }, { status: 409 });
    }
    if (existing.quantity < quantity) {
      return jsonResponse({
        error: `${symbol} 모의 보유 수량 부족: 보유 ${existing.quantity}주, 요청 ${quantity}주`,
      }, { status: 409 });
    }
    realizedOnExecution = (price - existing.averagePrice) * quantity;
    realizedPnl += realizedOnExecution;
    cash += orderValue;
    market = existing.market;
    nextSessionPositions = nextSessionPositions
      .map((position) =>
        position.id === existing.id
          ? {
            ...position,
            quantity: position.quantity - quantity,
            lastPrice: price,
            updatedAt: now,
            completedStages: [...new Set([...position.completedStages, "manual-intent-sell"])],
          }
          : position,
      )
      .filter((position) => position.quantity > 0);
  }

  const order: PaperOrder = {
    id: makePaperId("paper-order-intent"),
    runId,
    session,
    market,
    symbol,
    side,
    type,
    quantity,
    price,
    currency: account.currency,
    status: "filled",
    reason: stopPrice
      ? `macOS OrderIntent 모의 실행 · 손절 ${stopPrice.toFixed(2)}`
      : "macOS OrderIntent 모의 실행",
    strategyVersion: PAPER_STRATEGY_VERSION,
    createdAt: now,
  };
  const execution: PaperExecution = {
    id: makePaperId("paper-execution-intent"),
    runId,
    orderId: order.id,
    session,
    market,
    symbol,
    side,
    quantity,
    price,
    currency: account.currency,
    realizedPnl: realizedOnExecution,
    executedAt: now,
  };
  const result: RunPaperTradingDailyResult = {
    run: {
      id: runId,
      session,
      source: "manual",
      today,
      strategyVersion: PAPER_STRATEGY_VERSION,
      status: "executed",
      candidateCount: 1,
      tradableCount: 1,
      probeCount: 0,
      ordersCount: 1,
      executionsCount: 1,
      startedAt: now,
      finishedAt: now,
      summary: `${symbol} OrderIntent 모의 ${side === "buy" ? "매수" : "매도"} ${quantity}주 @ ${price.toFixed(2)} ${account.currency}`,
    },
    nextAccount: {
      ...account,
      cash,
      realizedPnl,
      strategyVersion: PAPER_STRATEGY_VERSION,
      updatedAt: now,
    },
    nextPositions: nextSessionPositions,
    orders: [order],
    executions: [execution],
    logs: [{
      id: makePaperId("paper-log-intent"),
      runId,
      session,
      source: "manual",
      market,
      symbol,
      level: "info",
      message: resultSummaryForLog(symbol, side, quantity, price, account.currency, dryRun),
      strategyVersion: PAPER_STRATEGY_VERSION,
      createdAt: now,
    }],
  };

  if (dryRun) {
    return jsonResponse({
      ...result,
      dryRun: true,
      state,
      snapshotPath: null,
    });
  }

  const nextState = {
    ...applyPaperTradingRunResult(state, session, result),
    positions: [...otherPositions, ...nextSessionPositions],
  };
  await writePaperTradingState(nextState, storageRoot);
  const snapshotPath = await writePaperTradingRunSnapshot(result, storageRoot);
  const auditEntry = await appendTerminalDashboardOperatorAction({
    symbol,
    orderIntentId: intentId,
    title: "모의 주문 실행",
    detail: `${symbol} ${side === "buy" ? "매수" : "매도"} ${quantity}주 @ ${price.toFixed(2)} ${account.currency}를 paper state에 기록했습니다.`,
  });

  return jsonResponse({
    ...result,
    dryRun: false,
    state: nextState,
    snapshotPath,
    auditEntry,
  });
};

const automationDryRunSummary = async (
  userId: string,
  options: { cleanupInternalStrategies?: boolean } = {},
) => {
  if (options.cleanupInternalStrategies !== false) {
    await cleanupInternalSelfTestStrategies(userId);
  }
  const [killSwitch, workerControl, credential, accountPreference, configs, liveGate] = await Promise.all([
    getAutomationKillSwitchState(),
    getAutomationWorkerControlState(),
    getBrokerCredentialView(userId, "toss"),
    getBrokerAccountPreference(userId, "toss"),
    listStrategyConfigs(userId),
    getLiveTradingGate(userId),
  ]);
  const enabledConfigs = configs.filter((config) => config.status === "enabled");
  const base = {
    userId,
    liveTradingEnabled: liveGate.effective,
    accountSeq: accountPreference?.accountSeq,
    strategies: enabledConfigs.length,
    triggers: 0,
    orders: 0,
    submitted: 0,
    rejected: 0,
    blocked: 0,
    errors: 0,
    syncedOrders: 0,
    newFills: 0,
    evaluations: [] as AutomationDryRunEvaluation[],
  };
  if (killSwitch.engaged) {
    return {
      ...base,
      status: "blocked",
      reason: "kill-switch",
    };
  }
  if (workerControl.paused) {
    return {
      ...base,
      status: "blocked",
      reason: "worker-paused",
    };
  }
  if (enabledConfigs.length === 0) {
    return {
      ...base,
      status: "skipped",
      reason: "no-enabled-strategies",
    };
  }

  const preview = await previewAutomationStrategyTicks(userId, enabledConfigs);
  const readinessReason = credential?.status !== "verified"
    ? "paper-preview-no-credentials"
    : !accountPreference
      ? "paper-preview-account-selection-required"
      : !liveGate.effective
        ? liveGate.reason ?? "paper-preview-live-gate-closed"
        : "paper-preview-ready";

  return {
    ...base,
    ...preview.totals,
    evaluations: preview.evaluations,
    status: liveGate.effective && accountPreference && credential?.status === "verified" ? "ready" : "preview",
    reason: readinessReason,
    safety: "dry-run: broker 제출 없음",
  };
};

const previewAutomationStrategyTicks = async (
  userId: string,
  configs: AutomationStrategyConfig[],
) => {
  const evaluations = [];
  let triggers = 0;
  let orders = 0;
  let submitted = 0;
  let rejected = 0;
  let blocked = 0;
  let errors = 0;

  for (const config of configs) {
    const marketPrice = strategyTickPreviewPrice(config, "current", null);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      errors += 1;
      evaluations.push({
        strategyId: config.id,
        name: config.name,
        symbol: config.symbol.trim().toUpperCase(),
        mode: config.mode ?? "ladder",
        marketPrice: null,
        triggers: 0,
        orders: [],
        logs: [{
          level: "error",
          message: "자동화 리허설에 사용할 유효한 현재가가 없습니다.",
        }],
        summary: {
          headline: "현재가가 없어 전략을 평가하지 못했습니다.",
          action: "none",
          mode: strategyModeLabel(config),
          safety: "dry-run: broker 제출 없음",
          nextAction: "전략 기준가 또는 현재가를 다시 저장한 뒤 리허설을 실행하세요.",
          submittedOrders: 0,
          blockedOrders: 0,
          rejectedOrders: 0,
          errorOrders: 1,
          blockers: ["자동화 리허설에 사용할 유효한 현재가가 없습니다."],
          scenario: "current",
        },
      });
      continue;
    }

    const result = await runAutomationWorkerTick({
      userId,
      config: { ...config, status: "enabled" },
      marketPrice,
      broker: previewBroker(),
      liveTradingEnabled: false,
      accountSeq: 0,
      today: new Date().toISOString().slice(0, 10),
    });
    const resultSubmitted = result.orders.filter((order) => order.status === "submitted").length;
    const resultRejected = result.orders.filter((order) => order.status === "rejected").length;
    const resultBlocked = result.orders.filter((order) => order.status === "blocked").length;
    const resultErrors = result.orders.filter((order) => order.status === "error").length;

    triggers += result.triggers;
    orders += result.orders.length;
    submitted += resultSubmitted;
    rejected += resultRejected;
    blocked += resultBlocked;
    errors += resultErrors;
    evaluations.push({
      strategyId: config.id,
      name: config.name,
      symbol: config.symbol.trim().toUpperCase(),
      mode: config.mode ?? "ladder",
      marketPrice,
      triggers: result.triggers,
      orders: result.orders,
      logs: result.logs,
      summary: strategyTickPreviewSummary(config, "current", marketPrice, result),
    });
  }

  return {
    evaluations,
    totals: {
      triggers,
      orders,
      submitted,
      rejected,
      blocked,
      errors,
    },
  };
};

type StrategyTickPreviewScenario = "current" | "entry-trigger";

const tickPreviewScenario = (value: unknown): StrategyTickPreviewScenario =>
  value === "entry-trigger" ? "entry-trigger" : "current";

const numericPayload = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const firstGridEntryPrice = (config: AutomationStrategyConfig): number | null => {
  if (!config.grid || config.grid.rungs.length === 0) {
    return null;
  }
  const firstRung = [...config.grid.rungs].sort((a, b) => a.buyDropPct - b.buyDropPct)[0];
  if (!firstRung || !Number.isFinite(config.grid.basePrice) || config.grid.basePrice <= 0) {
    return null;
  }
  return config.grid.basePrice * (1 - firstRung.buyDropPct / 100);
};

const loopEntryPrice = (config: AutomationStrategyConfig): number | null => {
  if (!config.loop || !Number.isFinite(config.loop.anchorPrice) || config.loop.anchorPrice <= 0) {
    return null;
  }
  return config.loop.anchorPrice * (1 - config.loop.buyDropPct / 100);
};

const ladderEntryPrice = (config: AutomationStrategyConfig): number | null => {
  const buySteps = config.ladder
    .filter((step) => step.side === "buy" && Number.isFinite(step.price) && step.price > 0)
    .sort((a, b) => b.price - a.price);
  return buySteps[0]?.price ?? null;
};

const strategyTickPreviewPrice = (
  config: AutomationStrategyConfig,
  scenario: StrategyTickPreviewScenario,
  explicitMarketPrice: number | null,
) => {
  if (explicitMarketPrice) {
    return explicitMarketPrice;
  }
  if (scenario === "entry-trigger") {
    return firstGridEntryPrice(config) ?? loopEntryPrice(config) ?? ladderEntryPrice(config) ?? config.currentPrice;
  }
  return config.currentPrice;
};

const strategyModeLabel = (config: AutomationStrategyConfig) => {
  if (config.mode === "loop-grid") {
    return "1% 순환매매";
  }
  if (config.mode === "percent-grid") {
    return "분할 그리드";
  }
  return "가격 사다리";
};

const strategyTickPreviewSummary = (
  config: AutomationStrategyConfig,
  scenario: StrategyTickPreviewScenario,
  marketPrice: number,
  result: AutomationWorkerTickResult,
  safety = "dry-run: broker 제출 없음",
) => {
  const nextEntryPrice = firstGridEntryPrice(config) ?? loopEntryPrice(config) ?? ladderEntryPrice(config);
  const blockedOrders = result.orders.filter((order) => order.status === "blocked").length;
  const rejectedOrders = result.orders.filter((order) => order.status === "rejected").length;
  const errorOrders = result.orders.filter((order) => order.status === "error").length;
  const submittedOrders = result.orders.filter((order) => order.status === "submitted").length;
  const action = result.orders.length > 0
    ? result.orders.some((order) => order.side === "sell")
      ? "sell"
      : "buy"
    : "none";
  const triggerDistancePct = nextEntryPrice && nextEntryPrice > 0
    ? ((marketPrice - nextEntryPrice) / marketPrice) * 100
    : null;
  const blockers = [
    ...result.orders
      .filter((order) => order.status !== "submitted")
      .map((order) => order.message),
    ...result.logs
      .filter((log) => log.level === "warning" || log.level === "error")
      .map((log) => log.message),
  ].filter((message, index, messages) => message.trim().length > 0 && messages.indexOf(message) === index);
  const headline = result.triggers > 0
    ? `${result.triggers}개 조건 발동, 주문 후보 ${result.orders.length}건`
    : "현재 가격에서는 주문 조건이 발동되지 않았습니다.";

  return {
    headline,
    action,
    mode: strategyModeLabel(config),
    safety,
    nextAction: result.triggers > 0
      ? "주문 후보와 차단 사유를 확인한 뒤 모의 자동화에서 먼저 검증하세요."
      : "기준가·하락률·보유 상태를 조정하거나 발동가 테스트로 다음 매수선을 확인하세요.",
    nextEntryPrice,
    triggerDistancePct,
    submittedOrders,
    blockedOrders,
    rejectedOrders,
    errorOrders,
    blockers,
    scenario,
  };
};

const paperAutomationSafety = "paper: 로컬 모의 계좌 기록 · 외부 broker/거래소 제출 없음";

const sessionForAutomationMarket = (market: AutomationStrategyConfig["market"]): PaperTradingSession =>
  market === "US" ? "US" : "KR";

const marketForAutomationConfig = (config: AutomationStrategyConfig): PaperTradingMarket =>
  config.market === "CRYPTO" ? "CRYPTO" : config.market === "KR" ? "KOSPI" : "US";

const paperAutomationBroker = (): BrokerPort => ({
  async submitOrder(request) {
    return {
      brokerOrderId: `paper-auto-${request.clientOrderId ?? crypto.randomUUID()}`,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      message: "local paper automation: Toss broker was not called",
    };
  },
  async cancelOrder(request) {
    return {
      brokerOrderId: request.brokerOrderId,
      status: "canceled",
      submittedAt: new Date().toISOString(),
      message: "local paper automation: cancel was recorded as paper-only",
    };
  },
});

const runLocalPaperAutomationCycle = async (
  userId: string,
  reason: string,
  marketScope: "all" | "stock" | "crypto" = "all",
) => {
  const configs = (await listStrategyConfigs(userId)).filter((config) =>
    config.status === "enabled" && (
      marketScope === "all" ||
      (marketScope === "crypto" && config.market === "CRYPTO") ||
      (marketScope === "stock" && config.market !== "CRYPTO")
    ),
  );
  const base = {
    userId,
    status: "skipped",
    reason,
    liveTradingEnabled: false,
    accountSeq: null,
    strategies: configs.length,
    triggers: 0,
    orders: 0,
    submitted: 0,
    rejected: 0,
    blocked: 0,
    errors: 0,
    syncedOrders: 0,
    newFills: 0,
    evaluations: [] as AutomationDryRunEvaluation[],
    safety: paperAutomationSafety,
  };
  if (configs.length === 0) {
    return {
      ...base,
      reason: "no-enabled-strategies",
    };
  }

  const storageRoot = getPaperTradingStorageRootForUser(userId);
  const { state } = await readPaperTradingState(storageRoot);
  let nextState = state;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const evaluations: AutomationDryRunEvaluation[] = [];
  let triggers = 0;
  let orders = 0;
  let submitted = 0;
  let rejected = 0;
  let blocked = 0;
  let errors = 0;
  let newFills = 0;

  for (const config of configs) {
    const marketPrice = strategyTickPreviewPrice(config, "current", null);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      errors += 1;
      evaluations.push({
        strategyId: config.id,
        name: config.name,
        symbol: config.symbol.trim().toUpperCase(),
        mode: config.mode ?? "ladder",
        marketPrice: null,
        triggers: 0,
        orders: [],
        logs: [{
          level: "error",
          message: "paper 자동화에 사용할 유효한 현재가가 없습니다.",
        }],
        summary: {
          headline: "현재가가 없어 paper 자동화를 실행하지 못했습니다.",
          action: "none",
          mode: strategyModeLabel(config),
          safety: paperAutomationSafety,
          nextAction: "전략 기준가 또는 현재가를 다시 저장한 뒤 실행하세요.",
          submittedOrders: 0,
          blockedOrders: 0,
          rejectedOrders: 0,
          errorOrders: 1,
          blockers: ["paper 자동화에 사용할 유효한 현재가가 없습니다."],
          scenario: "current",
        },
      });
      continue;
    }

    const session = sessionForAutomationMarket(config.market);
    const market = marketForAutomationConfig(config);
    const account = nextState.accounts[session];
    const otherPositions = nextState.positions.filter((position) => position.session !== session);
    let sessionPositions = nextState.positions.filter((position) => position.session === session);
    const paperSymbol = config.symbol.trim().toUpperCase();

    const tick = await runAutomationWorkerTick({
      userId,
      config: { ...config, status: "enabled" },
      marketPrice,
      broker: paperAutomationBroker(),
      liveTradingEnabled: false,
      accountSeq: 0,
      today,
      resolveExitQuantity: async (symbol) =>
        sessionPositions.find((position) => position.symbol.trim().toUpperCase() === symbol.trim().toUpperCase())?.quantity ?? 0,
      resolveEntryPrice: async (symbol) =>
        sessionPositions.find((position) => position.symbol.trim().toUpperCase() === symbol.trim().toUpperCase())?.averagePrice ?? null,
      resolveOpenOrderIds: async () => [],
    });
    let cash = account.cash;
    let realizedPnl = account.realizedPnl;
    const runId = makePaperId("paper-run-auto");
    const paperOrders: PaperOrder[] = [];
    const paperExecutions: PaperExecution[] = [];
    let stopLossFilled = false;
    const paperLogs = tick.logs.map((log) => ({
      id: makePaperId("paper-log-auto"),
      runId,
      session,
      source: "codex-automation" as const,
      market,
      symbol: paperSymbol,
      level: log.level,
      message: log.stepId ? `${log.stepId}: ${log.message}` : log.message,
      strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
      createdAt: now,
    }));

    for (const order of tick.orders) {
      const orderStatus = order.status;
      if (orderStatus === "rejected") {
        rejected += 1;
      } else if (orderStatus === "blocked") {
        blocked += 1;
      } else if (orderStatus === "error") {
        errors += 1;
      }
      if (orderStatus !== "submitted") {
        continue;
      }
      const price = order.limitPrice ?? marketPrice;
      if (!Number.isFinite(price) || price <= 0 || order.quantity <= 0) {
        errors += 1;
        paperLogs.push({
          id: makePaperId("paper-log-auto"),
          runId,
          session,
          source: "codex-automation",
          market,
          symbol: config.symbol.trim().toUpperCase(),
          level: "error",
          message: `${order.stepId}: 유효하지 않은 paper 주문 가격/수량이라 기록하지 않았습니다.`,
          strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
          createdAt: now,
        });
        continue;
      }
      const symbol = paperSymbol;
      const existing = sessionPositions.find((position) => position.symbol.trim().toUpperCase() === symbol);
      const orderValue = order.quantity * price;
      let realizedOnExecution = 0;

      if (order.side === "buy") {
        if (cash < orderValue) {
          rejected += 1;
          paperLogs.push({
            id: makePaperId("paper-log-auto"),
            runId,
            session,
            source: "codex-automation",
            market,
            symbol,
            level: "warning",
            message: `${symbol} paper 현금 부족으로 ${order.quantity}주 매수를 기록하지 않았습니다.`,
            strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
            createdAt: now,
          });
          continue;
        }
        cash -= orderValue;
        if (existing) {
          const totalQuantity = existing.quantity + order.quantity;
          const averagePrice = ((existing.averagePrice * existing.quantity) + orderValue) / totalQuantity;
          sessionPositions = sessionPositions.map((position) =>
            position.id === existing.id
              ? {
                ...position,
                quantity: totalQuantity,
                averagePrice,
                lastPrice: price,
                updatedAt: now,
              }
              : position,
          );
        } else {
          sessionPositions.push({
            id: makePaperId("paper-position-auto"),
            session,
            market,
            symbol,
            name: config.name,
            quantity: order.quantity,
            averagePrice: price,
            lastPrice: price,
            currency: account.currency,
            openedAt: now,
            updatedAt: now,
            completedStages: [],
          });
        }
      } else {
        if (!existing || existing.quantity < order.quantity) {
          rejected += 1;
          paperLogs.push({
            id: makePaperId("paper-log-auto"),
            runId,
            session,
            source: "codex-automation",
            market,
            symbol,
            level: "warning",
            message: `${symbol} paper 보유 수량 부족으로 ${order.quantity}주 매도를 기록하지 않았습니다.`,
            strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
            createdAt: now,
          });
          continue;
        }
        realizedOnExecution = (price - existing.averagePrice) * order.quantity;
        realizedPnl += realizedOnExecution;
        cash += orderValue;
        sessionPositions = sessionPositions
          .map((position) =>
            position.id === existing.id
              ? {
                ...position,
                quantity: position.quantity - order.quantity,
                lastPrice: price,
                updatedAt: now,
                completedStages: [...new Set([...position.completedStages, `auto-${order.stepId}`])],
              }
              : position,
          )
          .filter((position) => position.quantity > 0);
      }

      const paperOrder: PaperOrder = {
        id: makePaperId("paper-order-auto"),
        runId,
        session,
        market,
        symbol,
        side: order.side,
        type: "limit",
        quantity: order.quantity,
        price,
        currency: account.currency,
        status: "filled",
        reason: `자동화 전략 ${config.name} · ${order.stepId}`,
        strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
        createdAt: now,
      };
      paperOrders.push(paperOrder);
      paperExecutions.push({
        id: makePaperId("paper-execution-auto"),
        runId,
        orderId: paperOrder.id,
        session,
        market,
        symbol,
        side: order.side,
        quantity: order.quantity,
        price,
        currency: account.currency,
        realizedPnl: realizedOnExecution,
        executedAt: now,
      });
      if (order.side === "sell" && order.stepId.endsWith("stop-loss")) {
        stopLossFilled = true;
      }
      submitted += 1;
      newFills += 1;
    }

    if (stopLossFilled) {
      await upsertStrategyConfig(userId, {
        ...toPersistableStrategyConfig(config),
        status: "disabled",
        lastSimulation: undefined,
      });
      paperLogs.push({
        id: makePaperId("paper-log-auto"),
        runId,
        session,
        source: "codex-automation",
        market,
        symbol: config.symbol.trim().toUpperCase(),
        level: "warning",
        message: `${config.name} 손절 청산 완료로 전략을 일시중지했습니다. 다시 시뮬레이션한 뒤 활성화하세요.`,
        strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
        createdAt: now,
      });
    }

    const paperRun = {
      id: runId,
      session,
      source: "codex-automation" as const,
      today,
      strategyVersion: `automation-${config.preset}-${config.mode ?? "ladder"}`,
      status: "executed" as const,
      candidateCount: tick.triggers,
      tradableCount: paperOrders.length,
      probeCount: 0,
      ordersCount: paperOrders.length,
      executionsCount: paperExecutions.length,
      startedAt: now,
      finishedAt: now,
      summary: `${config.name} paper 자동화: 발동 ${tick.triggers}개, 체결 ${paperExecutions.length}건`,
    };
    nextState = {
      ...nextState,
      accounts: {
        ...nextState.accounts,
        [session]: {
          ...account,
          cash,
          realizedPnl,
          strategyVersion: paperRun.strategyVersion,
          updatedAt: now,
        },
      },
      positions: [...otherPositions, ...sessionPositions],
      runs: [paperRun, ...nextState.runs].slice(0, 120),
      orders: [...paperOrders, ...nextState.orders].slice(0, 500),
      executions: [...paperExecutions, ...nextState.executions].slice(0, 500),
      logs: [...paperLogs, ...nextState.logs].slice(0, 800),
      updatedAt: now,
    };

    triggers += tick.triggers;
    orders += tick.orders.length;
    evaluations.push({
      strategyId: config.id,
      name: config.name,
      symbol: config.symbol.trim().toUpperCase(),
      mode: config.mode ?? "ladder",
      marketPrice,
      triggers: tick.triggers,
      orders: tick.orders,
      logs: tick.logs,
      strategyTransition: tick.strategyTransition,
      summary: strategyTickPreviewSummary(config, "current", marketPrice, tick, paperAutomationSafety),
    });
  }

  await writePaperTradingState(nextState, storageRoot);
  return {
    ...base,
    status: "ran",
    triggers,
    orders,
    submitted,
    rejected,
    blocked,
    errors,
    newFills,
    evaluations,
  };
};

type CryptoLiveTradingGate = {
  exchange: CryptoExchange;
  masterEnabled: boolean;
  cryptoMasterEnabled: boolean;
  credentialVerified: boolean;
  effective: boolean;
  status: number;
  reason: string | null;
};

const getCryptoLiveTradingGate = async (
  userId: string,
  exchange: CryptoExchange,
): Promise<CryptoLiveTradingGate> => {
  const masterEnabled = process.env.ENABLE_LIVE_TRADING === "true";
  const cryptoMasterEnabled = process.env.ENABLE_CRYPTO_LIVE_TRADING === "true";
  const credential = await getBrokerCredentialView(userId, exchange).catch(() => undefined);
  const credentialVerified = credential?.status === "verified";
  const closed = (reason: string, status = 423): CryptoLiveTradingGate => ({
    exchange,
    masterEnabled,
    cryptoMasterEnabled,
    credentialVerified,
    effective: false,
    status,
    reason,
  });
  if (!CRYPTO_LIVE_AUTOMATION_SUPPORTED) {
    return closed("1.0.0에서는 코인 API 조회·사전검증·모의 자동화만 지원합니다. 체결 동기화가 포함된 후 실거래를 엽니다.", 501);
  }
  if (!cryptoMasterEnabled) {
    return closed("코인 실거래 게이트가 꺼져 있습니다.");
  }
  if (process.env.STOCK_ANALYSIS_RUNTIME !== "macos-local" || !process.env.STOCK_ANALYSIS_STORAGE_ROOT?.trim()) {
    return closed("코인 실거래는 macOS 로컬 sidecar 저장소에서만 허용됩니다.", 503);
  }
  if (credential === undefined) {
    return closed(`${exchange} 자격증명 저장소를 확인할 수 없습니다.`, 503);
  }
  if (!credentialVerified) {
    return closed(`검증 완료된 ${exchange} API 키가 필요합니다.`, 412);
  }
  const decrypted = await loadDecryptedCredentials(userId, exchange).catch(() => null);
  if (!decrypted) {
    return closed(`${exchange} API 키를 복호화하지 못했습니다.`, 503);
  }
  return {
    exchange,
    masterEnabled,
    cryptoMasterEnabled,
    credentialVerified,
    effective: true,
    status: 200,
    reason: null,
  };
};

const runCryptoLiveAutomationCycle = async (userId: string) => {
  const configs = (await listStrategyConfigs(userId)).filter(
    (config) => config.status === "enabled" && config.market === "CRYPTO",
  );
  const base = {
    userId,
    status: "skipped",
    reason: "no-enabled-crypto-strategies",
    liveTradingEnabled: true,
    accountSeq: null,
    strategies: configs.length,
    triggers: 0,
    orders: 0,
    submitted: 0,
    rejected: 0,
    blocked: 0,
    errors: 0,
    syncedOrders: 0,
    newFills: 0,
    evaluations: [] as Array<Record<string, unknown>>,
    safety: "live: 거래소 주문 제출 가능 · 별도 코인 게이트, 시뮬레이션, 잔고, 긴급 중지 적용",
  };
  if (configs.length === 0) {
    return base;
  }

  let triggers = 0;
  let orders = 0;
  let submitted = 0;
  let rejected = 0;
  let blocked = 0;
  let errors = 0;
  const evaluations: Array<Record<string, unknown>> = [];

  for (const config of configs) {
    const exchange: CryptoExchange = config.executionVenue === "bithumb" ? "bithumb" : "upbit";
    const market = config.symbol.trim().toUpperCase();
    const gate = await getCryptoLiveTradingGate(userId, exchange);
    const currentHash = getStrategyConfigHash(config);
    const simulationPassed = !!config.lastSimulation &&
      config.lastSimulation.configHash === currentHash &&
      config.lastSimulation.passed;
    if (!simulationPassed || !gate.effective || !/^KRW-[A-Z0-9]+$/.test(market)) {
      const reasons = [
        ...(!simulationPassed ? ["현재 설정으로 통과한 전략 시뮬레이션이 없습니다."] : []),
        ...(!gate.effective ? [gate.reason ?? "코인 실거래 게이트가 닫혀 있습니다."] : []),
        ...(!/^KRW-[A-Z0-9]+$/.test(market) ? [`지원하지 않는 코인 마켓입니다: ${market}`] : []),
      ];
      blocked += 1;
      evaluations.push({
        strategyId: config.id,
        name: config.name,
        symbol: market,
        exchange,
        status: "blocked",
        blockers: reasons,
        gate,
      });
      continue;
    }
    const encrypted = await loadDecryptedCredentials(userId, exchange);
    if (!encrypted) {
      blocked += 1;
      evaluations.push({ strategyId: config.id, name: config.name, symbol: market, exchange, status: "blocked", blockers: [`${exchange} API 키 복호화 실패`] });
      continue;
    }
    const marketPrice = strategyTickPreviewPrice(config, "current", null);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      errors += 1;
      evaluations.push({ strategyId: config.id, name: config.name, symbol: market, exchange, status: "error", blockers: ["유효한 현재가가 없습니다."] });
      continue;
    }
    const credentials = { accessKey: encrypted.clientId, secretKey: encrypted.clientSecret };
    const broker = createCryptoBroker({ exchange, credentials, liveTradingEnabled: true });
    const precheck = async ({ side, symbol, quantity, price }: { side: "buy" | "sell"; symbol: string; quantity: number; price: number }) => {
      const [accounts, chance] = await Promise.all([
        getCryptoAccounts(exchange, credentials),
        getCryptoOrderChance(exchange, credentials, symbol),
      ]);
      if (Object.keys(chance).length === 0) {
        return { ok: false, reason: `${exchange} 주문 가능 정보가 비어 있습니다.` };
      }
      const [quoteCurrency, baseCurrency] = symbol.split("-");
      const quoteBalance = Number(accounts.find((account) => account.currency === quoteCurrency)?.balance ?? 0);
      const baseBalance = Number(accounts.find((account) => account.currency === baseCurrency)?.balance ?? 0);
      if (side === "buy") {
        const required = quantity * price;
        return required <= quoteBalance
          ? { ok: true, available: quoteBalance }
          : { ok: false, available: quoteBalance, reason: `${quoteCurrency} 주문 가능 잔고가 부족합니다.` };
      }
      return quantity <= baseBalance
        ? { ok: true, available: baseBalance }
        : { ok: false, available: baseBalance, reason: `${baseCurrency} 주문 가능 수량이 부족합니다.` };
    };
    try {
      const tick = await runAutomationWorkerTick({
        userId,
        config,
        marketPrice,
        broker,
        liveTradingEnabled: true,
        accountSeq: 0,
        today: new Date().toISOString().slice(0, 10),
        precheck,
        resolveExitQuantity: async (symbol) => {
          const accounts = await getCryptoAccounts(exchange, credentials);
          const baseCurrency = symbol.split("-")[1];
          return Number(accounts.find((account) => account.currency === baseCurrency)?.balance ?? 0);
        },
        resolveEntryPrice: async (symbol) => {
          const accounts = await getCryptoAccounts(exchange, credentials);
          const baseCurrency = symbol.split("-")[1];
          const value = Number(accounts.find((account) => account.currency === baseCurrency)?.avg_buy_price ?? 0);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
      });
      const submittedCount = tick.orders.filter((order) => order.status === "submitted").length;
      const rejectedCount = tick.orders.filter((order) => order.status === "rejected").length;
      const blockedCount = tick.orders.filter((order) => order.status === "blocked").length;
      const errorCount = tick.orders.filter((order) => order.status === "error").length;
      await Promise.all(tick.orders.map((order) => appendTerminalDashboardOperatorAction({
        symbol: market,
        orderIntentId: `${config.id}:${order.stepId}`,
        title: order.status === "submitted" ? `${exchange} 코인 주문 제출` : `${exchange} 코인 주문 ${order.status}`,
        detail: `${order.side === "buy" ? "매수" : "매도"} ${order.quantity} @ ${order.limitPrice ?? "시장가"} · ${order.message}`,
      })));
      triggers += tick.triggers;
      orders += tick.orders.length;
      submitted += submittedCount;
      rejected += rejectedCount;
      blocked += blockedCount;
      errors += errorCount;
      evaluations.push({
        strategyId: config.id,
        name: config.name,
        symbol: market,
        exchange,
        status: errorCount ? "error" : submittedCount ? "submitted" : "evaluated",
        gate,
        result: tick,
      });
    } catch (error) {
      errors += 1;
      evaluations.push({
        strategyId: config.id,
        name: config.name,
        symbol: market,
        exchange,
        status: "error",
        blockers: [errorMessage(error)],
        gate,
      });
    }
  }

  return {
    ...base,
    status: errors > 0 ? "ran-with-errors" : "ran",
    reason: "crypto-live-automation",
    triggers,
    orders,
    submitted,
    rejected,
    blocked,
    errors,
    evaluations,
  };
};

const previewBroker = (): BrokerPort => ({
  async submitOrder(request) {
    throw new LiveTradingDisabledError(request);
  },
  async cancelOrder(request) {
    return {
      brokerOrderId: request.brokerOrderId,
      status: "canceled",
      submittedAt: new Date().toISOString(),
      message: "tick preview: cancel request was not sent to broker",
    };
  },
});

const automationPayloadHash = (request: BrokerOrderRequest) => createHash("sha256")
  .update(JSON.stringify({
    accountSeq: request.accountSeq,
    symbol: request.symbol.trim().toUpperCase(),
    side: request.side,
    type: request.type,
    quantity: request.quantity,
    limitPrice: request.limitPrice,
    clientOrderId: request.clientOrderId,
  }))
  .digest("hex");

const createLocalLiveAutomationBroker = ({
  userId,
  client,
  accountSeq,
}: {
  userId: string;
  client: ReturnType<typeof createTossClient>;
  accountSeq: number;
}): BrokerPort => {
  const tossBroker = createTossBroker({ client, liveTradingEnabled: true });
  return {
    async submitOrder(request) {
      if (request.type !== "limit" || request.limitPrice === null || request.limitPrice <= 0) {
        throw new Error("실거래 자동화는 Toss KR/US 지정가 주문만 지원합니다. 시장가·stop 주문은 차단됩니다.");
      }
      if (!request.clientOrderId) {
        throw new Error("자동화 실거래에는 영속 clientOrderId가 필요합니다.");
      }
      const gate = await getLiveTradingGate(userId, "automation", accountSeq);
      if (!gate.effective) {
        throw new LiveTradingDisabledError(request);
      }
      const currency = inferCurrency(request.symbol);
      const conversion = await resolveKrwConversion({
        client,
        currency,
        amount: request.quantity * request.limitPrice,
      });
      if (conversion.krwEquivalent === null || conversion.reason) {
        throw new Error(conversion.reason ?? "자동화 USD 주문의 KRW 환산 검증에 실패했습니다.");
      }
      const attempt = await prepareLocalLiveOrderAttempt({
        userId,
        accountSeq,
        source: "automation",
        previewId: null,
        clientOrderId: request.clientOrderId,
        payloadHash: automationPayloadHash(request),
        symbol: request.symbol.trim().toUpperCase(),
        side: request.side,
        quantity: request.quantity,
        limitPrice: request.limitPrice,
        currency,
        krwEquivalent: conversion.krwEquivalent,
        exchangeRate: conversion.exchangeRate,
      });
      try {
        const submitted = await tossBroker.submitOrder(request);
        await markLocalLiveOrderSubmitted(attempt.id, submitted.brokerOrderId);
        await recordSubmittedOrder({
          userId,
          brokerOrderId: submitted.brokerOrderId,
          clientOrderId: request.clientOrderId,
          accountSeq,
          strategyId: "automation-live",
          stepId: attempt.id,
          symbol: request.symbol.trim().toUpperCase(),
          side: request.side,
          quantity: request.quantity,
          limitPrice: request.limitPrice,
          submittedAt: submitted.submittedAt,
        });
        return submitted;
      } catch (error) {
        const message = error instanceof TossApiError
          ? `${error.code}: ${error.message}`
          : error instanceof Error ? error.message : String(error);
        if (isUnknownSubmissionError(error)) {
          await markLocalLiveOrderUnknown(attempt.id, message);
        } else {
          await markLocalLiveOrderRejected(attempt.id, message);
        }
        throw error;
      }
    },
    // 자동 청산 경로가 시장가로 바뀌는 것을 막기 위해 자동 취소도 별도 운영 확인 전까지 닫는다.
    async cancelOrder() {
      throw new Error("자동화 실거래의 주문 취소·시장가 청산은 1.1.0 범위 밖입니다.");
    },
  };
};

const previewLocalStrategyTick = async (request: Request, id: string) => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const config = await findStrategyConfig(userId, id);
  if (!config) {
    return jsonResponse({ error: "전략을 찾을 수 없습니다." }, { status: 404 });
  }
  const payload = await readJsonBody(request);
  const scenario = tickPreviewScenario(payload.scenario);
  const marketPrice = strategyTickPreviewPrice(config, scenario, numericPayload(payload.marketPrice));
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    return jsonResponse({ error: "전략 tick 점검에 사용할 유효한 가격이 없습니다." }, { status: 400 });
  }

  const previewConfig: AutomationStrategyConfig = {
    ...config,
    status: "enabled",
  };
  const result = await runAutomationWorkerTick({
    userId,
    config: previewConfig,
    marketPrice,
    broker: previewBroker(),
    liveTradingEnabled: false,
    accountSeq: 0,
    today: new Date().toISOString().slice(0, 10),
  });

  return jsonResponse({
    generatedAt: new Date().toISOString(),
    dryRun: true,
    scenario,
    marketPrice,
    originalStatus: config.status,
    summary: strategyTickPreviewSummary(config, scenario, marketPrice, result),
    result,
    config: await strategyResponse(config),
  });
};

const runAutomation = async (request: Request) => {
  const payload = await readJsonBody(request);
  if (payload.dryRun === true) {
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      dryRun: true,
      result: await automationDryRunSummary(localUserId()),
    });
  }
  const killSwitch = await getAutomationKillSwitchState();
  if (killSwitch.engaged) {
    return killSwitchBlockResponse(killSwitch, "automation-cycle");
  }
  const workerControl = await getAutomationWorkerControlState();
  if (workerControl.paused) {
    return workerPausedResponse(workerControl);
  }
  await cleanupInternalSelfTestStrategies(localUserId());
  const userId = localUserId();
  const [credential, accountPreference, liveGate] = await Promise.all([
    getBrokerCredentialView(userId, "toss"),
    getBrokerAccountPreference(userId, "toss"),
    getLiveTradingGate(userId, "automation"),
  ]);
  const liveReady = credential?.status === "verified" && !!accountPreference && liveGate.effective;
  const enabledConfigs = (await listStrategyConfigs(userId)).filter((config) => config.status === "enabled");
  const stockEnabled = enabledConfigs.some((config) => config.market !== "CRYPTO");
  const cryptoEnabled = enabledConfigs.some((config) => config.market === "CRYPTO");
  const credentials = liveReady ? await loadDecryptedCredentials(userId, "toss") : null;
  const stockResult = liveReady && credentials && accountPreference
    ? await runUserAutomationCycle(userId, {
      liveTradingEnabledOverride: true,
      broker: createLocalLiveAutomationBroker({
        userId,
        client: createTossClient(credentials),
        accountSeq: accountPreference.accountSeq,
      }),
    })
    : await runLocalPaperAutomationCycle(
      userId,
      credential?.status !== "verified" || !credentials
        ? "paper-automation-no-credentials"
        : !accountPreference
          ? "paper-automation-account-selection-required"
          : "paper-automation-live-gate-closed",
      cryptoEnabled ? "stock" : "all",
    );
  const cryptoResult = cryptoEnabled
    ? CRYPTO_LIVE_AUTOMATION_SUPPORTED && process.env.ENABLE_CRYPTO_LIVE_TRADING === "true"
      ? await runCryptoLiveAutomationCycle(userId)
      : await runLocalPaperAutomationCycle(userId, "paper-automation-crypto-live-not-supported", "crypto")
    : null;
  const result = cryptoResult
    ? {
      ...stockResult,
      status: stockResult.status === "ran" || cryptoResult.status === "ran" ? "ran" : cryptoResult.status,
      reason: stockEnabled ? stockResult.reason : cryptoResult.reason,
      strategies: (stockResult.strategies ?? 0) + cryptoResult.strategies,
      triggers: ("triggers" in stockResult ? stockResult.triggers : 0) + cryptoResult.triggers,
      orders: ("orders" in stockResult ? stockResult.orders : 0) + cryptoResult.orders,
      submitted: (stockResult.submitted ?? 0) + cryptoResult.submitted,
      rejected: (stockResult.rejected ?? 0) + cryptoResult.rejected,
      blocked: (stockResult.blocked ?? 0) + cryptoResult.blocked,
      errors: ("errors" in stockResult ? stockResult.errors : 0) + cryptoResult.errors,
      newFills: (stockResult.newFills ?? 0) + (cryptoResult.newFills ?? 0),
      evaluations: [
        ...("evaluations" in stockResult ? stockResult.evaluations : []),
        ...cryptoResult.evaluations,
      ],
      cryptoAutomation: cryptoResult,
    }
    : stockResult;
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    result,
  });
};

const automationSchedulerCycle = async () => {
  const response = await runAutomation(new Request("http://127.0.0.1/api/automation/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }));
  const payload = await response.json() as Record<string, unknown>;
  const error = typeof payload.error === "string" ? payload.error : null;
  const result = payload.result && typeof payload.result === "object"
    ? payload.result as Record<string, unknown>
    : null;
  const resultStatus = typeof result?.status === "string" ? result.status : null;
  return {
    status: response.ok ? "success" as const : "blocked" as const,
    message: error ?? (resultStatus ? `자동화 cycle 완료 · ${resultStatus}` : `자동화 cycle HTTP ${response.status}`),
  };
};

const localAutomationSchedulerState = async () => jsonResponse({
  generatedAt: new Date().toISOString(),
  scheduler: localAutomationScheduler
    ? await localAutomationScheduler.getState()
    : await getLocalAutomationSchedulerState(),
});

const updateLocalAutomationScheduler = async (request: Request) => {
  const payload = await readJsonBody(request);
  if (typeof payload.enabled !== "boolean") {
    return jsonResponse({ error: "enabled boolean 값이 필요합니다." }, { status: 400 });
  }
  const intervalSeconds = Number(payload.intervalSeconds);
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < LOCAL_AUTOMATION_MIN_INTERVAL_SECONDS ||
    intervalSeconds > LOCAL_AUTOMATION_MAX_INTERVAL_SECONDS
  ) {
    return jsonResponse({
      error: `intervalSeconds는 ${LOCAL_AUTOMATION_MIN_INTERVAL_SECONDS}~${LOCAL_AUTOMATION_MAX_INTERVAL_SECONDS}초 정수여야 합니다.`,
    }, { status: 400 });
  }
  const scheduler = localAutomationScheduler
    ? await localAutomationScheduler.configure(payload.enabled, intervalSeconds)
    : await configureLocalAutomationScheduler({
      enabled: payload.enabled,
      intervalSeconds,
      updatedBy: "local-engine-api",
    });
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    scheduler,
  });
};

const localOrderSyncSnapshot = async () => {
  const userId = localUserId();
  const [orders, fills] = await Promise.all([
    listTrackedOrders(userId),
    listFills(userId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    userId,
    orders: orders.slice(0, 100),
    fills: fills.slice(0, 100),
    summary: {
      orders: orders.length,
      openOrders: orders.filter((order) => !order.terminal).length,
      terminalOrders: orders.filter((order) => order.terminal).length,
      fills: fills.length,
    },
  };
};

const localOrderSync = async (request: Request) => {
  const userId = localUserId();
  const payload = await readJsonBody(request);
  const startupReconciliation = payload.startup === true;
  const credential = await loadDecryptedCredentials(userId, "toss");
  const accountPreference = await getBrokerAccountPreference(userId, "toss");
  const payloadAccountSeq = Number(payload.accountSeq);
  const accountSeq = Number.isFinite(payloadAccountSeq) && payloadAccountSeq > 0
    ? Math.floor(payloadAccountSeq)
    : accountPreference?.accountSeq;

  if (!credential) {
    return jsonResponse({
      ...(await localOrderSyncSnapshot()),
      status: "skipped",
      reason: "no-credentials",
      accountSeq: accountSeq ?? null,
      synced: 0,
      updates: 0,
      newFills: 0,
      logs: [],
    });
  }

  if (!accountSeq) {
    return jsonResponse({
      ...(await localOrderSyncSnapshot()),
      status: "skipped",
      reason: "account-selection-required",
      accountSeq: null,
      synced: 0,
      updates: 0,
      newFills: 0,
      logs: [],
    });
  }

  try {
    const client = createTossClient(credential);
    const trackedOrders = await listOpenTrackedOrders(userId, accountSeq);
    const result = await syncOrderFills({
      userId,
      accountSeq,
      trackedOrders,
      fetcher: {
        getOpenOrders: (seq, symbol) => client.getOpenOrders(seq, symbol),
        getOrder: (seq, orderId) => client.getOrder(seq, orderId),
      },
    });
    await applySyncUpdates({ orderUpdates: result.orderUpdates, newFills: result.newFills });
    const liveTrading = startupReconciliation
      ? await recordLocalLiveReconciliation({
        accountSeq,
        syncedBrokerOrderIds: trackedOrders.map((order) => order.brokerOrderId),
      })
      : await getLocalLiveTradingSnapshot();
    return jsonResponse({
      ...(await localOrderSyncSnapshot()),
      status: "ran",
      accountSeq,
      synced: trackedOrders.length,
      updates: result.orderUpdates.length,
      newFills: result.newFills.length,
      logs: result.logs,
      liveTrading,
      startupReconciliation,
    });
  } catch (error) {
    return jsonResponse({
      ...(await localOrderSyncSnapshot()),
      status: "error",
      accountSeq,
      synced: 0,
      updates: 0,
      newFills: 0,
      logs: [{
        level: "error",
        brokerOrderId: "*",
        message: error instanceof TossApiError
          ? `Toss 조회 실패 [${error.code}]: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error),
      }],
    }, { status: 502 });
  }
};

type LocalOrderPrecheckPayload = {
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  currency?: unknown;
  accountSeq?: unknown;
};

const positiveNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const accountSeqFromValue = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
};

const amountForCurrency = (
  amount: { krw?: string | null; usd?: string | null } | undefined,
  currency: TossCurrency,
): number | null => {
  const value = currency === "KRW" ? amount?.krw : amount?.usd;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

type KrwConversion = {
  krwEquivalent: number | null;
  exchangeRate: number | null;
  reason: string | null;
  validUntil: string | null;
};

const resolveKrwConversion = async ({
  client,
  currency,
  amount,
}: {
  client: ReturnType<typeof createTossClient>;
  currency: TossCurrency;
  amount: number;
}): Promise<KrwConversion> => {
  if (currency === "KRW") {
    return { krwEquivalent: amount, exchangeRate: 1, reason: null, validUntil: null };
  }
  try {
    const quote = await client.getExchangeRate("USD", "KRW");
    const rate = Number(quote.rate || quote.midRate);
    const validFrom = Date.parse(quote.validFrom);
    const validUntil = Date.parse(quote.validUntil);
    if (
      quote.baseCurrency !== "USD" ||
      quote.quoteCurrency !== "KRW" ||
      !Number.isFinite(rate) || rate <= 0 ||
      !Number.isFinite(validFrom) ||
      !Number.isFinite(validUntil) ||
      Date.now() < validFrom ||
      Date.now() > validUntil
    ) {
      return {
        krwEquivalent: null,
        exchangeRate: null,
        reason: "Toss USD/KRW 환율 응답이 유효하지 않거나 만료되었습니다.",
        validUntil: quote.validUntil || null,
      };
    }
    return {
      krwEquivalent: amount * rate,
      exchangeRate: rate,
      reason: null,
      validUntil: quote.validUntil,
    };
  } catch (error) {
    return {
      krwEquivalent: null,
      exchangeRate: null,
      reason: error instanceof TossApiError
        ? `USD 주문은 Toss 환율 조회가 필요합니다. [${error.code}]`
        : "USD 주문은 유효한 Toss 환율 응답이 필요합니다.",
      validUntil: null,
    };
  }
};

const resolveLocalBrokerageAccountSeq = async ({
  userId,
  client,
  explicitAccountSeq,
}: {
  userId: string;
  client: ReturnType<typeof createTossClient>;
  explicitAccountSeq: number | null;
}) => {
  if (explicitAccountSeq) {
    return explicitAccountSeq;
  }
  const preference = await getBrokerAccountPreference(userId, "toss");
  if (preference) {
    return preference.accountSeq;
  }
  const accounts = await client.listAccounts();
  const brokerage = accounts.find((account) => account.accountType === "BROKERAGE") ?? accounts[0];
  return brokerage?.accountSeq ?? null;
};

const localHoldings = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const url = new URL(request.url);
  const userId = localUserId();
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (!symbol) {
    return jsonResponse({ error: "symbol이 필요합니다." }, { status: 400 });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return jsonResponse({
      linked: false,
      held: false,
      symbol,
      message: "등록된 Toss credential이 없어 실계좌 보유 조회를 건너뛰었습니다.",
    });
  }

  try {
    const client = createTossClient(credentials);
    const accountSeq = await resolveLocalBrokerageAccountSeq({
      userId,
      client,
      explicitAccountSeq: accountSeqFromValue(url.searchParams.get("accountSeq")),
    });
    if (!accountSeq) {
      return jsonResponse({
        linked: true,
        held: false,
        symbol,
        accountSeq: null,
        message: "사용 가능한 Toss 계좌가 없습니다.",
      }, { status: 412 });
    }

    const holdings = await client.getHoldings(accountSeq, symbol);
    const item = holdings.items.find((holding) => holding.symbol.toUpperCase() === symbol);
    if (!item) {
      return jsonResponse({
        linked: true,
        held: false,
        symbol,
        accountSeq,
        message: "해당 종목 보유 수량이 없습니다.",
      });
    }

    return jsonResponse({
      linked: true,
      held: true,
      symbol,
      accountSeq,
      name: item.name,
      currency: item.currency,
      quantity: Number(item.quantity),
      averagePurchasePrice: Number(item.averagePurchasePrice),
      lastPrice: Number(item.lastPrice),
      marketValue: amountForCurrency(item.marketValue, item.currency),
      profitLoss: amountForCurrency(item.profitLoss, item.currency),
      dailyProfitLoss: amountForCurrency(item.dailyProfitLoss, item.currency),
      message: "Toss 실계좌 보유 조회를 완료했습니다. 주문 제출은 수행하지 않았습니다.",
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return jsonResponse(formatTossApiError(error, "보유 조회 실패"), { status: 502 });
    }
    return errorResponse(error, 502);
  }
};

const localOrderPrecheck = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const payload = await readJsonBody(request) as LocalOrderPrecheckPayload;
  const symbol = typeof payload.symbol === "string" ? payload.symbol.trim().toUpperCase() : "";
  const side = payload.side === "sell" ? "sell" : "buy";
  const quantity = positiveNumber(payload.quantity);
  const price = positiveNumber(payload.price);
  if (!symbol || quantity === null || price === null) {
    return jsonResponse({ error: "symbol, quantity, price가 필요합니다." }, { status: 400 });
  }
  const currency: TossCurrency =
    payload.currency === "KRW" || payload.currency === "USD" ? payload.currency : inferCurrency(symbol);

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return jsonResponse({ error: "등록된 Toss credential이 없습니다." }, { status: 412 });
  }

  try {
    const client = createTossClient(credentials);
    const accountSeq = await resolveLocalBrokerageAccountSeq({
      userId,
      client,
      explicitAccountSeq: accountSeqFromValue(payload.accountSeq),
    });
    if (!accountSeq) {
      return jsonResponse({ error: "사용 가능한 Toss 계좌가 없습니다." }, { status: 412 });
    }

    const liveTradingGate = await getLiveTradingGate(userId, "manual", accountSeq);
    const intentResult = createOrderIntent({
      userId,
      symbol,
      side,
      type: "limit",
      quantity,
      limitPrice: price,
      currency,
      rationale: ["macOS 앱 주문 전 사전검증"],
      riskPolicy: {
        allowLiveTrading: true,
        maxOrderValue: null,
        maxPositionValue: null,
      },
    });
    const precheck = createOrderPrecheck({
      accountSeq,
      getBuyingPower: (seq, cur) => client.getBuyingPower(seq, cur),
      getSellableQuantity: (seq, sym) => client.getSellableQuantity(seq, sym),
    });
    const result = await precheck({ side, symbol, quantity, price, currency });
    const conversion = await resolveKrwConversion({
      client,
      currency,
      amount: quantity * price,
    });
    const buyLimitBlockers = side === "buy"
      ? [
        ...(conversion.reason ? [conversion.reason] : []),
        ...(conversion.krwEquivalent !== null && conversion.krwEquivalent > LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW
          ? [`매수 1건은 ${LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW.toLocaleString("ko-KR")}원 이하만 허용됩니다.`]
          : []),
        ...(conversion.krwEquivalent !== null && conversion.krwEquivalent > liveTradingGate.remainingDailyBuyKrw
          ? ["KST 일일 매수 한도를 초과합니다. 취소·매도로 한도가 복구되지 않습니다."]
          : []),
      ]
      : [];
    const blockers = [
      ...intentResult.riskCheck.blockers,
      ...(result.ok ? [] : [result.reason ?? "주문 사전검증을 통과하지 못했습니다."]),
      ...buyLimitBlockers,
      ...(liveTradingGate.effective ? [] : [liveTradingGate.reason ?? "실거래 게이트가 닫혀 있습니다."]),
    ];
    const warnings = [
      ...intentResult.riskCheck.warnings,
      ...(liveTradingGate.masterEnabled ? [] : ["서버 실거래 킬스위치가 OFF입니다."]),
    ];
    const preview = await recordOrderPreview({
      userId,
      input: {
        accountSeq,
        symbol,
        side,
        orderType: "limit",
        quantity,
        price,
        currency,
      },
      available: result.available ?? null,
      ok: blockers.length === 0,
      blockers,
      warnings,
      liveTradingEffective: liveTradingGate.effective,
      liveTradingBlockedReason: liveTradingGate.reason,
    });

    return jsonResponse({
      ...result,
      symbol,
      side,
      quantity,
      price,
      currency,
      accountSeq,
      intent: intentResult.intent,
      riskCheck: intentResult.riskCheck,
      liveTradingGate: {
        effective: liveTradingGate.effective,
        masterEnabled: liveTradingGate.masterEnabled,
        userEnabled: liveTradingGate.userEnabled,
        reason: liveTradingGate.reason,
      },
      preview,
      blockers,
      warnings,
      submitReady: preview.ok,
      confirmationText: liveOrderConfirmationText({
        symbol,
        side,
        quantity,
        price,
        currency,
      }),
      krwEquivalent: conversion.krwEquivalent,
      exchangeRate: conversion.exchangeRate,
      exchangeRateValidUntil: conversion.validUntil,
      remainingDailyBuyKrw: liveTradingGate.remainingDailyBuyKrw,
      limits: {
        perBuyOrderKrw: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
        dailyBuyKrw: LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW,
      },
      message: preview.ok
        ? "주문 제출 전 사전검증을 통과했습니다. 실제 제출은 별도 게이트에서만 가능합니다."
        : "사전검증 결과 주문 제출 준비가 완료되지 않았습니다.",
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return jsonResponse(formatTossApiError(error, "사전검증 실패"), { status: 502 });
    }
    return errorResponse(error, 502);
  }
};

type LocalLiveOrderSubmitPayload = {
  previewId?: unknown;
  confirmation?: unknown;
};

const liveOrderConfirmationText = (preview: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  currency: TossCurrency;
}) => `${preview.symbol} ${preview.side === "buy" ? "매수" : "매도"} ${preview.quantity}주 ${preview.price} ${preview.currency}`;

const isUnknownSubmissionError = (error: unknown) =>
  !(error instanceof TossApiError) ||
  error.status >= 500 ||
  error.status === 429 ||
  (error.status === 409 && error.code === "request-in-progress");

const localLiveOrderSubmit = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const payload = await readJsonBody(request) as LocalLiveOrderSubmitPayload;
  const previewId = typeof payload.previewId === "string" ? payload.previewId : "";
  const confirmation = typeof payload.confirmation === "string" ? payload.confirmation.trim() : "";
  if (!previewId || !confirmation) {
    return jsonResponse({ error: "previewId와 최종 확인 문구가 필요합니다.", orderSubmissionAttempted: false }, { status: 400 });
  }

  const storedPreview = await getOrderPreview(userId, previewId);
  if (!storedPreview) {
    return jsonResponse({ error: "주문 미리보기를 먼저 실행하세요.", orderSubmissionAttempted: false }, { status: 428 });
  }
  if (storedPreview.orderType !== "limit") {
    return jsonResponse({ error: "실거래는 Toss KR/US 지정가 주문만 지원합니다.", orderSubmissionAttempted: false }, { status: 422 });
  }
  const expectedConfirmation = liveOrderConfirmationText(storedPreview);
  if (confirmation !== expectedConfirmation) {
    return jsonResponse({
      error: "주문 요약과 동일한 확인 문구를 입력해야 합니다.",
      expectedConfirmation,
      orderSubmissionAttempted: false,
    }, { status: 422 });
  }
  const verifiedPreview = await verifyOrderPreview({
    userId,
    previewId,
    input: {
      accountSeq: storedPreview.accountSeq,
      symbol: storedPreview.symbol,
      side: storedPreview.side,
      orderType: storedPreview.orderType,
      quantity: storedPreview.quantity,
      price: storedPreview.price,
      currency: storedPreview.currency,
    },
  });
  if (!verifiedPreview.ok) {
    return jsonResponse({
      error: verifiedPreview.reason,
      preview: verifiedPreview.preview ?? null,
      orderSubmissionAttempted: false,
    }, { status: verifiedPreview.status });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  const accountPreference = await getBrokerAccountPreference(userId, "toss");
  if (!credentials || !accountPreference) {
    return jsonResponse({ error: "검증된 Toss API 키와 선택 계좌가 필요합니다.", orderSubmissionAttempted: false }, { status: 412 });
  }
  if (accountPreference.accountSeq !== storedPreview.accountSeq) {
    return jsonResponse({
      error: "선택 계좌가 미리보기와 달라졌습니다. 새 계좌로 다시 사전검증하세요.",
      orderSubmissionAttempted: false,
    }, { status: 409 });
  }

  const liveTradingGate = await getLiveTradingGate(userId, "manual", storedPreview.accountSeq);
  if (!liveTradingGate.effective) {
    return jsonResponse({
      error: liveTradingGate.reason ?? "실거래 게이트가 닫혀 있습니다.",
      orderSubmissionAttempted: false,
      liveTradingGate,
    }, { status: liveTradingGate.status });
  }

  const client = createTossClient(credentials);
  try {
    // 미리보기 뒤 변한 매수가능금액/매도가능수량/환율을 제출 직전에 다시 검사한다.
    const precheck = createOrderPrecheck({
      accountSeq: storedPreview.accountSeq,
      getBuyingPower: (seq, currency) => client.getBuyingPower(seq, currency),
      getSellableQuantity: (seq, symbol) => client.getSellableQuantity(seq, symbol),
    });
    const accountCheck = await precheck({
      side: storedPreview.side,
      symbol: storedPreview.symbol,
      quantity: storedPreview.quantity,
      price: storedPreview.price,
      currency: storedPreview.currency,
    });
    if (!accountCheck.ok) {
      return jsonResponse({ error: accountCheck.reason ?? "주문 직전 사전검증에 실패했습니다.", orderSubmissionAttempted: false }, { status: 422 });
    }
    const conversion = await resolveKrwConversion({
      client,
      currency: storedPreview.currency,
      amount: storedPreview.estimatedOrderValue,
    });
    if (conversion.krwEquivalent === null || conversion.reason) {
      return jsonResponse({ error: conversion.reason ?? "KRW 환산 검증에 실패했습니다.", orderSubmissionAttempted: false }, { status: 422 });
    }
    const attempt = await prepareLocalLiveOrderAttempt({
      userId,
      accountSeq: storedPreview.accountSeq,
      source: "manual",
      previewId: storedPreview.id,
      clientOrderId: storedPreview.clientOrderId,
      payloadHash: storedPreview.payloadHash,
      symbol: storedPreview.symbol,
      side: storedPreview.side,
      quantity: storedPreview.quantity,
      limitPrice: storedPreview.price,
      currency: storedPreview.currency,
      krwEquivalent: conversion.krwEquivalent,
      exchangeRate: conversion.exchangeRate,
    });
    // 성공/실패/timeout 어느 경우에도 동일 preview로 다시 POST하지 못하게 잠근다.
    await markOrderPreviewSubmitted(userId, storedPreview.id, attempt.submissionStartedAt ?? new Date().toISOString());
    const broker = createTossBroker({ client, liveTradingEnabled: true });
    try {
      const submitted = await broker.submitOrder({
        orderIntentId: storedPreview.id,
        accountSeq: storedPreview.accountSeq,
        symbol: storedPreview.symbol,
        side: storedPreview.side,
        type: "limit",
        quantity: storedPreview.quantity,
        limitPrice: storedPreview.price,
        stopPrice: null,
        clientOrderId: storedPreview.clientOrderId,
        timeInForce: "DAY",
      });
      const updatedAttempt = await markLocalLiveOrderSubmitted(attempt.id, submitted.brokerOrderId);
      await recordSubmittedOrder({
        userId,
        brokerOrderId: submitted.brokerOrderId,
        clientOrderId: storedPreview.clientOrderId,
        accountSeq: storedPreview.accountSeq,
        strategyId: "manual-live",
        stepId: attempt.id,
        symbol: storedPreview.symbol,
        side: storedPreview.side,
        quantity: storedPreview.quantity,
        limitPrice: storedPreview.price,
        submittedAt: submitted.submittedAt,
      });
      return jsonResponse({
        status: "submitted",
        orderSubmissionAttempted: true,
        result: submitted,
        attempt: updatedAttempt,
        remainingDailyBuyKrw: Math.max(0, LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW - (await getLocalLiveTradingSnapshot()).policy.dailyBuyKrwSubmitted),
      }, { status: 201 });
    } catch (error) {
      const message = error instanceof TossApiError
        ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error);
      if (isUnknownSubmissionError(error)) {
        const updatedAttempt = await markLocalLiveOrderUnknown(attempt.id, message);
        return jsonResponse({
          status: "unknown",
          error: "주문 제출 결과가 불명확합니다. 자동 재시도를 금지하고 실거래를 잠급니다. Toss 주문 이력에서 clientOrderId를 확인하세요.",
          orderSubmissionAttempted: true,
          attempt: updatedAttempt,
        }, { status: 202 });
      }
      const updatedAttempt = await markLocalLiveOrderRejected(attempt.id, message);
      return jsonResponse({
        status: "rejected",
        error: message,
        orderSubmissionAttempted: true,
        attempt: updatedAttempt,
      }, { status: 422 });
    }
  } catch (error) {
    return errorResponse(error, 502);
  }
};

const localKillSwitchState = async () =>
  jsonResponse({
    generatedAt: new Date().toISOString(),
    killSwitch: await getAutomationKillSwitchState(),
  });

const updateLocalKillSwitch = async (request: Request) => {
  const payload = await readJsonBody(request);
  if (typeof payload.engaged !== "boolean") {
    return jsonResponse({ error: "engaged boolean 값이 필요합니다." }, { status: 400 });
  }
  const reason = typeof payload.reason === "string" ? payload.reason : null;
  const updatedBy = typeof payload.updatedBy === "string" && payload.updatedBy.trim()
    ? payload.updatedBy.trim()
    : "macos-app";
  const killSwitch = await setAutomationKillSwitchState({
    engaged: payload.engaged,
    reason,
    updatedBy,
  });
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    killSwitch,
  });
};

const localWorkerControlState = async () =>
  jsonResponse({
    generatedAt: new Date().toISOString(),
    workerControl: await getAutomationWorkerControlState(),
  });

const updateLocalWorkerControl = async (request: Request) => {
  const payload = await readJsonBody(request);
  if (typeof payload.paused !== "boolean") {
    return jsonResponse({ error: "paused boolean 값이 필요합니다." }, { status: 400 });
  }
  const reason = typeof payload.reason === "string" ? payload.reason : null;
  const updatedBy = typeof payload.updatedBy === "string" && payload.updatedBy.trim()
    ? payload.updatedBy.trim()
    : "macos-app";
  const workerControl = await setAutomationWorkerControlState({
    paused: payload.paused,
    reason,
    updatedBy,
  });
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    workerControl,
  });
};

const maskAccountNo = (accountNo: string) => accountNo.replace(/\d(?=\d{4})/g, "*");

const toAccountView = (account: Account) => ({
  accountNo: maskAccountNo(account.accountNo),
  accountSeq: account.accountSeq,
  accountType: account.accountType,
});

const reconcileAccountPreference = async (userId: string, accounts: Account[]) => {
  const existing = await getBrokerAccountPreference(userId, "toss");
  const brokerageAccounts = accounts.filter((account) => account.accountType === "BROKERAGE");
  const candidates = brokerageAccounts.length ? brokerageAccounts : accounts;
  if (existing && candidates.some((account) => account.accountSeq === existing.accountSeq)) {
    return existing;
  }
  if (existing) {
    await deleteBrokerAccountPreference(userId, "toss");
  }
  if (candidates.length === 1) {
    const [account] = candidates;
    return saveBrokerAccountPreference({
      userId,
      accountSeq: account.accountSeq,
      accountNo: maskAccountNo(account.accountNo),
      accountType: account.accountType,
    });
  }
  return null;
};

const brokerAccountPreferenceState = async () => {
  const userId = localUserId();
  const credential = await getBrokerCredentialView(userId, "toss");
  if (credential?.status !== "verified") {
    return jsonResponse({
      credential,
      accounts: [],
      accountPreference: await getBrokerAccountPreference(userId, "toss"),
      accountsError: credential ? "검증 완료된 Toss API 키가 필요합니다." : null,
    });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return jsonResponse({
      credential,
      accounts: [],
      accountPreference: null,
      accountsError: "저장된 Toss API 키를 복호화하지 못했습니다.",
    });
  }

  try {
    const accounts = await createTossClient(credentials).listAccounts();
    const accountPreference = await reconcileAccountPreference(userId, accounts);
    return jsonResponse({
      credential,
      accounts: accounts.map(toAccountView),
      accountPreference,
      accountsError: null,
    });
  } catch (error) {
    return jsonResponse({
      credential,
      accounts: [],
      accountPreference: await getBrokerAccountPreference(userId, "toss"),
      accountsError: error instanceof Error ? error.message : String(error),
    });
  }
};

const localTossReadiness = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const url = new URL(request.url);
  const userId = localUserId();
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() || "NVDA";
  const credentialView = await getBrokerCredentialView(userId, "toss");
  const accountPreference = await getBrokerAccountPreference(userId, "toss");
  const credentials = await loadDecryptedCredentials(userId, "toss");
  const env: Record<string, string | undefined> = {
    TOSS_READINESS_SYMBOL: symbol,
    TOSS_READINESS_CURRENCY: inferCurrency(symbol),
  };
  if (credentials) {
    env.TOSS_CLIENT_ID = credentials.clientId;
    env.TOSS_CLIENT_SECRET = credentials.clientSecret;
  }
  if (accountPreference) {
    env.TOSS_ACCOUNT_SEQ = String(accountPreference.accountSeq);
  }

  const report = await checkTossLiveReadiness(env);
  const automationAccountSelected = !!accountPreference;
  const automationReady = report.ok && automationAccountSelected;
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    ...report,
    ok: automationReady,
    status: automationReady
      ? report.status
      : report.status === "account-ready" ? "account-selection-required" : report.status,
    credential: credentialView,
    accountPreference,
    automationAccountSelected,
    automationReady,
    guidance: [
      ...report.guidance,
      ...(automationAccountSelected
        ? ["paper 자동화에 사용할 Toss 계좌가 선택되어 있습니다. 1.0.0 데스크톱은 실제 주문을 제출하지 않습니다."]
        : ["Toss 계좌 기반 paper 사전검증을 사용하려면 BROKERAGE 계좌를 선택하세요. 분석과 일반 paper 자동화는 계좌 없이도 사용할 수 있습니다."]),
    ],
  });
};

const localLiveTradingState = async () => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const [credential, readiness, gate, snapshot] = await Promise.all([
    getBrokerCredentialView(userId, "toss"),
    getAutomationReadinessSnapshot(userId, { includeOperator: true }),
    getLiveTradingGate(userId),
    getLocalLiveTradingSnapshot(),
  ]);
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    credential,
    liveTrading: {
      masterEnabled: gate.masterEnabled,
      userEnabled: gate.userEnabled,
      effective: gate.effective,
      status: gate.status,
      reason: gate.reason,
      featureEnabled: snapshot.policy.manualEnabled,
      localRuntime: process.env.STOCK_ANALYSIS_RUNTIME === "macos-local",
      storageRoot: process.env.STOCK_ANALYSIS_STORAGE_ROOT ?? null,
      policy: snapshot.policy,
      automationEligibility: snapshot.automationEligibility,
      attempts: snapshot.attempts.slice(0, 30),
      limits: {
        perBuyOrderKrw: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
        dailyBuyKrw: LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW,
      },
    },
    readiness,
    guidance: [
      "실거래는 이 Mac의 선택 계좌에만 바인딩되며, 수동·자동화 토글은 기본 OFF입니다.",
      "Upbit와 Bithumb 실주문은 계속 차단됩니다.",
      "IP address not allowed 오류가 나오면 Toss Open API 콘솔 허용 IP를 현재 공인 IP로 갱신하세요.",
    ],
  });
};

const approveLocalLiveTradingQa = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const payload = await readJsonBody(request);
  const confirmation = typeof payload.confirmation === "string" ? payload.confirmation : "";
  const userId = localUserId();
  const [credentials, accountPreference] = await Promise.all([
    loadDecryptedCredentials(userId, "toss"),
    getBrokerAccountPreference(userId, "toss"),
  ]);
  if (!credentials || !accountPreference) {
    return jsonResponse({ error: "QA 승인 전에 검증된 Toss API 키와 선택 계좌가 필요합니다." }, { status: 412 });
  }
  try {
    // QA 승인은 실제 API의 토큰/계좌/계좌 헤더 조회가 모두 성공할 때만 기록한다.
    const client = createTossClient(credentials);
    const accounts = await client.listAccounts();
    const selected = accounts.find((account) => account.accountSeq === accountPreference.accountSeq);
    if (!selected || selected.accountType !== "BROKERAGE") {
      return jsonResponse({ error: "선택한 Toss BROKERAGE 계좌를 다시 확인하세요." }, { status: 412 });
    }
    await Promise.all([
      client.getHoldings(selected.accountSeq, "005930"),
      client.getOpenOrders(selected.accountSeq, "AAPL"),
    ]);
    await approveLocalManualQa({
      userId,
      accountSeq: selected.accountSeq,
      confirmation,
    });
    return localLiveTradingState();
  } catch (error) {
    if (error instanceof TossApiError) {
      return jsonResponse(formatTossApiError(error, "실거래 QA 읽기 전용 점검 실패"), { status: 502 });
    }
    return errorResponse(error, 502);
  }
};

const updateLocalLiveTrading = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const payload = await readJsonBody(request);
  if (typeof payload.enabled !== "boolean") {
    return jsonResponse({ error: "enabled boolean 값이 필요합니다." }, { status: 400 });
  }
  const userId = localUserId();
  const accountPreference = await getBrokerAccountPreference(userId, "toss");
  if (!accountPreference) {
    return jsonResponse({ error: "실거래 토글에는 선택한 Toss BROKERAGE 계좌가 필요합니다." }, { status: 412 });
  }
  try {
    await setLocalManualLiveTrading({
      userId,
      accountSeq: accountPreference.accountSeq,
      enabled: payload.enabled,
      confirmation: typeof payload.confirmation === "string" ? payload.confirmation : undefined,
    });
    return localLiveTradingState();
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 423 });
  }
};

const updateLocalAutomationLiveTrading = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const payload = await readJsonBody(request);
  if (typeof payload.enabled !== "boolean") {
    return jsonResponse({ error: "enabled boolean 값이 필요합니다." }, { status: 400 });
  }
  const userId = localUserId();
  const accountPreference = await getBrokerAccountPreference(userId, "toss");
  if (!accountPreference) {
    return jsonResponse({ error: "자동화 실거래에는 선택한 Toss BROKERAGE 계좌가 필요합니다." }, { status: 412 });
  }
  try {
    await setLocalAutomationLiveTrading({
      userId,
      accountSeq: accountPreference.accountSeq,
      enabled: payload.enabled,
      confirmation: typeof payload.confirmation === "string" ? payload.confirmation : undefined,
    });
    return localLiveTradingState();
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 423 });
  }
};

const verifyLocalLiveTradingSafetyGates = async () => {
  await ensureLocalAutomationAccess();
  const [killSwitch, workerControl] = await Promise.all([
    getAutomationKillSwitchState(),
    getAutomationWorkerControlState(),
  ]);
  try {
    await recordLocalLiveSafetyProof({
      killSwitchEngaged: killSwitch.engaged,
      workerPaused: workerControl.paused,
    });
    return localLiveTradingState();
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 423 });
  }
};

const fetchPublicEgressIp = async () => {
  const checkedAt = new Date().toISOString();
  const overrideIp = process.env.STOCK_ANALYSIS_EGRESS_IP_OVERRIDE?.trim();
  if (overrideIp) {
    return {
      status: "checked",
      ip: overrideIp,
      message: "테스트 override IP입니다. 실제 운영 전 Toss 설정에서 공인 IP 확인을 다시 실행하세요.",
      checkedAt,
    };
  }
  if (process.env.STOCK_ANALYSIS_SKIP_EGRESS_CHECK === "1") {
    return {
      status: "skipped",
      ip: null,
      message: "테스트/오프라인 모드라 공인 IP 확인을 건너뛰었습니다.",
      checkedAt,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        status: "unavailable",
        ip: null,
        message: `공인 IP 확인 실패: HTTP ${response.status}`,
        checkedAt,
      };
    }
    const payload = (await response.json().catch(() => null)) as { ip?: unknown } | null;
    const ip = typeof payload?.ip === "string" && payload.ip.trim() ? payload.ip.trim() : null;
    return {
      status: ip ? "checked" : "unavailable",
      ip,
      message: ip
        ? "Toss Open API 콘솔의 허용 IP에 이 공인 IP를 등록해야 합니다."
        : "공인 IP 응답을 해석하지 못했습니다.",
      checkedAt,
    };
  } catch (error) {
    return {
      status: "unavailable",
      ip: null,
      message: error instanceof Error ? `공인 IP 확인 실패: ${error.message}` : "공인 IP 확인 실패",
      checkedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const skippedPublicEgressIp = () => ({
  status: "not-requested",
  ip: null,
  message: "공인 IP 확인은 사용자가 Toss 시트의 공인 IP 확인 버튼을 눌렀을 때만 실행됩니다.",
  checkedAt: new Date().toISOString(),
});

const brokerDiagnostics = async (request: Request) => {
  const url = new URL(request.url);
  const includeEgress = url.searchParams.get("includeEgress") === "1";
  const userId = localUserId();
  const localRuntime = process.env.STOCK_ANALYSIS_RUNTIME === "macos-local";
  const [credential, accountPreference, health, readiness, egress, killSwitch, workerControl, liveGate, automationLiveGate] = await Promise.all([
    getBrokerCredentialView(userId, "toss"),
    getBrokerAccountPreference(userId, "toss"),
    getAutomationHealthSnapshot(),
    getAutomationReadinessSnapshot(userId, { includeOperator: true }),
    includeEgress ? fetchPublicEgressIp() : skippedPublicEgressIp(),
    getAutomationKillSwitchState(),
    getAutomationWorkerControlState(),
    getLiveTradingGate(userId),
    getLiveTradingGate(userId, "automation"),
  ]);
  const liveTradingEffective = liveGate.effective;
  const automationQueueReady = automationLiveGate.effective;

  return jsonResponse({
    generatedAt: new Date().toISOString(),
    userId,
    credential,
    egress,
    liveGate: {
      enableLiveTrading: liveGate.masterEnabled,
      credentialEncryptionConfigured: health.env.credentialEncryptionConfigured,
      storageRoot: process.env.STOCK_ANALYSIS_STORAGE_ROOT ?? null,
      automationOverall: health.overall,
      readinessOverall: readiness.overall,
      automationBeta: readiness.user.automationBeta,
      brokerCredentials: readiness.user.brokerCredentials,
      accountPreferenceSelected: !!accountPreference,
      userLiveTrading: liveGate.userEnabled,
      liveTradingEffective,
      rawLiveTradingEffective: liveGate.effective,
      gateStatus: liveGate.status,
      gateReason: liveGate.reason,
      killSwitchEngaged: killSwitch.engaged,
      killSwitchReason: killSwitch.reason,
      workerPaused: workerControl.paused,
      workerPauseReason: workerControl.reason,
      automationQueueReady,
      automationGateStatus: automationLiveGate.status,
      automationGateReason: automationLiveGate.reason,
    },
    readinessItems: readiness.items,
    guidance: [
      "Swift 앱은 broker를 직접 호출하지 않습니다. 모든 주문은 local-engine의 OrderIntent/RiskCheck 경계를 통과해야 합니다.",
      "IP address not allowed 오류가 나오면 현재 공인 IP를 Toss Open API 허용 IP에 등록해야 합니다.",
      killSwitch.engaged
        ? "긴급 중지가 켜져 있어 모의 주문과 자동화 큐 실행이 차단됩니다."
        : "긴급 중지가 꺼져 있습니다.",
      workerControl.paused
        ? "워커 일시중지가 켜져 있어 자동화 큐 실행이 차단됩니다."
        : "워커가 감시 상태입니다.",
      localRuntime
        ? "Toss 실거래는 현재 Mac·선택 계좌의 QA와 수동/자동화 정책 토글을 모두 통과해야 합니다."
        : "실거래는 macOS 로컬 sidecar에서만 허용됩니다.",
    ],
  });
};

const runSelfTestCheck = async ({
  id,
  label,
  blocking,
  run,
}: {
  id: string;
  label: string;
  blocking: boolean;
  run: () => Promise<Omit<LocalSelfTestCheck, "id" | "label" | "blocking" | "durationMs">>;
}): Promise<LocalSelfTestCheck> => {
  const startedAt = performance.now();
  try {
    const result = await run();
    return {
      id,
      label,
      blocking,
      durationMs: Math.round(performance.now() - startedAt),
      ...result,
    };
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      summary: errorMessage(error),
      action: "sidecar 로그를 열어 오류 원인을 확인하세요.",
      blocking,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
};

const marketSnapshotChecksDisabled = () =>
  process.env.STOCK_ANALYSIS_DISABLE_MARKET_SNAPSHOT === "1";

const strategyCrudDryRunDisabled = () => getSupabaseAdminConfig() !== null;

const isInternalSelfTestStrategy = (config: AutomationStrategyConfig) =>
  config.id.startsWith("self-test-") || config.name.startsWith("Self-test ");

const cleanupInternalSelfTestStrategies = async (userId: string) => {
  const configs = await listStrategyConfigs(userId);
  const staleConfigs = configs.filter(isInternalSelfTestStrategy);
  await Promise.all(staleConfigs.map((config) => deleteStrategyConfig(userId, config.id)));
  return staleConfigs.length;
};

const buildStrategyDryRunConfig = (userId: string): AutomationStrategyConfig => {
  const now = new Date().toISOString();
  return {
    id: `self-test-magic-split-${crypto.randomUUID()}`,
    userId,
    name: "Self-test 순환분할 3차",
    symbol: "NVDA",
    market: "US",
    preset: "magic-split",
    status: "draft",
    mode: "percent-grid",
    supportPrice: 185,
    resistancePrice: 230,
    currentPrice: 204,
    ladder: [],
    grid: {
      basePrice: 204,
      rungs: [
        { index: 1, buyDropPct: 1.0, sellRisePct: 1.2, notional: 500 },
        { index: 2, buyDropPct: 3.0, sellRisePct: 1.6, notional: 700 },
        { index: 3, buyDropPct: 5.0, sellRisePct: 2.0, notional: 900 },
      ],
    },
    priceAnchor: {
      source: "manual",
      price: 204,
      capturedAt: now,
    },
    riskLimits: {
      maxDailyBuys: 3,
      maxDailySells: 3,
      maxPositionValue: 2_500,
      maxLossPct: 12,
      maxHoldHours: 120,
    },
    exitRules: {
      takeProfitPct: 4,
      stopLossPct: 8,
      rescueMode: "disable-only",
    },
    createdAt: now,
    updatedAt: now,
  };
};

const toPersistableStrategyConfig = (
  config: AutomationStrategyConfig,
): Parameters<typeof upsertStrategyConfig>[1] => ({
  id: config.id,
  name: config.name,
  symbol: config.symbol,
  market: config.market,
  executionVenue: config.executionVenue,
  preset: config.preset,
  status: config.status,
  mode: config.mode,
  orderSizing: config.orderSizing,
  supportPrice: config.supportPrice,
  resistancePrice: config.resistancePrice,
  currentPrice: config.currentPrice,
  ladder: config.ladder,
  grid: config.grid,
  loop: config.loop,
  priceAnchor: config.priceAnchor,
  lastSimulation: config.lastSimulation,
  riskLimits: config.riskLimits,
  exitRules: config.exitRules,
});

const runStrategyCrudDryRun = async (userId: string) => {
  await cleanupInternalSelfTestStrategies(userId);
  const config = buildStrategyDryRunConfig(userId);
  const errors = validateStrategyConfig(config);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  const persistableConfig = toPersistableStrategyConfig(config);
  await deleteStrategyConfig(userId, config.id);
  try {
    const saved = await upsertStrategyConfig(userId, persistableConfig);
    const found = await findStrategyConfig(userId, saved.id);
    if (!found) {
      throw new Error("저장한 전략을 다시 읽지 못했습니다.");
    }

    const result = simulateAutomationStrategy({ userId, config: found });
    const expectedOrders = found.grid?.rungs.length ?? 0;
    if (!result.riskCheck.passed || result.orderIntents.length !== expectedOrders) {
      throw new Error(`시뮬레이션 실패: 주문의도 ${result.orderIntents.length}/${expectedOrders}건`);
    }

    const simulated = await upsertStrategyConfig(userId, {
      ...toPersistableStrategyConfig(found),
      lastSimulation: toAutomationLastSimulation(result),
    });
    const reloaded = await findStrategyConfig(userId, simulated.id);
    if (!reloaded?.lastSimulation?.passed) {
      throw new Error("시뮬레이션 결과를 전략에 반영하지 못했습니다.");
    }

    return { saved, result };
  } finally {
    await deleteStrategyConfig(userId, config.id);
  }
};

const runStrategyEditInvalidationDryRun = async (userId: string) => {
  await cleanupInternalSelfTestStrategies(userId);
  const config = buildStrategyDryRunConfig(userId);
  const errors = validateStrategyConfig(config);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  await deleteStrategyConfig(userId, config.id);
  try {
    const saved = await upsertStrategyConfig(userId, toPersistableStrategyConfig(config));
    const result = simulateAutomationStrategy({ userId, config: saved });
    if (!result.riskCheck.passed) {
      throw new Error(`시뮬레이션 실패: ${result.riskCheck.blockers.join(" ")}`);
    }
    await upsertStrategyConfig(userId, {
      ...toPersistableStrategyConfig(saved),
      status: "enabled",
      lastSimulation: toAutomationLastSimulation(result),
    });

    const editResponse = await updateLocalStrategyConfig(
      new Request(`http://127.0.0.1:38771/api/local/strategy-configs/${saved.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Self-test 순환분할 수정",
          symbol: saved.symbol,
          market: saved.market,
          preset: saved.preset,
          mode: "percent-grid",
          currentPrice: 205,
          grid: {
            basePrice: 205,
            rungs: [
              { index: 1, buyDropPct: 1.5, sellRisePct: 1.2, notional: 600 },
              { index: 2, buyDropPct: 3.0, sellRisePct: 1.6, notional: 800 },
              { index: 3, buyDropPct: 5.0, sellRisePct: 2.0, notional: 1_000 },
            ],
          },
          priceAnchor: {
            source: "manual",
            price: 205,
            capturedAt: new Date().toISOString(),
          },
          riskLimits: {
            maxDailyBuys: 3,
            maxDailySells: 3,
            maxPositionValue: 2_800,
            maxLossPct: 11,
            maxHoldHours: 120,
          },
          exitRules: saved.exitRules,
        }),
      }),
      saved.id,
    );
    if (editResponse.status !== 200) {
      const payload = await editResponse.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? `전략 수정 응답 ${editResponse.status}`);
    }
    const editedPayload = await editResponse.json() as { config?: AutomationStrategyConfig };
    const edited = editedPayload.config;
    if (!edited) {
      throw new Error("전략 수정 응답에 config가 없습니다.");
    }
    if (edited.status !== "draft") {
      throw new Error(`수정 후 전략 상태가 draft가 아닙니다: ${edited.status}`);
    }
    if (edited.lastSimulation) {
      throw new Error("수정 후에도 이전 시뮬레이션이 남아 있습니다.");
    }
    const readiness = await strategyReadiness(edited);
    if (readiness.paperAutomationReady || !readiness.blockers.some((blocker) => blocker.includes("시뮬레이션"))) {
      throw new Error("수정 후 재시뮬레이션 차단 상태를 확인하지 못했습니다.");
    }

    return { before: saved, after: edited };
  } finally {
    await deleteStrategyConfig(userId, config.id);
  }
};

const runStrategyBackupImportDryRun = async (userId: string) => {
  await cleanupInternalSelfTestStrategies(userId);
  const config = buildStrategyDryRunConfig(userId);
  const errors = validateStrategyConfig(config);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  let saved: AutomationStrategyConfig | null = null;
  const importedIds: string[] = [];
  try {
    saved = await upsertStrategyConfig(userId, toPersistableStrategyConfig(config));
    const exportedConfig = strategyExportConfig(saved);
    if (
      "status" in exportedConfig ||
      "lastSimulation" in exportedConfig ||
      exportedConfig.sourceId !== saved.id
    ) {
      throw new Error("전략 백업 payload가 안전한 export 형식이 아닙니다.");
    }

    const response = await importLocalStrategyConfigs(new Request("http://127.0.0.1:38771/api/local/strategy-configs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        safety: {
          credentialsIncluded: false,
          accountPreferenceIncluded: false,
          importedStatus: "draft",
          importedSimulation: "discarded",
        },
        configs: [{
          ...exportedConfig,
          id: "unsafe-import-id",
          status: "enabled",
          lastSimulation: {
            configHash: "unsafe",
            passed: true,
            blockers: [],
            warnings: [],
            expectedReturnPct: 999,
            expectedLossPct: 0,
            summary: "unsafe imported simulation",
            simulatedAt: new Date().toISOString(),
          },
        }],
      }),
    }));
    const payload = (await response.json().catch(() => null)) as {
      imported?: unknown;
      status?: unknown;
      safety?: { enabledStrategiesImported?: unknown; lastSimulationDiscarded?: unknown; liveTradingChanged?: unknown };
      configs?: Array<{ id?: unknown; status?: unknown; lastSimulation?: unknown }>;
      error?: unknown;
    } | null;
    const imported = payload?.configs?.[0];
    const importedId = typeof imported?.id === "string" ? imported.id : "";
    if (importedId) {
      importedIds.push(importedId);
    }
    if (
      !response.ok ||
      payload?.imported !== 1 ||
      payload.status !== "draft" ||
      payload.safety?.enabledStrategiesImported !== 0 ||
      payload.safety?.lastSimulationDiscarded !== true ||
      payload.safety?.liveTradingChanged !== false ||
      !importedId.startsWith("imported-") ||
      importedId === "unsafe-import-id" ||
      imported?.status !== "draft" ||
      imported?.lastSimulation !== undefined
    ) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "전략 가져오기가 draft-only 안전 조건을 통과하지 못했습니다.");
    }

    return { exported: 1, imported: 1 };
  } finally {
    await Promise.all([
      saved ? deleteStrategyConfig(userId, saved.id).catch(() => undefined) : Promise.resolve(),
      ...importedIds.map((id) => deleteStrategyConfig(userId, id).catch(() => undefined)),
    ]);
    await cleanupInternalSelfTestStrategies(userId);
  }
};

const runEnabledStrategyAutomationDryRun = async (userId: string) => {
  await cleanupInternalSelfTestStrategies(userId);
  const config = buildStrategyDryRunConfig(userId);
  const errors = validateStrategyConfig(config);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  await deleteStrategyConfig(userId, config.id);
  const previousEnabledCount = (await listStrategyConfigs(userId))
    .filter((entry) => entry.status === "enabled").length;
  try {
    const saved = await upsertStrategyConfig(userId, toPersistableStrategyConfig(config));
    const result = simulateAutomationStrategy({ userId, config: saved });
    const expectedOrders = saved.grid?.rungs.length ?? 0;
    if (!result.riskCheck.passed || result.orderIntents.length !== expectedOrders) {
      throw new Error(`시뮬레이션 실패: 주문의도 ${result.orderIntents.length}/${expectedOrders}건`);
    }

    await upsertStrategyConfig(userId, {
      ...toPersistableStrategyConfig(saved),
      status: "enabled",
      lastSimulation: toAutomationLastSimulation(result),
    });

    const summary = await automationDryRunSummary(userId, { cleanupInternalStrategies: false });
    if (summary.strategies < previousEnabledCount + 1) {
      throw new Error(`자동화 dry-run이 활성 전략을 감지하지 못했습니다: ${summary.strategies}개`);
    }
    if (summary.submitted !== 0) {
      throw new Error(`dry-run에서 broker 제출이 발생했습니다: ${summary.submitted}건`);
    }

    return { result, summary, previousEnabledCount };
  } finally {
    await deleteStrategyConfig(userId, config.id);
  }
};

const localSelfTest = async () => {
  const generatedAt = new Date().toISOString();
  const userId = localUserId();
  const storageRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT ?? null;
  const storageRootFallback = `${process.cwd()}/.cache`;
  await cleanupInternalSelfTestStrategies(userId);

  const checks: LocalSelfTestCheck[] = [];
  checks.push(...await Promise.all([
    runSelfTestCheck({
      id: "sidecar-health",
      label: "Sidecar HTTP",
      blocking: true,
      run: async () => ({
        status: "pass",
        summary: `${ENGINE_NAME} ${process.pid} 응답 중`,
        action: "정상입니다.",
      }),
    }),
    runSelfTestCheck({
      id: "app-support-storage",
      label: "로컬 저장소",
      blocking: true,
      run: async () => {
        if (!storageRoot) {
          return {
            status: "warn",
            summary: "STOCK_ANALYSIS_STORAGE_ROOT가 없어 repo .cache fallback을 사용할 수 있습니다.",
            action: "패키징 앱에서는 App Support 저장소가 주입되어야 합니다.",
          };
        }
        if (storageRoot.startsWith(storageRootFallback)) {
          return {
            status: "warn",
            summary: "저장소가 repository .cache 아래에 있습니다.",
            action: "macOS 앱 실행 시 App Support 저장소로 sidecar를 시작하세요.",
          };
        }
        return {
          status: "pass",
          summary: storageRoot,
          action: "설정, 뉴스, paper state, 전략 저장에 사용할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "paper-store",
      label: "모의투자 저장소",
      blocking: true,
      run: async () => {
        const storagePath = getPaperTradingStorageRootForUser(userId);
        const { state } = await readPaperTradingState(storagePath);
        const account = state.accounts.US ?? state.accounts.KR;
        return {
          status: "pass",
          summary: `현금 ${Math.round(account?.cash ?? 0).toLocaleString("ko-KR")} · 포지션 ${state.positions.length}개 · 주문 ${state.orders.length}개`,
          action: "모의 주문 실행 전 상태를 읽을 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "official-news",
      label: "공식 뉴스/RSS",
      blocking: false,
      run: async () => {
        const result = await pollOfficialNews();
        const errorCount = result.errors.length;
        if (result.events.length === 0) {
          return {
            status: "warn",
            summary: `이벤트 0개 · 오류 ${errorCount}개`,
            action: "네트워크나 RSS 소스 상태를 확인하세요.",
          };
        }
        return {
          status: errorCount > 0 ? "warn" : "pass",
          summary: `이벤트 ${result.events.length}개 · 신규 ${result.newEvents.length}개 · 알림 후보 ${result.alertCandidates.length}개`,
          action: errorCount > 0 ? "일부 RSS 오류는 뉴스 탭에서 소스별로 확인하세요." : "뉴스·알림 탭에서 사용할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "market-analysis-action",
      label: "분석 버튼",
      blocking: false,
      run: async () => {
        if (marketSnapshotChecksDisabled()) {
          return {
            status: "warn",
            summary: "오프라인/테스트 모드라 외부 시세 조회를 건너뛰었습니다.",
            action: "앱 실행 환경에서는 상단 분석 버튼으로 종목 분석 응답을 확인하세요.",
          };
        }
        const response = await callRoute(
          new Request("http://127.0.0.1:38771/api/market/NVDA?days=120&tf=1d"),
          "/api/market/NVDA",
        );
        const payload = (await response.json().catch(() => null)) as { candles?: unknown[]; symbol?: unknown; error?: unknown } | null;
        if (!response.ok) {
          return {
            status: "warn",
            summary: `HTTP ${response.status} · ${typeof payload?.error === "string" ? payload.error : "분석 응답 실패"}`,
            action: "네트워크, 시세 provider, 심볼 분석 route 로그를 확인하세요.",
          };
        }
        const candleCount = Array.isArray(payload?.candles) ? payload.candles.length : 0;
        return {
          status: candleCount > 0 ? "pass" : "warn",
          summary: `NVDA 캔들 ${candleCount}개`,
          action: candleCount > 0
            ? "분석 버튼이 local-engine을 통해 기존 종목 분석 route를 호출합니다."
            : "응답은 받았지만 차트 데이터가 비어 있습니다. 시세 provider를 확인하세요.",
        };
      },
    }),
    runSelfTestCheck({
      id: "daily-briefing-action",
      label: "브리핑 버튼",
      blocking: false,
      run: async () => {
        if (marketSnapshotChecksDisabled()) {
          return {
            status: "warn",
            summary: "오프라인/테스트 모드라 일간 브리핑 생성을 건너뛰었습니다.",
            action: "앱 실행 환경에서는 상단 브리핑 버튼으로 시장 브리핑 응답을 확인하세요.",
          };
        }
        const response = await callRoute(
          new Request("http://127.0.0.1:38771/api/briefing/daily-market?session=US"),
          "/api/briefing/daily-market",
        );
        const payload = (await response.json().catch(() => null)) as { reports?: unknown[]; error?: unknown } | null;
        if (!response.ok) {
          return {
            status: "warn",
            summary: `HTTP ${response.status} · ${typeof payload?.error === "string" ? payload.error : "브리핑 응답 실패"}`,
            action: "네트워크, 시세 provider, briefing route 로그를 확인하세요.",
          };
        }
        const reportCount = Array.isArray(payload?.reports) ? payload.reports.length : 0;
        return {
          status: reportCount > 0 ? "pass" : "warn",
          summary: `시장 리포트 ${reportCount}개`,
          action: reportCount > 0
            ? "브리핑 버튼이 local-engine을 통해 기존 일간 시장 브리핑 route를 호출합니다."
            : "응답은 받았지만 리포트가 비어 있습니다. 브리핑 후보 소스를 확인하세요.",
        };
      },
    }),
    runSelfTestCheck({
      id: "terminal-dashboard",
      label: "터미널 대시보드",
      blocking: true,
      run: async () => {
        const dashboard = await buildTerminalDashboardSnapshot({ userId, symbol: "NVDA", session: "US" });
        const hasP0P1Data = dashboard.auditTrail.length > 0 &&
          dashboard.riskScenarios.length > 0 &&
          dashboard.preTradeChecklist.length > 0 &&
          dashboard.replayEvents.length > 0;
        return {
          status: hasP0P1Data ? "pass" : "fail",
          summary: `감사 ${dashboard.auditTrail.length} · 리스크 ${dashboard.riskScenarios.length} · 체크리스트 ${dashboard.preTradeChecklist.length} · 리플레이 ${dashboard.replayEvents.length}`,
          action: hasP0P1Data ? "개요/주문·리스크/리플레이 탭 데이터가 생성됩니다." : "dashboard builder를 점검하세요.",
        };
      },
    }),
    runSelfTestCheck({
      id: "paper-run-dry-run",
      label: "모의 주문 dry-run",
      blocking: true,
      run: async () => {
        const response = await runPaperTrading(new Request("http://127.0.0.1:38771/api/paper-trading/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: "US", source: "manual", dryRun: true }),
        }));
        const payload = (await response.json().catch(() => null)) as {
          dryRun?: unknown;
          run?: { id?: unknown };
          orders?: unknown[];
          executions?: unknown[];
          snapshotPath?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok || payload?.dryRun !== true || !payload.run) {
          return {
            status: "fail",
            summary: typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`,
            action: "모의 주문 endpoint가 주문 생성 전 미리보기 응답을 반환하는지 확인하세요.",
          };
        }
        return {
          status: "pass",
          summary: `주문 ${Array.isArray(payload.orders) ? payload.orders.length : 0} · 체결 ${Array.isArray(payload.executions) ? payload.executions.length : 0} · 저장 안 함`,
          action: "모의 주문 버튼의 핵심 경로가 paper state를 변경하지 않고 계산됩니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "strategy-store",
      label: "전략 저장소",
      blocking: true,
      run: async () => {
        const configs = await listStrategyConfigs(userId);
        return {
          status: "pass",
          summary: `전략 ${configs.length}개 읽음`,
          action: "전략 시트에서 순환분할/커스텀 전략을 저장할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "strategy-simulation-dry-run",
      label: "전략 시뮬레이션 dry-run",
      blocking: true,
      run: async () => {
        const config = buildStrategyDryRunConfig(userId);
        const errors = validateStrategyConfig(config);
        if (errors.length) {
          return {
            status: "fail",
            summary: errors.join(" "),
            action: "전략 payload 생성 규칙과 simulation validator를 확인하세요.",
          };
        }
        const result = simulateAutomationStrategy({ userId, config });
        const allDraft = result.orderIntents.every((intent) => intent.status === "draft");
        const expectedOrders = config.grid?.rungs.length ?? 0;
        if (!result.riskCheck.passed || result.orderIntents.length !== expectedOrders || !allDraft) {
          return {
            status: "fail",
            summary: `passed=${result.riskCheck.passed} · 주문의도 ${result.orderIntents.length}/${expectedOrders}건`,
            action: "순환분할 시뮬레이션의 RiskCheck와 주문의도 생성 결과를 확인하세요.",
          };
        }
        return {
          status: "pass",
          summary: `순환분할 ${expectedOrders}차 · 주문의도 ${result.orderIntents.length}건 · 저장 안 함`,
          action: "전략 시트에서 만든 분할 전략이 sidecar에서 검증과 paper-only 시뮬레이션을 통과할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "toss-openapi-contract",
      label: "Toss OpenAPI 계약",
      blocking: true,
      run: async () => {
        const contract = tossOpenApiContractSummary();
        const ok = contract.specVersion === "1.2.2" &&
          contract.baseUrl === "https://openapi.tossinvest.com" &&
          contract.requiredOperationCount >= 20 &&
          contract.accountHeaderOperationCount >= 8;
        return {
          status: ok ? "pass" : "fail",
          summary: `OpenAPI ${contract.specVersion} · 필수 ${contract.requiredOperationCount}개 · 계좌 헤더 ${contract.accountHeaderOperationCount}개`,
          action: ok
            ? "Toss 경로/계좌 헤더 계약 메타데이터가 번들 sidecar에 포함되어 있습니다."
            : "src/lib/toss/contract.ts와 Toss 공식 OpenAPI 계약을 다시 확인하세요.",
        };
      },
    }),
  ]));

  checks.push(await runSelfTestCheck({
    id: "strategy-crud-dry-run",
    label: "전략 저장 CRUD dry-run",
    blocking: true,
    run: async () => {
      if (strategyCrudDryRunDisabled()) {
        return {
          status: "warn",
          summary: "Supabase 저장소 모드라 원격 DB dry-run을 건너뛰었습니다.",
          action: "macOS 앱 로컬 저장소에서는 임시 전략 저장/시뮬레이션/삭제까지 점검합니다.",
        };
      }
      const { result } = await runStrategyCrudDryRun(userId);
      return {
        status: "pass",
        summary: `임시 전략 저장·시뮬레이션·삭제 완료 · 주문의도 ${result.orderIntents.length}건`,
        action: "전략 시트의 초안 저장, 시뮬레이션, 삭제 핵심 경로가 로컬 저장소에서 작동합니다.",
      };
    },
  }));

  checks.push(await runSelfTestCheck({
    id: "strategy-edit-invalidation-dry-run",
    label: "전략 수정 재검증 dry-run",
    blocking: true,
    run: async () => {
      if (strategyCrudDryRunDisabled()) {
        return {
          status: "warn",
          summary: "Supabase 저장소 모드라 원격 DB dry-run을 건너뛰었습니다.",
          action: "macOS 앱 로컬 저장소에서는 임시 전략 수정과 재시뮬레이션 차단까지 점검합니다.",
        };
      }
      const { after } = await runStrategyEditInvalidationDryRun(userId);
      return {
        status: "pass",
        summary: `${after.name} 수정 저장 · draft 복귀 · 시뮬레이션 무효화`,
        action: "전략 시트의 수정 저장 후에는 다시 시뮬레이션을 통과해야 활성화됩니다.",
      };
    },
  }));

  checks.push(await runSelfTestCheck({
    id: "strategy-backup-import-dry-run",
    label: "전략 백업/가져오기 dry-run",
    blocking: true,
    run: async () => {
      if (strategyCrudDryRunDisabled()) {
        return {
          status: "warn",
          summary: "Supabase 저장소 모드라 원격 DB dry-run을 건너뛰었습니다.",
          action: "macOS 앱 로컬 저장소에서는 전략 백업 JSON과 draft-only 가져오기를 점검합니다.",
        };
      }
      const result = await runStrategyBackupImportDryRun(userId);
      return {
        status: "pass",
        summary: `백업 ${result.exported}개 · 가져오기 ${result.imported}개 · draft-only 복구`,
        action: "전략 백업은 Toss 키/계좌/활성 상태/시뮬레이션 증거 없이 다른 Mac으로 옮길 수 있습니다.",
      };
    },
  }));

  checks.push(await runSelfTestCheck({
    id: "automation-enabled-strategy-dry-run",
    label: "활성 전략 자동화 dry-run",
    blocking: true,
    run: async () => {
      if (strategyCrudDryRunDisabled()) {
        return {
          status: "warn",
          summary: "Supabase 저장소 모드라 원격 DB dry-run을 건너뛰었습니다.",
          action: "macOS 앱 로컬 저장소에서는 임시 전략 활성화와 자동화 dry-run 감지를 점검합니다.",
        };
      }
      const { summary, previousEnabledCount } = await runEnabledStrategyAutomationDryRun(userId);
      const newStrategies = summary.strategies - previousEnabledCount;
      const reason = "reason" in summary && typeof summary.reason === "string"
        ? ` · ${summary.reason}`
        : "";
      return {
        status: "pass",
        summary: `활성 전략 +${newStrategies}개 감지 · ${summary.status}${reason} · 제출 ${summary.submitted}건`,
        action: "커스텀 전략이 자동화 큐에 잡히지만 dry-run에서는 broker 제출 없이 상태만 반환합니다.",
      };
    },
  }));

  checks.push(...await Promise.all([
    runSelfTestCheck({
      id: "automation-cycle-dry-run",
      label: "자동화 큐 dry-run",
      blocking: true,
      run: async () => {
        const response = await runAutomation(new Request("http://127.0.0.1:38771/api/automation/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        }));
        const payload = (await response.json().catch(() => null)) as {
          dryRun?: unknown;
          result?: { status?: unknown; reason?: unknown; strategies?: unknown; submitted?: unknown; liveTradingEnabled?: unknown };
          error?: unknown;
        } | null;
        const status = typeof payload?.result?.status === "string" ? payload.result.status : null;
        if (!response.ok || payload?.dryRun !== true || !status) {
          return {
            status: "fail",
            summary: typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`,
            action: "자동화 큐 endpoint가 Toss 네트워크 호출 없이 준비 상태를 반환하는지 확인하세요.",
          };
        }
        return {
          status: "pass",
          summary: `${status}${typeof payload.result?.reason === "string" ? ` · ${payload.result.reason}` : ""} · 전략 ${Number(payload.result?.strategies ?? 0)}개`,
          action: "자동화 큐 버튼의 준비 상태를 주문 제출 없이 확인할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "order-sync-ledger",
      label: "주문·체결 원장",
      blocking: true,
      run: async () => {
        const response = await localOrderSyncSnapshot();
        return {
          status: "pass",
          summary: `추적 주문 ${response.summary.orders}개 · 미종결 ${response.summary.openOrders}개 · 체결 ${response.summary.fills}개`,
          action: "체결 동기화 버튼이 broker 제출 없이 로컬 주문 추적 원장과 체결 기록을 조회할 수 있습니다.",
        };
      },
    }),
    runSelfTestCheck({
      id: "toss-readonly-precheck",
      label: "Toss 조회/사전검증 안전",
      blocking: true,
      run: async () => {
        const credential = await getBrokerCredentialView(userId, "toss");
        if (credential) {
          return {
            status: "pass",
            summary: "Toss credential 감지 · 자동 외부 조회 생략",
            action: "보유 조회와 사전검증은 주문·리스크 탭에서 사용자가 명시적으로 눌렀을 때만 실행합니다.",
          };
        }

        const holdingsResponse = await localHoldings(
          new Request("http://127.0.0.1:38771/api/local/holdings?symbol=NVDA"),
        );
        const holdings = (await holdingsResponse.json().catch(() => null)) as {
          linked?: unknown;
          held?: unknown;
          error?: unknown;
        } | null;
        const precheckResponse = await localOrderPrecheck(new Request("http://127.0.0.1:38771/api/local/orders/precheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: "NVDA", side: "buy", quantity: 1, price: 100, currency: "USD" }),
        }));
        const precheck = (await precheckResponse.json().catch(() => null)) as { error?: unknown } | null;
        const safe =
          holdingsResponse.ok &&
          holdings?.linked === false &&
          holdings?.held === false &&
          precheckResponse.status === 412 &&
          typeof precheck?.error === "string" &&
          precheck.error.includes("Toss credential");

        return {
          status: safe ? "pass" : "fail",
          summary: safe
            ? "credential 없음 · 보유 조회 미연동 표시 · 사전검증 412 차단"
            : `holdings HTTP ${holdingsResponse.status} · precheck HTTP ${precheckResponse.status}`,
          action: safe
            ? "Toss credential이 없어도 앱 버튼이 주문 제출 없이 명확한 차단 상태를 보여줍니다."
            : "보유 조회/사전검증 endpoint가 credential 미설정 상태에서 broker 호출 없이 닫히는지 확인하세요.",
        };
      },
    }),
    runSelfTestCheck({
      id: "toss-live-gate",
      label: "Toss 실거래 게이트",
      blocking: false,
      run: async () => {
        const [credential, accountPreference, liveGate] = await Promise.all([
          getBrokerCredentialView(userId, "toss"),
          getBrokerAccountPreference(userId, "toss"),
          getLiveTradingGate(userId),
        ]);
        const ready = credential?.status === "verified" && !!accountPreference && liveGate.status === 200;
        return {
          status: ready ? "pass" : "warn",
          summary: ready
            ? `검증 완료 · ${accountPreference?.accountNo ?? "계좌 선택됨"}`
            : liveGate.reason ?? "Toss credential, 계좌 선택, live 권한 중 일부가 준비되지 않았습니다.",
          action: ready
            ? "OrderIntent/RiskCheck 경계를 통과한 주문만 제출됩니다."
            : "Toss 시트에서 API 키 검증, 계좌 선택, 실거래 토글을 순서대로 확인하세요.",
        };
      },
    }),
    runSelfTestCheck({
      id: "automation-safety",
      label: "자동화 안전 상태",
      blocking: true,
      run: async () => {
        const [killSwitch, workerControl] = await Promise.all([
          getAutomationKillSwitchState(),
          getAutomationWorkerControlState(),
        ]);
        const blocked = killSwitch.engaged || workerControl.paused;
        return {
          status: blocked ? "warn" : "pass",
          summary: `긴급 중지 ${killSwitch.engaged ? "ON" : "OFF"} · 워커 ${workerControl.paused ? "일시중지" : "감시"}`,
          action: blocked
            ? "자동화/모의 실행 전 상단 버튼이나 메뉴바에서 차단 상태를 해제하세요."
            : "자동화 큐 실행을 막는 로컬 안전 차단은 없습니다.",
        };
      },
    }),
  ]));

  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  const passCount = checks.filter((check) => check.status === "pass").length;
  const blockingFailures = checks.filter((check) => check.blocking && check.status === "fail").length;
  const overall: LocalSelfTestStatus = blockingFailures > 0 || failCount > 0
    ? "fail"
    : warnCount > 0 ? "warn" : "pass";
  await cleanupInternalSelfTestStrategies(userId);

  return jsonResponse({
    generatedAt,
    overall,
    summary: {
      total: checks.length,
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      blockingFailures,
    },
    checks,
  });
};

const registerBrokerCredentials = async (request: Request) => {
  const payload = await readJsonBody(request);
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const clientSecret = typeof payload.clientSecret === "string" ? payload.clientSecret.trim() : "";
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: "clientId, clientSecret가 필요합니다." }, { status: 400 });
  }
  if (process.env.STOCK_ANALYSIS_UI_SMOKE_REJECT_TOSS_CREDENTIALS === "1") {
    return jsonResponse({ error: "토스 검증 실패: UI smoke credential rejection" }, { status: 401 });
  }

  const userId = localUserId();
  try {
    const client = createTossClient({ clientId, clientSecret });
    await client.verifyToken();
    const accounts = await client.listAccounts();
    await saveBrokerCredentials({ userId, clientId, clientSecret, status: "verified" });
    await grantAutomationFeature(userId, "broker_credentials");
    const accountPreference = await reconcileAccountPreference(userId, accounts);
    return jsonResponse({
      credential: await getBrokerCredentialView(userId, "toss"),
      accounts: accounts.map(toAccountView),
      accountPreference,
      accountsError: null,
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return jsonResponse(formatTossApiError(error, "토스 검증 실패"), {
        status: error.status === 401 ? 401 : 400,
      });
    }
    return jsonResponse({ error: "토스 자격증명 검증 중 오류가 발생했습니다." }, { status: 502 });
  }
};

const cryptoCredentialState = async () => {
  const userId = localUserId();
  const [upbit, bithumb] = await Promise.all([
    getBrokerCredentialView(userId, "upbit"),
    getBrokerCredentialView(userId, "bithumb"),
  ]);
  return jsonResponse({
    generatedAt: new Date().toISOString(),
    exchanges: ["upbit", "bithumb"].map((exchange) => ({
      exchange,
      credential: exchange === "upbit" ? upbit : bithumb,
      contract: cryptoExchangeContract(exchange as CryptoExchange),
    })),
  });
};

const registerCryptoCredential = async (exchange: CryptoExchange, request: Request) => {
  const payload = await readJsonBody(request);
  const accessKey = typeof payload.accessKey === "string" ? payload.accessKey.trim() : "";
  const secretKey = typeof payload.secretKey === "string" ? payload.secretKey.trim() : "";
  if (!accessKey || !secretKey) {
    return jsonResponse({ error: "accessKey, secretKey가 필요합니다." }, { status: 400 });
  }
  try {
    const accounts = await getCryptoAccounts(exchange, { accessKey, secretKey });
    await saveBrokerCredentials({
      userId: localUserId(),
      broker: exchange,
      clientId: accessKey,
      clientSecret: secretKey,
      status: "verified",
    });
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      exchange,
      credential: await getBrokerCredentialView(localUserId(), exchange),
      accountCount: accounts.length,
      currencies: accounts.map((account) => account.currency).slice(0, 20),
      orderSubmissionAttempted: false,
    });
  } catch (error) {
    return jsonResponse({
      error: `${exchange} 읽기 전용 계좌 검증 실패: ${errorMessage(error)}`,
      orderSubmissionAttempted: false,
    }, { status: 401 });
  }
};

const deleteCryptoCredential = async (exchange: CryptoExchange) => {
  await deleteBrokerCredentials(localUserId(), exchange);
  return jsonResponse({ ok: true, exchange });
};

const cryptoQuoteFreshness = (timestamp: number) => {
  const ageMs = Date.now() - timestamp;
  const futureSkewMs = Math.max(0, -ageMs);
  return {
    timestamp: new Date(timestamp).toISOString(),
    ageMs,
    futureSkewMs,
    fresh: ageMs >= -5_000 && ageMs <= CRYPTO_TICKER_MAX_AGE_MS,
    maxAgeMs: CRYPTO_TICKER_MAX_AGE_MS,
  };
};

const cryptoReadiness = async (exchange: CryptoExchange, market: string) => {
  const credential = await getBrokerCredentialView(localUserId(), exchange);
  const encrypted = await loadDecryptedCredentials(localUserId(), exchange);
  if (credential?.status !== "verified" || !encrypted) {
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      exchange,
      market,
      ready: false,
      credential,
      readonlyChecks: { accounts: false, orderChance: false, ticker: false, orderConstraints: false },
      orderSubmissionAttempted: false,
      message: `${exchange} API 키를 먼저 검증해 저장하세요.`,
    });
  }
  try {
    const credentials = { accessKey: encrypted.clientId, secretKey: encrypted.clientSecret };
    const [accounts, chance, ticker, upbitInstrument] = await Promise.all([
      getCryptoAccounts(exchange, credentials),
      getCryptoOrderChance(exchange, credentials, market),
      getCryptoTicker(exchange, market),
      exchange === "upbit" ? getUpbitOrderbookInstrument(market) : Promise.resolve(null),
    ]);
    const chanceAvailable = Object.keys(chance).length > 0;
    const rawBidConstraints = getCryptoOrderConstraints(chance, "bid");
    const rawAskConstraints = getCryptoOrderConstraints(chance, "ask");
    const bidConstraints = exchange === "upbit"
      ? { ...rawBidConstraints, priceUnit: upbitInstrument?.tickSize ?? null }
      : rawBidConstraints;
    const askConstraints = exchange === "upbit"
      ? { ...rawAskConstraints, priceUnit: upbitInstrument?.tickSize ?? null }
      : rawAskConstraints;
    const quote = cryptoQuoteFreshness(ticker.timestamp);
    const constraintsAvailable =
      (bidConstraints.minTotal ?? 0) > 0 &&
      (askConstraints.minTotal ?? 0) > 0 &&
      (bidConstraints.priceUnit ?? askConstraints.priceUnit ?? 0) > 0 &&
      bidConstraints.feeRate !== null &&
      askConstraints.feeRate !== null;
    const ready = chanceAvailable && constraintsAvailable && quote.fresh;
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      exchange,
      market,
      ready,
      credential,
      readonlyChecks: {
        accounts: true,
        orderChance: chanceAvailable,
        ticker: quote.fresh,
        orderConstraints: constraintsAvailable,
      },
      accountCount: accounts.length,
      currencies: accounts.map((account) => account.currency).slice(0, 20),
      chanceAvailable,
      ticker: {
        market: ticker.market,
        tradePrice: ticker.tradePrice,
        ...quote,
        lastTradeTimestamp: ticker.tradeTimestamp
          ? new Date(ticker.tradeTimestamp).toISOString()
          : null,
      },
      orderConstraints: { bid: bidConstraints, ask: askConstraints },
      orderSubmissionAttempted: false,
      message: ready
        ? "계좌 잔고, 주문 가능 정보, 최소 주문금액, 현재가 신선도 조회가 주문 제출 없이 통과했습니다."
        : !chanceAvailable
          ? "거래소 주문 가능 정보가 비어 있어 준비 상태를 차단했습니다."
          : !constraintsAvailable
            ? "최소 주문금액·호가 단위·수수료 제약을 모두 확인하지 못해 준비 상태를 차단했습니다."
            : "거래소 현재가가 오래되어 준비 상태를 차단했습니다.",
    });
  } catch (error) {
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      exchange,
      market,
      ready: false,
      credential,
      readonlyChecks: { accounts: false, orderChance: false, ticker: false, orderConstraints: false },
      orderSubmissionAttempted: false,
      message: errorMessage(error),
    }, { status: 502 });
  }
};

const cryptoOrderPrecheck = async (exchange: CryptoExchange, request: Request) => {
  const payload = await readJsonBody(request);
  const market = typeof payload.market === "string" ? payload.market.trim().toUpperCase() : "";
  const side = payload.side === "buy" ? "bid" : payload.side === "sell" ? "ask" : null;
  const volume = Number(payload.volume);
  const price = Number(payload.price);
  if (!/^KRW-[A-Z0-9]+$/.test(market) || !side || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(price) || price <= 0) {
    return jsonResponse({ error: "market(KRW-BTC), side(buy/sell), volume, price 양수가 필요합니다." }, { status: 400 });
  }
  const encrypted = await loadDecryptedCredentials(localUserId(), exchange);
  if (!encrypted) {
    return jsonResponse({ error: `검증 완료된 ${exchange} API 키가 필요합니다.`, orderSubmissionAttempted: false }, { status: 412 });
  }
  try {
    const credentials = { accessKey: encrypted.clientId, secretKey: encrypted.clientSecret };
    const [accounts, chance, ticker, upbitInstrument] = await Promise.all([
      getCryptoAccounts(exchange, credentials),
      getCryptoOrderChance(exchange, credentials, market),
      getCryptoTicker(exchange, market),
      exchange === "upbit" ? getUpbitOrderbookInstrument(market) : Promise.resolve(null),
    ]);
    const [quoteCurrency, baseCurrency] = market.split("-");
    const quoteBalance = Number(accounts.find((account) => account.currency === quoteCurrency)?.balance ?? 0);
    const baseBalance = Number(accounts.find((account) => account.currency === baseCurrency)?.balance ?? 0);
    const estimatedValue = volume * price;
    const blockers: string[] = [];
    const chanceAvailable = Object.keys(chance).length > 0;
    const rawConstraints = getCryptoOrderConstraints(chance, side);
    const constraints = exchange === "upbit"
      ? { ...rawConstraints, priceUnit: upbitInstrument?.tickSize ?? null }
      : rawConstraints;
    const quote = cryptoQuoteFreshness(ticker.timestamp);
    if (!chanceAvailable) {
      blockers.push(`${exchange} 주문 가능 정보가 비어 있습니다.`);
    }
    if (!quote.fresh) {
      blockers.push(quote.futureSkewMs > 5_000
        ? `현재가 시각이 로컬 시계보다 ${Math.round(quote.futureSkewMs / 1_000)}초 미래라 검증할 수 없습니다.`
        : `현재가가 ${Math.round(quote.ageMs / 1_000)}초 전에 갱신되어 신선도 제한을 초과했습니다.`);
    }
    if (constraints.minTotal === null || constraints.minTotal <= 0) {
      blockers.push("거래소 최소 주문금액을 확인하지 못했습니다.");
    } else if (estimatedValue < constraints.minTotal) {
      blockers.push(`최소 주문금액 ${constraints.minTotal.toLocaleString("ko-KR")} KRW보다 작습니다.`);
    }
    if (constraints.maxTotal !== null && constraints.maxTotal > 0 && estimatedValue > constraints.maxTotal) {
      blockers.push(`최대 주문금액 ${constraints.maxTotal.toLocaleString("ko-KR")} KRW를 초과했습니다.`);
    }
    if (constraints.priceUnit === null || constraints.priceUnit <= 0) {
      blockers.push("거래소 호가 단위를 확인하지 못했습니다.");
    } else {
      const unitRatio = price / constraints.priceUnit;
      if (Math.abs(unitRatio - Math.round(unitRatio)) > 1e-8) {
        blockers.push(`지정가는 호가 단위 ${constraints.priceUnit.toLocaleString("ko-KR")} KRW에 맞아야 합니다.`);
      }
    }
    if (constraints.feeRate === null || constraints.feeRate < 0) {
      blockers.push("거래소 수수료율을 확인하지 못했습니다.");
    }
    const estimatedBuyCost = estimatedValue * (1 + Math.max(constraints.feeRate ?? 0, 0));
    if (side === "bid" && estimatedBuyCost > quoteBalance) {
      blockers.push(`${quoteCurrency} 주문 가능 잔고가 부족합니다.`);
    }
    if (side === "ask" && volume > baseBalance) {
      blockers.push(`${baseCurrency} 주문 가능 수량이 부족합니다.`);
    }
    const orderPreview = previewCryptoLimitOrder({
      exchange,
      market,
      side,
      volume: String(volume),
      price: String(price),
      identifier: `${exchange}-${crypto.randomUUID()}`,
    });
    return jsonResponse({
      generatedAt: new Date().toISOString(),
      exchange,
      market,
      passed: blockers.length === 0,
      blockers,
      balances: { quoteCurrency, quoteBalance, baseCurrency, baseBalance },
      estimatedValue,
      estimatedBuyCost,
      orderChanceVerified: chanceAvailable,
      orderConstraints: constraints,
      ticker: {
        market: ticker.market,
        tradePrice: ticker.tradePrice,
        ...quote,
        lastTradeTimestamp: ticker.tradeTimestamp
          ? new Date(ticker.tradeTimestamp).toISOString()
          : null,
      },
      orderPreview,
      orderSubmissionAttempted: false,
    });
  } catch (error) {
    return jsonResponse({
      error: `${exchange} 주문 사전검증 실패: ${errorMessage(error)}`,
      orderSubmissionAttempted: false,
    }, { status: 502 });
  }
};

const deleteBrokerCredential = async () => {
  const userId = localUserId();
  await deleteBrokerCredentials(userId, "toss");
  await deleteBrokerAccountPreference(userId, "toss");
  await Promise.all([
    revokeAutomationFeature(userId, "broker_credentials"),
    revokeAutomationFeature(userId, "live_trading"),
  ]);
  return jsonResponse({ ok: true });
};

const updateBrokerAccountPreference = async (request: Request) => {
  const payload = await readJsonBody(request);
  const accountSeq = Number(payload.accountSeq);
  if (!Number.isInteger(accountSeq) || accountSeq <= 0) {
    return jsonResponse({ error: "accountSeq 양의 정수가 필요합니다." }, { status: 400 });
  }

  const userId = localUserId();
  const credential = await getBrokerCredentialView(userId, "toss");
  if (credential?.status !== "verified") {
    return jsonResponse({ error: "검증 완료된 Toss API 키가 필요합니다." }, { status: 412 });
  }
  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return jsonResponse({ error: "저장된 Toss API 키를 복호화하지 못했습니다." }, { status: 412 });
  }

  const accounts = await createTossClient(credentials).listAccounts();
  const selected = accounts.find((account) => account.accountSeq === accountSeq);
  if (!selected) {
    return jsonResponse({ error: "현재 Toss 계좌 목록에서 선택한 accountSeq를 찾지 못했습니다." }, { status: 404 });
  }
  if (selected.accountType !== "BROKERAGE") {
    return jsonResponse({ error: "자동거래 계좌는 BROKERAGE 계좌여야 합니다." }, { status: 400 });
  }

  const accountPreference = await saveBrokerAccountPreference({
    userId,
    accountSeq: selected.accountSeq,
    accountNo: maskAccountNo(selected.accountNo),
    accountType: selected.accountType,
  });
  return jsonResponse({
    credential,
    accounts: accounts.map(toAccountView),
    accountPreference,
    accountsError: null,
  });
};

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const strategyReadiness = async (config: AutomationStrategyConfig) => {
  const userId = config.userId || localUserId();
  const currentConfigHash = getStrategyConfigHash(config);
  const simulation = config.lastSimulation;
  const simulationCurrent = !!simulation && simulation.configHash === currentConfigHash;
  const simulationPassed = simulationCurrent && simulation.passed;
  const isCrypto = config.market === "CRYPTO";
  const cryptoVenue: CryptoExchange = config.executionVenue === "bithumb" ? "bithumb" : "upbit";
  const venue = isCrypto
    ? cryptoVenue
    : "toss";
  const venueLabel = isCrypto ? (venue === "bithumb" ? "Bithumb" : "Upbit") : "Toss";
  const [killSwitch, workerControl, credential, accountPreference, liveGate] = await Promise.all([
    getAutomationKillSwitchState(),
    getAutomationWorkerControlState(),
    getBrokerCredentialView(userId, venue),
    isCrypto ? Promise.resolve(null) : getBrokerAccountPreference(userId, "toss"),
    getLiveTradingGate(userId),
  ]);
  const cryptoLiveGate = isCrypto ? await getCryptoLiveTradingGate(userId, cryptoVenue) : null;
  const credentialVerified = credential?.status === "verified";
  const accountPreferenceSelected = isCrypto ? true : !!accountPreference;
  const blockers: string[] = [];
  const liveBlockers: string[] = [];
  const nextActions: string[] = [];

  if (!simulation) {
    blockers.push("전략 시뮬레이션을 먼저 실행하세요.");
    nextActions.push("전략 카드에서 시뮬레이션을 실행하세요.");
  } else if (!simulationCurrent) {
    blockers.push("전략 설정이 마지막 시뮬레이션 이후 변경되었습니다.");
    nextActions.push("변경된 설정으로 다시 시뮬레이션하세요.");
  } else if (!simulation.passed) {
    blockers.push(...(simulation.blockers.length ? simulation.blockers : ["시뮬레이션이 통과되지 않았습니다."]));
    nextActions.push("시뮬레이션 차단 사유를 해결한 뒤 다시 실행하세요.");
  }
  if (killSwitch.engaged) {
    blockers.push("긴급 중지가 켜져 있어 자동화 큐가 차단됩니다.");
    nextActions.push("우측 안전 게이트에서 긴급 중지를 해제하세요.");
  }
  if (workerControl.paused) {
    blockers.push("워커 일시중지 상태라 자동화 큐가 차단됩니다.");
    nextActions.push("워커를 재개한 뒤 자동화 큐를 실행하세요.");
  }
  if (!credentialVerified) {
    liveBlockers.push(`검증 완료된 ${venueLabel} API 키가 없습니다.`);
    nextActions.push(isCrypto ? "코인 설정에서 거래소 API 키를 등록하고 검증하세요." : "Toss 설정에서 API 키를 등록하고 검증하세요.");
  }
  if (!isCrypto && !accountPreferenceSelected) {
    liveBlockers.push("자동거래에 사용할 Toss 계좌가 선택되지 않았습니다.");
    nextActions.push("Toss 설정에서 자동거래 계좌를 선택하세요.");
  }
  if (isCrypto && cryptoLiveGate?.effective !== true) {
    liveBlockers.push(cryptoLiveGate?.reason ?? "코인 실거래 게이트가 닫혀 있습니다.");
    nextActions.push("코인 설정에서 실거래 게이트와 거래소 API 키 상태를 확인하세요.");
  } else if (!isCrypto && liveGate.status !== 200) {
    liveBlockers.push(liveGate.reason ?? "실거래 live gate가 닫혀 있습니다.");
    nextActions.push("ENABLE_LIVE_TRADING, 사용자 실거래 토글, 권한 상태를 확인하세요.");
  }

  const paperAutomationReady = simulationPassed && !killSwitch.engaged && !workerControl.paused;
  const liveSubmissionReady = paperAutomationReady &&
    credentialVerified &&
    accountPreferenceSelected &&
    (isCrypto ? cryptoLiveGate?.effective === true : liveGate.status === 200);

  return {
    simulationCurrent,
    simulationPassed,
    paperAutomationReady,
    liveSubmissionReady,
    killSwitchEngaged: killSwitch.engaged,
    workerPaused: workerControl.paused,
    credentialVerified,
    accountPreferenceSelected,
    liveGateStatus: isCrypto ? cryptoLiveGate?.status ?? 503 : liveGate.status,
    liveGateReason: isCrypto ? cryptoLiveGate?.reason ?? null : liveGate.reason,
    blockers,
    liveBlockers,
    nextActions: [...new Set(nextActions)],
  };
};

const strategyResponse = async (config: AutomationStrategyConfig) => ({
  ...config,
  instrument: await resolveInstrumentDisplay({
    symbol: config.symbol,
    market: config.market,
  }),
  currentConfigHash: getStrategyConfigHash(config),
  automationReadiness: await strategyReadiness(config),
});

const strategyExportConfig = (config: AutomationStrategyConfig) => ({
  sourceId: config.id,
  name: config.name,
  symbol: config.symbol,
  market: config.market,
  executionVenue: config.executionVenue,
  preset: config.preset,
  mode: config.mode ?? "ladder",
  orderSizing: config.orderSizing,
  supportPrice: config.supportPrice,
  resistancePrice: config.resistancePrice,
  currentPrice: config.currentPrice,
  ladder: config.ladder,
  grid: config.grid,
  loop: config.loop,
  priceAnchor: config.priceAnchor,
  riskLimits: config.riskLimits,
  exitRules: config.exitRules,
});

const exportLocalStrategyConfigs = async () => {
  await ensureLocalAutomationAccess();
  await cleanupInternalSelfTestStrategies(localUserId());
  const configs = await listStrategyConfigs(localUserId());
  return jsonResponse({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    source: "StockAnalysis macOS local-engine",
    configCount: configs.length,
    safety: {
      credentialsIncluded: false,
      accountPreferenceIncluded: false,
      importedStatus: "draft",
      importedSimulation: "discarded",
    },
    configs: configs.map(strategyExportConfig),
  });
};

const importLocalStrategyConfigs = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const payload = await readJsonBody(request);
  const schemaVersion = Number(payload.schemaVersion ?? 1);
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    return jsonResponse({ error: `지원하지 않는 전략 백업 schemaVersion입니다: ${schemaVersion}` }, { status: 400 });
  }
  const rawConfigs = Array.isArray(payload.configs) ? payload.configs : [];
  if (rawConfigs.length === 0) {
    return jsonResponse({ error: "가져올 전략 configs 배열이 필요합니다." }, { status: 400 });
  }
  const imported: AutomationStrategyConfig[] = [];
  const errors: Array<{ index: number; errors: string[] }> = [];
  for (const [index, rawConfig] of rawConfigs.slice(0, 50).entries()) {
    const row = typeof rawConfig === "object" && rawConfig !== null ? rawConfig as Record<string, unknown> : {};
    const parsed = {
      ...parseStrategyConfigPayload({
        ...row,
        orderSizing: schemaVersion === 1 ? undefined : row.orderSizing,
        id: `imported-${crypto.randomUUID()}`,
        status: "draft",
        lastSimulation: undefined,
      }, localUserId()),
      status: "draft" as const,
      lastSimulation: undefined,
    };
    const validationErrors = validateStrategyConfig(parsed);
    if (validationErrors.length) {
      errors.push({ index, errors: validationErrors });
      continue;
    }
    const saved = await upsertStrategyConfig(localUserId(), parsed, { preserveNewId: true });
    imported.push(saved);
  }
  if (imported.length === 0) {
    return jsonResponse({
      error: "가져온 전략이 없습니다. 전략 설정 값을 확인하세요.",
      errors,
    }, { status: 400 });
  }
  return jsonResponse({
    ok: true,
    schemaVersion,
    imported: imported.length,
    skipped: Math.max(rawConfigs.length - imported.length, 0),
    status: "draft",
    safety: {
      enabledStrategiesImported: 0,
      lastSimulationDiscarded: true,
      liveTradingChanged: false,
    },
    configs: await Promise.all(imported.map(strategyResponse)),
    errors,
  });
};

const ensureLocalAutomationAccess = async () => {
  await grantAutomationFeature(localUserId(), "automation_beta");
};

const findActivationBlocker = async (config: AutomationStrategyConfig) => {
  const userId = localUserId();
  const currentHash = getStrategyConfigHash(config);
  const simulation = config.lastSimulation;
  if (!simulation) {
    return {
      status: 428,
      error: "전략을 활성화하려면 먼저 시뮬레이션을 실행하세요.",
    };
  }
  if (simulation.configHash !== currentHash) {
    return {
      status: 409,
      error: "전략 설정이 마지막 시뮬레이션 이후 변경되었습니다. 다시 시뮬레이션하세요.",
    };
  }
  if (!simulation.passed) {
    return {
      status: 428,
      error: simulation.blockers[0] ?? "시뮬레이션이 통과되지 않아 전략을 활성화할 수 없습니다.",
      errors: simulation.blockers,
    };
  }

  const configs = await listStrategyConfigs(userId);
  const duplicate = configs.find(
    (entry) =>
      entry.id !== config.id &&
      entry.status === "enabled" &&
      entry.market === config.market &&
      entry.executionVenue === config.executionVenue &&
      normalizeSymbol(entry.symbol) === normalizeSymbol(config.symbol),
  );
  if (duplicate) {
    return {
      status: 409,
      error: `이미 활성화된 동일 종목 전략이 있습니다: ${duplicate.name}`,
    };
  }
  return null;
};

const listLocalStrategyConfigs = async () => {
  await ensureLocalAutomationAccess();
  await cleanupInternalSelfTestStrategies(localUserId());
  const configs = await listStrategyConfigs(localUserId());
  return jsonResponse({ configs: await Promise.all(configs.map(strategyResponse)) });
};

const createLocalStrategyConfig = async (request: Request) => {
  await ensureLocalAutomationAccess();
  const payload = await readJsonBody(request);
  const parsed = {
    ...parseStrategyConfigPayload(payload, localUserId()),
    status: "draft" as const,
    lastSimulation: undefined,
  };
  const errors = validateStrategyConfig(parsed);
  if (errors.length) {
    return jsonResponse({ error: errors.join(" "), errors }, { status: 400 });
  }

  const config = await upsertStrategyConfig(localUserId(), parsed);
  return jsonResponse({ config: await strategyResponse(config) }, { status: 201 });
};

const updateLocalStrategyConfig = async (request: Request, id: string) => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const existing = await findStrategyConfig(userId, id);
  if (!existing) {
    return jsonResponse({ error: "전략을 찾을 수 없습니다." }, { status: 404 });
  }
  const payload = await readJsonBody(request);
  const existingHash = getStrategyConfigHash(existing);
  const parsed = parseStrategyConfigPayload({ ...existing, ...payload, id }, userId, id);
  const changedTradingConfig = getStrategyConfigHash(parsed) !== existingHash;
  const requestedStatus = payload.status === "enabled" || payload.status === "disabled"
    ? payload.status
    : changedTradingConfig ? "draft" : existing.status;
  const nextConfig = changedTradingConfig
    ? {
      ...parsed,
      status: requestedStatus === "enabled" ? "enabled" as const : requestedStatus === "disabled" ? "disabled" as const : "draft" as const,
      lastSimulation: undefined,
    }
    : {
      ...parsed,
      status: requestedStatus,
      lastSimulation: existing.lastSimulation,
    };
  const errors = validateStrategyConfig(nextConfig);
  if (errors.length) {
    return jsonResponse({ error: errors.join(" "), errors }, { status: 400 });
  }
  if (nextConfig.status === "enabled") {
    const blocker = await findActivationBlocker(nextConfig);
    if (blocker) {
      return jsonResponse(blocker, { status: blocker.status });
    }
  }

  const config = await upsertStrategyConfig(userId, nextConfig);
  return jsonResponse({ config: await strategyResponse(config) });
};

const deleteLocalStrategyConfig = async (id: string) => {
  await ensureLocalAutomationAccess();
  await deleteStrategyConfig(localUserId(), id);
  return jsonResponse({ ok: true });
};

const simulateLocalStrategyConfig = async (id: string) => {
  await ensureLocalAutomationAccess();
  const userId = localUserId();
  const config = await findStrategyConfig(userId, id);
  if (!config) {
    return jsonResponse({ error: "전략을 찾을 수 없습니다." }, { status: 404 });
  }

  const result = simulateAutomationStrategy({ userId, config });
  await saveAutomationSimulation(userId, result);
  const saved = await upsertStrategyConfig(userId, {
    ...config,
    lastSimulation: toAutomationLastSimulation(result),
  });
  return jsonResponse({
    result,
    config: await strategyResponse(saved),
  });
};

const callRoute = async (request: Request, pathname: string) => {
  if (pathname === "/api/briefing/daily-market") {
    const { GET } = await import("../src/app/api/briefing/daily-market/route.ts");
    return GET(request);
  }
  const marketMatch = pathname.match(/^\/api\/market\/([^/]+)$/);
  if (marketMatch?.[1]) {
    const { GET } = await import("../src/app/api/market/[symbol]/route.ts");
    return GET(request, { params: { symbol: decodeURIComponent(marketMatch[1]) } });
  }
  throw new Error(`Unsupported route: ${pathname}`);
};

const localChartResponse = async (request: Request, url: URL) => {
  const assetClass = url.searchParams.get("assetClass");
  const symbol = url.searchParams.get("symbol")?.trim();
  const timeframe = url.searchParams.get("tf");
  if (!symbol) {
    return jsonResponse({ error: "symbol is required" }, { status: 400 });
  }
  if (!LOCAL_CHART_TIMEFRAMES.includes(timeframe as typeof LOCAL_CHART_TIMEFRAMES[number])) {
    return jsonResponse({ error: "Unsupported chart timeframe." }, { status: 400 });
  }
  const selectedTimeframe = timeframe as typeof LOCAL_CHART_TIMEFRAMES[number];
  if (assetClass !== "stock" && assetClass !== "crypto") {
    return jsonResponse({ error: "assetClass must be stock or crypto" }, { status: 400 });
  }
  if (assetClass === "crypto") {
    return handleLocalCryptoChartRequest(url);
  }
  if (process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE === "1") {
    return fixtureLocalChartResponse({ symbol, assetClass, timeframe: selectedTimeframe });
  }
  const daysByTimeframe: Record<typeof selectedTimeframe, number> = {
    "5m": 7,
    "15m": 14,
    "30m": 30,
    "1h": 60,
    "4h": 180,
    "1d": 365,
    "1wk": 365 * 3,
  };
  const chartUrl = new URL(`/api/market/${encodeURIComponent(symbol)}`, url.origin);
  chartUrl.searchParams.set("days", String(daysByTimeframe[selectedTimeframe]));
  chartUrl.searchParams.set("tf", selectedTimeframe);
  return callRoute(new Request(chartUrl, { headers: request.headers }), chartUrl.pathname);
};

const parseCommunityBoolean = (value: string | null) =>
  value === "1" || value?.toLowerCase() === "true";

const parseCommunitySources = (value: string | null): CommunitySourceId[] | undefined => {
  if (!value) {
    return undefined;
  }
  const sources = value
    .split(",")
    .map((source) => source.trim() as CommunitySourceId)
    .filter((source) => COMMUNITY_SOURCE_IDS.has(source));
  return sources.length > 0 ? sources : undefined;
};

const sweepLocalCommunityCache = (now: number) => {
  for (const [key, value] of localCommunityCache.entries()) {
    if (value.expiresAt <= now || localCommunityCache.size > COMMUNITY_CACHE_MAX_ENTRIES) {
      localCommunityCache.delete(key);
    }
  }
};

const localCommunityPainResponse = async (url: URL, encodedSymbol: string) => {
  const symbol = decodeURIComponent(encodedSymbol).trim();
  if (!symbol || symbol.length > 32) {
    return jsonResponse({ error: "유효한 종목 코드가 필요합니다." }, { status: 400 });
  }
  const market = (url.searchParams.get("market") || "US").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,12}$/.test(market)) {
    return jsonResponse({ error: "유효한 market 값이 필요합니다." }, { status: 400 });
  }
  const includeBroad = parseCommunityBoolean(url.searchParams.get("broad"));
  const includeSpikeSources = parseCommunityBoolean(url.searchParams.get("spike"));
  const forceRefresh = parseCommunityBoolean(url.searchParams.get("refresh"));
  const requestedSources = parseCommunitySources(url.searchParams.get("sources"));
  const requestedLimit = Number(url.searchParams.get("limit") ?? 60);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.round(requestedLimit), 20), 250)
    : 60;
  const cacheKey = JSON.stringify({
    symbol: symbol.toUpperCase(),
    market,
    includeBroad,
    includeSpikeSources,
    requestedSources,
    limit,
  });
  const now = Date.now();
  sweepLocalCommunityCache(now);
  const cached = localCommunityCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return jsonResponse(cached.payload);
  }
  try {
    let pending = localCommunityInFlight.get(cacheKey);
    if (!pending) {
      pending = getCommunityPain({
        symbol,
        market,
        includeBroad,
        includeSpikeSources,
        requestedSources,
        limit,
      });
      localCommunityInFlight.set(cacheKey, pending);
    }
    const payload = await pending;
    const hasTransientFailure = payload.sourceStats.some((source) =>
      source.status === "error" || source.timedOut
    );
    const ttlSeconds = hasTransientFailure
      ? COMMUNITY_TRANSIENT_FAILURE_CACHE_TTL_SECONDS
      : COMMUNITY_CACHE_TTL_SECONDS;
    localCommunityCache.set(cacheKey, {
      expiresAt: Date.now() + ttlSeconds * 1_000,
      payload,
    });
    return jsonResponse(payload);
  } catch {
    return jsonResponse({ error: "커뮤니티 민심 데이터를 계산하지 못했습니다." }, { status: 500 });
  } finally {
    localCommunityInFlight.delete(cacheKey);
  }
};

export const handleLocalEngineRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      const tossOpenApi = tossOpenApiContractSummary();
      return jsonResponse({
        ok: true,
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        generatedAt: new Date().toISOString(),
        storageRoot: process.env.STOCK_ANALYSIS_STORAGE_ROOT ?? null,
        localUserId: localUserId(),
        pid: process.pid,
        workingDirectory: process.cwd(),
        sidecarBuildId: process.env.STOCK_ANALYSIS_SIDECAR_BUILD_ID ?? null,
        tossOpenApi: {
          specVersion: tossOpenApi.specVersion,
          baseUrl: tossOpenApi.baseUrl,
          requiredOperationCount: tossOpenApi.requiredOperationCount,
          accountHeaderOperationCount: tossOpenApi.accountHeaderOperationCount,
        },
      });
    }
    if (request.method === "GET" && (url.pathname === "/api/briefing/daily-market" || /^\/api\/market\/[^/]+$/.test(url.pathname))) {
      return callRoute(request, url.pathname);
    }
    if (request.method === "GET" && url.pathname === "/api/automation/health") {
      return jsonResponse(await getAutomationHealthSnapshot());
    }
    if (request.method === "GET" && url.pathname === "/api/local/self-test") {
      return localSelfTest();
    }
    if (request.method === "GET" && url.pathname === "/api/local/analysis/workspace") {
      return handleMarketWorkspaceRequest(request, {
        userId: localUserId(),
        dependencies: process.env.STOCK_ANALYSIS_MARKET_FIXTURE_MODE === "1"
          ? createMarketWorkspaceFixtureDependencies()
          : undefined,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/local/chart") {
      return localChartResponse(request, url);
    }
    if (request.method === "GET" && url.pathname === "/api/paper-trading/state") {
      return getPaperTradingStateResponse();
    }
    if (request.method === "POST" && url.pathname === "/api/paper-trading/reset") {
      return resetPaperTradingStateResponse();
    }
    if (request.method === "POST" && url.pathname === "/api/paper-trading/run") {
      return runPaperTrading(request);
    }
    if (request.method === "POST" && url.pathname === "/api/paper-trading/order-intent") {
      return submitPaperOrderIntent(request);
    }
    if (request.method === "POST" && url.pathname === "/api/automation/cycle") {
      return runAutomation(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/automation/scheduler") {
      return localAutomationSchedulerState();
    }
    if (request.method === "PUT" && url.pathname === "/api/local/automation/scheduler") {
      return updateLocalAutomationScheduler(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/symbol-search") {
      return searchLocalSymbols(url);
    }
    if (request.method === "GET" && url.pathname === "/api/local/watchlist") {
      return jsonResponse(await listWatchlist());
    }
    if (request.method === "POST" && url.pathname === "/api/local/watchlist") {
      return jsonResponse(await addWatchlistItem(await readJsonBody(request)), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/api/local/watchlist/summary") {
      return jsonResponse(await getWatchlistSummary());
    }
    const watchlistItemMatch = url.pathname.match(/^\/api\/local\/watchlist\/([^/]+)$/);
    if (request.method === "DELETE" && watchlistItemMatch?.[1]) {
      return jsonResponse(await removeWatchlistItem(decodeURIComponent(watchlistItemMatch[1])));
    }
    if (request.method === "GET" && url.pathname === "/api/local/crypto-exchanges") {
      return cryptoCredentialState();
    }
    const cryptoCredentialMatch = url.pathname.match(/^\/api\/local\/crypto-exchanges\/(upbit|bithumb)\/credentials$/);
    if (cryptoCredentialMatch && isCryptoExchange(cryptoCredentialMatch[1])) {
      if (request.method === "POST") {
        return registerCryptoCredential(cryptoCredentialMatch[1], request);
      }
      if (request.method === "DELETE") {
        return deleteCryptoCredential(cryptoCredentialMatch[1]);
      }
    }
    const cryptoReadinessMatch = url.pathname.match(/^\/api\/local\/crypto-exchanges\/(upbit|bithumb)\/readiness$/);
    if (request.method === "GET" && cryptoReadinessMatch && isCryptoExchange(cryptoReadinessMatch[1])) {
      return cryptoReadiness(cryptoReadinessMatch[1], url.searchParams.get("market")?.toUpperCase() || "KRW-BTC");
    }
    const cryptoPrecheckMatch = url.pathname.match(/^\/api\/local\/crypto-exchanges\/(upbit|bithumb)\/orders\/precheck$/);
    if (request.method === "POST" && cryptoPrecheckMatch && isCryptoExchange(cryptoPrecheckMatch[1])) {
      return cryptoOrderPrecheck(cryptoPrecheckMatch[1], request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/orders/sync") {
      return jsonResponse(await localOrderSyncSnapshot());
    }
    if (request.method === "POST" && url.pathname === "/api/local/orders/sync") {
      return localOrderSync(request);
    }
    if (request.method === "POST" && url.pathname === "/api/local/orders/precheck") {
      return localOrderPrecheck(request);
    }
    if (request.method === "POST" && url.pathname === "/api/local/live-orders/submit") {
      return localLiveOrderSubmit(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/holdings") {
      return localHoldings(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/broker/credentials") {
      return brokerAccountPreferenceState();
    }
    if (request.method === "GET" && url.pathname === "/api/local/broker/account-preference") {
      return brokerAccountPreferenceState();
    }
    if (request.method === "PUT" && url.pathname === "/api/local/broker/account-preference") {
      return updateBrokerAccountPreference(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/live-trading") {
      return localLiveTradingState();
    }
    if (request.method === "PUT" && url.pathname === "/api/local/live-trading") {
      return updateLocalLiveTrading(request);
    }
    if (request.method === "POST" && url.pathname === "/api/local/live-trading/qa") {
      return approveLocalLiveTradingQa(request);
    }
    if (request.method === "PUT" && url.pathname === "/api/local/live-trading/automation") {
      return updateLocalAutomationLiveTrading(request);
    }
    if (request.method === "POST" && url.pathname === "/api/local/live-trading/safety-proof") {
      return verifyLocalLiveTradingSafetyGates();
    }
    if (request.method === "GET" && url.pathname === "/api/local/kill-switch") {
      return localKillSwitchState();
    }
    if (request.method === "PUT" && url.pathname === "/api/local/kill-switch") {
      return updateLocalKillSwitch(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/worker-control") {
      return localWorkerControlState();
    }
    if (request.method === "PUT" && url.pathname === "/api/local/worker-control") {
      return updateLocalWorkerControl(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/broker/diagnostics") {
      return brokerDiagnostics(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/toss/readiness") {
      return localTossReadiness(request);
    }
    if (request.method === "GET" && url.pathname === "/api/local/toss/openapi-contract") {
      return jsonResponse({
        generatedAt: new Date().toISOString(),
        ...tossOpenApiContractSummary(),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/local/broker/credentials") {
      return registerBrokerCredentials(request);
    }
    if (request.method === "DELETE" && url.pathname === "/api/local/broker/credentials") {
      return deleteBrokerCredential();
    }
    if (request.method === "GET" && url.pathname === "/api/local/strategy-configs") {
      return listLocalStrategyConfigs();
    }
    if (request.method === "GET" && url.pathname === "/api/local/strategy-configs/export") {
      return exportLocalStrategyConfigs();
    }
    if (request.method === "POST" && url.pathname === "/api/local/strategy-configs/import") {
      return importLocalStrategyConfigs(request);
    }
    if (request.method === "POST" && url.pathname === "/api/local/strategy-configs") {
      return createLocalStrategyConfig(request);
    }
    const strategyTickPreviewMatch = url.pathname.match(/^\/api\/local\/strategy-configs\/([^/]+)\/tick-preview$/);
    if (request.method === "POST" && strategyTickPreviewMatch?.[1]) {
      return previewLocalStrategyTick(request, decodeURIComponent(strategyTickPreviewMatch[1]));
    }
    const strategySimulationMatch = url.pathname.match(/^\/api\/local\/strategy-configs\/([^/]+)\/simulate$/);
    if (request.method === "POST" && strategySimulationMatch?.[1]) {
      return simulateLocalStrategyConfig(decodeURIComponent(strategySimulationMatch[1]));
    }
    const strategyMatch = url.pathname.match(/^\/api\/local\/strategy-configs\/([^/]+)$/);
    if (request.method === "PUT" && strategyMatch?.[1]) {
      return updateLocalStrategyConfig(request, decodeURIComponent(strategyMatch[1]));
    }
    if (request.method === "DELETE" && strategyMatch?.[1]) {
      return deleteLocalStrategyConfig(decodeURIComponent(strategyMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/api/news/events") {
      const result = await pollOfficialNews();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);
      return jsonResponse({
        ...result,
        events: result.events.slice(0, limit),
      });
    }
    const communityPainMatch = url.pathname.match(/^\/api\/community-pain\/([^/]+)$/);
    if (request.method === "GET" && communityPainMatch?.[1]) {
      return localCommunityPainResponse(url, communityPainMatch[1]);
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard/terminal") {
      return jsonResponse(await buildTerminalDashboardSnapshot({
        userId: localUserId(),
        symbol: url.searchParams.get("symbol") ?? "NVDA",
        session: url.searchParams.get("session"),
      }));
    }
    if (request.method === "POST" && url.pathname === "/api/dashboard/playbook") {
      return jsonResponse(await saveTerminalDashboardPlaybook({
        symbol: url.searchParams.get("symbol") ?? "NVDA",
        payload: await readJsonBody(request),
      }));
    }
    return jsonResponse({ error: "not found" }, { status: 404 });
  } catch (error) {
    return errorResponse(error, error instanceof WatchlistRequestError ? error.status : 500);
  }
};

const writeNodeResponse = async (response: Response, outgoing: ServerResponse) => {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
};

const readIncomingBody = async (incoming: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const toRequestHeaders = (incoming: IncomingMessage) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
};

const logLocalEngineRequest = ({
  method,
  path,
  status,
  durationMs,
}: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}) => {
  if (path === "/health") {
    return;
  }
  const message = `[local-engine] ${method} ${path} -> ${status} ${durationMs}ms`;
  if (status >= 500) {
    console.error(message);
    return;
  }
  if (status >= 400) {
    console.warn(message);
    return;
  }
  console.log(message);
};

export const startLocalEngineServer = async (port = DEFAULT_PORT, hostname = "127.0.0.1") => {
  const server = createServer(async (incoming, outgoing) => {
    const startedAt = Date.now();
    const method = incoming.method ?? "GET";
    const url = new URL(`http://${hostname}:${port}${incoming.url ?? "/"}`);
    let status = 500;
    try {
      const body = method === "GET" || method === "HEAD"
        ? undefined
        : await readIncomingBody(incoming);
      const request = new Request(url, {
        method,
        headers: toRequestHeaders(incoming),
        body,
      });
      const response = await handleLocalEngineRequest(request);
      status = response.status;
      await writeNodeResponse(response, outgoing);
    } catch (error) {
      const response = errorResponse(error);
      status = response.status;
      await writeNodeResponse(response, outgoing);
    } finally {
      logLocalEngineRequest({
        method,
        path: url.pathname,
        status,
        durationMs: Date.now() - startedAt,
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const scheduler = new LocalAutomationScheduler(automationSchedulerCycle);
  localAutomationScheduler?.stop();
  localAutomationScheduler = scheduler;
  server.once("close", () => {
    scheduler.stop();
    if (localAutomationScheduler === scheduler) {
      localAutomationScheduler = null;
    }
  });
  await scheduler.start();
  return server;
};

const argValue = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const main = async () => {
  const port = Number(argValue("port") ?? process.env.STOCK_ANALYSIS_LOCAL_ENGINE_PORT ?? DEFAULT_PORT);
  const server = await startLocalEngineServer(port);
  console.log(`${ENGINE_NAME} listening on http://127.0.0.1:${port}`);
  const close = () => {
    server.close();
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
