"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { BreakoutRule, BreakoutRuleStatus, BreakoutVolumeStatus } from "@/lib/market/breakout-rule";
import type {
  PaperAccount,
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PaperRun,
  PaperTradingLog,
  PaperTradingSession,
  PaperTradingState,
} from "@/domain/paper-trading";
import type { PortfolioDailyAction } from "@/domain/portfolio";
import type { ExtendedSessionReport, ExtendedSessionSignal } from "@/lib/market/extended-session";
import type { LeaderMarket } from "@/lib/market/leader-universes";
import type {
  BreakoutSignal,
  ChartQuality,
  ChartQualityGrade,
  PatternSignalStatus,
  PatternSignalType,
  PatternSignals,
} from "@/lib/market/pattern-signals";
import type { SignalReliability, SignalReliabilityGrade } from "@/lib/market/signal-reliability";
import type { TradeSetup, TradeSetupType } from "@/lib/market/trade-setup";
import { calculatePositionManagementPlan, type PositionManagementPlan } from "@/lib/market/position-management-plan";
import { calculatePortfolioDailyAction } from "@/lib/portfolio/daily-action";
import {
  buildChartBriefing,
  buildDailyBriefing,
  type BriefingRow,
} from "@/lib/market/briefing";
import type { SymbolSearchItem } from "@/lib/market/symbol-search";
import AnnotatedAnalysisChart from "./AnnotatedAnalysisChart";
import SymbolAutocomplete from "./SymbolAutocomplete";
import ThemeToggle from "./ThemeToggle";
import styles from "./page.module.css";

type UTCTimestamp = number;

type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type IndicatorPoint = { time: UTCTimestamp; value: number };

type MarketSignal = {
  time: UTCTimestamp;
  type: "buy" | "sell";
  label: string;
  reason: string;
  stopLevel?: number;
};

type TrendFollowingSignal = MarketSignal & {
  action:
    | "entry"
    | "breakout-entry"
    | "management-warning"
    | "trend-exit";
  entryPrice?: number;
  initialStop?: number;
  riskPerShare?: number;
  partialTakeProfitLevel?: number;
  trendExitLevel?: number;
  volumeRatio?: number;
};

type MarketResponse = {
  symbol: string;
  candles: Candle[];
  indicators: {
    sma: {
      "5": IndicatorPoint[];
      "20": IndicatorPoint[];
      "60": IndicatorPoint[];
      "100": IndicatorPoint[];
    };
    rsi: IndicatorPoint[];
    bbands: {
      upper: IndicatorPoint[];
      middle: IndicatorPoint[];
      lower: IndicatorPoint[];
    };
    psar: IndicatorPoint[];
    adx: IndicatorPoint[];
    atrStops: {
      upper: IndicatorPoint[];
      lower: IndicatorPoint[];
    };
    chandelier: {
      long: IndicatorPoint[];
      short: IndicatorPoint[];
    };
  };
  signals: MarketSignal[];
  breakoutRule?: BreakoutRule;
  tradeSetup?: TradeSetup;
  chartQuality?: ChartQuality;
  patternSignals?: PatternSignals;
  breakoutSignal?: BreakoutSignal;
  signalReliability?: SignalReliability;
  trendFollowing?: {
    primaryTimeframe: "1d";
    currentTimeframe: string;
    role: "primary" | "auxiliary" | "legacy-chart";
    signals: TrendFollowingSignal[];
    latestFeature: {
      time: UTCTimestamp;
      sma5: number | null;
      sma20: number | null;
      sma50: number | null;
      sma20SlopePct: number | null;
      sma50SlopePct: number | null;
      volumeMa20: number | null;
      volumeRatio: number | null;
      recentHigh20: number | null;
      recentLow5: number | null;
      closeLocation: number;
      rejectionReasons: string[];
    } | null;
    activeSetup: {
      entryTime: UTCTimestamp;
      entryPrice: number;
      initialStop: number;
      riskPerShare: number;
      partialTakeProfitLevel: number;
      trendExitLevel: number;
    } | null;
    diagnostics?: {
      insufficientHistory: boolean;
      rejectedSetups: number;
      latestRejectionReasons: string[];
    };
  };
};

type PainFactor = {
  key: string;
  label: string;
  score: number;
  value: string;
  detail: string;
};

type PainMeter = {
  score: number;
  level: string;
  verdict: string;
  tone: "calm" | "watch" | "warning" | "panic";
  factors: PainFactor[];
  latest: {
    price: number;
    changePct: number;
    drawdownPct: number;
    rsi: number | null;
    adx: number | null;
    volumeRatio: number;
  };
};

type WatchRow = {
  id: string;
  symbol: string;
  name?: string;
  market: string;
  normalizedSymbol: string;
  data: MarketResponse | null;
  meter: PainMeter | null;
  loading: boolean;
  error: string | null;
};

type WatchSeed = {
  symbol: string;
  market: string;
  name?: string;
};

type PortfolioCurrency = "USD" | "KRW";

type PortfolioPosition = {
  id: string;
  symbol: string;
  market: string;
  name?: string;
  normalizedSymbol: string;
  avgPrice: number;
  quantity: number;
  currency: PortfolioCurrency;
  memo?: string;
  updatedAt: string;
  data: MarketResponse | null;
  meter: PainMeter | null;
  loading: boolean;
  error: string | null;
};

type StoredPortfolioPosition = Omit<PortfolioPosition, "data" | "meter" | "loading" | "error">;

type PortfolioFormState = {
  symbol: string;
  market: string;
  name: string;
  avgPrice: string;
  quantity: string;
  currency: PortfolioCurrency;
  memo: string;
};

type MarketTab = "ALL" | "US" | "KOSPI" | "KOSDAQ" | "FAVORITES";
type WorkbenchTab = "watchlist" | "portfolio" | "paper" | "daily" | "analysis";
type DailyBriefingSession = "US" | "KR";
type DailyBriefingInnerTab = "summary" | "candidates" | "risk" | "market" | "history";
type MarketRiskLightLevel = "green" | "yellow" | "red";
type AutomationStatus = "tradable" | "probe" | "armed" | "watch" | "blocked";
type EntrySetup = "breakout" | "pullback-5d" | "pullback-20d" | "trend-continuation";
type EntryType = "limit" | "stop-limit" | "close-confirmation";

type LeaderCandidate = {
  symbol: string;
  name: string;
  sector?: string;
  themes?: string[];
  rank: number;
  price: number;
  return5: number | null;
  return50: number;
  leadershipScore?: number;
  leadershipReasons?: string[];
  candidateSourceDetail?: "dynamic" | "symbol-master" | "fallback" | "curated";
  decision: "enter" | "hold" | "watch" | "avoid";
  actionable?: boolean;
  activeTrend?: boolean;
  reason: string;
  breakoutRule?: BreakoutRule;
  tradeSetup?: TradeSetup;
  chartQuality?: ChartQuality;
  patternSignals?: PatternSignals;
  breakoutSignal?: BreakoutSignal;
  signalReliability?: SignalReliability;
  risk: {
    entryPrice: number;
    stopPrice: number | null;
    stopPct: number | null;
    twoR: number | null;
    trendExitLevel: number | null;
  };
  levels?: {
    sma5: number | null;
    sma20: number | null;
    aggressiveEntryLow: number | null;
    aggressiveEntryHigh: number | null;
    conservativeEntryLow: number | null;
    conservativeEntryHigh: number | null;
    newEntryStop: number | null;
    breakoutPrice: number | null;
  };
  features?: {
    volumeRatio: number | null;
    sma20SlopePct: number | null;
    sma50SlopePct: number | null;
  };
};

type LeaderResponse = {
  market: LeaderMarket;
  strategy: {
    name: string;
    leaderCount: number;
    marketBreadthMin: number;
    marketAverageReturn50Min: number;
    minLeaderReturn50: number | null;
    maxStopPct: number;
  };
  generatedAt: string;
  marketHealth: {
    breadth: number;
    averageReturn50: number;
    pass: boolean;
    loadedSymbols: number;
    totalSymbols: number;
  };
  scanKey?: string;
  tradingDate?: string;
  nextRefreshAt?: string;
  scanStatus?: "ready" | "waiting-for-close";
  candidateSource?: {
    status: "dynamic" | "fallback" | "mixed";
    label: string;
    requested: number;
    returned: number;
    used: number;
    dynamicCount?: number;
    symbolMasterCount?: number;
    fallbackCount?: number;
    curatedCount?: number;
    analyzedCount?: number;
    errors: string[];
  };
  candidates: LeaderCandidate[];
  errors: Array<{ symbol: string; name: string; error: string }>;
};

type DailyFocusCandidate = {
  symbol: string;
  name: string;
  sector: string;
  themes: string[];
  rank: number;
  price: number;
  decision: LeaderCandidate["decision"];
  return5: number | null;
  return50: number;
  leadershipScore?: number;
  leadershipReasons?: string[];
  breakoutSignal?: BreakoutSignal;
  chartQuality?: ChartQuality;
  signalReliability?: SignalReliability;
  tradeSetup: TradeSetup;
  whyToday: string;
};

type DailyAnalysisCandidate = {
  symbol: string;
  name?: string;
};

type MarketBriefingReport = {
  market: LeaderMarket;
  strategy: string;
  tradingDate?: string;
  nextRefreshAt?: string;
  scanStatus?: "ready" | "waiting-for-close";
  candidateSource?: LeaderResponse["candidateSource"];
  marketHealth: LeaderResponse["marketHealth"];
  headline: string;
  leadingThemes: Array<{
    theme: string;
    sector: string;
    score: number;
    averageReturn5: number;
    averageReturn50: number;
    leaderCount: number;
    read: string;
    strongest: Array<{
      symbol: string;
      name: string;
      sector: string;
      themes: string[];
      rank: number;
      price: number;
      decision: LeaderCandidate["decision"];
      reason: string;
      return5: number | null;
      return50: number;
      leadershipScore?: number;
      leadershipReasons?: string[];
      candidateSourceDetail?: LeaderCandidate["candidateSourceDetail"];
      breakoutRule?: BreakoutRule;
      tradeSetup?: TradeSetup;
      chartQuality?: ChartQuality;
      breakoutSignal?: BreakoutSignal;
      signalReliability?: SignalReliability;
      tradePlan: {
        firstEntry: string;
        conservativeEntry: string;
        stop: string;
        breakout: string;
        basis: string;
        text: string;
        tradeSetup?: TradeSetup;
      };
    }>;
  }>;
  leadingSectors: Array<{
    sector: string;
    theme?: string;
    averageReturn5?: number;
    averageReturn50: number;
    leaderCount: number;
    read: string;
    strongest: Array<{
      symbol: string;
      name: string;
      sector?: string;
      themes?: string[];
      decision: LeaderCandidate["decision"];
      return5?: number | null;
      return50: number;
      breakoutRule?: BreakoutRule;
      tradeSetup?: TradeSetup;
      chartQuality?: ChartQuality;
      breakoutSignal?: BreakoutSignal;
      signalReliability?: SignalReliability;
      tradePlan?: {
        firstEntry: string;
        conservativeEntry: string;
        stop: string;
        breakout: string;
        basis: string;
        text: string;
        tradeSetup?: TradeSetup;
      };
    }>;
  }>;
  strongestStocks: Array<{
    symbol: string;
    name: string;
    sector: string;
    themes: string[];
    rank: number;
    price: number;
    return5: number | null;
    return50: number;
    leadershipScore?: number;
    leadershipReasons?: string[];
    candidateSourceDetail?: LeaderCandidate["candidateSourceDetail"];
    decision: LeaderCandidate["decision"];
    reason: string;
    breakoutRule?: BreakoutRule;
    tradeSetup?: TradeSetup;
    chartQuality?: ChartQuality;
    breakoutSignal?: BreakoutSignal;
    signalReliability?: SignalReliability;
    tradePlan: {
      firstEntry: string;
      conservativeEntry: string;
      stop: string;
      breakout: string;
      basis: string;
      text: string;
      tradeSetup?: TradeSetup;
    };
  }>;
  entryCandidates: Array<{
    symbol: string;
    name: string;
    sector: string;
    rank: number;
    price: number;
    decision: LeaderCandidate["decision"];
    automationStatus: AutomationStatus;
    setup: EntrySetup;
    entryType: EntryType;
    entryRange: string;
    stop: string;
    riskPct: number | null;
    reason: string;
    blockers: string[];
    breakoutRule?: BreakoutRule;
    tradeSetup?: TradeSetup;
    chartQuality?: ChartQuality;
    breakoutSignal?: BreakoutSignal;
    signalReliability?: SignalReliability;
  }>;
  breakoutCandidates?: Array<{
    symbol: string;
    name: string;
    sector: string;
    themes: string[];
    rank: number;
    price: number;
    decision: LeaderCandidate["decision"];
    return5: number | null;
    return50: number;
    leadershipScore?: number;
    leadershipReasons?: string[];
    candidateSourceDetail?: LeaderCandidate["candidateSourceDetail"];
    breakoutSignal: BreakoutSignal;
    chartQuality?: ChartQuality;
    signalReliability?: SignalReliability;
    tradeSetup: TradeSetup;
  }>;
  supportCandidates?: DailyFocusCandidate[];
  cautionCandidates?: DailyFocusCandidate[];
  scanCandidates?: LeaderCandidate[];
  summary: string[];
  errors: Array<{ symbol: string; name: string; error: string }>;
};

type MarketBriefingResponse = {
  generatedAt: string;
  session?: DailyBriefingSession;
  sessionLabel?: string;
  tradingDate?: string;
  nextRefreshAt?: string;
  scanStatus?: "ready" | "waiting-for-close";
  markets: LeaderMarket[];
  extendedSession?: ExtendedSessionReport;
  reports: MarketBriefingReport[];
};

type MarketBriefingSnapshot = {
  id: string;
  dateKey: string;
  savedAt: string;
  session?: DailyBriefingSession;
  markets: LeaderMarket[];
  summary: string;
  response: MarketBriefingResponse;
};

type MarketRiskLight = {
  level: MarketRiskLightLevel;
  label: string;
  action: string;
  score: number;
  reasons: string[];
  detail: string;
  defaultTab: DailyBriefingInnerTab;
};

type DailyBriefingTabSummary = {
  title: string;
  body: string;
  metrics: Array<{ label: string; value: string; tone?: "good" | "watch" | "danger" | "neutral" }>;
};

type PaperTradingRunResponse = {
  run: PaperRun;
  nextAccount: PaperAccount;
  nextPositions: PaperPosition[];
  orders: PaperOrder[];
  executions: PaperExecution[];
  logs: PaperTradingLog[];
  state: PaperTradingState;
};

type PaperTradingStateResponse = {
  state: PaperTradingState;
  repaired?: boolean;
};

type PortfolioPositionsResponse = {
  positions: StoredPortfolioPosition[];
};

type TossCredentialStatus = "pending" | "verified" | "failed" | "disabled";

type TossWorkbenchPosition = StoredPortfolioPosition & {
  source: "toss";
  lastPrice: number | null;
  warnings: Array<{
    warningType: string;
    exchange: string | null;
    startDate: string | null;
    endDate: string | null;
  }>;
};

type TossWorkbenchResponse = {
  connected: boolean;
  credential?: {
    broker: "toss";
    maskedIdentifier: string;
    status: TossCredentialStatus;
    lastVerifiedAt: string | null;
    updatedAt: string;
  } | null;
  accountSeq?: number;
  accounts?: Array<{ accountNo: string; accountSeq: number; accountType: string }>;
  positions?: TossWorkbenchPosition[];
  buyingPower?: {
    KRW?: { currency: "KRW"; cashBuyingPower: string } | null;
    USD?: { currency: "USD"; cashBuyingPower: string } | null;
  };
  commissions?: Array<{ marketCountry: string; commissionRate: string }>;
  orders?: {
    open: unknown[];
    closed: unknown[];
  };
  marketInfo?: {
    exchangeRate?: { rate: string; validUntil: string } | null;
  };
  warnings?: string[];
  error?: string;
};

const marketOptions = [
  { label: "US", value: "US" },
  { label: "KOSPI", value: "KOSPI" },
  { label: "KOSDAQ", value: "KOSDAQ" },
  { label: "CRYPTO", value: "CRYPTO" },
];

const marketTabs: Array<{ label: string; value: MarketTab }> = [
  { label: "전체", value: "ALL" },
  { label: "나스닥", value: "US" },
  { label: "코스피", value: "KOSPI" },
  { label: "코스닥", value: "KOSDAQ" },
  { label: "즐겨찾기", value: "FAVORITES" },
];

const workbenchTabs: Array<{ label: string; value: WorkbenchTab }> = [
  { label: "관심종목", value: "watchlist" },
  { label: "포트폴리오", value: "portfolio" },
  { label: "데일리 브리핑", value: "daily" },
  { label: "종목분석", value: "analysis" },
];

const getWorkbenchTabFromQuery = (value: string | null): WorkbenchTab | null => {
  if (!value) {
    return null;
  }
  return workbenchTabs.some((tab) => tab.value === value) ? (value as WorkbenchTab) : null;
};

const paperStrategyVersion = "paper-breakout-v1";
const marketBriefingSnapshotStorageKey = "stock-analysis-market-briefing-snapshots";
const maxMarketBriefingSnapshots = 10;

const briefingSessionOptions: Array<{ label: string; value: DailyBriefingSession }> = [
  { label: "데일리 나스닥", value: "US" },
  { label: "데일리 한국장", value: "KR" },
];

const dailyBriefingTabs: Array<{ label: string; value: DailyBriefingInnerTab }> = [
  { label: "요약", value: "summary" },
  { label: "후보", value: "candidates" },
  { label: "리스크", value: "risk" },
  { label: "시장", value: "market" },
  { label: "기록", value: "history" },
];

const rangeOptions = [
  { label: "3M", value: "90" },
  { label: "6M", value: "180" },
  { label: "1Y", value: "365" },
  { label: "2Y", value: "730" },
];

const timeframeOptions = [
  { label: "1D", value: "1d" },
  { label: "4H", value: "4h" },
];

const helpText = {
  pricePain: "가격 하락, RSI, 거래량, 추세 훼손으로 계산한 가격 리스크입니다.",
  priceRegime: "가격 곡소리 점수 구간을 사람이 읽기 쉽게 표시한 판정입니다.",
  drawdown: "최근 60개 봉 고점 대비 현재 가격이 얼마나 내려왔는지입니다.",
  rsi: "가격 과매수·과매도 상태를 보는 RSI 지표입니다.",
  adx: "추세 강도를 보는 ADX 지표입니다.",
};

const defaultWatchlist: WatchSeed[] = [
  { symbol: "NVDA", market: "US", name: "NVIDIA" },
  { symbol: "MSFT", market: "US", name: "Microsoft" },
  { symbol: "AAPL", market: "US", name: "Apple" },
  { symbol: "AMZN", market: "US", name: "Amazon" },
  { symbol: "GOOGL", market: "US", name: "Alphabet" },
  { symbol: "AVGO", market: "US", name: "Broadcom" },
  { symbol: "META", market: "US", name: "Meta" },
  { symbol: "TSLA", market: "US", name: "Tesla" },
  { symbol: "COST", market: "US", name: "Costco" },
  { symbol: "NFLX", market: "US", name: "Netflix" },
  { symbol: "005930", market: "KOSPI", name: "삼성전자" },
  { symbol: "000660", market: "KOSPI", name: "SK하이닉스" },
  { symbol: "373220", market: "KOSPI", name: "LG에너지솔루션" },
  { symbol: "207940", market: "KOSPI", name: "삼성바이오로직스" },
  { symbol: "005380", market: "KOSPI", name: "현대차" },
  { symbol: "000270", market: "KOSPI", name: "기아" },
  { symbol: "105560", market: "KOSPI", name: "KB금융" },
  { symbol: "068270", market: "KOSPI", name: "셀트리온" },
  { symbol: "035420", market: "KOSPI", name: "NAVER" },
  { symbol: "012450", market: "KOSPI", name: "한화에어로스페이스" },
  { symbol: "247540", market: "KOSDAQ", name: "에코프로비엠" },
  { symbol: "196170", market: "KOSDAQ", name: "알테오젠" },
  { symbol: "086520", market: "KOSDAQ", name: "에코프로" },
  { symbol: "028300", market: "KOSDAQ", name: "HLB" },
  { symbol: "277810", market: "KOSDAQ", name: "레인보우로보틱스" },
  { symbol: "214150", market: "KOSDAQ", name: "클래시스" },
  { symbol: "141080", market: "KOSDAQ", name: "리가켐바이오" },
  { symbol: "087010", market: "KOSDAQ", name: "펩트론" },
  { symbol: "000250", market: "KOSDAQ", name: "삼천당제약" },
  { symbol: "403870", market: "KOSDAQ", name: "HPSP" },
];

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const normalizeSymbol = (rawSymbol: string, market: string) => {
  const trimmed = rawSymbol.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  const hasSuffix = /\.(KS|KQ)$/i.test(trimmed);
  const hasCryptoSuffix = /-USD$/i.test(trimmed);
  if (market === "CRYPTO") {
    return hasCryptoSuffix ? trimmed : `${trimmed}-USD`;
  }
  if (market === "US" || hasSuffix) {
    return trimmed;
  }
  return `${trimmed}.${market === "KOSPI" ? "KS" : "KQ"}`;
};

const rowId = (symbol: string, market: string) =>
  `${market}:${normalizeSymbol(symbol, market) || symbol.trim().toUpperCase()}`;

const createEmptyRow = (symbol: string, market: string, name?: string): WatchRow => {
  const normalizedSymbol = normalizeSymbol(symbol, market);
  return {
    id: rowId(symbol, market),
    symbol: symbol.trim().toUpperCase(),
    name,
    market,
    normalizedSymbol,
    data: null,
    meter: null,
    loading: false,
    error: null,
  };
};

const lastValue = (series: IndicatorPoint[]) =>
  series.length ? series[series.length - 1].value : null;

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatScore = (value?: number | null) =>
  typeof value === "number" ? value.toString() : "--";

const formatPrice = (value?: number | null) =>
  typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const formatRatio = (value?: number | null) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "--";

const addUniqueReason = (reasons: string[], reason: string) => {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
};

const buildMarketRiskLight = (
  briefing: MarketBriefingResponse | null,
  portfolioActions: Array<{ action: PortfolioDailyAction }>,
): MarketRiskLight => {
  if (!briefing) {
    return {
      level: "yellow",
      label: "분석 대기",
      action: "일간분석을 실행한 뒤 신규 진입 여부를 판단합니다.",
      score: 35,
      reasons: ["시장폭과 후보 리스크를 아직 계산하지 못했습니다."],
      detail: "브리핑 실행 전에는 풀진입보다 관찰을 기본값으로 둡니다.",
      defaultTab: "summary",
    };
  }

  const reasons: string[] = [];
  const reports = briefing.reports;
  const reportCount = Math.max(reports.length, 1);
  const averageBreadth =
    reports.reduce((sum, report) => sum + report.marketHealth.breadth, 0) / reportCount;
  const failedMarkets = reports.filter((report) => !report.marketHealth.pass).length;
  const cautionCount = reports.reduce(
    (sum, report) => sum + (report.cautionCandidates?.length ?? 0),
    0,
  );
  const riskOffScanCount = reports.reduce(
    (sum, report) =>
      sum +
      (report.scanCandidates ?? []).filter(
        (candidate) =>
          candidate.decision === "avoid" ||
          candidate.breakoutRule?.status === "risk-off" ||
          candidate.tradeSetup?.type === "risk-off",
      ).length,
    0,
  );
  const scanCandidateCount = reports.reduce(
    (sum, report) =>
      sum +
      Math.max(
        report.scanCandidates?.length ?? 0,
        report.candidateSource?.used ?? 0,
        report.marketHealth.loadedSymbols,
      ),
    0,
  );
  const breakoutCount = reports.reduce(
    (sum, report) => sum + (report.breakoutCandidates?.length ?? 0),
    0,
  );
  const supportCount = reports.reduce(
    (sum, report) => sum + (report.supportCandidates?.length ?? 0),
    0,
  );
  const portfolioDangerCount = portfolioActions.filter(({ action }) => action.riskLevel === "danger").length;
  const portfolioWatchCount = portfolioActions.filter(({ action }) => action.riskLevel === "watch").length;
  const extendedWarnings = briefing.extendedSession?.warnings.length ?? 0;
  const extendedRiskMovers =
    briefing.extendedSession?.topMovers.filter(
      (mover) => mover.signal === "risk-off" || mover.changeFromRegularClosePct <= -0.025,
    ).length ?? 0;

  let score = 0;

  if (averageBreadth < 0.45) {
    score += 35;
    addUniqueReason(reasons, `시장폭 ${(averageBreadth * 100).toFixed(0)}%로 약세`);
  } else if (averageBreadth < 0.65) {
    score += 18;
    addUniqueReason(reasons, `시장폭 ${(averageBreadth * 100).toFixed(0)}%로 선별 필요`);
  }

  if (failedMarkets > 0) {
    score += failedMarkets * 12;
    addUniqueReason(reasons, `${failedMarkets}개 시장이 breadth 기준 미달`);
  }

  const riskRatio = scanCandidateCount > 0 ? (cautionCount + riskOffScanCount) / scanCandidateCount : 0;
  if (riskRatio >= 0.35) {
    score += 28;
    addUniqueReason(reasons, `주의/제외 후보 비중 ${(riskRatio * 100).toFixed(0)}%`);
  } else if (riskRatio >= 0.18) {
    score += 14;
    addUniqueReason(reasons, `주의 후보가 늘어나는 구간`);
  }

  if (breakoutCount + supportCount === 0) {
    score += 10;
    addUniqueReason(reasons, "돌파/지지 후보 부족");
  }

  if (portfolioDangerCount > 0) {
    score += 18;
    addUniqueReason(reasons, `보유 종목 위험 ${portfolioDangerCount}개`);
  } else if (portfolioWatchCount > 0) {
    score += 8;
    addUniqueReason(reasons, `보유 종목 관찰 ${portfolioWatchCount}개`);
  }

  if (extendedRiskMovers > 0) {
    score += 10;
    addUniqueReason(reasons, `장외 약세 후보 ${extendedRiskMovers}개`);
  }

  if (extendedWarnings > 0) {
    score += Math.min(12, extendedWarnings * 4);
    addUniqueReason(reasons, "장외 보조 경고 확인");
  }

  const normalizedScore = clamp(Math.round(score));

  if (normalizedScore >= 65) {
    return {
      level: "red",
      label: "신규 진입 중단",
      action: "신규 매수보다 보유 종목 손절선과 비중 축소 기준을 먼저 점검합니다.",
      score: normalizedScore,
      reasons: reasons.slice(0, 3),
      detail: "빨간불에서는 후보 탐색보다 리스크 탭을 먼저 확인합니다.",
      defaultTab: "risk",
    };
  }

  if (normalizedScore >= 30) {
    return {
      level: "yellow",
      label: "주의 / 탐색 진입만",
      action: "풀진입은 보류하고 지지 확인 후보만 소액 탐색 진입으로 제한합니다.",
      score: normalizedScore,
      reasons: reasons.slice(0, 3),
      detail: "노란불에서는 기준선 위 종가 유지와 거래량 확인 전까지 공격적인 진입을 줄입니다.",
      defaultTab: "summary",
    };
  }

  return {
    level: "green",
    label: "선별 진입 가능",
    action: "시장폭과 후보 구성이 양호합니다. 강한 후보만 기준선 중심으로 선별합니다.",
    score: normalizedScore,
    reasons: reasons.length ? reasons.slice(0, 3) : ["시장폭과 후보 구성이 안정적입니다."],
    detail: "초록불이어도 현재가 추격보다 기준선 지지 확인을 우선합니다.",
    defaultTab: "summary",
  };
};

const buildDailyBriefingTabSummary = (
  activeTab: DailyBriefingInnerTab,
  briefing: MarketBriefingResponse | null,
  riskLight: MarketRiskLight,
  portfolioActions: Array<{ action: PortfolioDailyAction }>,
  snapshotCount: number,
): DailyBriefingTabSummary => {
  const reports = briefing?.reports ?? [];
  const reportCount = Math.max(reports.length, 1);
  const supportCount = reports.reduce((sum, report) => sum + (report.supportCandidates?.length ?? 0), 0);
  const breakoutCount = reports.reduce((sum, report) => sum + (report.breakoutCandidates?.length ?? 0), 0);
  const cautionCount = reports.reduce((sum, report) => sum + (report.cautionCandidates?.length ?? 0), 0);
  const scanCount = reports.reduce((sum, report) => sum + (report.scanCandidates?.length ?? 0), 0);
  const averageBreadth = reports.length
    ? reports.reduce((sum, report) => sum + report.marketHealth.breadth, 0) / reportCount
    : null;
  const weakMarketCount = reports.filter((report) => !report.marketHealth.pass).length;
  const portfolioDangerCount = portfolioActions.filter(({ action }) => action.riskLevel === "danger").length;
  const portfolioWatchCount = portfolioActions.filter(({ action }) => action.riskLevel === "watch").length;
  const extendedWarningCount = briefing?.extendedSession?.warnings.length ?? 0;

  switch (activeTab) {
    case "candidates":
      return {
        title: "오늘 볼 후보",
        body: "지지 확인과 돌파 후보만 먼저 보고, 전체 후보는 필요할 때 펼쳐서 확인합니다.",
        metrics: [
          { label: "지지 확인", value: `${supportCount}개`, tone: supportCount > 0 ? "watch" : "neutral" },
          { label: "돌파 후보", value: `${breakoutCount}개`, tone: breakoutCount > 0 ? "good" : "neutral" },
          { label: "전체 후보", value: `${scanCount}개`, tone: scanCount > 0 ? "neutral" : "watch" },
        ],
      };
    case "risk":
      return {
        title: riskLight.level === "red" ? "리스크 우선 확인" : "주의 종목 점검",
        body: "신규 진입보다 실패선, 낮은 신뢰도, 보유 종목 위험 신호를 먼저 확인합니다.",
        metrics: [
          { label: "주의 종목", value: `${cautionCount}개`, tone: cautionCount > 0 ? "danger" : "good" },
          { label: "보유 위험", value: `${portfolioDangerCount}개`, tone: portfolioDangerCount > 0 ? "danger" : "neutral" },
          { label: "보유 관찰", value: `${portfolioWatchCount}개`, tone: portfolioWatchCount > 0 ? "watch" : "neutral" },
        ],
      };
    case "market":
      return {
        title: "시장 체온과 보조 지표",
        body: "시장폭, 장외 체크, 주도테마, 후보 출처를 묶어서 현재 장세의 배경을 확인합니다.",
        metrics: [
          {
            label: "평균 시장폭",
            value: averageBreadth === null ? "--" : `${(averageBreadth * 100).toFixed(0)}%`,
            tone: averageBreadth === null ? "neutral" : averageBreadth >= 0.65 ? "good" : averageBreadth >= 0.45 ? "watch" : "danger",
          },
          { label: "기준 미달", value: `${weakMarketCount}개`, tone: weakMarketCount > 0 ? "danger" : "good" },
          { label: "장외 경고", value: `${extendedWarningCount}개`, tone: extendedWarningCount > 0 ? "watch" : "neutral" },
        ],
      };
    case "history":
      return {
        title: "최근 브리핑 기록",
        body: "저장된 스냅샷을 열어 같은 날짜 리포트와 판단 흐름을 다시 확인합니다.",
        metrics: [
          { label: "저장본", value: `${snapshotCount}/${maxMarketBriefingSnapshots}`, tone: snapshotCount > 0 ? "neutral" : "watch" },
          { label: "현재 보기", value: briefing ? "리포트 있음" : "대기", tone: briefing ? "good" : "neutral" },
        ],
      };
    case "summary":
    default:
      return {
        title: "오늘의 첫 판단",
        body: riskLight.action,
        metrics: [
          { label: "신호", value: riskLight.label, tone: riskLight.level === "red" ? "danger" : riskLight.level === "yellow" ? "watch" : "good" },
          {
            label: "평균 시장폭",
            value: averageBreadth === null ? "--" : `${(averageBreadth * 100).toFixed(0)}%`,
            tone: averageBreadth === null ? "neutral" : averageBreadth >= 0.65 ? "good" : averageBreadth >= 0.45 ? "watch" : "danger",
          },
          { label: "주의 종목", value: `${cautionCount}개`, tone: cautionCount > 0 ? "danger" : "neutral" },
        ],
      };
  }
};

const formatPriceRange = (low?: number | null, high?: number | null) =>
  typeof low === "number" && typeof high === "number"
    ? `${formatPrice(low)} ~ ${formatPrice(high)}`
    : "--";

const formatLargeAmount = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  if (value >= 1_0000_0000_0000) {
    return `${(value / 1_0000_0000_0000).toFixed(1)}조`;
  }
  if (value >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(1)}억`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const translateBreakoutStatus = (status?: BreakoutRuleStatus) => {
  switch (status) {
    case "breakout-ready":
      return "신고가 돌파";
    case "wait-pullback":
      return "지지 확인";
    case "profit-tracking":
      return "20일선 추적";
    case "risk-off":
      return "20일선 이탈 주의";
    case "avoid":
      return "돌파 대기";
    default:
      return "--";
  }
};

const getBreakoutTone = (status?: BreakoutRuleStatus) => {
  switch (status) {
    case "breakout-ready":
      return "trendEnter";
    case "profit-tracking":
      return "trendHold";
    case "wait-pullback":
      return "trendWatch";
    case "risk-off":
      return "trendExit";
    case "avoid":
    default:
      return "trendMuted";
  }
};

const getBreakoutHeadline = (rule?: BreakoutRule | null) => {
  if (!rule) {
    return "신고가 돌파 룰 데이터가 아직 없습니다.";
  }
  switch (rule.status) {
    case "breakout-ready":
      return "신고가 돌파 후보입니다. 즉시 추격보다 거래량과 5일선 지지 확인을 같이 봅니다.";
    case "profit-tracking":
      return "+20% 이후 20일선 추적 모드입니다. 수익은 끌고 가되 20일선 이탈은 수익 보호 기준입니다.";
    case "risk-off":
      return "20일선 또는 -10% 손절 기준을 위협합니다. 추가매수보다 리스크 관리가 먼저입니다.";
    case "wait-pullback":
      return "추세 구조는 살아 있지만 신고가 돌파는 아직 아닙니다. 5일선/20일선 지지 확인이 우선입니다.";
    case "avoid":
    default:
      return "신고가 돌파와 20일선 구조가 아직 부족합니다.";
  }
};

const translateBreakoutVolumeStatus = (status?: BreakoutVolumeStatus) => {
  switch (status) {
    case "strong":
      return "강한 수급";
    case "confirmed":
      return "거래량 확인";
    case "normal":
      return "거래량 보통";
    case "weak":
      return "거래량 부족";
    case "unavailable":
    default:
      return "거래량 대기";
  }
};

const getBreakoutVolumeTone = (status?: BreakoutVolumeStatus) => {
  switch (status) {
    case "strong":
      return "trendEnter";
    case "confirmed":
      return "trendHold";
    case "normal":
      return "trendWatch";
    case "weak":
      return "trendExit";
    case "unavailable":
    default:
      return "trendMuted";
  }
};

const formatBreakoutVolume = (rule?: BreakoutRule | null) => {
  if (!rule?.volumeConfirmation) {
    return "거래량 대기";
  }
  const ratio = rule.volumeConfirmation.ratio20;
  return `${typeof ratio === "number" ? `${ratio.toFixed(2)}x` : "--"} · ${translateBreakoutVolumeStatus(rule.volumeConfirmation.status)}`;
};

const translateExtendedSignal = (signal?: ExtendedSessionSignal) => {
  switch (signal) {
    case "strong":
      return "장외 강세";
    case "watch":
      return "지지 확인";
    case "thin-volume":
      return "추격 주의";
    case "risk-off":
      return "리스크 확대";
    case "none":
    default:
      return "변동 제한";
  }
};

const getExtendedSignalTone = (signal?: ExtendedSessionSignal) => {
  switch (signal) {
    case "strong":
      return "trendEnter";
    case "thin-volume":
      return "trendWatch";
    case "watch":
      return "trendWatch";
    case "risk-off":
      return "trendExit";
    case "none":
    default:
      return "trendMuted";
  }
};

const getMarketCurrency = (market: string): PortfolioCurrency =>
  market === "US" || market === "CRYPTO" ? "USD" : "KRW";

const formatCurrencyAmount = (value?: number | null, currency?: PortfolioCurrency) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  if (currency === "KRW") {
    return `₩${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

const formatSignedCurrencyAmount = (value?: number | null, currency?: PortfolioCurrency) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${formatCurrencyAmount(Math.abs(value), currency)}`;
};

const createEmptyPortfolioForm = (market = "US"): PortfolioFormState => ({
  symbol: "",
  market,
  name: "",
  avgPrice: "",
  quantity: "",
  currency: getMarketCurrency(market),
  memo: "",
});

const createDefaultPaperAccount = (session: PaperTradingSession, now = new Date().toISOString()): PaperAccount => {
  const isUs = session === "US";
  return {
    id: `paper-${session.toLowerCase()}`,
    session,
    currency: isUs ? "USD" : "KRW",
    initialCash: isUs ? 10_000 : 10_000_000,
    cash: isUs ? 10_000 : 10_000_000,
    realizedPnl: 0,
    strategyVersion: paperStrategyVersion,
    createdAt: now,
    updatedAt: now,
  };
};

const createDefaultPaperTradingState = (): PaperTradingState => {
  const now = new Date().toISOString();
  return {
    accounts: {
      US: createDefaultPaperAccount("US", now),
      KR: createDefaultPaperAccount("KR", now),
    },
    positions: [],
    runs: [],
    orders: [],
    executions: [],
    logs: [],
    updatedAt: now,
  };
};

const getPaperTodayKey = () => new Date().toISOString().slice(0, 10);

const getPaperPositionValue = (position: PaperPosition) =>
  position.quantity * position.lastPrice;

const buildPaperAccountSummary = (
  account: PaperAccount,
  positions: PaperPosition[],
) => {
  const marketValue = positions.reduce((sum, position) => sum + getPaperPositionValue(position), 0);
  const equity = account.cash + marketValue;
  return {
    marketValue,
    equity,
    totalReturnPct: account.initialCash > 0 ? (equity + account.realizedPnl) / account.initialCash - 1 : null,
  };
};

const getPaperRunSourceLabel = (source?: PaperRun["source"]) => {
  switch (source) {
    case "manual":
      return "수동";
    case "codex-automation":
      return "Codex 자동화";
    case "script":
      return "스크립트";
    default:
      return "기록";
  }
};

const getPaperNextRunLabel = (session: PaperTradingSession) =>
  session === "KR" ? "평일 KST 16:10" : "화-토 KST 07:30";

const createPortfolioPosition = (
  form: PortfolioFormState,
  existing?: PortfolioPosition | null,
): PortfolioPosition | null => {
  const symbol = form.symbol.trim().toUpperCase();
  const avgPrice = Number(form.avgPrice);
  const quantity = Number(form.quantity);
  if (!symbol || !Number.isFinite(avgPrice) || avgPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const market = form.market;
  const normalizedSymbol = normalizeSymbol(symbol, market);
  const now = new Date().toISOString();

  return {
    id: existing?.id ?? rowId(symbol, market),
    symbol,
    market,
    name: form.name.trim() || existing?.name,
    normalizedSymbol,
    avgPrice,
    quantity,
    currency: form.currency,
    memo: form.memo.trim() || undefined,
    updatedAt: now,
    data: existing?.data ?? null,
    meter: existing?.meter ?? null,
    loading: false,
    error: null,
  };
};

const toStoredPortfolioPosition = (position: PortfolioPosition): StoredPortfolioPosition => ({
  id: position.id,
  symbol: position.symbol,
  market: position.market,
  name: position.name,
  normalizedSymbol: position.normalizedSymbol,
  avgPrice: position.avgPrice,
  quantity: position.quantity,
  currency: position.currency,
  memo: position.memo,
  updatedAt: position.updatedAt,
});

const hydratePortfolioPosition = (position: StoredPortfolioPosition): PortfolioPosition => ({
  ...position,
  normalizedSymbol: position.normalizedSymbol || normalizeSymbol(position.symbol, position.market),
  data: null,
  meter: null,
  loading: false,
  error: null,
});

const getPortfolioMetrics = (position: PortfolioPosition) => {
  const marketCurrency = getMarketCurrency(position.market);
  const currencyMatched = marketCurrency === position.currency;
  const currentPrice = position.meter?.latest.price ?? null;
  const costBasis = currencyMatched ? position.avgPrice * position.quantity : null;
  const marketValue =
    currencyMatched && typeof currentPrice === "number" ? currentPrice * position.quantity : null;
  const pnl =
    typeof marketValue === "number" && typeof costBasis === "number" ? marketValue - costBasis : null;
  const pnlPct =
    typeof pnl === "number" && typeof costBasis === "number" && costBasis > 0 ? (pnl / costBasis) * 100 : null;

  return {
    marketCurrency,
    currencyMatched,
    currentPrice,
    costBasis,
    marketValue,
    pnl,
    pnlPct,
  };
};

const buildPortfolioSummary = (positions: PortfolioPosition[]) => {
  const initial = {
    USD: { marketValue: 0, costBasis: 0, pnl: 0 },
    KRW: { marketValue: 0, costBasis: 0, pnl: 0 },
  };

  return positions.reduce((summary, position) => {
    const metrics = getPortfolioMetrics(position);
    if (
      metrics.currencyMatched &&
      typeof metrics.marketValue === "number" &&
      typeof metrics.costBasis === "number" &&
      typeof metrics.pnl === "number"
    ) {
      summary[position.currency].marketValue += metrics.marketValue;
      summary[position.currency].costBasis += metrics.costBasis;
      summary[position.currency].pnl += metrics.pnl;
    }
    return summary;
  }, initial);
};

const getPortfolioValueLabel = (
  summary: ReturnType<typeof buildPortfolioSummary>,
  key: "marketValue" | "pnl",
) => {
  const values = [
    summary.USD[key] ? formatCurrencyAmount(summary.USD[key], "USD") : null,
    summary.KRW[key] ? formatCurrencyAmount(summary.KRW[key], "KRW") : null,
  ].filter(Boolean);
  return values.length ? values.join(" / ") : "--";
};

const getPortfolioPnlPctLabel = (summary: ReturnType<typeof buildPortfolioSummary>) => {
  const totalCost = summary.USD.costBasis + summary.KRW.costBasis;
  const totalPnl = summary.USD.pnl + summary.KRW.pnl;
  if (totalCost <= 0) {
    return "--";
  }
  return formatPercent((totalPnl / totalCost) * 100);
};

const getRowDisplayName = (row?: WatchRow | null) =>
  row?.name ?? row?.normalizedSymbol ?? row?.symbol ?? "--";

const getRowSymbolLabel = (row?: WatchRow | null) =>
  row?.normalizedSymbol || row?.symbol || "--";

const getLeaderMarketFromSymbol = (symbol: string): LeaderMarket =>
  symbol.endsWith(".KS") ? "KOSPI" : symbol.endsWith(".KQ") ? "KOSDAQ" : "US";

const getDisplaySymbol = (symbol: string) => symbol.replace(/\.(KS|KQ)$/i, "");

const getBriefingMarketLabel = (market: LeaderMarket) =>
  market === "US" ? "나스닥" : market === "KOSPI" ? "코스피" : "코스닥";

const getBriefingSessionLabel = (session?: DailyBriefingSession) =>
  session === "KR" ? "데일리 한국장" : "데일리 나스닥";

const getCandidateSourceStatusLabel = (status?: MarketBriefingReport["candidateSource"] extends infer Source
  ? Source extends { status?: infer Status } ? Status : never
  : never) => {
  switch (status) {
    case "dynamic":
      return "실시간 선별";
    case "mixed":
      return "혼합 선별";
    case "fallback":
      return "대체 목록 사용";
    default:
      return "명시 종목";
  }
};

const getBriefingDateKey = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const formatBriefingDateLabel = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "저장된 브리핑";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
};

const formatDateTimeLabel = (isoDate?: string) => {
  if (!isoDate) {
    return "--";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getReportThemes = (report: MarketBriefingReport) =>
  report.leadingThemes?.length ? report.leadingThemes : report.leadingSectors.map((sector) => ({
    ...sector,
    theme: sector.theme ?? sector.sector,
    score: 0,
    averageReturn5: sector.averageReturn5 ?? 0,
  }));

const buildBriefingSnapshotSummary = (response: MarketBriefingResponse) =>
  response.reports
    .map((report) => {
      const primaryTheme = getReportThemes(report)[0]?.theme ?? "주도테마 없음";
      return `${getBriefingMarketLabel(report.market)} ${primaryTheme}`;
    })
    .join(" / ");

const createMarketBriefingSnapshot = (response: MarketBriefingResponse): MarketBriefingSnapshot => {
  const dateKey = response.tradingDate ?? getBriefingDateKey(response.generatedAt);
  const markets = [...response.markets].sort();
  return {
    id: `${dateKey}:${response.session ?? markets.join(",")}`,
    dateKey,
    savedAt: new Date().toISOString(),
    session: response.session,
    markets,
    summary: buildBriefingSnapshotSummary(response),
    response,
  };
};

const translateDecision = (decision: LeaderCandidate["decision"]) => {
  switch (decision) {
    case "enter":
      return "진입 가능";
    case "hold":
      return "보유/관리";
    case "watch":
      return "관찰";
    case "avoid":
      return "회피";
  }
};

const translateTradeSetupType = (type?: TradeSetupType) => {
  switch (type) {
    case "breakout":
      return "돌파형";
    case "pullback":
      return "눌림형";
    case "reclaim":
      return "회복형";
    case "extended":
      return "보유형";
    case "risk-off":
      return "방어형";
    default:
      return "기준선 대기";
  }
};

const formatTradeSetupSummary = (tradeSetup?: TradeSetup | null) => {
  if (!tradeSetup) {
    return "기준선 대기";
  }
  return `${translateTradeSetupType(tradeSetup.type)} · 기준 ${formatPrice(tradeSetup.keyLevel)} / 실패 ${formatPrice(tradeSetup.failureLevel)}`;
};

const translatePatternType = (type?: PatternSignalType) => {
  switch (type) {
    case "box-breakout":
      return "박스권 돌파";
    case "triangle-breakout":
      return "수렴 돌파";
    case "cup-handle":
      return "컵앤핸들";
    case "new-high":
      return "신고가 돌파";
    case "ma-reclaim":
      return "20일선 회복";
    case "none":
    default:
      return "패턴 대기";
  }
};

const translateBreakoutSignalStatus = (status?: PatternSignalStatus) => {
  switch (status) {
    case "confirmed":
      return "돌파 확인";
    case "triggered":
      return "돌파 발생";
    case "retest":
      return "지지 재확인";
    case "extended":
      return "추세 진행중";
    case "failed":
      return "돌파 실패";
    case "watch":
    default:
      return "패턴 대기";
  }
};

const getBreakoutSignalTone = (status?: PatternSignalStatus) => {
  switch (status) {
    case "confirmed":
      return "trendEnter";
    case "triggered":
    case "retest":
      return "trendHold";
    case "extended":
      return "trendWatch";
    case "failed":
      return "trendExit";
    case "watch":
    default:
      return "trendWatch";
  }
};

const translateChartQualityGrade = (grade?: ChartQualityGrade) => {
  switch (grade) {
    case "excellent":
      return "매우 좋음";
    case "good":
      return "좋음";
    case "watch":
      return "관찰";
    case "weak":
    default:
      return "약함";
  }
};

const translateSignalReliabilityGrade = (grade?: SignalReliabilityGrade) => {
  switch (grade) {
    case "high":
      return "높음";
    case "medium":
      return "보통";
    case "low":
      return "낮음";
    case "insufficient-data":
    default:
      return "데이터 부족";
  }
};

const getSignalReliabilityTone = (grade?: SignalReliabilityGrade) => {
  switch (grade) {
    case "high":
      return "trendEnter";
    case "medium":
      return "trendHold";
    case "low":
      return "trendExit";
    case "insufficient-data":
    default:
      return "trendMuted";
  }
};

type AnalysisBreakoutDecision = {
  label: "진입 가능" | "분할 가능" | "확인 대기" | "리테스트 대기" | "추격 주의" | "제외";
  statusLabel: string;
  tone: "trendEnter" | "trendHold" | "trendWatch" | "trendExit" | "trendMuted";
  headline: string;
  metrics: Array<{ label: string; value: string }>;
  entryConditions: string[];
  failureConditions: string[];
  reasons: string[];
};

const hasBreakoutVolumeConfirmation = (
  breakoutSignal?: BreakoutSignal | null,
  breakoutRule?: BreakoutRule | null,
) => {
  const signalRatio = breakoutSignal?.volumeRatio;
  const ruleStatus = breakoutRule?.volumeConfirmation?.status;
  return (
    (typeof signalRatio === "number" && signalRatio >= 1.3) ||
    ruleStatus === "strong" ||
    ruleStatus === "confirmed"
  );
};

const buildAnalysisBreakoutDecision = (data?: MarketResponse | null): AnalysisBreakoutDecision => {
  const breakoutSignal = data?.breakoutSignal ?? null;
  const chartQuality = data?.chartQuality ?? null;
  const tradeSetup = data?.tradeSetup ?? null;
  const breakoutRule = data?.breakoutRule ?? null;
  const signalReliability = data?.signalReliability ?? null;
  const status = breakoutSignal?.status ?? "watch";
  const qualityOk = chartQuality ? chartQuality.grade !== "weak" : false;
  const weakQuality = chartQuality?.grade === "weak";
  const lowReliability = signalReliability?.grade === "low";
  const volumeConfirmed = hasBreakoutVolumeConfirmation(breakoutSignal, breakoutRule);
  const latestClose = data?.candles.at(-1)?.close ?? null;
  const riskOff =
    status === "failed" ||
    tradeSetup?.type === "risk-off" ||
    breakoutRule?.status === "risk-off" ||
    weakQuality ||
    lowReliability;
  const patternLabel = translatePatternType(breakoutSignal?.pattern);
  const breakoutLevel = breakoutSignal?.breakoutLevel ?? tradeSetup?.keyLevel ?? breakoutRule?.newHighLevel ?? null;
  const failureLevel = breakoutSignal?.failureLevel ?? tradeSetup?.failureLevel ?? breakoutRule?.fixedStopPrice ?? null;
  const breakoutDistancePct =
    typeof latestClose === "number" &&
    typeof breakoutLevel === "number" &&
    breakoutLevel > 0
      ? (latestClose - breakoutLevel) / breakoutLevel
      : breakoutRule?.breakoutDistancePct ?? null;
  const failureDistancePct =
    typeof latestClose === "number" &&
    typeof failureLevel === "number" &&
    latestClose > 0
      ? (latestClose - failureLevel) / latestClose
      : null;
  const elevatedEntryRisk =
    status === "extended" ||
    (typeof breakoutDistancePct === "number" && breakoutDistancePct >= 0.035) ||
    (typeof failureDistancePct === "number" && failureDistancePct >= 0.08);
  const probeEligible =
    (status === "confirmed" || status === "triggered" || status === "extended") &&
    qualityOk &&
    volumeConfirmed;
  const volumeLabel = breakoutSignal?.volumeRatio
    ? `${breakoutSignal.volumeRatio.toFixed(2)}x`
    : formatBreakoutVolume(breakoutRule);
  const reliabilityLabel = signalReliability
    ? `신뢰도 ${translateSignalReliabilityGrade(signalReliability.grade)}`
    : "신뢰도 대기";
  const entryConditions = [
    breakoutSignal?.entryPlan ?? tradeSetup?.entryPlan ?? `${patternLabel} 기준선 위 종가 유지 여부를 확인합니다.`,
    volumeConfirmed ? "거래량 확인은 충족했습니다." : "거래량이 20일 평균 대비 충분한지 확인합니다.",
    qualityOk ? `차트 품질은 ${translateChartQualityGrade(chartQuality?.grade)}입니다.` : "차트 품질이 약하면 신규 진입을 보류합니다.",
  ];
  const failureConditions = [
    breakoutSignal?.invalidation ?? tradeSetup?.invalidIf ?? `${formatPrice(failureLevel)} 아래 일봉 마감은 실패로 봅니다.`,
    tradeSetup?.stopReason ?? "돌파선 재이탈 또는 거래량 없는 윗꼬리는 실패 조건입니다.",
  ];
  const reasons = [
    breakoutSignal?.reasons[0],
    chartQuality?.reasons[0],
    signalReliability?.reasons[0] ?? reliabilityLabel,
  ].filter((reason): reason is string => Boolean(reason));

  if (riskOff) {
    return {
      label: "제외",
      statusLabel: "신규 진입 보류",
      tone: "trendExit",
      headline: weakQuality || lowReliability
        ? "돌파처럼 보여도 차트 품질 또는 신호 신뢰도가 약합니다. 신규 진입보다 후보 제외가 우선입니다."
        : "돌파 아이디어가 실패했거나 방어 기준을 위협합니다. 신규 진입보다 리스크 점검이 우선입니다.",
      metrics: [
        { label: "패턴", value: patternLabel },
        { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
        { label: "실패선", value: formatPrice(failureLevel) },
        { label: "거래량 배율", value: volumeLabel },
      ],
      entryConditions,
      failureConditions,
      reasons,
    };
  }

  if (probeEligible && elevatedEntryRisk) {
    return {
      label: "분할 가능",
      statusLabel: "탐색 진입",
      tone: "trendHold",
      headline: "돌파 신호와 거래량은 좋지만 이격 또는 손절폭 부담이 있습니다. 풀진입은 제외하고 1차 탐색 비중만 검토합니다.",
      metrics: [
        { label: "패턴", value: patternLabel },
        { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
        { label: "실패선", value: formatPrice(failureLevel) },
        { label: "거래량 배율", value: volumeLabel },
      ],
      entryConditions: [
        "계획 비중의 20~30% 이하 1차 탐색만 허용합니다.",
        breakoutSignal?.entryPlan ?? tradeSetup?.entryPlan ?? `${patternLabel} 기준선 위 종가 유지 여부를 확인합니다.`,
        "추가 진입은 돌파선 리테스트 또는 5일선 지지 확인 뒤로 미룹니다.",
      ],
      failureConditions,
      reasons: [
        ...(typeof breakoutDistancePct === "number" && breakoutDistancePct >= 0.035
          ? [`돌파선 대비 이격 ${formatRatio(breakoutDistancePct)}로 풀진입 부담이 있습니다.`]
          : []),
        ...(typeof failureDistancePct === "number" && failureDistancePct >= 0.08
          ? [`실패선까지 거리 ${formatRatio(failureDistancePct)}로 손절폭 부담이 있습니다.`]
          : []),
        ...reasons,
      ],
    };
  }

  if (status === "extended") {
    return {
      label: "추격 주의",
      statusLabel: "이미 진행",
      tone: "trendWatch",
      headline: "돌파 이후 상승이 이미 진행된 구간입니다. 추격보다 눌림이나 돌파선 지지를 기다립니다.",
      metrics: [
        { label: "패턴", value: patternLabel },
        { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
        { label: "실패선", value: formatPrice(failureLevel) },
        { label: "거래량 배율", value: volumeLabel },
      ],
      entryConditions,
      failureConditions,
      reasons,
    };
  }

  if (status === "confirmed" && qualityOk && volumeConfirmed) {
    return {
      label: "진입 가능",
      statusLabel: "조건 충족",
      tone: "trendEnter",
      headline: "돌파, 차트 품질, 거래량 확인이 맞물린 구간입니다. 실패선 기준을 정하고 제한적으로 접근할 수 있습니다.",
      metrics: [
        { label: "패턴", value: patternLabel },
        { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
        { label: "실패선", value: formatPrice(failureLevel) },
        { label: "거래량 배율", value: volumeLabel },
      ],
      entryConditions,
      failureConditions,
      reasons,
    };
  }

  if (status === "retest") {
    return {
      label: "리테스트 대기",
      statusLabel: "지지 확인",
      tone: "trendHold",
      headline: "돌파 후 기준선 지지 여부를 다시 확인하는 구간입니다. 지지 확인 전 추격 진입은 제한합니다.",
      metrics: [
        { label: "패턴", value: patternLabel },
        { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
        { label: "실패선", value: formatPrice(failureLevel) },
        { label: "거래량 배율", value: volumeLabel },
      ],
      entryConditions,
      failureConditions,
      reasons,
    };
  }

  return {
    label: "확인 대기",
    statusLabel: status === "triggered" ? "돌파 발생" : "패턴 대기",
    tone: status === "triggered" ? "trendHold" : "trendWatch",
    headline:
      status === "triggered"
        ? "가격 돌파는 발생했지만 차트 품질 또는 거래량 확인이 아직 부족합니다."
        : "명확한 돌파 조건이 아직 완성되지 않았습니다. 패턴 완성, 종가, 거래량을 더 확인합니다.",
    metrics: [
      { label: "패턴", value: patternLabel },
      { label: "돌파 기준선", value: formatPrice(breakoutLevel) },
      { label: "실패선", value: formatPrice(failureLevel) },
      { label: "거래량 배율", value: volumeLabel },
    ],
    entryConditions,
    failureConditions,
    reasons,
  };
};

const translateRejectionReason = (reason: string) => {
  if (reason.includes("Insufficient")) {
    return "추세 판단에 필요한 데이터가 아직 부족합니다.";
  }
  if (reason.includes("SMA20/SMA50 trend stack failed")) {
    return "SMA20/SMA50 추세 배열이 아직 충족되지 않았습니다.";
  }
  if (reason.includes("SMA20 is flat or falling") || reason.includes("SMA20 slope is weak")) {
    return "SMA20 기울기가 약하거나 하락 중입니다.";
  }
  if (reason.includes("Volume confirmation failed") || reason.includes("Volume confirmation is weak")) {
    return "거래량 확인이 부족합니다.";
  }
  if (reason.includes("Close strength failed") || reason.includes("Close strength is weak")) {
    return "종가가 당일 고점권에서 마감하지 못했습니다.";
  }
  if (reason.includes("Close is not above SMA20")) {
    return "종가가 SMA20 위에 안착하지 못했습니다.";
  }
  if (reason.includes("Entry cooldown is active")) {
    return "최근 진입 신호 이후 재진입 대기 구간입니다.";
  }
  return "추세 조건이 아직 충분하지 않습니다.";
};

const translateReason = (reason?: string | null) => {
  if (!reason) {
    return "추세 조건이 아직 충분하지 않습니다.";
  }
  if (reason.includes("Trend setup is already active")) {
    return "이미 추세가 진행 중입니다. 늦은 추격 진입은 차트 확인 후 판단하십시오.";
  }
  if (reason.includes("Market breadth filter failed")) {
    return "시장 전체 흐름이 약해 신규 진입을 보류합니다.";
  }
  if (reason.includes("Outside top")) {
    return "현재 상대강도 상위 후보 범위 밖입니다.";
  }
  if (reason.includes("Leader absolute momentum is too weak")) {
    return "대장주 기준의 절대 모멘텀이 아직 약합니다.";
  }
  if (reason.includes("Continuation entry conditions passed")) {
    return "추세 지속 진입 조건을 충족했습니다.";
  }
  if (reason.includes("20-day breakout entry conditions passed")) {
    return "20일 고점 돌파 진입 조건을 충족했습니다.";
  }
  if (reason.includes("Close broke SMA50 trend exit level")) {
    return "종가가 SMA50 추세 이탈 기준을 하회했습니다.";
  }
  if (reason.includes("Close slipped below SMA20")) {
    return "종가가 SMA20 아래로 밀렸지만 SMA50 추세는 아직 유지 중입니다.";
  }
  if (reason.includes("SMA5/SMA20 continuation")) {
    return "SMA5/SMA20 추세 지속 조건, 거래량, 종가 위치를 함께 충족했습니다.";
  }
  if (reason.includes("20-bar breakout")) {
    return "20개 봉 고점 돌파와 거래량 조건을 충족했습니다.";
  }
  if (reason.includes("Waiting for entry trigger")) {
    return "추세 구조는 관찰 가능하지만 신규 진입 트리거는 아직 없습니다.";
  }
  return translateRejectionReason(reason);
};

const getTrendState = (data?: MarketResponse | null) => {
  const trend = data?.trendFollowing;
  if (!trend) {
    return { label: "--", detail: "--", tone: "trendMuted" };
  }
  if (trend.activeSetup) {
    return {
      label: "보유/관리",
      detail: `손절 ${formatPrice(trend.activeSetup.initialStop)} / 이탈 ${formatPrice(trend.activeSetup.trendExitLevel)}`,
      tone: "trendHold",
    };
  }
  const latestSignal = trend.signals[trend.signals.length - 1];
  if (latestSignal?.type === "buy") {
    return {
      label: "진입 가능",
      detail: `진입 ${formatPrice(latestSignal.entryPrice)} / 손절 ${formatPrice(latestSignal.initialStop)}`,
      tone: "trendEnter",
    };
  }
  if (latestSignal?.action === "trend-exit") {
    return {
      label: "이탈",
      detail: translateReason(latestSignal.reason),
      tone: "trendExit",
    };
  }
  const latestFeature = trend.latestFeature;
  if (latestFeature?.rejectionReasons.length) {
    return {
      label: "대기",
      detail: translateRejectionReason(latestFeature.rejectionReasons[0]),
      tone: "trendWatch",
    };
  }
  return {
    label: "관찰",
    detail: "추세 조건을 계속 관찰하십시오.",
    tone: "trendWatch",
  };
};

const getRiskSummary = (chartBriefing: ReturnType<typeof buildChartBriefing>, trendDetail: string) => {
  if (chartBriefing?.levels.primaryStop) {
    return `손절 ${formatPrice(chartBriefing.levels.primaryStop)}`;
  }
  if (chartBriefing?.levels.hardStop) {
    return `이탈 ${formatPrice(chartBriefing.levels.hardStop)}`;
  }
  return trendDetail;
};

const buildPortfolioHoldingRead = (
  position: PortfolioPosition,
  chartBriefing: ReturnType<typeof buildChartBriefing>,
  trendState: ReturnType<typeof getTrendState>,
) => {
  const metrics = getPortfolioMetrics(position);
  if (position.loading) {
    return {
      label: "분석 중",
      tone: "trendMuted",
      headline: "보유 종목 데이터를 불러오는 중입니다.",
    };
  }
  if (position.error || !chartBriefing || typeof metrics.currentPrice !== "number") {
    return {
      label: "분석 대기",
      tone: "trendMuted",
      headline: position.error ?? "분석 갱신을 실행하면 보유 관점의 리스크 기준을 계산합니다.",
    };
  }

  const { currentPrice, currencyMatched, pnlPct } = metrics;
  const { sma5, sma20, primaryStop, hardStop } = chartBriefing.levels;
  const aboveSma5 = typeof sma5 === "number" && currentPrice >= sma5;
  const aboveSma20 = typeof sma20 === "number" && currentPrice >= sma20;
  const belowPrimaryStop = typeof primaryStop === "number" && currentPrice < primaryStop;
  const belowHardStop = typeof hardStop === "number" && currentPrice < hardStop;
  const profitable = currencyMatched && typeof pnlPct === "number" && pnlPct >= 0;

  if (belowHardStop || belowPrimaryStop) {
    return {
      label: "손절 검토",
      tone: "trendExit",
      headline: `현재가가 ${belowHardStop ? "강제 손절" : "1차 손절"} 기준을 이탈했습니다. 보유 논리 훼손 여부를 먼저 확인하십시오.`,
    };
  }

  if (currencyMatched && !profitable && !aboveSma20) {
    return {
      label: "손실 관리",
      tone: "trendExit",
      headline: "평단가 아래에서 20일선도 회복하지 못했습니다. 추가 매수보다 손실 한도 관리가 우선입니다.",
    };
  }

  if (profitable && aboveSma5) {
    return {
      label: "보유 유지",
      tone: "trendHold",
      headline: `평단가 대비 ${formatPercent(pnlPct ?? 0)}이고 현재가가 5일선 위입니다. 5일선 이탈 시 일부 수익 보호를 검토하십시오.`,
    };
  }

  if (profitable && aboveSma20) {
    return {
      label: "수익 보호",
      tone: "trendWatch",
      headline: "수익권이지만 5일선 탄력은 약합니다. 20일선 이탈 여부를 보유 기준으로 보십시오.",
    };
  }

  if (!currencyMatched) {
    return {
      label: trendState.label === "--" ? "추세 확인" : trendState.label,
      tone: trendState.tone,
      headline: `${position.currency} 평단과 ${metrics.marketCurrency} 현재가가 섞여 손익률은 계산하지 않습니다. 추세 기준만 참고하십시오.`,
    };
  }

  return {
    label: "회복 관찰",
    tone: aboveSma20 ? "trendWatch" : "trendExit",
    headline: aboveSma20
      ? "평단 회복 전이지만 20일선 위에 있습니다. 손절선을 좁히고 회복 여부를 관찰하십시오."
      : "평단 회복과 20일선 회복이 모두 필요합니다. 신규 비중 확대는 보류하는 편이 안전합니다.",
  };
};

const buildPortfolioTradePlan = (
  position: PortfolioPosition,
  chartBriefing: ReturnType<typeof buildChartBriefing>,
) => {
  const metrics = getPortfolioMetrics(position);
  const marketCurrency = metrics.marketCurrency;

  if (position.loading) {
    return {
      label: "분석 중",
      tone: "trendMuted",
      headline: "손절/익절 기준을 계산하는 중입니다.",
      managementPlan: null,
      stopItems: ["시장 데이터를 불러온 뒤 손절 기준을 다시 계산합니다."],
      profitItems: ["시장 데이터를 불러온 뒤 분할익절 기준을 다시 계산합니다."],
      managementItems: ["기준선 데이터가 계산될 때까지 추가 판단을 보류합니다."],
      blockers: [],
    };
  }

  if (position.error || !chartBriefing || typeof metrics.currentPrice !== "number") {
    return {
      label: "분석 대기",
      tone: "trendMuted",
      headline: position.error ?? "분석 갱신 후 손절/익절 기준을 확인할 수 있습니다.",
      managementPlan: null,
      stopItems: ["손절선 데이터가 아직 부족합니다."],
      profitItems: ["익절 목표가 데이터가 아직 부족합니다."],
      managementItems: ["5일선/20일선 지지 구간 데이터가 아직 부족합니다."],
      blockers: ["먼저 포트폴리오 분석 갱신을 실행하십시오."],
    };
  }

  const { currentPrice, currencyMatched, pnlPct } = metrics;
  const breakoutRule = position.data?.breakoutRule;
  const tradeSetup = position.data?.tradeSetup;
  const managementPlan = calculatePositionManagementPlan({
    currentPrice,
    averagePrice: position.avgPrice,
    quantity: position.quantity,
    currencyMatched,
    levels: chartBriefing.levels,
    breakoutRule,
    breakoutSignal: position.data?.breakoutSignal,
    tradeSetup,
    signalReliability: position.data?.signalReliability,
  });
  const takeProfitReady = managementPlan.takeProfitLevels.some(
    (item) => item.id.startsWith("take-profit") && item.status === "triggered",
  );
  const label =
    managementPlan.bias === "defense"
      ? "방어 우선"
      : managementPlan.bias === "take-profit" || takeProfitReady
        ? "분할익절"
        : managementPlan.bias === "wait"
          ? "확인 대기"
          : "보유 관리";
  const tone =
    managementPlan.bias === "defense"
      ? "trendExit"
      : managementPlan.bias === "take-profit"
        ? "trendHold"
        : managementPlan.bias === "wait"
          ? "trendWatch"
          : "trendHold";
  const blockers = [
    !currencyMatched ? `${position.currency} 평단과 ${marketCurrency} 현재가가 달라 손익 기반 추가매수는 보류합니다.` : null,
    managementPlan.setupStop.status === "triggered" ? "돌파매매 손절선 이탈로 추가매수 금지 구간입니다." : null,
    currencyMatched && typeof pnlPct === "number" && pnlPct < 0 && managementPlan.bias === "defense"
      ? "평단 아래에서 20일선도 회복하지 못해 물타기 위험이 큽니다."
      : null,
    ...managementPlan.riskWarnings,
  ].filter((item): item is string => Boolean(item));

  return {
    label,
    tone,
    headline: managementPlan.headline,
    managementPlan,
    stopItems: managementPlan.stagedExitPlan.map((item) =>
      `${item.label}: ${formatCurrencyAmount(item.price, marketCurrency)} 기준 ${item.allocationPct ?? 0}% 대응. ${item.note}`,
    ),
    profitItems: [
      typeof pnlPct === "number"
        ? `현재 손익률은 ${formatPercent(pnlPct)}입니다.`
        : "통화 기준이 달라 손익률 기반 익절 판단은 제외합니다.",
      ...managementPlan.takeProfitLevels.map((item) =>
        `${item.label}: ${formatCurrencyAmount(item.price, marketCurrency)} 기준 ${item.allocationPct ?? 0}% 대응. ${item.note}`,
      ),
    ],
    managementItems: [
      managementPlan.reentryCondition,
      tradeSetup
        ? `${tradeSetup.keyLevelLabel}: ${formatCurrencyAmount(tradeSetup.keyLevel, marketCurrency)} 위 종가 유지 시 보유 논리를 유지합니다.`
        : "핵심 기준선은 종목 분석 갱신 후 확인합니다.",
      "손실 중 비중 확대는 기본 전략에서 제외하고, 회복 확인 뒤 재진입 후보로만 봅니다.",
    ],
    blockers: [
      ...blockers,
      tradeSetup?.type === "risk-off" ? tradeSetup.invalidIf : null,
    ].filter((item): item is string => Boolean(item)),
  };
};

const buildPortfolioDailyAction = (
  position: PortfolioPosition,
  chartBriefing: ReturnType<typeof buildChartBriefing>,
): PortfolioDailyAction => {
  const metrics = getPortfolioMetrics(position);
  return calculatePortfolioDailyAction({
    loading: position.loading,
    error: position.error,
    marketCurrency: metrics.marketCurrency,
    currentPrice: metrics.currentPrice,
    pnlPct: metrics.pnlPct,
    currencyMatched: metrics.currencyMatched,
    levels: {
      sma5: chartBriefing?.levels.sma5,
      sma20: chartBriefing?.levels.sma20,
      primaryStop: chartBriefing?.levels.primaryStop,
      hardStop: chartBriefing?.levels.hardStop,
      resistance: chartBriefing?.levels.resistance,
    },
    signalReliability: position.data?.signalReliability,
    breakoutSignal: position.data?.breakoutSignal,
    tradeSetup: position.data?.tradeSetup,
  });
};

const getPositionPlanTone = (bias: PositionManagementPlan["bias"]) => {
  switch (bias) {
    case "defense":
      return "trendExit";
    case "take-profit":
      return "trendHold";
    case "wait":
      return "trendWatch";
    case "hold":
    default:
      return "trendHold";
  }
};

const getPositionPlanLabel = (bias: PositionManagementPlan["bias"]) => {
  switch (bias) {
    case "defense":
      return "방어 우선";
    case "take-profit":
      return "분할익절";
    case "wait":
      return "확인 대기";
    case "hold":
    default:
      return "보유 관리";
  }
};

const renderPlanLevel = (level: PositionManagementPlan["setupStop"], currency: PortfolioCurrency) => (
  <div key={level.id}>
    <span>{level.label}</span>
    <strong>{formatCurrencyAmount(level.price, currency)}</strong>
    <p>
      {level.allocationPct ? `${level.allocationPct}% · ` : ""}
      {formatRatio(level.distancePct)}
    </p>
  </div>
);

const PositionManagementPanel = ({
  plan,
  currency,
  title = "리스크 관리",
}: {
  plan: PositionManagementPlan;
  currency: PortfolioCurrency;
  title?: string;
}) => (
  <div className={styles.positionPlanPanel}>
    <div className={styles.positionPlanHeader}>
      <div>
        <span>{title}</span>
        <strong>{plan.headline}</strong>
      </div>
      <span className={`${styles.trendPill} ${styles[getPositionPlanTone(plan.bias)]}`}>
        {getPositionPlanLabel(plan.bias)}
      </span>
    </div>
    <div className={styles.positionPlanLevels}>
      {renderPlanLevel(plan.setupStop, currency)}
      {renderPlanLevel(plan.portfolioStop, currency)}
      {renderPlanLevel(plan.takeProfitLevels[0], currency)}
      {renderPlanLevel(plan.takeProfitLevels[1], currency)}
    </div>
    <div className={styles.positionPlanActions}>
      <article>
        <span>분할 손절</span>
        <ul>
          {plan.stagedExitPlan.map((item) => (
            <li key={item.id}>
              {item.label} {formatCurrencyAmount(item.price, currency)} 기준 {item.allocationPct ?? 0}%
            </li>
          ))}
        </ul>
      </article>
      <article>
        <span>분할익절</span>
        <ul>
          {plan.takeProfitLevels.map((item) => (
            <li key={item.id}>
              {item.label} {formatCurrencyAmount(item.price, currency)} 기준 {item.allocationPct ?? 0}%
            </li>
          ))}
        </ul>
      </article>
      <article>
        <span>재진입/주의</span>
        <p>{plan.reentryCondition}</p>
        {plan.riskWarnings.length ? (
          <ul>
            {plan.riskWarnings.slice(0, 2).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </article>
    </div>
  </div>
);

const HelpTip = ({ text }: { text: string }) => {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const maxWidth = 260;
    const margin = 12;
    const centeredLeft = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centeredLeft, margin + maxWidth / 2), window.innerWidth - margin - maxWidth / 2);
    const showBelow = rect.bottom + 92 < window.innerHeight;

    setTooltipStyle({
      left,
      maxWidth,
      top: showBelow ? rect.bottom + 8 : rect.top - 8,
      transform: showBelow ? "translateX(-50%)" : "translate(-50%, -100%)",
    });
  };

  return (
    <span
      ref={triggerRef}
      className={styles.helpTip}
      tabIndex={0}
      aria-label={text}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setTooltipStyle(null);
        }
      }}
    >
      ?
      {tooltipStyle && typeof document !== "undefined"
        ? createPortal(
            <span className={styles.helpTipBubble} role="tooltip" style={tooltipStyle}>
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  mapper: (value: T) => Promise<R>,
  concurrency = 3,
) => {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

const getMeterTone = (score: number): PainMeter["tone"] => {
  if (score >= 70) return "panic";
  if (score >= 50) return "warning";
  if (score >= 30) return "watch";
  return "calm";
};

const getMeterCopy = (score: number) => {
  if (score >= 85) {
    return {
      level: "대합창",
      verdict: "투매와 공포가 동시에 잡힙니다. 반등 욕심보다 손실 한도와 현금 비중 확인이 우선입니다.",
    };
  }
  if (score >= 70) {
    return {
      level: "곡소리",
      verdict: "체감 손실이 꽤 큽니다. 바닥 신호를 보더라도 분할 접근이 적절합니다.",
    };
  }
  if (score >= 50) {
    return {
      level: "비명 전조",
      verdict: "하락 압력이 누적되고 있습니다. 추세 회복 전까지 무리한 추격은 불리합니다.",
    };
  }
  if (score >= 30) {
    return {
      level: "한숨",
      verdict: "불편한 조정 구간입니다. 아직 공포 매수 구간으로 단정하기는 이릅니다.",
    };
  }
  return {
    level: "평온",
    verdict: "가격 훼손과 공포 지표가 낮습니다. 큰 곡소리는 아직 감지되지 않습니다.",
  };
};

const buildPainMeter = (data: MarketResponse): PainMeter | null => {
  if (!data.candles.length) {
    return null;
  }

  const candles = data.candles;
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const window60 = candles.slice(-60);
  const window20 = candles.slice(-20);
  const high60 = Math.max(...window60.map((candle) => candle.high));
  const low60 = Math.min(...window60.map((candle) => candle.low));
  const avgVolume20 =
    window20.reduce((sum, candle) => sum + candle.volume, 0) / Math.max(1, window20.length);
  const rsi = lastValue(data.indicators.rsi);
  const adx = lastValue(data.indicators.adx);
  const sma20 = lastValue(data.indicators.sma["20"]);
  const sma60 = lastValue(data.indicators.sma["60"]);
  const sma100 = lastValue(data.indicators.sma["100"]);
  const changePct = ((latest.close - previous.close) / previous.close) * 100;
  const drawdownPct = high60 > 0 ? ((high60 - latest.close) / high60) * 100 : 0;
  const volumeRatio = avgVolume20 > 0 ? latest.volume / avgVolume20 : 1;
  const brokenAverages = [sma20, sma60, sma100].filter(
    (value) => value !== null && latest.close < value,
  ).length;

  const drawdownScore = clamp((drawdownPct / 35) * 26);
  const rsiScore = rsi === null ? 8 : clamp(((45 - rsi) / 35) * 22);
  const volumeScore = clamp(((volumeRatio - 1) / 2) * 16);
  const trendScore = clamp((brokenAverages / 3) * 20 + (adx !== null && adx > 28 ? 6 : 0));
  const dayScore = clamp((-changePct / 6) * 10);
  const score = Math.round(
    clamp(drawdownScore + rsiScore + volumeScore + trendScore + dayScore),
  );
  const copy = getMeterCopy(score);

  return {
    score,
    level: copy.level,
    verdict: copy.verdict,
    tone: getMeterTone(score),
    factors: [
      {
        key: "drawdown",
        label: "고점 대비 훼손",
        score: drawdownScore,
        value: `-${drawdownPct.toFixed(1)}%`,
        detail: `60개 봉 범위 ${low60.toFixed(2)} - ${high60.toFixed(2)}`,
      },
      {
        key: "rsi",
        label: "RSI 공포",
        score: rsiScore,
        value: rsi === null ? "부족" : rsi.toFixed(1),
        detail: "45 아래로 내려갈수록 가중",
      },
      {
        key: "volume",
        label: "거래량 비명",
        score: volumeScore,
        value: `${volumeRatio.toFixed(2)}x`,
        detail: "최근 20개 봉 평균 대비",
      },
      {
        key: "trend",
        label: "추세 훼손",
        score: trendScore,
        value: `${brokenAverages}/3`,
        detail: "SMA 20, 60, 100 하회 여부",
      },
      {
        key: "session",
        label: "직전 봉 충격",
        score: dayScore,
        value: formatPercent(changePct),
        detail: "마지막 종가 변화율",
      },
    ],
    latest: {
      price: latest.close,
      changePct,
      drawdownPct,
      rsi,
      adx,
      volumeRatio,
    },
  };
};

export default function Home() {
  const [rows, setRows] = useState<WatchRow[]>(
    defaultWatchlist.map((row) => createEmptyRow(row.symbol, row.market, row.name)),
  );
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTab>("watchlist");
  const [portfolioPositions, setPortfolioPositions] = useState<PortfolioPosition[]>([]);
  const [portfolioForm, setPortfolioForm] = useState<PortfolioFormState>(() => createEmptyPortfolioForm());
  const [portfolioFormError, setPortfolioFormError] = useState<string | null>(null);
  const [editingPortfolioId, setEditingPortfolioId] = useState<string | null>(null);
  const [expandedPortfolioId, setExpandedPortfolioId] = useState<string | null>(null);
  const [expandedPortfolioTradeId, setExpandedPortfolioTradeId] = useState<string | null>(null);
  const [portfolioHydrated, setPortfolioHydrated] = useState(false);
  const [refreshingPortfolio, setRefreshingPortfolio] = useState(false);
  const [tossWorkbench, setTossWorkbench] = useState<TossWorkbenchResponse | null>(null);
  const [tossWorkbenchLoading, setTossWorkbenchLoading] = useState(false);
  const [tossWorkbenchError, setTossWorkbenchError] = useState<string | null>(null);
  const [tossSyncing, setTossSyncing] = useState(false);
  const [paperTradingState, setPaperTradingState] = useState<PaperTradingState>(() => createDefaultPaperTradingState());
  const [activePaperSession, setActivePaperSession] = useState<PaperTradingSession>("US");
  const [paperTradingStorageLabel] = useState("Supabase Auth 사용자별 보안 저장소");
  const [paperTradingRefreshing, setPaperTradingRefreshing] = useState(false);
  const [paperTradingRunning, setPaperTradingRunning] = useState(false);
  const [paperTradingError, setPaperTradingError] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [newMarket, setNewMarket] = useState("US");
  const [analysisSymbol, setAnalysisSymbol] = useState("NVDA");
  const [analysisMarket, setAnalysisMarket] = useState("US");
  const [selectedAnalysis, setSelectedAnalysis] = useState<WatchRow | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [expandedScanMarkets, setExpandedScanMarkets] = useState<LeaderMarket[]>([]);
  const [activeBriefingSession, setActiveBriefingSession] =
    useState<DailyBriefingSession>("US");
  const [activeDailyBriefingTab, setActiveDailyBriefingTab] =
    useState<DailyBriefingInnerTab>("summary");
  const [marketBriefing, setMarketBriefing] = useState<MarketBriefingResponse | null>(null);
  const [marketBriefingLoading, setMarketBriefingLoading] = useState(false);
  const [marketBriefingError, setMarketBriefingError] = useState<string | null>(null);
  const [briefingSnapshots, setBriefingSnapshots] = useState<MarketBriefingSnapshot[]>([]);
  const [briefingSnapshotsHydrated, setBriefingSnapshotsHydrated] = useState(false);
  const [activeBriefingSnapshotId, setActiveBriefingSnapshotId] = useState<string | null>(null);
  const [activeMarketTab, setActiveMarketTab] = useState<MarketTab>("ALL");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [expandedRiskRowId, setExpandedRiskRowId] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState("365");
  const [timeframe, setTimeframe] = useState("1d");
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    const tabFromQuery = getWorkbenchTabFromQuery(new URLSearchParams(window.location.search).get("tab"));
    if (tabFromQuery) {
      setActiveWorkbenchTab(tabFromQuery);
    }
  }, []);

  const visibleRows = useMemo(
    () => {
      if (activeMarketTab === "ALL") {
        return rows;
      }
      if (activeMarketTab === "FAVORITES") {
        return rows.filter((row) => favoriteIds.has(row.id));
      }
      return rows.filter((row) => row.market === activeMarketTab);
    },
    [activeMarketTab, favoriteIds, rows],
  );
  const portfolioSummary = useMemo(
    () => buildPortfolioSummary(portfolioPositions),
    [portfolioPositions],
  );
  const portfolioRiskCount = useMemo(
    () =>
      portfolioPositions.filter((position) => {
        const chartBriefing = buildChartBriefing(position as BriefingRow);
        const trendState = getTrendState(position.data);
        const read = buildPortfolioHoldingRead(position, chartBriefing, trendState);
        return read.tone === "trendExit" || read.label === "손절 검토";
      }).length,
    [portfolioPositions],
  );
  const portfolioProfitCount = useMemo(
    () =>
      portfolioPositions.filter((position) => {
        const metrics = getPortfolioMetrics(position);
        return typeof metrics.pnl === "number" && metrics.pnl > 0;
      }).length,
    [portfolioPositions],
  );
  const portfolioDailyActions = useMemo(
    () =>
      portfolioPositions
        .map((position) => ({
          position,
          action: buildPortfolioDailyAction(position, buildChartBriefing(position as BriefingRow)),
        }))
        .toSorted((left, right) => right.action.priority - left.action.priority)
        .slice(0, 6),
    [portfolioPositions],
  );
  const pricePainLeader = useMemo(
    () =>
      [...visibleRows]
        .filter((row) => row.meter)
        .sort((left, right) => (right.meter?.score ?? 0) - (left.meter?.score ?? 0))[0] ?? null,
    [visibleRows],
  );
  const drawdownLeader = useMemo(
    () =>
      [...visibleRows]
        .filter((row) => row.meter)
        .sort((left, right) => (right.meter?.latest.drawdownPct ?? 0) - (left.meter?.latest.drawdownPct ?? 0))[0] ?? null,
    [visibleRows],
  );
  const rsiLeader = useMemo(
    () =>
      [...visibleRows]
        .filter((row) => typeof row.meter?.latest.rsi === "number")
        .sort((left, right) => (left.meter?.latest.rsi ?? 100) - (right.meter?.latest.rsi ?? 100))[0] ?? null,
    [visibleRows],
  );
  const dropLeader = useMemo(
    () =>
      [...visibleRows]
        .filter((row) => row.meter)
        .sort((left, right) => (left.meter?.latest.changePct ?? 0) - (right.meter?.latest.changePct ?? 0))[0] ?? null,
    [visibleRows],
  );
  const fetchRow = async (
    row: WatchRow,
    options?: { rangeDays?: string; timeframe?: string },
  ): Promise<WatchRow> => {
    const normalizedSymbol = normalizeSymbol(row.symbol, row.market);
    if (!normalizedSymbol) {
      return { ...row, loading: false, error: "종목 코드 필요" };
    }

    try {
      const nextRangeDays = options?.rangeDays ?? rangeDays;
      const nextTimeframe = options?.timeframe ?? timeframe;
      const marketResponse = await fetch(
        `/api/market/${encodeURIComponent(normalizedSymbol)}?days=${nextRangeDays}&tf=${nextTimeframe}`,
      );
      if (!marketResponse.ok) {
        throw new Error("시장 데이터 실패");
      }

      const payload = (await marketResponse.json()) as MarketResponse;
      return {
        ...row,
        normalizedSymbol,
        data: payload,
        meter: buildPainMeter(payload),
        loading: false,
        error: null,
      };
    } catch (error) {
      return {
        ...row,
        normalizedSymbol,
        data: null,
        meter: null,
        loading: false,
        error: error instanceof Error ? error.message : "측정 실패",
      };
    }
  };

  const fetchPortfolioPosition = async (position: PortfolioPosition): Promise<PortfolioPosition> => {
    const row = createEmptyRow(position.symbol, position.market, position.name);
    const updated = await fetchRow({ ...row, loading: true }, { rangeDays: "365", timeframe: "1d" });
    return {
      ...position,
      normalizedSymbol: updated.normalizedSymbol,
      data: updated.data,
      meter: updated.meter,
      loading: false,
      error: updated.error,
    };
  };

  const refreshPortfolioPositions = async (targetPositions = portfolioPositions) => {
    if (!targetPositions.length) {
      return;
    }
    setRefreshingPortfolio(true);
    setPortfolioPositions((currentPositions) =>
      currentPositions.map((position) =>
        targetPositions.some((target) => target.id === position.id)
          ? { ...position, loading: true, error: null }
          : position,
      ),
    );
    const refreshed = await mapWithConcurrency(
      targetPositions,
      (position) => fetchPortfolioPosition({ ...position, loading: true, error: null }),
      3,
    );
    setPortfolioPositions((currentPositions) =>
      currentPositions.map((position) => refreshed.find((updated) => updated.id === position.id) ?? position),
    );
    setRefreshingPortfolio(false);
  };

  const savePortfolioPositions = async (positions: PortfolioPosition[]) => {
    const response = await fetch("/api/portfolio/positions", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        positions: positions.map((position) => toStoredPortfolioPosition(position)),
      }),
    });
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, "포트폴리오 저장 실패"));
    }
    const payload = (await response.json()) as PortfolioPositionsResponse;
    return payload.positions.map((position) => hydratePortfolioPosition(position));
  };

  const loadTossWorkbench = async () => {
    setTossWorkbenchLoading(true);
    setTossWorkbenchError(null);
    try {
      const response = await fetch("/api/toss/workbench", { cache: "no-store" });
      if (response.status === 401) {
        // ponytail: null이면 3111행 effect가 무한 재요청하므로 비연결 상태로 고정
        setTossWorkbench({ connected: false });
        return null;
      }
      const payload = (await response.json()) as TossWorkbenchResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "토스 연결 정보를 불러오지 못했습니다.");
      }
      setTossWorkbench(payload);
      return payload;
    } catch (error) {
      setTossWorkbenchError(error instanceof Error ? error.message : "토스 연결 정보를 불러오지 못했습니다.");
      return null;
    } finally {
      setTossWorkbenchLoading(false);
    }
  };

  const syncTossPortfolio = async () => {
    setTossSyncing(true);
    setPortfolioFormError(null);
    try {
      const payload = tossWorkbench?.connected ? tossWorkbench : await loadTossWorkbench();
      if (!payload?.connected) {
        setPortfolioFormError("로그인 후 토스 API 키를 등록해야 보유 주식을 가져올 수 있습니다.");
        return;
      }
      const imported = (payload.positions ?? []).map((position) =>
        hydratePortfolioPosition({
          id: position.id,
          symbol: position.symbol,
          market: position.market,
          name: position.name,
          normalizedSymbol: position.normalizedSymbol,
          avgPrice: position.avgPrice,
          quantity: position.quantity,
          currency: position.currency,
          memo: position.warnings.length
            ? `${position.memo ?? "토스 보유자산에서 동기화"} · 유의 ${position.warnings.length}건`
            : position.memo,
          updatedAt: position.updatedAt,
        }),
      );
      setPortfolioPositions(imported);
      const saved = await savePortfolioPositions(imported);
      setPortfolioPositions(saved);
      void refreshPortfolioPositions(saved);
    } catch (error) {
      setPortfolioFormError(error instanceof Error ? error.message : "토스 보유 주식 동기화 실패");
    } finally {
      setTossSyncing(false);
    }
  };

  const resetPortfolioForm = (market = portfolioForm.market) => {
    setPortfolioForm(createEmptyPortfolioForm(market));
    setEditingPortfolioId(null);
    setPortfolioFormError(null);
  };

  const submitPortfolioPosition = async () => {
    const editingPosition =
      editingPortfolioId !== null
        ? portfolioPositions.find((position) => position.id === editingPortfolioId) ?? null
        : null;
    const position = createPortfolioPosition(portfolioForm, editingPosition);
    if (!position) {
      setPortfolioFormError("종목, 평단가, 수량을 올바르게 입력하십시오.");
      return;
    }
    if (!editingPosition && portfolioPositions.some((item) => item.id === position.id)) {
      setPortfolioFormError("이미 등록된 종목입니다. 기존 항목을 수정하십시오.");
      return;
    }

    setPortfolioFormError(null);
    const nextPositions = editingPosition
      ? portfolioPositions.map((item) => (item.id === editingPosition.id ? position : item))
      : [position, ...portfolioPositions];
    setPortfolioPositions(nextPositions.map((item) => (
      item.id === position.id ? { ...item, loading: true } : item
    )));
    resetPortfolioForm(position.market);
    try {
      await savePortfolioPositions(nextPositions);
      const updated = await fetchPortfolioPosition({ ...position, loading: true, error: null });
      setPortfolioPositions((currentPositions) =>
        currentPositions.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setPortfolioFormError(error instanceof Error ? error.message : "포트폴리오 저장 실패");
      setPortfolioPositions(portfolioPositions);
    }
  };

  const editPortfolioPosition = (position: PortfolioPosition) => {
    setEditingPortfolioId(position.id);
    setPortfolioForm({
      symbol: getDisplaySymbol(position.symbol),
      market: position.market,
      name: position.name ?? "",
      avgPrice: String(position.avgPrice),
      quantity: String(position.quantity),
      currency: position.currency,
      memo: position.memo ?? "",
    });
    setPortfolioFormError(null);
  };

  const removePortfolioPosition = (position: PortfolioPosition) => {
    const nextPositions = portfolioPositions.filter((item) => item.id !== position.id);
    setPortfolioPositions(nextPositions);
    if (editingPortfolioId === position.id) {
      resetPortfolioForm(position.market);
    }
    if (expandedPortfolioId === position.id) {
      setExpandedPortfolioId(null);
    }
    if (expandedPortfolioTradeId === position.id) {
      setExpandedPortfolioTradeId(null);
    }
    void savePortfolioPositions(nextPositions).catch((error) => {
      setPortfolioFormError(error instanceof Error ? error.message : "포트폴리오 저장 실패");
      setPortfolioPositions(portfolioPositions);
    });
  };

  const openPortfolioAnalysis = async (position: PortfolioPosition) => {
    const displaySymbol = getDisplaySymbol(position.symbol);
    setRangeDays("365");
    setTimeframe("1d");
    setAnalysisSymbol(displaySymbol);
    setAnalysisMarket(position.market);
    setSelectedAnalysis({
      id: position.id,
      symbol: displaySymbol,
      name: position.name,
      market: position.market,
      normalizedSymbol: position.normalizedSymbol,
      data: position.data,
      meter: position.meter,
      loading: position.loading,
      error: position.error,
    });
    setActiveWorkbenchTab("analysis");
    if (!position.data && !position.loading) {
      await runSingleAnalysis(displaySymbol, position.market);
    }
  };

  const refreshRows = async (targetRows = rows) => {
    setRefreshingAll(true);
    setRows((currentRows) =>
      currentRows.map((row) =>
        targetRows.some((target) => target.id === row.id) ? { ...row, loading: true, error: null } : row,
      ),
    );
    const refreshed = await mapWithConcurrency(targetRows, (row) => fetchRow({ ...row, loading: true }), 3);
    setRows((currentRows) =>
      currentRows.map((row) => refreshed.find((updated) => updated.id === row.id) ?? row),
    );
    setRefreshingAll(false);
  };

  const refreshSingleRow = async (row: WatchRow) => {
    setRows((currentRows) =>
      currentRows.map((item) => (item.id === row.id ? { ...item, loading: true, error: null } : item)),
    );
    const updated = await fetchRow({ ...row, loading: true });
    setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? updated : item)));
  };

  const addWatchRow = async () => {
    const symbol = newSymbol.trim();
    if (!symbol) {
      return;
    }
    const row = createEmptyRow(symbol, newMarket);
    if (rows.some((item) => item.id === row.id)) {
      setNewSymbol("");
      return;
    }
    setRows((currentRows) => [...currentRows, { ...row, loading: true }]);
    setNewSymbol("");
    const updated = await fetchRow({ ...row, loading: true });
    setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? updated : item)));
  };

  const removeWatchRow = (row: WatchRow) => {
    setRows((currentRows) => currentRows.filter((item) => item.id !== row.id));
  };

  const toggleFavorite = (row: WatchRow) => {
    setFavoriteIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(row.id)) {
        nextIds.delete(row.id);
      } else {
        nextIds.add(row.id);
      }
      return nextIds;
    });
  };

  const changeMarketTab = (tab: MarketTab) => {
    setActiveMarketTab(tab);
  };

  const selectWatchSymbol = (item: SymbolSearchItem) => {
    setNewSymbol(item.displaySymbol);
    setNewMarket(item.market);
  };

  const selectPortfolioSymbol = (item: SymbolSearchItem) => {
    setPortfolioForm((current) => ({
      ...current,
      symbol: item.displaySymbol,
      market: item.market,
      name: item.name,
      currency: item.currency ?? getMarketCurrency(item.market),
    }));
  };

  const selectAnalysisSymbol = (item: SymbolSearchItem) => {
    setAnalysisSymbol(item.displaySymbol);
    setAnalysisMarket(item.market);
  };

  const saveMarketBriefingSnapshot = (response: MarketBriefingResponse) => {
    const snapshot = createMarketBriefingSnapshot(response);
    setBriefingSnapshots((currentSnapshots) => {
      const nextSnapshots = [
        snapshot,
        ...currentSnapshots.filter((item) => item.id !== snapshot.id),
      ].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      return nextSnapshots.slice(0, maxMarketBriefingSnapshots);
    });
    setActiveBriefingSnapshotId(snapshot.id);
  };

  const loadMarketBriefingSnapshot = (snapshot: MarketBriefingSnapshot) => {
    setMarketBriefing(snapshot.response);
    setActiveBriefingSession(snapshot.session ?? (snapshot.markets.includes("US") ? "US" : "KR"));
    setActiveBriefingSnapshotId(snapshot.id);
    setMarketBriefingError(null);
    setExpandedScanMarkets([]);
  };

  const fetchMarketBriefing = async () => {
    setMarketBriefingLoading(true);
    setMarketBriefingError(null);
    try {
      const response = await fetch(
        `/api/briefing/daily-market?session=${activeBriefingSession}`,
      );
      if (!response.ok) {
        throw new Error("시장 브리핑 생성 실패");
      }
      const payload = (await response.json()) as MarketBriefingResponse;
      setMarketBriefing(payload);
      setExpandedScanMarkets([]);
      saveMarketBriefingSnapshot(payload);
    } catch (error) {
      setMarketBriefingError(error instanceof Error ? error.message : "시장 브리핑 생성 실패");
    } finally {
      setMarketBriefingLoading(false);
    }
  };

  const readApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const payload = (await response.json()) as { error?: unknown };
      return typeof payload.error === "string" ? payload.error : fallback;
    } catch {
      return fallback;
    }
  };

  const refreshPaperTradingState = async () => {
    setPaperTradingRefreshing(true);
    setPaperTradingError(null);
    try {
      const response = await fetch("/api/paper-trading/state", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "페이퍼 저장 상태 조회 실패"));
      }
      const payload = (await response.json()) as PaperTradingStateResponse;
      setPaperTradingState(payload.state);
      if (payload.repaired) {
        setPaperTradingError("상태 파일을 기본값으로 복구했습니다.");
      }
    } catch (error) {
      setPaperTradingError(error instanceof Error ? error.message : "페이퍼 저장 상태 조회 실패");
    } finally {
      setPaperTradingRefreshing(false);
    }
  };

  const runPaperTrading = async () => {
    setPaperTradingRunning(true);
    setPaperTradingError(null);
    try {
      const response = await fetch("/api/paper-trading/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: activePaperSession,
          source: "manual",
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "페이퍼 자동운용 실행 실패"));
      }
      const payload = (await response.json()) as PaperTradingRunResponse;
      setPaperTradingState(payload.state);
      if (payload.run.status === "skipped") {
        setPaperTradingError(payload.run.summary);
      }
    } catch (error) {
      setPaperTradingError(error instanceof Error ? error.message : "페이퍼 자동운용 실행 실패");
    } finally {
      setPaperTradingRunning(false);
    }
  };

  const resetPaperTrading = async () => {
    setPaperTradingRunning(true);
    setPaperTradingError(null);
    try {
      const response = await fetch("/api/paper-trading/reset", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, "페이퍼 자동운용 초기화 실패"));
      }
      const payload = (await response.json()) as PaperTradingStateResponse;
      setPaperTradingState(payload.state);
    } catch (error) {
      setPaperTradingError(error instanceof Error ? error.message : "페이퍼 자동운용 초기화 실패");
    } finally {
      setPaperTradingRunning(false);
    }
  };

  const exportPaperTrading = () => {
    const blob = new Blob([JSON.stringify(paperTradingState, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stock-analysis-paper-trading-${getPaperTodayKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runSingleAnalysis = async (symbol = analysisSymbol, market = analysisMarket) => {
    const nextSymbol = symbol.trim();
    if (!nextSymbol) {
      setAnalysisError("분석할 종목 코드를 입력하십시오.");
      return;
    }

    const row = createEmptyRow(nextSymbol, market);
    setAnalysisSymbol(row.symbol.replace(/\.(KS|KQ)$/i, ""));
    setAnalysisMarket(market);
    setAnalysisLoading(true);
    setAnalysisError(null);
    const updated = await fetchRow({ ...row, loading: true });
    setSelectedAnalysis(updated);
    setAnalysisLoading(false);
    setAnalysisError(updated.error);
  };

  const toggleScanCandidates = (market: LeaderMarket) => {
    setExpandedScanMarkets((currentMarkets) =>
      currentMarkets.includes(market)
        ? currentMarkets.filter((item) => item !== market)
        : [...currentMarkets, market],
    );
  };

  const openDailyCandidateAnalysis = async (candidate: DailyAnalysisCandidate) => {
    const nextMarket = getLeaderMarketFromSymbol(candidate.symbol);
    const displaySymbol = getDisplaySymbol(candidate.symbol);
    const row = createEmptyRow(displaySymbol, nextMarket, candidate.name);

    if (typeof window !== "undefined") {
      window.history.replaceState({ workbenchTab: "daily" }, "", window.location.href);
      window.history.pushState(
        { workbenchTab: "analysis", returnTab: "daily" },
        "",
        window.location.href,
      );
    }

    setRangeDays("365");
    setTimeframe("1d");
    setAnalysisSymbol(displaySymbol);
    setAnalysisMarket(nextMarket);
    setAnalysisLoading(true);
    setAnalysisError(null);
    setActiveMarketTab(nextMarket);
    setActiveWorkbenchTab("analysis");
    setRows((currentRows) => {
      const loadingRow = { ...row, loading: true, error: null };
      return currentRows.some((item) => item.id === row.id)
        ? currentRows.map((item) => (item.id === row.id ? { ...item, ...loadingRow } : item))
        : [...currentRows, loadingRow];
    });

    const updated = await fetchRow({ ...row, loading: true }, { rangeDays: "365", timeframe: "1d" });
    setSelectedAnalysis(updated);
    setAnalysisLoading(false);
    setAnalysisError(updated.error);
    setRows((currentRows) =>
      currentRows.map((item) => (item.id === row.id ? updated : item)),
    );
  };

  useEffect(() => {
    try {
      const storedFavorites = window.localStorage.getItem("community-pain-favorites");
      if (storedFavorites) {
        setFavoriteIds(new Set(JSON.parse(storedFavorites) as string[]));
      }
    } catch {
      window.localStorage.removeItem("community-pain-favorites");
    }
    setFavoritesHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPortfolioPositions = async () => {
      try {
        const response = await fetch("/api/portfolio/positions", { cache: "no-store" });
        if (response.status === 401) {
          // ponytail: 비로그인은 에러가 아니라 빈 포트폴리오로 취급
          if (!cancelled) {
            setPortfolioPositions([]);
            setPortfolioFormError(null);
          }
          return;
        }
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, "포트폴리오 조회 실패"));
        }
        const payload = (await response.json()) as PortfolioPositionsResponse;
        if (!cancelled) {
          setPortfolioPositions(
            payload.positions
              .filter((position) => position.symbol && position.market)
              .map((position) => hydratePortfolioPosition(position)),
          );
          setPortfolioFormError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setPortfolioPositions([]);
          setPortfolioFormError(error instanceof Error ? error.message : "포트폴리오 조회 실패");
        }
      } finally {
        if (!cancelled) {
          setPortfolioHydrated(true);
        }
      }
    };
    void loadPortfolioPositions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeWorkbenchTab !== "paper") {
      return;
    }
    void refreshPaperTradingState();
  }, [activeWorkbenchTab]);

  useEffect(() => {
    // 실패(error) 상태면 자동 재시도하지 않는다 — 무한 루프 방지, 수동 갱신 버튼으로 재시도
    if (activeWorkbenchTab !== "portfolio" || tossWorkbench || tossWorkbenchLoading || tossWorkbenchError) {
      return;
    }
    void loadTossWorkbench();
  }, [activeWorkbenchTab, tossWorkbench, tossWorkbenchLoading, tossWorkbenchError]);

  useEffect(() => {
    if (!favoritesHydrated) {
      return;
    }
    window.localStorage.setItem("community-pain-favorites", JSON.stringify([...favoriteIds]));
  }, [favoriteIds, favoritesHydrated]);

  useEffect(() => {
    try {
      const storedSnapshots = window.localStorage.getItem(marketBriefingSnapshotStorageKey);
      if (storedSnapshots) {
        const parsed = JSON.parse(storedSnapshots) as MarketBriefingSnapshot[];
        if (Array.isArray(parsed)) {
          setBriefingSnapshots(parsed.slice(0, maxMarketBriefingSnapshots));
        }
      }
    } catch {
      window.localStorage.removeItem(marketBriefingSnapshotStorageKey);
    }
    setBriefingSnapshotsHydrated(true);
  }, []);

  useEffect(() => {
    if (!briefingSnapshotsHydrated) {
      return;
    }
    window.localStorage.setItem(
      marketBriefingSnapshotStorageKey,
      JSON.stringify(briefingSnapshots.slice(0, maxMarketBriefingSnapshots)),
    );
  }, [briefingSnapshots, briefingSnapshotsHydrated]);

  useEffect(() => {
    if (!timeframeOptions.some((option) => option.value === timeframe)) {
      setTimeframe("1d");
    }
  }, [timeframe]);

  useEffect(() => {
    void refreshRows(defaultWatchlist.map((row) => createEmptyRow(row.symbol, row.market, row.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 실패(error) 상태면 자동 재시도하지 않는다 — 무한 루프 방지, 수동 갱신 버튼으로 재시도
    if (activeWorkbenchTab !== "daily" || marketBriefing || marketBriefingLoading || marketBriefingError) {
      return;
    }
    void fetchMarketBriefing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkbenchTab, marketBriefing, marketBriefingLoading, marketBriefingError]);

  useEffect(() => {
    if (activeWorkbenchTab !== "portfolio" || !portfolioHydrated || refreshingPortfolio) {
      return;
    }
    const stalePositions = portfolioPositions.filter((position) => !position.data && !position.loading);
    if (!stalePositions.length) {
      return;
    }
    void refreshPortfolioPositions(stalePositions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkbenchTab, portfolioHydrated, portfolioPositions, refreshingPortfolio]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { workbenchTab?: WorkbenchTab; returnTab?: WorkbenchTab } | null;
      if (state?.workbenchTab === "analysis") {
        setActiveWorkbenchTab("analysis");
        return;
      }
      if (state?.workbenchTab === "daily" || state?.returnTab === "daily") {
        setActiveWorkbenchTab("daily");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const analysisTrendState = getTrendState(selectedAnalysis?.data);
  const analysisTrend = selectedAnalysis?.data?.trendFollowing;
  const latestTrendFeature = analysisTrend?.latestFeature ?? null;
  const latestTrendSignal = analysisTrend?.signals[analysisTrend.signals.length - 1] ?? null;
  const selectedChartBriefing = useMemo(
    () => buildChartBriefing(selectedAnalysis as BriefingRow | null),
    [selectedAnalysis],
  );
  const analysisBreakoutDecision = buildAnalysisBreakoutDecision(selectedAnalysis?.data);
  const analysisPositionPlan = selectedAnalysis?.data
    ? calculatePositionManagementPlan({
        currentPrice: selectedChartBriefing?.levels.currentPrice ?? selectedAnalysis.meter?.latest.price ?? null,
        averagePrice: null,
        quantity: null,
        currencyMatched: true,
        levels: selectedChartBriefing?.levels,
        breakoutRule: selectedAnalysis.data.breakoutRule,
        breakoutSignal: selectedAnalysis.data.breakoutSignal,
        tradeSetup: selectedAnalysis.data.tradeSetup,
        signalReliability: selectedAnalysis.data.signalReliability,
      })
    : null;
  const analysisCurrency = getMarketCurrency(selectedAnalysis?.market ?? analysisMarket);
  const activePaperAccount = paperTradingState.accounts[activePaperSession];
  const activePaperPositions = paperTradingState.positions.filter((position) => position.session === activePaperSession);
  const activePaperSummary = buildPaperAccountSummary(activePaperAccount, activePaperPositions);
  const activePaperRuns = paperTradingState.runs.filter((run) => run.session === activePaperSession);
  const activePaperOrders = paperTradingState.orders.filter((order) => order.session === activePaperSession);
  const activePaperLogs = paperTradingState.logs.filter((log) => log.session === activePaperSession);
  const paperAlreadyRanToday = activePaperAccount.lastRunDate === getPaperTodayKey();
  const dailyBriefing = useMemo(() => buildDailyBriefing(rows as BriefingRow[]), [rows]);
  const marketRiskLight = useMemo(
    () => buildMarketRiskLight(marketBriefing, portfolioDailyActions),
    [marketBriefing, portfolioDailyActions],
  );
  const dailyBriefingTabSummary = useMemo(
    () =>
      buildDailyBriefingTabSummary(
        activeDailyBriefingTab,
        marketBriefing,
        marketRiskLight,
        portfolioDailyActions,
        briefingSnapshots.length,
      ),
    [activeDailyBriefingTab, briefingSnapshots.length, marketBriefing, marketRiskLight, portfolioDailyActions],
  );
  const activeBriefingSnapshot = useMemo(
    () => briefingSnapshots.find((snapshot) => snapshot.id === activeBriefingSnapshotId) ?? null,
    [activeBriefingSnapshotId, briefingSnapshots],
  );
  const marketBriefingDateLabel = marketBriefing
    ? formatBriefingDateLabel(marketBriefing.tradingDate ?? marketBriefing.generatedAt)
    : dailyBriefing?.dateLabel;
  const marketBriefingSessionLabel =
    marketBriefing?.sessionLabel ?? getBriefingSessionLabel(activeBriefingSession);

  useEffect(() => {
    if (activeWorkbenchTab !== "daily") {
      return;
    }
    setActiveDailyBriefingTab(marketRiskLight.defaultTab);
  }, [activeWorkbenchTab, marketBriefing?.generatedAt, activeBriefingSnapshotId, marketRiskLight.defaultTab]);

  const renderRiskDetailPanel = (
    chartBriefing: ReturnType<typeof buildChartBriefing>,
    trendState: ReturnType<typeof getTrendState>,
  ) => (
    <div className={styles.riskDetailPanel}>
      <div>
        <span>판단</span>
        <strong>{chartBriefing?.label ?? trendState.label}</strong>
        <p>{chartBriefing?.headline ?? trendState.detail}</p>
      </div>
      <div>
        <span>진입 기준</span>
        <p>{chartBriefing?.executionPlan[0] ?? "5일선 기준 데이터가 부족합니다."}</p>
        <p>{chartBriefing?.executionPlan[1] ?? "20일선 기준 데이터가 부족합니다."}</p>
      </div>
      <div>
        <span>리스크 기준</span>
        <ul>
          {(chartBriefing?.riskNotes ?? [trendState.detail]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className={styles.riskLevelGrid}>
        <div>
          <span>5일선</span>
          <strong>{formatPrice(chartBriefing?.levels.sma5)}</strong>
        </div>
        <div>
          <span>20일선</span>
          <strong>{formatPrice(chartBriefing?.levels.sma20)}</strong>
        </div>
        <div>
          <span>1차 손절</span>
          <strong>{formatPrice(chartBriefing?.levels.primaryStop)}</strong>
        </div>
        <div>
          <span>강제 손절</span>
          <strong>{formatPrice(chartBriefing?.levels.hardStop)}</strong>
        </div>
      </div>
    </div>
  );

  return (
    <main className={styles.page}>
      <section className={styles.workbenchHeader}>
        <div>
          <p className={styles.kicker}>Signal Desk</p>
          <h1>트레이딩 신호 워크벤치</h1>
        </div>
        <div className={styles.headerSide}>
          <p>관심종목, 포트폴리오, 단건 분석, 데일리 브리핑을 실제 거래 판단 흐름에 맞게 사용합니다.</p>
          <ThemeToggle />
        </div>
      </section>

      <nav className={styles.workbenchTabs} aria-label="작업 화면 선택">
        {workbenchTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={activeWorkbenchTab === tab.value ? styles.activeWorkbenchTab : ""}
            onClick={() => setActiveWorkbenchTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
        <a href="/automation" className={styles.automationNavLink}>
          베타 자동매매
        </a>
      </nav>

      {activeWorkbenchTab === "watchlist" ? (
        <>
      <form
        className={styles.addBar}
        onSubmit={(event) => {
          event.preventDefault();
          void addWatchRow();
        }}
      >
        <SymbolAutocomplete
          label="종목 추가"
          value={newSymbol}
          onChange={(value) => setNewSymbol(value.toUpperCase())}
          onSelect={selectWatchSymbol}
          placeholder={newMarket === "CRYPTO" ? "BTC" : "삼성 / AAPL"}
        />
        <label>
          <span>시장</span>
          <select value={newMarket} onChange={(event) => setNewMarket(event.target.value)}>
            {marketOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">추가</button>
      </form>

      <section className={styles.toolbar}>
        <div className={styles.segmentGroup}>
          <label>
            기간
            <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)}>
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            봉
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
              {timeframeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => void refreshRows()} disabled={refreshingAll}>
          {refreshingAll ? "갱신 중" : "전체 갱신"}
        </button>
      </section>

      <nav className={styles.marketTabs} aria-label="시장 필터">
        {marketTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={activeMarketTab === tab.value ? styles.activeMarketTab : ""}
            onClick={() => changeMarketTab(tab.value)}
          >
            {tab.label}
            <span>
              {tab.value === "ALL"
                ? rows.length
                : tab.value === "FAVORITES"
                  ? favoriteIds.size
                  : rows.filter((row) => row.market === tab.value).length}
            </span>
          </button>
        ))}
      </nav>

      <section className={styles.summaryStrip} aria-label="곡소리 요약">
        <article>
          <span>가격 공포 상위 <HelpTip text={helpText.pricePain} /></span>
          <strong>{getRowDisplayName(pricePainLeader)}</strong>
          <p>
            {pricePainLeader?.meter
              ? `${getRowSymbolLabel(pricePainLeader)} · ${formatScore(pricePainLeader.meter.score)}점 · ${pricePainLeader.meter.level}`
              : "측정 대기"}
          </p>
        </article>
        <article>
          <span>고점 훼손 상위 <HelpTip text={helpText.drawdown} /></span>
          <strong>{getRowDisplayName(drawdownLeader)}</strong>
          <p>
            {drawdownLeader?.meter
              ? `${getRowSymbolLabel(drawdownLeader)} · -${drawdownLeader.meter.latest.drawdownPct.toFixed(1)}%`
              : "측정 대기"}
          </p>
        </article>
        <article>
          <span>과매도 상위 <HelpTip text={helpText.rsi} /></span>
          <strong>{getRowDisplayName(rsiLeader)}</strong>
          <p>
            {typeof rsiLeader?.meter?.latest.rsi === "number"
              ? `${getRowSymbolLabel(rsiLeader)} · RSI ${rsiLeader.meter.latest.rsi.toFixed(1)}`
              : "측정 대기"}
          </p>
        </article>
        <article>
          <span>하락률 상위 <HelpTip text={helpText.pricePain} /></span>
          <strong>{getRowDisplayName(dropLeader)}</strong>
          <p>
            {dropLeader?.meter
              ? `${getRowSymbolLabel(dropLeader)} · ${formatPercent(dropLeader.meter.latest.changePct)}`
              : "측정 대기"}
          </p>
        </article>
      </section>

      <section className={styles.sheetPanel}>
        <div className={styles.sheetScroll}>
          <table className={styles.sheetTable}>
            <thead>
              <tr>
                <th>종목</th>
                <th>시장</th>
                <th>가격 곡소리 <HelpTip text={helpText.pricePain} /></th>
                <th>판정 <HelpTip text={helpText.priceRegime} /></th>
                <th>추세</th>
                <th>리스크 기준</th>
                <th>현재가</th>
                <th>변화</th>
                <th>고점 훼손 <HelpTip text={helpText.drawdown} /></th>
                <th>RSI <HelpTip text={helpText.rsi} /></th>
                <th>ADX <HelpTip text={helpText.adx} /></th>
                <th>상태</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const priceTone = row.meter ? styles[row.meter.tone] : "";
                const trendState = getTrendState(row.data);
                const chartBriefing = buildChartBriefing(row as BriefingRow);
                const riskSummary = getRiskSummary(chartBriefing, trendState.detail);
                const riskExpanded = expandedRiskRowId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td>
                        <div className={styles.symbolCell}>
                          <button
                            type="button"
                            className={`${styles.favoriteButton} ${favoriteIds.has(row.id) ? styles.favoriteActive : ""}`}
                            onClick={() => toggleFavorite(row)}
                            title={favoriteIds.has(row.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                            aria-label={favoriteIds.has(row.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                          >
                            ★
                          </button>
                          <div className={styles.symbolButton}>
                            <strong>{row.normalizedSymbol || row.symbol}</strong>
                            <span>{row.name ?? row.data?.symbol ?? row.symbol}</span>
                          </div>
                        </div>
                      </td>
                      <td>{row.market}</td>
                      <td>
                        <span className={`${styles.scorePill} ${priceTone}`}>
                          {formatScore(row.meter?.score)}
                        </span>
                      </td>
                      <td>{row.meter?.level ?? "--"}</td>
                      <td>
                        <span className={`${styles.trendPill} ${styles[trendState.tone]}`}>
                          {trendState.label}
                        </span>
                      </td>
                      <td className={styles.trendDetail}>
                        <button
                          type="button"
                          className={styles.riskSummaryButton}
                          onClick={() => setExpandedRiskRowId(riskExpanded ? null : row.id)}
                          title={trendState.detail}
                          aria-expanded={riskExpanded}
                        >
                          {riskSummary}
                        </button>
                      </td>
                      <td>{formatPrice(row.meter?.latest.price)}</td>
                      <td className={row.meter && row.meter.latest.changePct < 0 ? styles.negative : styles.positive}>
                        {row.meter ? formatPercent(row.meter.latest.changePct) : "--"}
                      </td>
                      <td>{row.meter ? `-${row.meter.latest.drawdownPct.toFixed(1)}%` : "--"}</td>
                      <td>{row.meter?.latest.rsi === null || !row.meter ? "--" : row.meter.latest.rsi.toFixed(1)}</td>
                      <td>{row.meter?.latest.adx === null || !row.meter ? "--" : row.meter.latest.adx.toFixed(1)}</td>
                      <td>
                        {row.loading ? (
                          <span className={styles.statusBusy}>측정 중</span>
                        ) : row.error ? (
                          <span className={styles.statusError}>{row.error}</span>
                        ) : (
                          <span className={styles.statusOk}>정상</span>
                        )}
                      </td>
                      <td className={styles.rowActions}>
                        <button type="button" onClick={() => setExpandedRiskRowId(riskExpanded ? null : row.id)}>
                          {riskExpanded ? "닫기" : "상세"}
                        </button>
                        <button type="button" onClick={() => void refreshSingleRow(row)}>
                          갱신
                        </button>
                        <button type="button" onClick={() => removeWatchRow(row)} disabled={rows.length <= 1}>
                          삭제
                        </button>
                      </td>
                    </tr>
                    {riskExpanded ? (
                      <tr className={styles.riskDetailRow}>
                        <td colSpan={13}>
                          {renderRiskDetailPanel(chartBriefing, trendState)}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!visibleRows.length ? (
                <tr>
                  <td colSpan={13} className={styles.emptySheetCell}>
                    이 시장 탭에 표시할 종목이 없습니다. 위 입력창에서 종목을 추가하십시오.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.mobileWatchlist}>
        {visibleRows.map((row) => {
          const trendState = getTrendState(row.data);
          const chartBriefing = buildChartBriefing(row as BriefingRow);
          const riskSummary = getRiskSummary(chartBriefing, trendState.detail);
          const riskExpanded = expandedRiskRowId === row.id;

          return (
            <article key={row.id} className={styles.mobileWatchCard}>
              <div className={styles.mobileWatchHeader}>
                <button
                  type="button"
                  className={`${styles.favoriteButton} ${favoriteIds.has(row.id) ? styles.favoriteActive : ""}`}
                  onClick={() => toggleFavorite(row)}
                  title={favoriteIds.has(row.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                  aria-label={favoriteIds.has(row.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                >
                  ★
                </button>
                <div>
                  <strong>{row.name ?? row.data?.symbol ?? row.symbol}</strong>
                  <span>{row.normalizedSymbol || row.symbol} · {row.market}</span>
                </div>
                {row.loading ? (
                  <span className={styles.statusBusy}>측정 중</span>
                ) : row.error ? (
                  <span className={styles.statusError}>에러</span>
                ) : (
                  <span className={styles.statusOk}>정상</span>
                )}
              </div>

              <div className={styles.mobileWatchMetrics}>
                <div>
                  <span>현재가</span>
                  <strong>{formatPrice(row.meter?.latest.price)}</strong>
                </div>
                <div>
                  <span>변화율</span>
                  <strong className={row.meter && row.meter.latest.changePct < 0 ? styles.negative : styles.positive}>
                    {row.meter ? formatPercent(row.meter.latest.changePct) : "--"}
                  </strong>
                </div>
                <div>
                  <span>가격 곡소리</span>
                  <strong>{formatScore(row.meter?.score)}점 · {row.meter?.level ?? "--"}</strong>
                </div>
                <div>
                  <span>추세</span>
                  <strong>{trendState.label}</strong>
                </div>
              </div>

              <div className={styles.mobileWatchRisk}>
                <span className={`${styles.trendPill} ${styles[trendState.tone]}`}>
                  {trendState.label}
                </span>
                <button
                  type="button"
                  className={styles.riskSummaryButton}
                  onClick={() => setExpandedRiskRowId(riskExpanded ? null : row.id)}
                  title={trendState.detail}
                  aria-expanded={riskExpanded}
                >
                  {riskSummary}
                </button>
              </div>

              {riskExpanded ? renderRiskDetailPanel(chartBriefing, trendState) : null}

              <div className={styles.mobileWatchActions}>
                <button type="button" onClick={() => setExpandedRiskRowId(riskExpanded ? null : row.id)}>
                  {riskExpanded ? "닫기" : "상세"}
                </button>
                <button type="button" onClick={() => void refreshSingleRow(row)}>
                  갱신
                </button>
                <button type="button" onClick={() => removeWatchRow(row)} disabled={rows.length <= 1}>
                  삭제
                </button>
              </div>
            </article>
          );
        })}
        {!visibleRows.length ? (
          <div className={styles.mobileWatchEmpty}>
            이 시장 탭에 표시할 종목이 없습니다. 위 입력창에서 종목을 추가하십시오.
          </div>
        ) : null}
      </section>
        </>
      ) : activeWorkbenchTab === "portfolio" ? (
        <section className={styles.portfolioPanel}>
          <div className={styles.portfolioHero}>
            <div>
              <p className={styles.kicker}>Portfolio</p>
              <h2>나의 포트폴리오 관리</h2>
              <p>공개 분석은 그대로 쓰고, 토스 API 키를 연결하면 실제 보유 종목의 평단가와 수량으로 개인화합니다.</p>
            </div>
            <div className={styles.portfolioHeroActions}>
              <button
                type="button"
                onClick={() => void refreshPortfolioPositions()}
                disabled={refreshingPortfolio || !portfolioPositions.length}
              >
                {refreshingPortfolio ? "분석 중" : "전체 분석"}
              </button>
              <a href="/automation">토스 연결</a>
            </div>
          </div>

          <section className={styles.tossConnectionPanel}>
            <div className={styles.tossConnectionHeader}>
              <div>
                <p className={styles.kicker}>Toss Personalization</p>
                <h3>토스 연결 개인화</h3>
                <p>
                  토스 API 키를 등록하면 보유 주식, 매수 가능 금액, 주문 상태를 서버에서 불러와
                  포트폴리오 판단에 반영합니다.
                </p>
              </div>
              <span className={tossWorkbench?.connected ? styles.statusOk : styles.statusBusy}>
                {tossWorkbenchLoading
                  ? "확인 중"
                  : tossWorkbench?.connected
                    ? "연결됨"
                    : "미연동"}
              </span>
            </div>
            {tossWorkbench?.connected ? (
              <>
                <div className={styles.tossMetricGrid}>
                  <article>
                    <span>토스 계좌</span>
                    <strong>{tossWorkbench.accounts?.[0]?.accountNo ?? "확인됨"}</strong>
                    <p>accountSeq {tossWorkbench.accountSeq ?? "-"}</p>
                  </article>
                  <article>
                    <span>매수 가능 KRW</span>
                    <strong>
                      {formatCurrencyAmount(
                        Number(tossWorkbench.buyingPower?.KRW?.cashBuyingPower ?? NaN),
                        "KRW",
                      )}
                    </strong>
                    <p>현금 기반 사전검증에 사용</p>
                  </article>
                  <article>
                    <span>매수 가능 USD</span>
                    <strong>
                      {formatCurrencyAmount(
                        Number(tossWorkbench.buyingPower?.USD?.cashBuyingPower ?? NaN),
                        "USD",
                      )}
                    </strong>
                    <p>
                      USD/KRW {tossWorkbench.marketInfo?.exchangeRate?.rate ?? "-"}
                    </p>
                  </article>
                  <article>
                    <span>미체결 주문</span>
                    <strong>{tossWorkbench.orders?.open.length ?? 0}</strong>
                    <p>체결/취소 이력은 자동매매 탭에서 확인</p>
                  </article>
                </div>
                <div className={styles.tossConnectionActions}>
                  <button type="button" onClick={() => void syncTossPortfolio()} disabled={tossSyncing}>
                    {tossSyncing ? "가져오는 중" : `토스 보유 ${tossWorkbench.positions?.length ?? 0}개 가져오기`}
                  </button>
                  <button type="button" onClick={() => void loadTossWorkbench()} disabled={tossWorkbenchLoading}>
                    연결 새로고침
                  </button>
                  <a href="/automation">키 관리</a>
                </div>
              </>
            ) : (
              <div className={styles.tossConnectionEmpty}>
                <strong>토스 API 키를 연결하면 수동 입력 없이 시작할 수 있습니다.</strong>
                <p>미연동 상태에서도 아래 수동 포트폴리오와 공개 종목분석은 계속 사용할 수 있습니다.</p>
                <a href="/automation">로그인하고 토스 API 키 등록</a>
              </div>
            )}
            {tossWorkbenchError ? <p className={styles.portfolioFormError}>{tossWorkbenchError}</p> : null}
          </section>

          <section className={styles.portfolioSummaryGrid} aria-label="포트폴리오 요약">
            <article>
              <span>총 평가금액</span>
              <strong>{getPortfolioValueLabel(portfolioSummary, "marketValue")}</strong>
              <p>통화가 맞는 종목만 합산합니다.</p>
            </article>
            <article>
              <span>총 평가손익</span>
              <strong>{getPortfolioValueLabel(portfolioSummary, "pnl")}</strong>
              <p>{getPortfolioPnlPctLabel(portfolioSummary)}</p>
            </article>
            <article>
              <span>수익 종목</span>
              <strong>{portfolioProfitCount}/{portfolioPositions.length}</strong>
              <p>평단가와 현재가 통화가 같은 항목 기준입니다.</p>
            </article>
            <article>
              <span>리스크 경고</span>
              <strong>{portfolioRiskCount}</strong>
              <p>손절선 이탈 또는 손실 관리 후보입니다.</p>
            </article>
          </section>

          <section className={styles.entryCandidateSection}>
            <div className={styles.entryCandidateHeader}>
              <div>
                <span>내 포트폴리오 기준 오늘 할 일</span>
                <strong>보유 종목 관리 우선순위</strong>
              </div>
              <em>주문 지시가 아니라 확인 기준입니다</em>
            </div>
            {portfolioDailyActions.length ? (
              <div className={styles.entryCandidateGrid}>
                {portfolioDailyActions.map(({ position, action }) => (
                  <article
                    key={`portfolio-action:${position.id}`}
                    className={`${styles.entryCandidateCard} ${
                      action.riskLevel === "danger"
                        ? styles.entryblocked
                        : action.riskLevel === "watch"
                          ? styles.entrywatch
                          : styles.entrytradable
                    }`}
                  >
                    <div className={styles.entryCandidateTopline}>
                      <span>{action.label}</span>
                      <em>{position.market}</em>
                    </div>
                    <strong>
                      {position.name || getDisplaySymbol(position.symbol)} ({getDisplaySymbol(position.symbol)})
                    </strong>
                    <p>{action.headline}</p>
                    <ul>
                      {action.criteria.slice(0, 3).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.entryCandidateEmpty}>보유 종목을 등록하면 오늘 확인할 기준을 자동으로 정리합니다.</p>
            )}
          </section>

          <form
            className={styles.portfolioForm}
            onSubmit={(event) => {
              event.preventDefault();
              void submitPortfolioPosition();
            }}
          >
            <div className={styles.portfolioFormHeader}>
              <strong>{editingPortfolioId ? "보유 종목 수정" : "보유 종목 등록"}</strong>
              <p>평단가와 현재가의 통화가 다르면 손익률 대신 추세 기준만 표시합니다.</p>
            </div>
            <SymbolAutocomplete
              label="종목"
              value={portfolioForm.symbol}
              onChange={(value) =>
                setPortfolioForm((current) => ({ ...current, symbol: value.toUpperCase() }))
              }
              onSelect={selectPortfolioSymbol}
              placeholder={portfolioForm.market === "CRYPTO" ? "BTC" : "삼성 / 테슬"}
            />
            <label>
              시장
              <select
                value={portfolioForm.market}
                onChange={(event) => {
                  const market = event.target.value;
                  setPortfolioForm((current) => ({
                    ...current,
                    market,
                    currency: getMarketCurrency(market),
                  }));
                }}
              >
                {marketOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              이름
              <input
                value={portfolioForm.name}
                onChange={(event) => setPortfolioForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="선택"
              />
            </label>
            <label>
              평단가
              <input
                inputMode="decimal"
                value={portfolioForm.avgPrice}
                onChange={(event) => setPortfolioForm((current) => ({ ...current, avgPrice: event.target.value }))}
                placeholder="125.50"
              />
            </label>
            <label>
              수량
              <input
                inputMode="decimal"
                value={portfolioForm.quantity}
                onChange={(event) => setPortfolioForm((current) => ({ ...current, quantity: event.target.value }))}
                placeholder="10"
              />
            </label>
            <label>
              기준 통화
              <select
                value={portfolioForm.currency}
                onChange={(event) =>
                  setPortfolioForm((current) => ({
                    ...current,
                    currency: event.target.value as PortfolioCurrency,
                  }))
                }
              >
                <option value="USD">USD</option>
                <option value="KRW">KRW</option>
              </select>
            </label>
            <label className={styles.portfolioMemoField}>
              메모
              <input
                value={portfolioForm.memo}
                onChange={(event) => setPortfolioForm((current) => ({ ...current, memo: event.target.value }))}
                placeholder="매수 이유, 목표 등"
              />
            </label>
            <div className={styles.portfolioFormActions}>
              <button type="submit">{editingPortfolioId ? "변경" : "등록"}</button>
              {editingPortfolioId ? (
                <button type="button" onClick={() => resetPortfolioForm()}>
                  취소
                </button>
              ) : null}
            </div>
            {portfolioFormError ? <p className={styles.portfolioFormError}>{portfolioFormError}</p> : null}
          </form>

          {portfolioPositions.length ? (
            <div className={styles.portfolioGrid}>
              {portfolioPositions.map((position) => {
                const metrics = getPortfolioMetrics(position);
                const chartBriefing = buildChartBriefing(position as BriefingRow);
                const trendState = getTrendState(position.data);
                const holdingRead = buildPortfolioHoldingRead(position, chartBriefing, trendState);
                const tradePlan = buildPortfolioTradePlan(position, chartBriefing);
                const managementPlan = tradePlan.managementPlan;
                const expanded = expandedPortfolioId === position.id;
                const tradeExpanded = expandedPortfolioTradeId === position.id;

                return (
                  <article key={position.id} className={styles.portfolioCard}>
                    <div className={styles.portfolioCardHeader}>
                      <div>
                        <span>{position.market}</span>
                        <h3>{position.name || position.normalizedSymbol || position.symbol}</h3>
                        <p>{position.normalizedSymbol || position.symbol}</p>
                      </div>
                      <span className={`${styles.trendPill} ${styles[holdingRead.tone]}`}>
                        {holdingRead.label}
                      </span>
                    </div>

                    <p className={styles.portfolioRead}>{holdingRead.headline}</p>

                    <div className={styles.portfolioMetricGrid}>
                      <div>
                        <span>현재가</span>
                        <strong>{formatCurrencyAmount(metrics.currentPrice, metrics.marketCurrency)}</strong>
                      </div>
                      <div>
                        <span>평단가</span>
                        <strong>{formatCurrencyAmount(position.avgPrice, position.currency)}</strong>
                      </div>
                      <div>
                        <span>수량</span>
                        <strong>{position.quantity.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>평가손익</span>
                        <strong className={metrics.pnl !== null && metrics.pnl < 0 ? styles.negative : styles.positive}>
                          {formatSignedCurrencyAmount(metrics.pnl, position.currency)}
                        </strong>
                      </div>
                    </div>

                    <div className={styles.portfolioMetricGrid}>
                      <div>
                        <span>평가금액</span>
                        <strong>{formatCurrencyAmount(metrics.marketValue, position.currency)}</strong>
                      </div>
                      <div>
                        <span>손익률</span>
                        <strong className={metrics.pnlPct !== null && metrics.pnlPct < 0 ? styles.negative : styles.positive}>
                          {typeof metrics.pnlPct === "number" ? formatPercent(metrics.pnlPct) : "--"}
                        </strong>
                      </div>
                      <div>
                        <span>5일선</span>
                        <strong>{formatCurrencyAmount(chartBriefing?.levels.sma5, metrics.marketCurrency)}</strong>
                      </div>
                      <div>
                        <span>20일선</span>
                        <strong>{formatCurrencyAmount(chartBriefing?.levels.sma20, metrics.marketCurrency)}</strong>
                      </div>
                    </div>

                    <div className={styles.portfolioBadges}>
                      <span>{position.currency} 평단</span>
                      <span>{metrics.marketCurrency} 현재가</span>
                      {position.data?.breakoutRule?.status === "profit-tracking" ||
                      (typeof metrics.pnlPct === "number" && metrics.pnlPct >= 20) ? (
                        <span className={styles.breakoutBadge}>20일선 추적 모드</span>
                      ) : null}
                      {position.data?.breakoutRule?.status === "breakout-ready" ? (
                        <span className={styles.breakoutBadge}>신고가 돌파 후보</span>
                      ) : null}
                      {!metrics.currencyMatched ? <span className={styles.portfolioWarningBadge}>통화 기준 다름</span> : null}
                      {position.loading ? <span className={styles.statusBusy}>분석 중</span> : null}
                      {position.error ? <span className={styles.statusError}>{position.error}</span> : null}
                    </div>

                    {managementPlan ? (
                      <div className={styles.portfolioPlanLevels}>
                        <div>
                          <span>1차 익절</span>
                          <strong>{formatCurrencyAmount(managementPlan.takeProfitLevels[0]?.price, metrics.marketCurrency)}</strong>
                          <p>30% 수익 실현</p>
                        </div>
                        <div>
                          <span>2차 익절</span>
                          <strong>{formatCurrencyAmount(managementPlan.takeProfitLevels[1]?.price, metrics.marketCurrency)}</strong>
                          <p>추가 30% 수익 실현</p>
                        </div>
                        <div>
                          <span>추적 손절</span>
                          <strong>{formatCurrencyAmount(managementPlan.trailingStop.price, metrics.marketCurrency)}</strong>
                          <p>잔여 40% 기준</p>
                        </div>
                        <div>
                          <span>최종 손절</span>
                          <strong>{formatCurrencyAmount(managementPlan.portfolioStop.price, metrics.marketCurrency)}</strong>
                          <p>잔여 비중 정리</p>
                        </div>
                      </div>
                    ) : null}

                    {tradeExpanded ? (
                      <div className={styles.portfolioTradePanel}>
                        <div className={styles.portfolioTradeHeader}>
                          <div>
                            <span>손절/익절 계획</span>
                            <strong>{tradePlan.headline}</strong>
                          </div>
                          <span className={`${styles.trendPill} ${styles[tradePlan.tone]}`}>
                            {tradePlan.label}
                          </span>
                        </div>
                        <div className={styles.portfolioTradeGrid}>
                          <article>
                            <span>지금 할 일</span>
                            <strong>{tradePlan.label}</strong>
                            <p>{tradePlan.headline}</p>
                          </article>
                          <article>
                            <span>손절 대응</span>
                            <ul>
                              {tradePlan.stopItems.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </article>
                          <article>
                            <span>분할익절</span>
                            <ul>
                              {tradePlan.profitItems.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </article>
                        </div>
                        <div className={styles.portfolioTradeBlockers}>
                          <span>재진입/관리 원칙</span>
                          <ul>
                            {tradePlan.managementItems.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        {tradePlan.blockers.length ? (
                          <div className={styles.portfolioTradeBlockers}>
                            <span>추가매수 금지 조건</span>
                            <ul>
                              {tradePlan.blockers.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {expanded ? (
                      <div className={styles.portfolioDetail}>
                        <div>
                          <span>보유 기준</span>
                          <strong>{chartBriefing?.headline ?? trendState.detail}</strong>
                          <p>{chartBriefing?.marketRead ?? "분석 갱신 후 5일선/20일선 기준을 확인할 수 있습니다."}</p>
                        </div>
                        <div>
                          <span>리스크 기준</span>
                          <strong>
                            1차 {formatCurrencyAmount(chartBriefing?.levels.primaryStop, metrics.marketCurrency)} / 강제 {formatCurrencyAmount(chartBriefing?.levels.hardStop, metrics.marketCurrency)}
                          </strong>
                          <p>보유 중인 종목은 신규 매수보다 손실 제한과 수익 보호 기준을 먼저 확인하십시오.</p>
                        </div>
                        <div>
                          <span>메모</span>
                          <strong>{position.memo || "메모 없음"}</strong>
                          <p>마지막 변경 {formatDateTimeLabel(position.updatedAt)}</p>
                        </div>
                      </div>
                    ) : null}

                    <div className={styles.portfolioActions}>
                      <button type="button" onClick={() => setExpandedPortfolioId(expanded ? null : position.id)}>
                        {expanded ? "닫기" : "상세"}
                      </button>
                      <button type="button" onClick={() => setExpandedPortfolioTradeId(tradeExpanded ? null : position.id)}>
                        {tradeExpanded ? "손절/익절 닫기" : "손절/익절"}
                      </button>
                      <button type="button" onClick={() => void refreshPortfolioPositions([position])}>
                        갱신
                      </button>
                      <button type="button" onClick={() => editPortfolioPosition(position)}>
                        수정
                      </button>
                      <button type="button" onClick={() => void openPortfolioAnalysis(position)}>
                        종목분석
                      </button>
                      <button type="button" onClick={() => removePortfolioPosition(position)}>
                        삭제
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.portfolioEmpty}>
              <strong>등록된 보유 종목이 없습니다.</strong>
              <p>종목, 평단가, 수량을 입력하면 보유 기준의 추세 분석을 시작합니다.</p>
            </div>
          )}
        </section>
      ) : activeWorkbenchTab === "paper" ? (
        <section className={styles.paperPanel}>
          <div className={styles.paperHero}>
            <div>
              <p className={styles.kicker}>Paper Automation</p>
              <h2>페이퍼 자동운용</h2>
              <p>실계좌 연결 없이 로컬 파일 저장소에 한국장/미국장 페이퍼 전략 실행 결과를 누적합니다.</p>
            </div>
            <div className={styles.paperHeroActions}>
              <div className={styles.paperSessionGroup}>
                {briefingSessionOptions.map((option) => (
                  <button
                    key={`paper-session:${option.value}`}
                    type="button"
                    className={activePaperSession === option.value ? styles.activeSegment : ""}
                    onClick={() => setActivePaperSession(option.value)}
                  >
                    {option.value === "US" ? "미국장" : "한국장"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void runPaperTrading()}
                disabled={paperTradingRunning || paperAlreadyRanToday}
              >
                {paperTradingRunning ? "실행 중" : paperAlreadyRanToday ? "오늘 실행 완료" : "오늘 실행"}
              </button>
            </div>
          </div>

          {paperTradingError ? <p className={styles.paperNotice}>{paperTradingError}</p> : null}

          <section className={styles.paperSummaryGrid} aria-label="페이퍼 자동화 상태">
            <article>
              <span>사용자별 저장</span>
              <strong>인증 필요</strong>
              <p>{paperTradingStorageLabel}</p>
            </article>
            <article>
              <span>마지막 실행</span>
              <strong>{activePaperRuns[0]?.today ?? "기록 없음"}</strong>
              <p>{activePaperRuns[0] ? getPaperRunSourceLabel(activePaperRuns[0].source) : "아직 실행 전"}</p>
            </article>
            <article>
              <span>다음 권장 실행</span>
              <strong>{getPaperNextRunLabel(activePaperSession)}</strong>
              <p>휴장일 캘린더는 v1에서 중복 실행 로그로 처리합니다.</p>
            </article>
            <article>
              <span>Codex 자동화</span>
              <strong>등록 필요</strong>
              <p>자동화는 runner를 호출하고 결과 요약만 보고합니다.</p>
            </article>
          </section>

          <section className={styles.paperSummaryGrid} aria-label="페이퍼 계좌 요약">
            <article>
              <span>모의 현금</span>
              <strong>{formatCurrencyAmount(activePaperAccount.cash, activePaperAccount.currency)}</strong>
              <p>{activePaperSession === "US" ? "기본 USD 10,000" : "기본 KRW 10,000,000"}</p>
            </article>
            <article>
              <span>보유 평가</span>
              <strong>{formatCurrencyAmount(activePaperSummary.marketValue, activePaperAccount.currency)}</strong>
              <p>{activePaperPositions.length}개 보유 중</p>
            </article>
            <article>
              <span>추정 총자산</span>
              <strong>{formatCurrencyAmount(activePaperSummary.equity, activePaperAccount.currency)}</strong>
              <p>실현손익 {formatSignedCurrencyAmount(activePaperAccount.realizedPnl, activePaperAccount.currency)}</p>
            </article>
            <article>
              <span>전략 성과</span>
              <strong>{formatRatio(activePaperSummary.totalReturnPct)}</strong>
              <p>{activePaperAccount.strategyVersion}</p>
            </article>
          </section>

          <section className={styles.paperControls}>
            <div>
              <strong>실행 규칙</strong>
              <p>정상 진입 후보는 계획 비중, 탐색 진입 후보는 30% 탐색 비중만 진입하고 하루 3개·종목 15%·1회 손실 1% 한도를 적용합니다.</p>
            </div>
            <div>
              <button type="button" onClick={() => void refreshPaperTradingState()} disabled={paperTradingRefreshing}>
                {paperTradingRefreshing ? "새로고침 중" : "상태 새로고침"}
              </button>
              <button type="button" onClick={exportPaperTrading}>
                JSON 내보내기
              </button>
              <button type="button" onClick={() => void resetPaperTrading()} disabled={paperTradingRunning}>
                초기화
              </button>
            </div>
          </section>

          <section className={styles.paperGrid}>
            <article className={styles.paperCard}>
              <div className={styles.paperCardHeader}>
                <span>오늘 실행 후보</span>
                <strong>{activePaperRuns[0]?.summary ?? "아직 실행 기록이 없습니다."}</strong>
              </div>
              {activePaperRuns.length ? (
                <ul className={styles.paperList}>
                  {activePaperRuns.slice(0, 5).map((run) => (
                    <li key={run.id}>
                      <strong>{run.today}</strong>
                      <span>
                        {getPaperRunSourceLabel(run.source)} · 후보 {run.candidateCount} / 정상 진입 {run.tradableCount} / 탐색 진입 {run.probeCount ?? 0} / 체결 {run.ordersCount}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>오늘 실행을 누르면 데일리 브리핑의 내부 후보 큐로 페이퍼 운용을 시작합니다.</p>
              )}
            </article>

            <article className={styles.paperCard}>
              <div className={styles.paperCardHeader}>
                <span>보유 포지션</span>
                <strong>{activePaperPositions.length ? `${activePaperPositions.length}개 보유` : "보유 없음"}</strong>
              </div>
              {activePaperPositions.length ? (
                <ul className={styles.paperList}>
                  {activePaperPositions.map((position) => (
                    <li key={position.id}>
                      <strong>{position.name ?? position.symbol}</strong>
                      <span>
                        {position.quantity}주 · 평단 {formatCurrencyAmount(position.averagePrice, position.currency)} · 현재 {formatCurrencyAmount(position.lastPrice, position.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>조건을 통과한 후보가 체결되면 포지션이 쌓입니다.</p>
              )}
            </article>

            <article className={styles.paperCard}>
              <div className={styles.paperCardHeader}>
                <span>페이퍼 체결</span>
                <strong>{activePaperOrders.length ? `${activePaperOrders.length}건` : "체결 없음"}</strong>
              </div>
              {activePaperOrders.length ? (
                <ul className={styles.paperList}>
                  {activePaperOrders.slice(0, 8).map((order) => (
                    <li key={order.id}>
                      <strong>{order.side === "buy" ? "진입" : "정리"} · {order.symbol}</strong>
                      <span>
                        {order.quantity}주 @ {formatCurrencyAmount(order.price, order.currency)} · {order.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>신규 진입, 분할익절, 분할손절이 발생하면 여기에 기록됩니다.</p>
              )}
            </article>

            <article className={styles.paperCard}>
              <div className={styles.paperCardHeader}>
                <span>제외/주의 로그</span>
                <strong>{activePaperLogs.length ? `${activePaperLogs.length}개 로그` : "로그 없음"}</strong>
              </div>
              {activePaperLogs.length ? (
                <ul className={styles.paperList}>
                  {activePaperLogs.slice(0, 10).map((log) => (
                    <li key={log.id}>
                      <strong>{log.symbol ?? log.session}</strong>
                      <span>{getPaperRunSourceLabel(log.source)} · {log.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>armed/watch/blocked 후보와 리스크 차단 사유를 기록합니다.</p>
              )}
            </article>
          </section>
        </section>
      ) : activeWorkbenchTab === "daily" ? (
        <section className={styles.briefingPanel}>
          <div className={styles.briefingHero}>
            <div>
              <p className={styles.kicker}>Daily Analysis</p>
              <h2>{marketBriefingDateLabel ? `${marketBriefingDateLabel} ${marketBriefingSessionLabel}` : "일간분석 준비 중"}</h2>
              <p>
                주도테마와 돌파 후보, 지지 확인 후보, 주의 종목을 카드로 정리합니다.
              </p>
            </div>
            <div className={styles.briefingHeroBadges}>
              <span className={`${styles.trendPill} ${marketBriefing ? styles.trendHold : styles.trendMuted}`}>
                시장 분석 기반
              </span>
              {activeBriefingSnapshot ? (
                <span className={`${styles.trendPill} ${styles.trendMuted}`}>저장본</span>
              ) : null}
            </div>
          </div>

          <div className={styles.marketBriefingControls}>
            <div>
              <strong>일간분석 선택</strong>
              <p>오늘 볼 후보를 먼저 훑고, 필요한 종목은 카드에서 바로 종목분석으로 이동합니다.</p>
            </div>
            <div className={styles.marketChoiceGroup}>
              {briefingSessionOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.marketChoiceButton} ${
                    activeBriefingSession === option.value ? styles.marketChoiceActive : ""
                  }`}
                  onClick={() => {
                    setActiveBriefingSession(option.value);
                    setMarketBriefing(null);
                    setMarketBriefingError(null);
                    setActiveBriefingSnapshotId(null);
                    setExpandedScanMarkets([]);
                    setActiveDailyBriefingTab("summary");
                  }}
                >
                  {option.label}
                </button>
              ))}
              <button type="button" onClick={() => void fetchMarketBriefing()} disabled={marketBriefingLoading}>
                {marketBriefingLoading ? "분석 중" : "일간분석"}
              </button>
            </div>
          </div>

	          <section className={`${styles.marketRiskLightPanel} ${styles[`marketRisk${marketRiskLight.level}`]}`}>
	            <div className={styles.trafficLightStack} aria-label={`오늘의 시장 신호등: ${marketRiskLight.label}`}>
	              {(["green", "yellow", "red"] as MarketRiskLightLevel[]).map((level) => (
                <span
                  key={level}
                  className={`${styles.trafficLightDot} ${styles[`traffic${level}`]} ${
                    marketRiskLight.level === level ? styles.trafficLightActive : ""
                  }`}
	                />
	              ))}
	            </div>
	            <div className={styles.marketRiskLightBody}>
	              <span>오늘의 시장 신호등</span>
	              <strong>{marketRiskLight.label}</strong>
	              <p>현재 브리핑 데이터로 산출한 첫 행동 기준입니다.</p>
	            </div>
	            <div className={styles.marketRiskReasonPanel}>
	              <span>왜 이 색인가</span>
	              <div className={styles.marketRiskReasons}>
	                {marketRiskLight.reasons.map((reason) => (
	                  <em key={reason}>{reason}</em>
	                ))}
	              </div>
	            </div>
	            <div className={styles.marketRiskActionBox}>
	              <span>오늘 행동</span>
	              <strong>{marketRiskLight.action}</strong>
	              <p>{marketRiskLight.detail}</p>
	            </div>
	            <div className={styles.marketRiskScoreBox}>
	              <span>위험 점수</span>
	              <strong>{marketRiskLight.score}</strong>
	              <p>높을수록 신규 진입보다 방어 기준을 우선합니다.</p>
	            </div>
	          </section>

          <div className={styles.dailyBriefingTabs} role="tablist" aria-label="데일리 브리핑 보기">
            {dailyBriefingTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={activeDailyBriefingTab === tab.value}
                className={activeDailyBriefingTab === tab.value ? styles.dailyBriefingTabActive : ""}
                onClick={() => setActiveDailyBriefingTab(tab.value)}
              >
                {tab.label}
              </button>
	            ))}
	          </div>

	          <section className={styles.dailyTabSummaryPanel}>
	            <div>
	              <span>{dailyBriefingTabs.find((tab) => tab.value === activeDailyBriefingTab)?.label ?? "요약"} 탭 핵심</span>
	              <strong>{dailyBriefingTabSummary.title}</strong>
	              <p>{dailyBriefingTabSummary.body}</p>
	            </div>
	            <div className={styles.dailyTabMetricGrid}>
	              {dailyBriefingTabSummary.metrics.map((metric) => (
	                <div key={`${activeDailyBriefingTab}:${metric.label}`} className={styles[`dailyTabMetric${metric.tone ?? "neutral"}`]}>
	                  <span>{metric.label}</span>
	                  <strong>{metric.value}</strong>
	                </div>
	              ))}
	            </div>
	          </section>

	                  {activeDailyBriefingTab === "market" ? (
	            <div className={styles.briefingStatusGrid}>
	              <div>
	                <span>분석 구분</span>
	                <strong>{marketBriefingSessionLabel}</strong>
	              </div>
	              <div>
	                <span>기준 거래일</span>
	                <strong>{marketBriefing?.tradingDate ?? "--"}</strong>
	              </div>
	              <div>
	                <span>마지막 분석</span>
	                <strong>{formatDateTimeLabel(marketBriefing?.generatedAt)}</strong>
	              </div>
	              <div>
	                <span>다음 분석</span>
	                <strong>{formatDateTimeLabel(marketBriefing?.nextRefreshAt)}</strong>
	              </div>
	            </div>
	          ) : null}

          {portfolioDailyActions.length && (activeDailyBriefingTab === "summary" || activeDailyBriefingTab === "risk") ? (
            <section className={styles.briefingSection}>
              <strong>내 포트폴리오 요약</strong>
              <ul>
                {portfolioDailyActions.slice(0, 4).map(({ position, action }) => (
                  <li key={`daily-portfolio:${position.id}`}>
                    {position.name || getDisplaySymbol(position.symbol)}: {action.label} · {action.headline}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {marketBriefing?.extendedSession && activeDailyBriefingTab === "market" ? (
            <section className={styles.extendedSessionPanel}>
              <div className={styles.extendedSessionHeader}>
                <div>
                  <span>장외 보조 체크</span>
                  <strong>{marketBriefing.extendedSession.sessionLabel}</strong>
                  <p>{marketBriefing.extendedSession.summary}</p>
                </div>
                <em className={marketBriefing.extendedSession.available ? styles.scanPass : styles.scanBlock}>
                  {marketBriefing.extendedSession.available ? "참조 가능" : "데이터 없음"}
                </em>
              </div>

              {marketBriefing.extendedSession.topMovers.length ? (
                <div className={styles.extendedMoverGrid}>
                  {marketBriefing.extendedSession.topMovers.map((mover) => (
                    <article key={mover.symbol} className={styles.extendedMoverCard}>
                      <div>
                        <span>{getDisplaySymbol(mover.symbol)}</span>
                        <strong>{mover.name}</strong>
                      </div>
                      <div className={styles.extendedMoverStats}>
                        <span>{formatCurrencyAmount(mover.price, "USD")}</span>
                        <strong className={mover.changeFromRegularClosePct >= 0 ? styles.positive : styles.negative}>
                          {formatRatio(mover.changeFromRegularClosePct)}
                        </strong>
                      </div>
                      <div className={styles.breakoutBadgeRow}>
                        <span className={`${styles.trendPill} ${styles[getExtendedSignalTone(mover.signal)]}`}>
                          {translateExtendedSignal(mover.signal)}
                        </span>
                        <span className={styles.breakoutBadge}>
                          {mover.breakoutStatus ? translateBreakoutStatus(mover.breakoutStatus) : "신고가 룰 대기"}
                        </span>
                      </div>
                      <p>{mover.reason}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.extendedSessionEmpty}>
                  프리마켓 또는 애프터마켓 가격이 확인되면 장외 변화 상위 후보를 표시합니다.
                </p>
              )}

              <ul className={styles.extendedSessionWarnings}>
                {marketBriefing.extendedSession.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {activeDailyBriefingTab === "history" ? (
          <div className={styles.briefingSnapshotPanel}>
            <div className={styles.briefingSnapshotHeader}>
              <div>
                <strong>최근 10일 브리핑</strong>
                <p>분석 결과를 스냅샷으로 저장해 같은 날짜 리포트를 다시 열 수 있습니다.</p>
              </div>
              <span>{briefingSnapshots.length}/{maxMarketBriefingSnapshots}</span>
            </div>
            {briefingSnapshots.length ? (
              <div className={styles.briefingSnapshotList}>
                {briefingSnapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className={`${styles.briefingSnapshotButton} ${
                      snapshot.id === activeBriefingSnapshotId ? styles.briefingSnapshotActive : ""
                    }`}
                    onClick={() => loadMarketBriefingSnapshot(snapshot)}
                  >
                    <span>{snapshot.dateKey}</span>
                    <strong>{snapshot.summary}</strong>
                    <em>{snapshot.session ? getBriefingSessionLabel(snapshot.session) : snapshot.markets.map(getBriefingMarketLabel).join(" / ")}</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.briefingSnapshotEmpty}>일간분석을 실행하면 오늘 브리핑이 자동 저장됩니다.</p>
            )}
          </div>
          ) : null}

          {marketBriefingError ? <p className={styles.analysisError}>{marketBriefingError}</p> : null}

          {marketBriefing && activeDailyBriefingTab !== "history" ? (
            <div className={styles.marketReportList}>
              {marketBriefing.reports.map((report) => (
                <article key={report.market} className={styles.marketReport}>
                  {(() => {
                    const reportThemes = getReportThemes(report);
                    const primaryTheme = reportThemes[0];
                    const primaryStock = report.strongestStocks[0];
                    const scanExpanded = expandedScanMarkets.includes(report.market);

                    return (
                      <>
                  <div className={styles.marketReportHeader}>
                    <div>
                      <span>{getBriefingMarketLabel(report.market)}</span>
                      <h3>{report.headline}</h3>
                    </div>
                    <em className={report.marketHealth.pass ? styles.scanPass : styles.scanBlock}>
                      시장폭 {(report.marketHealth.breadth * 100).toFixed(0)}%
                    </em>
                  </div>

	                  {activeDailyBriefingTab === "market" ? (
	                    <>
	                      <div className={styles.scannerMeta}>
	                        <span>기준일 {report.tradingDate ?? marketBriefing.tradingDate ?? "--"}</span>
	                        <span>다음 분석 {formatDateTimeLabel(report.nextRefreshAt ?? marketBriefing.nextRefreshAt)}</span>
	                      </div>
	                      <details className={styles.marketSourceDisclosure}>
	                        <summary>
	                          <span>데이터 출처 보기</span>
	                          <strong>{getCandidateSourceStatusLabel(report.candidateSource?.status)}</strong>
	                        </summary>
	                        <div className={styles.marketSourceGrid}>
	                          <div>
	                            <span>후보 사용</span>
	                            <strong>
	                              요청 후보 {report.candidateSource?.requested ?? report.marketHealth.totalSymbols}개 중 {report.candidateSource?.used ?? report.marketHealth.totalSymbols}개 사용
	                            </strong>
	                          </div>
	                          <div>
	                            <span>분석 완료</span>
	                            <strong>분석 완료 {report.candidateSource?.analyzedCount ?? report.marketHealth.loadedSymbols}개</strong>
	                          </div>
	                          {report.candidateSource ? (
	                            <div>
	                              <span>출처 구성</span>
	                              <strong>
	                                실시간 선별 {report.candidateSource.dynamicCount ?? 0} / 보강 목록 {report.candidateSource.curatedCount ?? 0} / 기본 목록 {report.candidateSource.fallbackCount ?? 0}
	                              </strong>
	                            </div>
	                          ) : null}
	                          {report.candidateSource?.status === "fallback" ? (
	                            <div className={styles.marketSourceWarning}>
	                              <span>대체 상태</span>
	                              <strong>대체 목록 사용</strong>
	                            </div>
	                          ) : null}
	                        </div>
	                      </details>
	                    </>
	                  ) : null}

                  {activeDailyBriefingTab === "summary" || activeDailyBriefingTab === "market" ? (
                  <div className={styles.marketSummaryGrid}>
                    <div>
                      <span>오늘의 주도테마</span>
                      <strong>{primaryTheme?.theme ?? "--"}</strong>
                      <p>{primaryTheme?.read ?? "뚜렷한 주도테마가 아직 없습니다."}</p>
                    </div>
                    <div>
                      <span>흐름 강한 종목</span>
                      <strong>
                        {primaryStock
                          ? `${primaryStock.name} (${getDisplaySymbol(primaryStock.symbol)})`
                          : "--"}
                      </strong>
                      <p>
                        {primaryStock
                          ? `${primaryStock.sector} · ${formatTradeSetupSummary(primaryStock.tradeSetup ?? primaryStock.tradePlan.tradeSetup)} · ${primaryStock.tradePlan.basis}`
                          : "바로 접근할 후보가 부족합니다."}
                      </p>
                    </div>
                    <div>
                      <span>핵심 기준선</span>
                      <strong>{formatPrice(primaryStock?.tradeSetup?.keyLevel ?? primaryStock?.tradePlan.tradeSetup?.keyLevel)}</strong>
                      <p>{primaryStock?.tradeSetup?.validIf ?? primaryStock?.tradePlan.tradeSetup?.validIf ?? "기준선 위 종가 유지 여부를 확인합니다."}</p>
                    </div>
                    <div>
                      <span>실패 기준</span>
                      <strong>{formatPrice(primaryStock?.tradeSetup?.failureLevel ?? primaryStock?.tradePlan.tradeSetup?.failureLevel)}</strong>
                      <p>{primaryStock?.tradeSetup?.invalidIf ?? primaryStock?.tradePlan.tradeSetup?.invalidIf ?? "실패선 이탈 시 신규 진입 근거가 약해집니다."}</p>
                    </div>
                  </div>
                  ) : null}

                  {activeDailyBriefingTab === "candidates" ? (
                  <div className={styles.entryCandidateSection}>
                    <div className={styles.entryCandidateHeader}>
                      <div>
                        <span>지지 확인 후보</span>
                        <strong>기준선 위에서 버티는지 확인</strong>
                      </div>
                      <em>돌파 후 재진입 또는 눌림 후보입니다</em>
                    </div>
                    {(report.supportCandidates ?? []).length ? (
                      <div className={styles.entryCandidateGrid}>
                        {(report.supportCandidates ?? []).slice(0, 4).map((candidate) => (
                          <button
                            key={`${report.market}:support:${candidate.symbol}`}
                            type="button"
                            className={`${styles.entryCandidateCard} ${styles.entrywatch}`}
                            onClick={() => void openDailyCandidateAnalysis(candidate)}
                          >
                            <div className={styles.entryCandidateTopline}>
                              <span>{candidate.breakoutSignal ? translateBreakoutSignalStatus(candidate.breakoutSignal.status) : translateTradeSetupType(candidate.tradeSetup.type)}</span>
                              <em>{candidate.signalReliability ? `${translateSignalReliabilityGrade(candidate.signalReliability.grade)} ${candidate.signalReliability.score}` : "신뢰도 대기"}</em>
                            </div>
                            <strong>
                              {candidate.name} ({getDisplaySymbol(candidate.symbol)})
                            </strong>
                            <p>{candidate.whyToday}</p>
                            <dl>
                              <div>
                                <dt>기준선</dt>
                                <dd>{formatPrice(candidate.breakoutSignal?.supportLevel ?? candidate.tradeSetup.keyLevel)}</dd>
                              </div>
                              <div>
                                <dt>실패</dt>
                                <dd>{formatPrice(candidate.breakoutSignal?.failureLevel ?? candidate.tradeSetup.failureLevel)}</dd>
                              </div>
                              <div>
                                <dt>5일</dt>
                                <dd>{formatRatio(candidate.return5)}</dd>
                              </div>
                              <div>
                                <dt>차트</dt>
                                <dd>{candidate.chartQuality ? `${candidate.chartQuality.score}점` : "--"}</dd>
                              </div>
                            </dl>
                            <p>{candidate.tradeSetup.validIf}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.entryCandidateEmpty}>지지 확인만으로 접근할 후보는 아직 부족합니다.</p>
                    )}
                  </div>
                  ) : null}

                  {activeDailyBriefingTab === "risk" ? (
                  <div className={styles.entryCandidateSection}>
                    <div className={styles.entryCandidateHeader}>
                      <div>
                        <span>주의 종목</span>
                        <strong>신규 진입보다 리스크 점검</strong>
                      </div>
                      <em>실패선, 손절폭, 낮은 신뢰도 기준입니다</em>
                    </div>
                    {(report.cautionCandidates ?? []).length ? (
                      <div className={styles.entryCandidateGrid}>
                        {(report.cautionCandidates ?? []).slice(0, 4).map((candidate) => (
                          <button
                            key={`${report.market}:caution:${candidate.symbol}`}
                            type="button"
                            className={`${styles.entryCandidateCard} ${styles.entryblocked}`}
                            onClick={() => void openDailyCandidateAnalysis(candidate)}
                          >
                            <div className={styles.entryCandidateTopline}>
                              <span>{translateDecision(candidate.decision)}</span>
                              <em>{candidate.signalReliability ? `${translateSignalReliabilityGrade(candidate.signalReliability.grade)} ${candidate.signalReliability.score}` : "리스크 우선"}</em>
                            </div>
                            <strong>
                              {candidate.name} ({getDisplaySymbol(candidate.symbol)})
                            </strong>
                            <p>{candidate.whyToday}</p>
                            <dl>
                              <div>
                                <dt>기준선</dt>
                                <dd>{formatPrice(candidate.tradeSetup.keyLevel)}</dd>
                              </div>
                              <div>
                                <dt>실패</dt>
                                <dd>{formatPrice(candidate.tradeSetup.failureLevel)}</dd>
                              </div>
                              <div>
                                <dt>50일</dt>
                                <dd>{formatRatio(candidate.return50)}</dd>
                              </div>
                              <div>
                                <dt>상태</dt>
                                <dd>{candidate.breakoutSignal ? translateBreakoutSignalStatus(candidate.breakoutSignal.status) : translateTradeSetupType(candidate.tradeSetup.type)}</dd>
                              </div>
                            </dl>
                            <p>{candidate.tradeSetup.invalidIf}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.entryCandidateEmpty}>현재 리포트 상단에 올릴 주의 후보는 없습니다.</p>
                    )}
                  </div>
                  ) : null}

                  {activeDailyBriefingTab === "candidates" ? (
                  <div className={styles.entryCandidateSection}>
                    <div className={styles.entryCandidateHeader}>
                      <div>
                        <span>오늘의 돌파 후보</span>
                        <strong>좋은 돌파 차트 필터</strong>
                      </div>
                      <em>돌파/지지 확인 후보입니다</em>
                    </div>
                    {(report.breakoutCandidates ?? []).length ? (
                      <div className={styles.entryCandidateGrid}>
                        {(report.breakoutCandidates ?? []).slice(0, 4).map((candidate) => (
                          <button
                            key={`${report.market}:breakout:${candidate.symbol}`}
                            type="button"
                            className={`${styles.entryCandidateCard} ${styles.entryarmed}`}
                            onClick={() => void openDailyCandidateAnalysis(candidate)}
                          >
                            <div className={styles.entryCandidateTopline}>
                              <span>{translateBreakoutSignalStatus(candidate.breakoutSignal.status)}</span>
                              <em>{candidate.chartQuality ? `${candidate.chartQuality.score}점` : "품질 대기"}</em>
                            </div>
                            <strong>
                              {candidate.name} ({getDisplaySymbol(candidate.symbol)})
                            </strong>
                            <p>
                              {translatePatternType(candidate.breakoutSignal.pattern)} · {candidate.breakoutSignal.entryPlan}
                            </p>
                            <dl>
                              <div>
                                <dt>기준</dt>
                                <dd>{formatPrice(candidate.breakoutSignal.breakoutLevel)}</dd>
                              </div>
                              <div>
                                <dt>실패</dt>
                                <dd>{formatPrice(candidate.breakoutSignal.failureLevel)}</dd>
                              </div>
                              <div>
                                <dt>거래량</dt>
                                <dd>{candidate.breakoutSignal.volumeRatio ? `${candidate.breakoutSignal.volumeRatio.toFixed(2)}x` : "--"}</dd>
                              </div>
                              <div>
                                <dt>등급</dt>
                                <dd>{translateChartQualityGrade(candidate.chartQuality?.grade)}</dd>
                              </div>
                              <div>
                                <dt>신뢰도</dt>
                                <dd>{candidate.signalReliability ? `${translateSignalReliabilityGrade(candidate.signalReliability.grade)} ${candidate.signalReliability.score}` : "--"}</dd>
                              </div>
                            </dl>
                            <p>{candidate.breakoutSignal.invalidation}</p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.entryCandidateEmpty}>오늘은 돌파가 확인된 후보가 부족합니다.</p>
                    )}
                  </div>
                  ) : null}

                  {activeDailyBriefingTab === "candidates" ? (
                  <div className={styles.entryCandidateSection}>
                    <div className={styles.entryCandidateHeader}>
                      <div>
                        <span>스캔 상세 후보</span>
                        <strong>전체 후보 흐름</strong>
                      </div>
                      <button
                        type="button"
                        className={styles.scanDetailToggle}
                        onClick={() => toggleScanCandidates(report.market)}
                        aria-expanded={scanExpanded}
                      >
                        {scanExpanded ? "접기" : "전체 후보 보기"}
                      </button>
                    </div>
                    {scanExpanded ? (
                      (report.scanCandidates ?? []).length ? (
                        <div className={styles.leaderGrid}>
                          {(report.scanCandidates ?? []).slice(0, 12).map((candidate) => (
                            <button
                              key={`${report.market}:scan:${candidate.symbol}`}
                              type="button"
                              className={`${styles.leaderCard} ${styles[`leader${candidate.decision}`]}`}
                              onClick={() => void openDailyCandidateAnalysis(candidate)}
                            >
                              <div className={styles.leaderTopline}>
                                <span>#{candidate.rank}</span>
                                <strong>{getDisplaySymbol(candidate.symbol)}</strong>
                                <em>{translateDecision(candidate.decision)}</em>
                              </div>
                              <div className={styles.leaderName}>{candidate.name}</div>
                              <div className={styles.leaderSector}>
                                {candidate.themes?.slice(0, 2).join(" / ") ?? candidate.sector ?? "기타"}
                              </div>
                              {candidate.breakoutRule ? (
                                <div className={styles.breakoutBadgeRow}>
                                  <span className={styles.breakoutBadge}>
                                    {translateBreakoutStatus(candidate.breakoutRule.status)}
                                  </span>
                                  <span className={`${styles.trendPill} ${styles[getBreakoutVolumeTone(candidate.breakoutRule.volumeConfirmation?.status)]}`}>
                                    {translateBreakoutVolumeStatus(candidate.breakoutRule.volumeConfirmation?.status)}
                                  </span>
                                  {candidate.breakoutRule.status === "profit-tracking" ? (
                                    <span>+20% 추적</span>
                                  ) : null}
                                  {candidate.breakoutRule.status === "risk-off" ? (
                                    <span>20일선 이탈 주의</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {candidate.breakoutSignal ? (
                                <div className={styles.breakoutBadgeRow}>
                                  <span className={`${styles.trendPill} ${styles[getBreakoutSignalTone(candidate.breakoutSignal.status)]}`}>
                                    {translateBreakoutSignalStatus(candidate.breakoutSignal.status)}
                                  </span>
                                  <span>{translatePatternType(candidate.breakoutSignal.pattern)}</span>
                                  {candidate.chartQuality ? <span>차트 {candidate.chartQuality.score}점</span> : null}
                                  {candidate.signalReliability ? <span>신뢰도 {candidate.signalReliability.score}점</span> : null}
                                </div>
                              ) : null}
                              <div className={styles.leaderStats}>
                                <span>대장 {candidate.leadershipScore ?? "--"}점</span>
                                <span>5일 {formatRatio(candidate.return5)}</span>
                                <span>50일 {formatRatio(candidate.return50)}</span>
                                <span>{formatPrice(candidate.price)}</span>
                                <span>손절 {formatRatio(candidate.risk.stopPct)}</span>
                              </div>
                              {candidate.leadershipReasons?.length ? (
                                <div className={styles.breakoutBadgeRow}>
                                  {candidate.leadershipReasons.slice(0, 3).map((reason) => (
                                    <span key={reason}>{reason}</span>
                                  ))}
                                </div>
                              ) : null}
                              <div className={styles.leaderPlan}>
                                <span>{candidate.breakoutSignal ? "돌파" : candidate.tradeSetup?.keyLevelLabel ?? "기준선"} {formatPrice(candidate.breakoutSignal?.breakoutLevel ?? candidate.tradeSetup?.keyLevel)}</span>
                                <span>실패 {formatPrice(candidate.breakoutSignal?.failureLevel ?? candidate.tradeSetup?.failureLevel)}</span>
                                <span>{candidate.breakoutSignal?.entryPlan ?? candidate.tradeSetup?.entryPlan ?? "5일선/20일선 지지 확인 후 판단합니다."}</span>
                              </div>
                              <p>{translateReason(candidate.reason)}</p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.entryCandidateEmpty}>스캔 상세 후보가 아직 없습니다.</p>
                      )
                    ) : (
                      <p className={styles.entryCandidateEmpty}>
                        후보 전체는 필요할 때 펼쳐 보고, 카드를 누르면 종목분석으로 이동합니다.
                      </p>
                    )}
                  </div>
                  ) : null}

                  {activeDailyBriefingTab === "market" ? (
                    <div className={styles.briefingGrid}>
                      <article>
                        <span>오늘의 주도테마</span>
                        <ul>
                          {reportThemes.slice(0, 4).map((theme) => (
                            <li key={theme.theme}>
                              {theme.theme}: 5일 {formatRatio(theme.averageReturn5)} / 50일 {formatRatio(theme.averageReturn50)} / 후보 {theme.leaderCount}개
                            </li>
                          ))}
                        </ul>
                      </article>
                      <article className={styles.themeLeaderArticle}>
                        <span>주도테마별 후보</span>
                        <div className={styles.themeLeaderGroups}>
                          {reportThemes.slice(0, 4).map((theme) => (
                            <div key={theme.theme} className={styles.themeLeaderGroup}>
                              <strong>{theme.theme}</strong>
                              {theme.strongest.length ? (
                                <ul>
                                  {theme.strongest.map((stock) => (
                                    <li key={`${theme.theme}:${stock.symbol}`}>
                                      {stock.name} ({getDisplaySymbol(stock.symbol)}) {translateDecision(stock.decision)} · {formatTradeSetupSummary(stock.tradeSetup ?? stock.tradePlan?.tradeSetup)} · {stock.breakoutRule ? formatBreakoutVolume(stock.breakoutRule) : "거래량 대기"} · 5일 {formatRatio(stock.return5)}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p>표시할 후보가 부족합니다.</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </article>
                      <article>
                        <span>실행 기준</span>
                        <ul>
                          {report.strongestStocks.slice(0, 3).map((stock) => (
                            <li key={stock.symbol}>
                              {stock.name} ({getDisplaySymbol(stock.symbol)}): {stock.tradeSetup?.keyLevelLabel ?? stock.tradePlan.tradeSetup?.keyLevelLabel ?? "기준선"} {formatPrice(stock.tradeSetup?.keyLevel ?? stock.tradePlan.tradeSetup?.keyLevel)} / 실패 {formatPrice(stock.tradeSetup?.failureLevel ?? stock.tradePlan.tradeSetup?.failureLevel)}
                            </li>
                          ))}
                        </ul>
                      </article>
                    </div>
                  ) : null}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
          ) : !marketBriefing && activeDailyBriefingTab !== "history" ? (
            <div className={styles.analysisEmpty}>
              <strong>시장 브리핑 대기</strong>
              <p>데일리 나스닥 또는 데일리 한국장을 선택하고 일간분석을 실행하십시오.</p>
            </div>
          ) : null}

	          {dailyBriefing && activeDailyBriefingTab === "history" ? (
            <>
              <div className={styles.briefingSection}>
                <strong>관심종목 참고 브리핑</strong>
                <p>{dailyBriefing.marketTone}</p>
              </div>
              <div className={styles.briefingGrid}>
                <article>
                  <span>주도 후보</span>
                  <ul>
                    {dailyBriefing.leadership.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
                <article>
                  <span>관찰 후보</span>
                  <ul>
                    {dailyBriefing.watchlist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
                <article>
                  <span>위험 후보</span>
                  <ul>
                    {dailyBriefing.riskList.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              </div>
              <div className={styles.briefingSection}>
                <strong>오늘의 트레이딩 스토리</strong>
                <p>{dailyBriefing.tradingStory}</p>
              </div>
            </>
	          ) : !dailyBriefing && activeDailyBriefingTab === "history" ? (
            <div className={styles.analysisEmpty}>
              <strong>데이터 로딩 중</strong>
              <p>관심종목의 시장 데이터를 불러오면 데일리 브리핑이 자동으로 생성됩니다.</p>
            </div>
          ) : null}
        </section>
      ) : activeWorkbenchTab === "analysis" ? (
        <section className={styles.analysisPanel}>
          <form
            className={styles.analysisForm}
            onSubmit={(event) => {
              event.preventDefault();
              void runSingleAnalysis();
            }}
          >
            <div>
              <p className={styles.kicker}>단건 분석</p>
              <h2>원하는 종목 분석</h2>
              <p>입력한 종목의 돌파 패턴, 거래량, 실패선을 기준으로 진입 가능 여부를 요약합니다.</p>
            </div>
            <SymbolAutocomplete
              label="종목"
              value={analysisSymbol}
              onChange={(value) => setAnalysisSymbol(value.toUpperCase())}
              onSelect={selectAnalysisSymbol}
              placeholder={analysisMarket === "CRYPTO" ? "BTC" : "삼성 / 테슬"}
            />
            <label>
              시장
              <select
                value={analysisMarket}
                onChange={(event) => setAnalysisMarket(event.target.value)}
              >
                {marketOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              기간
              <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)}>
                {rangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              봉
              <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
                {timeframeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={analysisLoading}>
              {analysisLoading ? "분석 중" : "분석"}
            </button>
          </form>

          {analysisError ? <p className={styles.analysisError}>{analysisError}</p> : null}

          {selectedAnalysis?.data && selectedAnalysis.meter ? (
            <div className={styles.analysisResult}>
              <div className={styles.analysisResultHeader}>
                <div>
                  <span>{selectedAnalysis.market}</span>
                  <h3>{getRowDisplayName(selectedAnalysis)}</h3>
                  <p>{getRowSymbolLabel(selectedAnalysis)}</p>
                </div>
                <span className={`${styles.trendPill} ${styles[selectedChartBriefing?.tone ?? analysisTrendState.tone]}`}>
                  {selectedChartBriefing?.label ?? analysisTrendState.label}
                </span>
              </div>

              <div className={styles.analysisBreakoutHero}>
                <div className={styles.analysisBreakoutHeroTop}>
                  <div>
                    <span>돌파매매 판단</span>
                    <h3>{analysisBreakoutDecision.label}</h3>
                    <p>{analysisBreakoutDecision.headline}</p>
                  </div>
                  <span className={`${styles.trendPill} ${styles[analysisBreakoutDecision.tone]}`}>
                    {analysisBreakoutDecision.statusLabel}
                  </span>
                </div>
                <div className={styles.analysisBreakoutMetrics}>
                  {analysisBreakoutDecision.metrics.map((metric) => (
                    <div key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
                <div className={styles.analysisDecisionGrid}>
                  <article>
                    <span>진입 조건</span>
                    <ul>
                      {analysisBreakoutDecision.entryConditions.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </article>
                  <article>
                    <span>실패 조건</span>
                    <ul>
                      {analysisBreakoutDecision.failureConditions.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </article>
                </div>
                {analysisBreakoutDecision.reasons.length ? (
                  <div className={styles.analysisBreakoutReasons}>
                    {analysisBreakoutDecision.reasons.slice(0, 3).map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              {analysisPositionPlan ? (
                <PositionManagementPanel
                  plan={analysisPositionPlan}
                  currency={analysisCurrency}
                  title="손절/분할익절 기준"
                />
              ) : null}

              {selectedChartBriefing ? (
                <AnnotatedAnalysisChart
                  key={`${selectedAnalysis.symbol}:${timeframe}:${rangeDays}`}
                  data={selectedAnalysis.data}
                  briefing={selectedChartBriefing}
                />
              ) : null}

              <details className={styles.analysisDetailDisclosure}>
                <summary>
                  <span>상세 기준과 보조 지표</span>
                  <strong>신고가 룰, 가격 기준선, 기존 추세 신호</strong>
                </summary>
                <div className={styles.analysisDetailStack}>
                  <div className={styles.analysisMetricGrid}>
                    <div>
                      <span>현재가</span>
                      <strong>{formatPrice(selectedAnalysis.meter.latest.price)}</strong>
                    </div>
                    <div>
                      <span>변화율</span>
                      <strong>{formatPercent(selectedAnalysis.meter.latest.changePct)}</strong>
                    </div>
                    <div>
                      <span>가격 곡소리</span>
                      <strong>{selectedAnalysis.meter.score}점 · {selectedAnalysis.meter.level}</strong>
                    </div>
                    <div>
                      <span>추세 판단</span>
                      <strong>{selectedChartBriefing?.label ?? analysisTrendState.label}</strong>
                    </div>
                  </div>

              <div className={styles.analysisMetricGrid}>
                <div>
                  <span>5일선 매수 구간</span>
                  <strong>
                    {formatPriceRange(
                      selectedChartBriefing?.levels.fiveDayBuyLow,
                      selectedChartBriefing?.levels.fiveDayBuyHigh,
                    )}
                  </strong>
                </div>
                <div>
                  <span>20일선 매수 구간</span>
                  <strong>
                    {formatPriceRange(
                      selectedChartBriefing?.levels.twentyDayBuyLow,
                      selectedChartBriefing?.levels.twentyDayBuyHigh,
                    )}
                  </strong>
                </div>
                <div>
                  <span>1차 손절</span>
                  <strong>{formatPrice(selectedChartBriefing?.levels.primaryStop)}</strong>
                </div>
                <div>
                  <span>강제 손절</span>
                  <strong>{formatPrice(selectedChartBriefing?.levels.hardStop)}</strong>
                </div>
              </div>

              <div className={styles.analysisMetricGrid}>
                <div>
                  <span>5일선 거리</span>
                  <strong>{formatRatio(selectedChartBriefing?.levels.distanceToSma5Pct)}</strong>
                </div>
                <div>
                  <span>20일선 거리</span>
                  <strong>{formatRatio(selectedChartBriefing?.levels.distanceToSma20Pct)}</strong>
                </div>
                <div>
                  <span>20일선 기울기</span>
                  <strong>{formatRatio(latestTrendFeature?.sma20SlopePct)}</strong>
                </div>
                <div>
                  <span>거래량 배율</span>
                  <strong>{latestTrendFeature?.volumeRatio ? `${latestTrendFeature.volumeRatio.toFixed(2)}x` : "--"}</strong>
                </div>
              </div>

              {selectedAnalysis.data.breakoutRule ? (
                <div className={styles.breakoutRulePanel}>
                  <div className={styles.breakoutRuleHeader}>
                    <div>
                      <span>신고가 돌파 룰</span>
                      <strong>{getBreakoutHeadline(selectedAnalysis.data.breakoutRule)}</strong>
                    </div>
                    <span className={`${styles.trendPill} ${styles[getBreakoutTone(selectedAnalysis.data.breakoutRule.status)]}`}>
                      {translateBreakoutStatus(selectedAnalysis.data.breakoutRule.status)}
                    </span>
                  </div>
                  <div className={styles.breakoutMetricGrid}>
                    <div>
                      <span>신고가 기준가</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutRule.newHighLevel)}</strong>
                    </div>
                    <div>
                      <span>현재가 대비 거리</span>
                      <strong>{formatRatio(selectedAnalysis.data.breakoutRule.breakoutDistancePct)}</strong>
                    </div>
                    <div>
                      <span>거래대금 강도</span>
                      <strong>{formatLargeAmount(selectedAnalysis.data.breakoutRule.avgTradedValue20)}</strong>
                    </div>
                    <div>
                      <span>돌파/지지 거래량</span>
                      <strong>{formatBreakoutVolume(selectedAnalysis.data.breakoutRule)}</strong>
                    </div>
                    <div>
                      <span>-10% 손절가</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutRule.fixedStopPrice)}</strong>
                    </div>
                    <div>
                      <span>+20% 전환가</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutRule.profitSwitchPrice)}</strong>
                    </div>
                    <div>
                      <span>20일선 추적선</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutRule.trailingExitPrice)}</strong>
                    </div>
                  </div>
                  <ul>
                    {selectedAnalysis.data.breakoutRule.reasons.slice(0, 3).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedAnalysis.data.tradeSetup ? (
                <div className={styles.tradeSetupPanel}>
                  <div className={styles.breakoutRuleHeader}>
                    <div>
                      <span>가격 기준선</span>
                      <strong>{selectedAnalysis.data.tradeSetup.label}</strong>
                    </div>
                    <span className={`${styles.trendPill} ${styles.trendWatch}`}>
                      {translateTradeSetupType(selectedAnalysis.data.tradeSetup.type)}
                    </span>
                  </div>
                  <div className={styles.breakoutMetricGrid}>
                    <div>
                      <span>핵심 기준</span>
                      <strong>{selectedAnalysis.data.tradeSetup.keyLevelLabel}</strong>
                    </div>
                    <div>
                      <span>기준선</span>
                      <strong>{formatPrice(selectedAnalysis.data.tradeSetup.keyLevel)}</strong>
                    </div>
                    <div>
                      <span>실패선</span>
                      <strong>{formatPrice(selectedAnalysis.data.tradeSetup.failureLevel)}</strong>
                    </div>
                    <div>
                      <span>유효 조건</span>
                      <strong>{selectedAnalysis.data.tradeSetup.validIf}</strong>
                    </div>
                    <div>
                      <span>실패 조건</span>
                      <strong>{selectedAnalysis.data.tradeSetup.invalidIf}</strong>
                    </div>
                    <div>
                      <span>진입 방식</span>
                      <strong>{selectedAnalysis.data.tradeSetup.entryPlan}</strong>
                    </div>
                  </div>
                  <p>{selectedAnalysis.data.tradeSetup.stopReason}</p>
                </div>
              ) : null}

              {selectedAnalysis.data.breakoutSignal ? (
                <div className={styles.breakoutRulePanel}>
                  <div className={styles.breakoutRuleHeader}>
                    <div>
                      <span>돌파매매 신호</span>
                      <strong>
                        {translatePatternType(selectedAnalysis.data.breakoutSignal.pattern)} · {translateBreakoutSignalStatus(selectedAnalysis.data.breakoutSignal.status)}
                      </strong>
                    </div>
                    <span className={`${styles.trendPill} ${styles[getBreakoutSignalTone(selectedAnalysis.data.breakoutSignal.status)]}`}>
                      {selectedAnalysis.data.chartQuality
                        ? `차트 ${selectedAnalysis.data.chartQuality.score}점 · ${translateChartQualityGrade(selectedAnalysis.data.chartQuality.grade)}`
                        : "차트 품질 대기"}
                    </span>
                  </div>
                  <div className={styles.breakoutMetricGrid}>
                    <div>
                      <span>패턴명</span>
                      <strong>{translatePatternType(selectedAnalysis.data.breakoutSignal.pattern)}</strong>
                    </div>
                    <div>
                      <span>돌파 기준선</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutSignal.breakoutLevel)}</strong>
                    </div>
                    <div>
                      <span>현재가</span>
                      <strong>{formatPrice(selectedAnalysis.data.candles.at(-1)?.close)}</strong>
                    </div>
                    <div>
                      <span>거래량 배율</span>
                      <strong>{selectedAnalysis.data.breakoutSignal.volumeRatio ? `${selectedAnalysis.data.breakoutSignal.volumeRatio.toFixed(2)}x` : "--"}</strong>
                    </div>
                    <div>
                      <span>실패선</span>
                      <strong>{formatPrice(selectedAnalysis.data.breakoutSignal.failureLevel)}</strong>
                    </div>
                    <div>
                      <span>상태</span>
                      <strong>{translateBreakoutSignalStatus(selectedAnalysis.data.breakoutSignal.status)}</strong>
                    </div>
                  </div>
                  <ul>
                    <li>{selectedAnalysis.data.breakoutSignal.entryPlan}</li>
                    <li>{selectedAnalysis.data.breakoutSignal.invalidation}</li>
                    {(selectedAnalysis.data.chartQuality?.reasons ?? selectedAnalysis.data.breakoutSignal.reasons).slice(0, 2).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedAnalysis.data.signalReliability ? (
                <div className={styles.breakoutRulePanel}>
                  <div className={styles.breakoutRuleHeader}>
                    <div>
                      <span>신호 신뢰도</span>
                      <strong>
                        {translatePatternType(
                          selectedAnalysis.data.signalReliability.pattern === "trend-following"
                            ? "ma-reclaim"
                            : selectedAnalysis.data.signalReliability.pattern,
                        )} 과거 유사 성과
                      </strong>
                    </div>
                    <span className={`${styles.trendPill} ${styles[getSignalReliabilityTone(selectedAnalysis.data.signalReliability.grade)]}`}>
                      {translateSignalReliabilityGrade(selectedAnalysis.data.signalReliability.grade)} · {selectedAnalysis.data.signalReliability.score}점
                    </span>
                  </div>
                  <div className={styles.breakoutMetricGrid}>
                    <div>
                      <span>유사 신호</span>
                      <strong>{selectedAnalysis.data.signalReliability.sampleSize}회</strong>
                    </div>
                    <div>
                      <span>성공 비율</span>
                      <strong>{formatRatio(selectedAnalysis.data.signalReliability.successRate)}</strong>
                    </div>
                    <div>
                      <span>손절 도달</span>
                      <strong>{formatRatio(selectedAnalysis.data.signalReliability.stopHitRate)}</strong>
                    </div>
                    <div>
                      <span>평균 최대상승</span>
                      <strong>{formatRatio(selectedAnalysis.data.signalReliability.averageMaxGainPct)}</strong>
                    </div>
                    <div>
                      <span>평균 최대하락</span>
                      <strong>{formatRatio(selectedAnalysis.data.signalReliability.averageMaxDrawdownPct)}</strong>
                    </div>
                    <div>
                      <span>평균 손익비</span>
                      <strong>{selectedAnalysis.data.signalReliability.riskReward ? `${selectedAnalysis.data.signalReliability.riskReward.toFixed(2)}배` : "--"}</strong>
                    </div>
                  </div>
                  <ul>
                    {selectedAnalysis.data.signalReliability.reasons.slice(0, 4).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedChartBriefing ? (
                <div className={styles.briefingGrid}>
                  <article>
                    <span>차트 해석</span>
                    <p>{selectedChartBriefing.marketRead}</p>
                    <p>{selectedChartBriefing.sectorRead}</p>
                  </article>
                  <article>
                    <span>실행 플랜</span>
                    <ul>
                      {selectedChartBriefing.executionPlan.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                  <article>
                    <span>리스크 기준</span>
                    <ul>
                      {selectedChartBriefing.riskNotes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                </div>
              ) : null}

              <div className={styles.analysisReason}>
                <strong>기존 추세 신호 참고</strong>
                <p>
                  {latestTrendSignal
                    ? translateReason(latestTrendSignal.reason)
                    : "기존 돌파 신호는 보조 참고로만 사용하고, 실제 실행은 현재가와 5일선/20일선 기준으로 판단하십시오."}
                </p>
                {latestTrendFeature?.rejectionReasons.length ? (
                  <ul>
                    {latestTrendFeature.rejectionReasons.map((reason) => (
                      <li key={reason}>{translateRejectionReason(reason)}</li>
                    ))}
                  </ul>
                ) : null}
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <div className={styles.analysisEmpty}>
              <strong>분석 대기</strong>
              <p>원하는 종목과 시장을 입력한 뒤 `분석`을 실행하십시오.</p>
            </div>
          )}
        </section>
      ) : null}

      <footer className={styles.footer}>
        <span>전체 {rows.length}</span>
        <span>표시 {visibleRows.length}</span>
      </footer>
    </main>
  );
}
