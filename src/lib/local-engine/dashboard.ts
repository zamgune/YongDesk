import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PaperTradingState,
} from "@/domain/paper-trading";
import type { Currency } from "@/domain/portfolio";
import type { RiskCheckResult } from "@/domain/trading";
import type { MarketCandle } from "@/lib/market-data";
import { DEFAULT_OFFICIAL_NEWS_SOURCES, readStoredNewsEvents, type LocalNewsEvent } from "@/lib/local-engine/news";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { getMarketDataProvider } from "@/lib/market-data";
import { getPaperTradingStorageRootForUser, readPaperTradingState } from "@/lib/paper-trading/state-store";
import { createOrderIntent } from "@/use-cases/trading/create-order-intent";

export type DashboardSession = "US" | "KR";

export type TerminalDashboardSnapshot = {
  generatedAt: string;
  symbol: string;
  session: DashboardSession;
  orderIntent: {
    id: string;
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit" | "stop-limit";
    quantity: number;
    limitPrice: number | null;
    stopPrice: number | null;
    currency: Currency;
    status: string;
    rationale: string[];
    createdAt: string;
  };
  riskCheck: RiskCheckResult;
  auditTrail: DashboardAuditEntry[];
  riskScenarios: RiskScenario[];
  watchlistAlerts: WatchlistAlertRule[];
  watchlistAlertEvaluations: WatchlistAlertEvaluation[];
  newsCredibility: NewsCredibilityScore[];
  preTradeChecklist: PreTradeChecklistItem[];
  replayEvents: ReplayEvent[];
  playbook: PositionPlaybook;
};

export type DashboardAuditEntry = {
  id: string;
  createdAt: string;
  symbol: string;
  type: "intent-created" | "quote-snapshot" | "news-evidence" | "risk-check" | "operator-action" | "live-gate";
  title: string;
  detail: string;
  state: "ok" | "blocked" | "warning" | "stored";
  orderIntentId?: string;
};

export type RiskScenario = {
  id: string;
  label: string;
  shock: string;
  estimatedPnl: number;
  severity: "low" | "medium" | "high";
};

export type WatchlistAlertRule = {
  id: string;
  scope: "momentum" | "position-risk" | "news" | "earnings";
  title: string;
  detail: string;
  enabled: boolean;
  priority: "normal" | "high" | "urgent";
  cooldownMinutes: number;
};

export type WatchlistAlertEvaluation = {
  id: string;
  ruleId: string;
  scope: WatchlistAlertRule["scope"];
  symbol: string;
  triggered: boolean;
  state: "triggered" | "clear" | "blocked" | "limited";
  priority: WatchlistAlertRule["priority"];
  evaluatedAt: string;
  title: string;
  detail: string;
  evidence: string[];
};

export type NewsCredibilityScore = {
  sourceId: string;
  sourceName: string;
  grade: "A" | "B" | "C" | "D";
  score: number;
  allowedForOrderInput: boolean;
  rationale: string;
};

export type PreTradeChecklistItem = {
  id: string;
  title: string;
  detail: string;
  status: "pass" | "warn" | "block";
};

export type ReplayEvent = {
  id: string;
  occurredAt: string;
  symbol: string;
  kind: "candle" | "news" | "signal" | "risk-check" | "paper-order" | "paper-execution" | "live-gate";
  title: string;
  detail: string;
};

export type PositionPlaybook = {
  symbol: string;
  thesis: string;
  entryRule: string;
  invalidationRule: string;
  addRule: string;
  trimRule: string;
  target: string;
  workerMode: "paper-only" | "manual-approval" | "disabled";
  updatedAt: string;
};

type DashboardStore = {
  auditTrail: DashboardAuditEntry[];
  watchlistAlerts: WatchlistAlertRule[];
  replayEvents: ReplayEvent[];
  playbooks: Record<string, PositionPlaybook>;
};

type MarketSnapshot = {
  source: "market-data" | "unavailable";
  candles: MarketCandle[];
  latestPrice: number;
  previousClose: number | null;
  latestVolume: number | null;
  averageVolume20: number | null;
  volumeRatio: number | null;
  fetchedAt: string;
  error?: string;
};

const DASHBOARD_STORE_PATH = stockAnalysisStoragePath("dashboard", "terminal-dashboard.json");
const MAX_AUDIT_ENTRIES = 300;
const MAX_REPLAY_EVENTS = 300;

const normalizeSymbol = (symbol: string) =>
  symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 16) || "NVDA";

const normalizeSession = (session: string | null): DashboardSession =>
  session === "KR" ? "KR" : "US";

const defaultReferencePrice = (symbol: string) => {
  const prices: Record<string, number> = {
    NVDA: 181.8,
    TSLA: 315.18,
    AAPL: 246.03,
    MSFT: 501.62,
    AMD: 164.22,
    META: 712.8,
    PLTR: 142.31,
    SPY: 628.1,
  };
  return prices[symbol] ?? 100;
};

const SYMBOL_ALIASES: Record<string, string[]> = {
  AAPL: ["aapl", "apple"],
  AMD: ["amd", "advanced micro devices"],
  AVGO: ["avgo", "broadcom"],
  COIN: ["coin", "coinbase"],
  META: ["meta", "meta platforms", "facebook"],
  MSFT: ["msft", "microsoft"],
  NVDA: ["nvda", "nvidia"],
  PLTR: ["pltr", "palantir"],
  TSLA: ["tsla", "tesla"],
};

const EARNINGS_RISK_PATTERN = /\b(earnings?|results?|quarterly|quarter|guidance|revenue|eps|profit|10-q|10-k|8-k|form 10|annual report)\b/i;

const newsText = (event: LocalNewsEvent) =>
  `${event.title} ${event.summary} ${event.tags.join(" ")} ${event.tickers.join(" ")}`.toLowerCase();

const eventMentionsSymbol = (symbol: string, event: LocalNewsEvent) => {
  if (event.tickers.includes(symbol)) {
    return true;
  }
  const text = newsText(event);
  return (SYMBOL_ALIASES[symbol] ?? [symbol.toLowerCase()])
    .some((alias) => text.includes(alias));
};

const isRecentEvent = (now: string, event: LocalNewsEvent, maxAgeHours: number) => {
  if (!event.publishedAt) {
    return true;
  }
  const publishedAt = Date.parse(event.publishedAt);
  const evaluatedAt = Date.parse(now);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(evaluatedAt)) {
    return true;
  }
  return evaluatedAt - publishedAt <= maxAgeHours * 60 * 60 * 1000;
};

const isEarningsRiskEvent = (symbol: string, now: string, event: LocalNewsEvent) =>
  eventMentionsSymbol(symbol, event) &&
  isRecentEvent(now, event, 24) &&
  EARNINGS_RISK_PATTERN.test(newsText(event));

const defaultWatchlistAlerts = (): WatchlistAlertRule[] => [
  {
    id: "watchlist-momentum",
    scope: "momentum",
    title: "15분 거래량 2.0x + HMA 상승 전환",
    detail: "US 성장주 관심목록 전체에 적용합니다.",
    enabled: true,
    priority: "high",
    cooldownMinutes: 20,
  },
  {
    id: "watchlist-position-risk",
    scope: "position-risk",
    title: "손절선 1% 이내 접근",
    detail: "보유종목에 macOS 알림과 메뉴바 배지를 표시합니다.",
    enabled: true,
    priority: "urgent",
    cooldownMinutes: 10,
  },
  {
    id: "watchlist-news",
    scope: "news",
    title: "신뢰도 A/B 출처 + 영향 점수 0.65 이상",
    detail: "공식/RSS 뉴스의 티커 매핑과 중요도 점수를 사용합니다.",
    enabled: true,
    priority: "high",
    cooldownMinutes: 20,
  },
  {
    id: "watchlist-earnings-guard",
    scope: "earnings",
    title: "실적 발표 24시간 전 자동 진입 금지",
    detail: "OrderIntent 생성은 허용하되 주문 전 체크리스트에서 차단합니다.",
    enabled: true,
    priority: "normal",
    cooldownMinutes: 60,
  },
];

const defaultPlaybook = (symbol: string, now: string): PositionPlaybook => ({
  symbol,
  thesis: "AI 리더 모멘텀과 거래량 확인",
  entryRule: "15m HMA 유지 + 지정가 눌림 진입",
  invalidationRule: "핵심 기준선 이탈 또는 뉴스 리스크 급등",
  addRule: "돌파 후 되돌림 + 거래량 1.8x 이상일 때만 추가",
  trimRule: "2.1R 도달 시 40% 축소, 나머지는 추적 손절",
  target: "2.1R / 분할청산",
  workerMode: "paper-only",
  updatedAt: now,
});

const defaultStore = (): DashboardStore => ({
  auditTrail: [],
  watchlistAlerts: defaultWatchlistAlerts(),
  replayEvents: [],
  playbooks: {},
});

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const readMarketSnapshot = async (symbol: string, fallbackPrice: number, now: string): Promise<MarketSnapshot> => {
  if (process.env.STOCK_ANALYSIS_DISABLE_MARKET_SNAPSHOT === "1") {
    return {
      source: "unavailable",
      candles: [],
      latestPrice: fallbackPrice,
      previousClose: null,
      latestVolume: null,
      averageVolume20: null,
      volumeRatio: null,
      fetchedAt: now,
      error: "market snapshot disabled",
    };
  }
  const period2 = new Date(now);
  const period1 = new Date(period2);
  period1.setDate(period2.getDate() - 45);
  try {
    const marketData = getMarketDataProvider();
    const response = await marketData.getCandles(symbol, {
      period1,
      period2,
      interval: "1d",
    });
    const candles = response.candles.slice(-30);
    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2] ?? null;
    if (!latest) {
      return {
        source: "unavailable",
        candles: [],
        latestPrice: fallbackPrice,
        previousClose: null,
        latestVolume: null,
        averageVolume20: null,
        volumeRatio: null,
        fetchedAt: now,
        error: "market-data provider returned no candles",
      };
    }
    const volumeWindow = candles.slice(Math.max(0, candles.length - 21), Math.max(0, candles.length - 1));
    const averageVolume20 = average(volumeWindow.map((candle) => candle.volume));
    return {
      source: "market-data",
      candles,
      latestPrice: latest.close,
      previousClose: previous?.close ?? null,
      latestVolume: latest.volume,
      averageVolume20,
      volumeRatio: averageVolume20 && averageVolume20 > 0 ? latest.volume / averageVolume20 : null,
      fetchedAt: now,
    };
  } catch (error) {
    return {
      source: "unavailable",
      candles: [],
      latestPrice: fallbackPrice,
      previousClose: null,
      latestVolume: null,
      averageVolume20: null,
      volumeRatio: null,
      fetchedAt: now,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const readPaperStateForDashboard = async (userId: string): Promise<PaperTradingState | null> => {
  try {
    return (await readPaperTradingState(getPaperTradingStorageRootForUser(userId))).state;
  } catch {
    return null;
  }
};

const readStore = async (): Promise<DashboardStore> => {
  try {
    const parsed = JSON.parse(await readFile(DASHBOARD_STORE_PATH, "utf8")) as Partial<DashboardStore>;
    return {
      auditTrail: Array.isArray(parsed.auditTrail) ? parsed.auditTrail : [],
      watchlistAlerts: Array.isArray(parsed.watchlistAlerts) && parsed.watchlistAlerts.length > 0
        ? parsed.watchlistAlerts
        : defaultWatchlistAlerts(),
      replayEvents: Array.isArray(parsed.replayEvents) ? parsed.replayEvents : [],
      playbooks: typeof parsed.playbooks === "object" && parsed.playbooks !== null
        ? parsed.playbooks as Record<string, PositionPlaybook>
        : {},
    };
  } catch {
    return defaultStore();
  }
};

const writeStore = async (store: DashboardStore) => {
  await mkdir(dirname(DASHBOARD_STORE_PATH), { recursive: true });
  const tempPath = `${DASHBOARD_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, DASHBOARD_STORE_PATH);
};

const buildAuditEntries = ({
  now,
  symbol,
  orderIntentId,
  riskCheck,
  referencePrice,
  quantity,
  marketSnapshot,
  newsEvidenceCount,
}: {
  now: string;
  symbol: string;
  orderIntentId: string;
  riskCheck: RiskCheckResult;
  referencePrice: number;
  quantity: number;
  marketSnapshot: MarketSnapshot;
  newsEvidenceCount: number;
}): DashboardAuditEntry[] => [
  {
    id: `audit-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "intent-created",
    title: "OrderIntent 생성",
    detail: `${symbol} 매수 ${quantity}주 지정가 ${referencePrice.toFixed(2)} 후보를 생성했습니다.`,
    state: "stored",
    orderIntentId,
  },
  {
    id: `audit-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "quote-snapshot",
    title: "시세 스냅샷 저장",
    detail: marketSnapshot.source === "market-data"
      ? `market-data 기준가 ${referencePrice.toFixed(2)}, 거래량 배율 ${marketSnapshot.volumeRatio?.toFixed(2) ?? "N/A"}를 저장했습니다.`
      : `시세 provider 응답이 없어 기준가 ${referencePrice.toFixed(2)} fallback 상태로 표시합니다.`,
    state: marketSnapshot.source === "market-data" ? "stored" : "warning",
    orderIntentId,
  },
  {
    id: `audit-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "news-evidence",
    title: "뉴스 근거 저장",
    detail: newsEvidenceCount > 0
      ? `공식/RSS 저장소에서 ${symbol} 관련 뉴스 ${newsEvidenceCount}건을 주문 전 근거로 연결했습니다.`
      : "공식/RSS 저장소에 현재 종목 직접 매핑 뉴스가 없습니다.",
    state: newsEvidenceCount > 0 ? "stored" : "warning",
    orderIntentId,
  },
  {
    id: `audit-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "risk-check",
    title: riskCheck.passed ? "RiskCheck 통과" : "RiskCheck 차단",
    detail: riskCheck.blockers.length > 0
      ? riskCheck.blockers.join(" / ")
      : "리스크 정책 범위 안입니다.",
    state: riskCheck.passed ? "ok" : "blocked",
    orderIntentId,
  },
  {
    id: `audit-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "live-gate",
    title: "실거래 게이트 확인",
    detail: "ENABLE_LIVE_TRADING=false 또는 live 권한 미충족 시 실거래 전송은 차단됩니다.",
    state: "blocked",
    orderIntentId,
  },
];

const buildRiskScenarios = (estimatedOrderValue: number | null): RiskScenario[] => {
  const exposure = Math.max(estimatedOrderValue ?? 0, 1);
  const scenarios = [
    { id: "nasdaq-minus-2", label: "NASDAQ -2%", shock: "지수 충격", factor: -0.078, severity: "medium" as const },
    { id: "semis-minus-4", label: "반도체 -4%", shock: "섹터 충격", factor: -0.124, severity: "high" as const },
    { id: "vix-plus-5", label: "VIX +5p", shock: "변동성 확대", factor: -0.054, severity: "medium" as const },
    { id: "usdkrw-plus-1-5", label: "USD/KRW +1.5%", shock: "환율 충격", factor: 0.012, severity: "low" as const },
  ];
  return scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    shock: scenario.shock,
    estimatedPnl: Math.round(exposure * scenario.factor),
    severity: scenario.severity,
  }));
};

const buildNewsCredibility = (): NewsCredibilityScore[] => {
  const officialScores: NewsCredibilityScore[] = DEFAULT_OFFICIAL_NEWS_SOURCES.map((source): NewsCredibilityScore => {
    const isOfficial = source.id.includes("federal") || source.id.includes("sec") || source.id.includes("bea");
    const grade: NewsCredibilityScore["grade"] = isOfficial ? "A" : "B";
    return {
      sourceId: source.id,
      sourceName: source.name,
      grade,
      score: isOfficial ? 0.92 : 0.74,
      allowedForOrderInput: isOfficial,
      rationale: isOfficial
        ? "공식 기관/공시성 RSS로 주문 전 체크리스트 입력에 사용할 수 있습니다."
        : "검증된 금융 뉴스는 중복 확인 후 알림 입력으로 사용합니다.",
    };
  });
  return [
    ...officialScores,
    {
      sourceId: "general-rss",
      sourceName: "General RSS",
      grade: "C",
      score: 0.48,
      allowedForOrderInput: false,
      rationale: "일반 RSS는 요약 표시용이며 주문 판단 입력값으로 직접 사용하지 않습니다.",
    },
    {
      sourceId: "unverified-social",
      sourceName: "Unverified Social",
      grade: "D",
      score: 0,
      allowedForOrderInput: false,
      rationale: "미확인 소셜 루머는 v1 기본 경로에서 제외합니다.",
    },
  ];
};

const buildPreTradeChecklist = (riskCheck: RiskCheckResult): PreTradeChecklistItem[] => [
  {
    id: "intent-ready",
    title: "OrderIntent 생성",
    detail: "sidecar의 createOrderIntent 경계를 통해 주문 후보를 생성했습니다.",
    status: "pass",
  },
  {
    id: "risk-check",
    title: riskCheck.passed ? "RiskCheck 통과" : "RiskCheck 차단",
    detail: riskCheck.blockers.length > 0 ? riskCheck.blockers.join(" / ") : "리스크 정책 범위 안입니다.",
    status: riskCheck.passed ? "pass" : "block",
  },
  {
    id: "macro-window",
    title: "매크로/실적 이벤트 확인",
    detail: "공식/RSS 이벤트와 뉴스 신뢰도 점수를 함께 확인합니다.",
    status: "warn",
  },
  {
    id: "live-gate",
    title: "실거래 게이트",
    detail: "local macOS v1은 실거래 전송을 기본 차단하고 모의 주문을 우선합니다.",
    status: "block",
  },
];

const buildReplayEvents = ({
  now,
  symbol,
  auditEntries,
}: {
  now: string;
  symbol: string;
  auditEntries: DashboardAuditEntry[];
}): ReplayEvent[] =>
  auditEntries.map((entry): ReplayEvent => ({
    id: `replay-${entry.id}`,
    occurredAt: now,
    symbol,
    kind: entry.type === "risk-check" ? "risk-check" : entry.type === "live-gate" ? "live-gate" : "signal",
    title: entry.title,
    detail: entry.detail,
  }));

const isRelevantNewsEvent = (symbol: string, event: LocalNewsEvent) =>
  event.tickers.includes(symbol) ||
  (
    event.tickers.length === 0 &&
    event.tags.some((tag) => tag === "rate-policy" || tag === "employment" || tag === "gdp")
  );

const newsReplayEvents = (symbol: string, events: LocalNewsEvent[]): ReplayEvent[] =>
  events
    .filter((event) => isRelevantNewsEvent(symbol, event))
    .slice(0, 30)
    .map((event): ReplayEvent => ({
      id: `replay-news-${event.id}`,
      occurredAt: event.publishedAt ?? new Date().toISOString(),
      symbol,
      kind: "news",
      title: event.title,
      detail: `${event.sourceName} · ${event.importance}`,
    }));

const buildCandleReplayEvents = (symbol: string, marketSnapshot: MarketSnapshot): ReplayEvent[] => {
  if (marketSnapshot.source !== "market-data" || !marketSnapshot.candles.length) {
    return [{
      id: `replay-candle-unavailable-${symbol}`,
      occurredAt: marketSnapshot.fetchedAt,
      symbol,
      kind: "candle",
      title: "캔들 데이터 대기",
      detail: marketSnapshot.error
        ? `market-data provider 응답 실패: ${marketSnapshot.error}`
        : "market-data provider가 캔들을 반환하지 않았습니다.",
    }];
  }
  return marketSnapshot.candles.slice(-4).map((candle): ReplayEvent => {
    const direction = candle.close >= candle.open ? "상승" : "하락";
    return {
      id: `replay-candle-${symbol}-${candle.time}`,
      occurredAt: new Date(candle.time * 1000).toISOString(),
      symbol,
      kind: "candle",
      title: `${symbol} 일봉 ${direction}`,
      detail: `O ${candle.open.toFixed(2)} / H ${candle.high.toFixed(2)} / L ${candle.low.toFixed(2)} / C ${candle.close.toFixed(2)} / V ${Math.round(candle.volume).toLocaleString("en-US")}`,
    };
  });
};

const buildPaperReplayEvents = (symbol: string, state: PaperTradingState | null): ReplayEvent[] => {
  if (!state) {
    return [];
  }
  const normalize = (value: string) => value.trim().toUpperCase();
  const orderEvents = state.orders
    .filter((order) => normalize(order.symbol) === symbol)
    .slice(0, 30)
    .map((order: PaperOrder): ReplayEvent => ({
      id: `replay-paper-order-${order.id}`,
      occurredAt: order.createdAt,
      symbol,
      kind: "paper-order",
      title: `모의 주문 ${order.side === "buy" ? "매수" : "매도"} ${order.status}`,
      detail: `${order.quantity}주 @ ${order.price.toFixed(2)} · ${order.reason}`,
    }));
  const executionEvents = state.executions
    .filter((execution) => normalize(execution.symbol) === symbol)
    .slice(0, 30)
    .map((execution: PaperExecution): ReplayEvent => ({
      id: `replay-paper-execution-${execution.id}`,
      occurredAt: execution.executedAt,
      symbol,
      kind: "paper-execution",
      title: `모의 체결 ${execution.side === "buy" ? "매수" : "매도"}`,
      detail: `${execution.quantity}주 @ ${execution.price.toFixed(2)} · 실현손익 ${execution.realizedPnl.toFixed(2)} ${execution.currency}`,
    }));
  return [...orderEvents, ...executionEvents]
    .toSorted((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 40);
};

const buildWatchlistAlertEvaluations = ({
  rules,
  now,
  symbol,
  marketSnapshot,
  paperState,
  stopPrice,
  newsEvents,
}: {
  rules: WatchlistAlertRule[];
  now: string;
  symbol: string;
  marketSnapshot: MarketSnapshot;
  paperState: PaperTradingState | null;
  stopPrice: number;
  newsEvents: LocalNewsEvent[];
}): WatchlistAlertEvaluation[] => {
  const latest = marketSnapshot.candles[marketSnapshot.candles.length - 1] ?? null;
  const previous = marketSnapshot.candles[marketSnapshot.candles.length - 2] ?? null;
  const positions = paperState?.positions.filter((position: PaperPosition) =>
    position.symbol.trim().toUpperCase() === symbol,
  ) ?? [];
  const relevantNews = newsEvents.filter((event) => isRelevantNewsEvent(symbol, event));

  return rules.map((rule): WatchlistAlertEvaluation => {
    if (!rule.enabled) {
      return {
        id: `eval-${rule.id}-${symbol}`,
        ruleId: rule.id,
        scope: rule.scope,
        symbol,
        triggered: false,
        state: "blocked",
        priority: rule.priority,
        evaluatedAt: now,
        title: rule.title,
        detail: "알림 규칙이 꺼져 있습니다.",
        evidence: [],
      };
    }

    if (rule.scope === "momentum") {
      if (!latest || !previous || marketSnapshot.volumeRatio === null) {
        return {
          id: `eval-${rule.id}-${symbol}`,
          ruleId: rule.id,
          scope: rule.scope,
          symbol,
          triggered: false,
          state: "limited",
          priority: rule.priority,
          evaluatedAt: now,
          title: rule.title,
          detail: "market-data 캔들/거래량 데이터가 없어 fallback 기준으로 제한 평가합니다.",
          evidence: [marketSnapshot.error ?? "market-data provider returned no usable candles"],
        };
      }
      const triggered = latest.close > previous.close && marketSnapshot.volumeRatio >= 2;
      return {
        id: `eval-${rule.id}-${symbol}`,
        ruleId: rule.id,
        scope: rule.scope,
        symbol,
        triggered,
        state: triggered ? "triggered" : "clear",
        priority: rule.priority,
        evaluatedAt: now,
        title: rule.title,
        detail: triggered
          ? "종가 상승과 거래량 급증 조건이 동시에 감지됐습니다."
          : "종가 상승/거래량 2.0x 조건을 동시에 만족하지 않았습니다.",
        evidence: [
          `종가 ${latest.close.toFixed(2)} vs 이전 ${previous.close.toFixed(2)}`,
          `거래량 배율 ${marketSnapshot.volumeRatio.toFixed(2)}x`,
        ],
      };
    }

    if (rule.scope === "position-risk") {
      const position = positions[0] ?? null;
      if (!position) {
        return {
          id: `eval-${rule.id}-${symbol}`,
          ruleId: rule.id,
          scope: rule.scope,
          symbol,
          triggered: false,
          state: "clear",
          priority: rule.priority,
          evaluatedAt: now,
          title: rule.title,
          detail: "현재 로컬 paper state에 보유 포지션이 없습니다.",
          evidence: [`기준 손절가 ${stopPrice.toFixed(2)}`],
        };
      }
      const lastPrice = position.lastPrice || marketSnapshot.latestPrice;
      const distanceToStop = Math.abs(lastPrice - stopPrice) / Math.max(lastPrice, 1);
      const triggered = distanceToStop <= 0.01;
      return {
        id: `eval-${rule.id}-${symbol}`,
        ruleId: rule.id,
        scope: rule.scope,
        symbol,
        triggered,
        state: triggered ? "triggered" : "clear",
        priority: rule.priority,
        evaluatedAt: now,
        title: rule.title,
        detail: triggered
          ? "보유 포지션 가격이 손절선 1% 이내에 접근했습니다."
          : "보유 포지션이 손절선에서 1% 이상 떨어져 있습니다.",
        evidence: [
          `보유 ${position.quantity}주 @ 평균 ${position.averagePrice.toFixed(2)}`,
          `현재 ${lastPrice.toFixed(2)} / 손절 ${stopPrice.toFixed(2)} / 거리 ${(distanceToStop * 100).toFixed(2)}%`,
        ],
      };
    }

    if (rule.scope === "news") {
      const highImpact = relevantNews.filter((event) => event.importance === "high" || event.importance === "medium");
      const triggered = highImpact.length > 0;
      return {
        id: `eval-${rule.id}-${symbol}`,
        ruleId: rule.id,
        scope: rule.scope,
        symbol,
        triggered,
        state: triggered ? "triggered" : "clear",
        priority: rule.priority,
        evaluatedAt: now,
        title: rule.title,
        detail: triggered
          ? `공식/RSS 저장소에서 관련 뉴스 ${highImpact.length}건이 감지됐습니다.`
          : "공식/RSS 저장소에 현재 관련 고중요도 뉴스가 없습니다.",
        evidence: highImpact.slice(0, 3).map((event) => `${event.sourceName}: ${event.title}`),
      };
    }

    if (rule.scope === "earnings") {
      const earningsRiskEvents = newsEvents.filter((event) => isEarningsRiskEvent(symbol, now, event));
      const triggered = earningsRiskEvents.length > 0;
      return {
        id: `eval-${rule.id}-${symbol}`,
        ruleId: rule.id,
        scope: rule.scope,
        symbol,
        triggered,
        state: triggered ? "triggered" : "limited",
        priority: rule.priority,
        evaluatedAt: now,
        title: rule.title,
        detail: triggered
          ? `공식/RSS 저장소에서 24시간 내 ${symbol} 실적/가이던스 리스크 ${earningsRiskEvents.length}건을 감지했습니다.`
          : "실적 캘린더 API는 아직 없지만, 공식/RSS 저장소 기준 24시간 내 직접 실적/가이던스 리스크는 감지되지 않았습니다.",
        evidence: triggered
          ? earningsRiskEvents.slice(0, 3).map((event) => `${event.sourceName}: ${event.title}`)
          : [
            "실적 캘린더 미연동: 공식/RSS 제목, 요약, 태그, 티커로 제한 평가",
            `감시 심볼: ${symbol}`,
          ],
      };
    }

    return {
      id: `eval-${rule.id}-${symbol}`,
      ruleId: rule.id,
      scope: rule.scope,
      symbol,
      triggered: false,
      state: "limited",
      priority: rule.priority,
      evaluatedAt: now,
      title: rule.title,
      detail: "이 알림 유형은 공식/RSS 기반 제한 평가만 제공합니다.",
      evidence: ["지원되지 않는 알림 scope를 차단하지 않고 제한 평가로 표시"],
    };
  });
};

const sanitizeText = (value: unknown, fallback: string, maxLength = 240) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
};

const isWorkerMode = (value: unknown): value is PositionPlaybook["workerMode"] =>
  value === "paper-only" || value === "manual-approval" || value === "disabled";

export const buildTerminalDashboardSnapshot = async ({
  userId,
  symbol: rawSymbol,
  session: rawSession,
}: {
  userId: string;
  symbol: string;
  session: string | null;
}): Promise<TerminalDashboardSnapshot> => {
  const now = new Date().toISOString();
  const symbol = normalizeSymbol(rawSymbol);
  const session = normalizeSession(rawSession);
  const fallbackReferencePrice = defaultReferencePrice(symbol);
  const [store, storedNewsEvents, paperState, marketSnapshot] = await Promise.all([
    readStore(),
    readStoredNewsEvents(),
    readPaperStateForDashboard(userId),
    readMarketSnapshot(symbol, fallbackReferencePrice, now),
  ]);
  const referencePrice = Number(marketSnapshot.latestPrice.toFixed(2));
  const quantity = 12;
  const stopPrice = Number((referencePrice * 0.969).toFixed(2));
  const currency: Currency = session === "KR" ? "KRW" : "USD";
  const { intent, riskCheck } = createOrderIntent({
    userId,
    symbol,
    side: "buy",
    type: "limit",
    quantity,
    limitPrice: referencePrice,
    stopPrice,
    currency,
    sourceSignalId: `mac-terminal-${symbol}`,
    rationale: [
      "터미널 대시보드 주문 전 검토",
      "실거래 게이트 OFF 상태에서는 모의 주문 후보로만 사용",
      "뉴스/리스크/플레이북 탭에서 근거 확인 필요",
    ],
  });

  const configuredAlerts = store.watchlistAlerts.length > 0 ? store.watchlistAlerts : defaultWatchlistAlerts();
  const newsEvidenceCount = storedNewsEvents.filter((event) => isRelevantNewsEvent(symbol, event)).length;
  const newAuditEntries = buildAuditEntries({
    now,
    symbol,
    orderIntentId: intent.id,
    riskCheck,
    referencePrice,
    quantity,
    marketSnapshot,
    newsEvidenceCount,
  });
  const newReplayEvents = buildReplayEvents({ now, symbol, auditEntries: newAuditEntries });
  const storedNewsReplayEvents = newsReplayEvents(symbol, storedNewsEvents);
  const candleReplayEvents = buildCandleReplayEvents(symbol, marketSnapshot);
  const paperReplayEvents = buildPaperReplayEvents(symbol, paperState);
  const watchlistAlertEvaluations = buildWatchlistAlertEvaluations({
    rules: configuredAlerts,
    now,
    symbol,
    marketSnapshot,
    paperState,
    stopPrice,
    newsEvents: storedNewsEvents,
  });
  const playbook = store.playbooks[symbol] ?? defaultPlaybook(symbol, now);
  const nextStore: DashboardStore = {
    auditTrail: [...newAuditEntries, ...store.auditTrail].slice(0, MAX_AUDIT_ENTRIES),
    watchlistAlerts: configuredAlerts,
    replayEvents: [...newReplayEvents, ...store.replayEvents].slice(0, MAX_REPLAY_EVENTS),
    playbooks: {
      ...store.playbooks,
      [symbol]: playbook,
    },
  };
  await writeStore(nextStore);

  return {
    generatedAt: now,
    symbol,
    session,
    orderIntent: {
      id: intent.id,
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
      quantity: intent.quantity,
      limitPrice: intent.limitPrice,
      stopPrice: intent.stopPrice,
      currency: intent.currency,
      status: intent.status,
      rationale: intent.rationale,
      createdAt: intent.createdAt,
    },
    riskCheck,
    auditTrail: nextStore.auditTrail.filter((entry) => entry.symbol === symbol).slice(0, 40),
    riskScenarios: buildRiskScenarios(riskCheck.estimatedOrderValue),
    watchlistAlerts: nextStore.watchlistAlerts,
    watchlistAlertEvaluations,
    newsCredibility: buildNewsCredibility(),
    preTradeChecklist: buildPreTradeChecklist(riskCheck),
    replayEvents: [
      ...candleReplayEvents,
      ...storedNewsReplayEvents,
      ...paperReplayEvents,
      ...nextStore.replayEvents.filter((event) => event.symbol === symbol),
    ]
      .toSorted((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, 40),
    playbook,
  };
};

export const saveTerminalDashboardPlaybook = async ({
  symbol: rawSymbol,
  payload,
}: {
  symbol: string;
  payload: Record<string, unknown>;
}): Promise<PositionPlaybook> => {
  const now = new Date().toISOString();
  const symbol = normalizeSymbol(rawSymbol);
  const store = await readStore();
  const previous = store.playbooks[symbol] ?? defaultPlaybook(symbol, now);
  const next: PositionPlaybook = {
    symbol,
    thesis: sanitizeText(payload.thesis, previous.thesis),
    entryRule: sanitizeText(payload.entryRule, previous.entryRule),
    invalidationRule: sanitizeText(payload.invalidationRule, previous.invalidationRule),
    addRule: sanitizeText(payload.addRule, previous.addRule),
    trimRule: sanitizeText(payload.trimRule, previous.trimRule),
    target: sanitizeText(payload.target, previous.target, 120),
    workerMode: isWorkerMode(payload.workerMode) ? payload.workerMode : previous.workerMode,
    updatedAt: now,
  };
  const replayEvent: ReplayEvent = {
    id: `replay-playbook-${randomUUID()}`,
    occurredAt: now,
    symbol,
    kind: "signal",
    title: "플레이북 저장",
    detail: `${symbol} 플레이북이 업데이트됐습니다.`,
  };
  await writeStore({
    ...store,
    playbooks: {
      ...store.playbooks,
      [symbol]: next,
    },
    replayEvents: [replayEvent, ...store.replayEvents].slice(0, MAX_REPLAY_EVENTS),
  });
  return next;
};

export const appendTerminalDashboardOperatorAction = async ({
  symbol: rawSymbol,
  orderIntentId,
  title,
  detail,
  state = "stored",
}: {
  symbol: string;
  orderIntentId?: string;
  title: string;
  detail: string;
  state?: DashboardAuditEntry["state"];
}): Promise<DashboardAuditEntry> => {
  const now = new Date().toISOString();
  const symbol = normalizeSymbol(rawSymbol);
  const store = await readStore();
  const auditEntry: DashboardAuditEntry = {
    id: `audit-operator-${randomUUID()}`,
    createdAt: now,
    symbol,
    type: "operator-action",
    title: sanitizeText(title, "사용자 액션", 120),
    detail: sanitizeText(detail, "macOS 앱에서 사용자 액션을 기록했습니다.", 360),
    state,
    orderIntentId,
  };
  const replayEvent: ReplayEvent = {
    id: `replay-operator-${auditEntry.id}`,
    occurredAt: now,
    symbol,
    kind: "signal",
    title: auditEntry.title,
    detail: auditEntry.detail,
  };
  await writeStore({
    ...store,
    auditTrail: [auditEntry, ...store.auditTrail].slice(0, MAX_AUDIT_ENTRIES),
    replayEvents: [replayEvent, ...store.replayEvents].slice(0, MAX_REPLAY_EVENTS),
  });
  return auditEntry;
};
