import type { LeaderMarket } from "./leader-universes.ts";
import type { BreakoutRule } from "./breakout-rule.ts";
import type { BreakoutSignal, ChartQuality, PatternSignals } from "./pattern-signals.ts";
import type { SignalReliability } from "./signal-reliability.ts";
import { buildTradeSetup, type TradeSetup } from "./trade-setup.ts";

export type DailyBriefingSession = "US" | "KR";

export type CandidateSourceStatus = "dynamic" | "fallback" | "mixed";
export type CandidateSourceDetail = "dynamic" | "symbol-master" | "fallback" | "curated";

export type CandidateSource = {
  status: CandidateSourceStatus;
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

export type LeaderCandidate = {
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
  candidateSourceDetail?: CandidateSourceDetail;
  decision: "enter" | "hold" | "watch" | "avoid";
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
};

export type LeaderResponse = {
  market: LeaderMarket;
  strategy: {
    name: string;
    maxStopPct?: number;
  };
  generatedAt?: string;
  tradingDate?: string;
  nextRefreshAt?: string;
  scanStatus?: "ready" | "waiting-for-close";
  candidateSource?: CandidateSource;
  marketHealth: {
    breadth: number;
    averageReturn50: number;
    pass: boolean;
    loadedSymbols: number;
    totalSymbols: number;
  };
  candidates: LeaderCandidate[];
  errors: Array<{ symbol: string; name: string; error: string }>;
};

export type MarketBriefingReport = ReturnType<typeof buildMarketReport>;

export type AutomationStatus = "tradable" | "probe" | "armed" | "watch" | "blocked";
export type EntrySetup = "breakout" | "pullback-5d" | "pullback-20d" | "trend-continuation";
export type EntryType = "limit" | "stop-limit" | "close-confirmation";

type ThemeBriefing = {
  theme: string;
  sector: string;
  score: number;
  averageReturn5: number;
  averageReturn50: number;
  leaderCount: number;
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
    candidateSourceDetail?: CandidateSourceDetail;
    breakoutRule?: BreakoutRule;
    tradeSetup: TradeSetup;
    breakoutSignal?: BreakoutSignal;
    chartQuality?: ChartQuality;
    signalReliability?: SignalReliability;
    tradePlan: ReturnType<typeof buildTradePlan>;
  }>;
  read: string;
};

export type EntryCandidate = {
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
  tradeSetup: TradeSetup;
  breakoutSignal?: BreakoutSignal;
  chartQuality?: ChartQuality;
  signalReliability?: SignalReliability;
};

type BreakoutCandidate = {
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
  candidateSourceDetail?: CandidateSourceDetail;
  breakoutSignal: BreakoutSignal;
  chartQuality?: ChartQuality;
  signalReliability?: SignalReliability;
  tradeSetup: TradeSetup;
};

type ScanCandidate = LeaderCandidate & {
  tradeSetup: TradeSetup;
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

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const sessionConfig: Record<DailyBriefingSession, {
  label: string;
  markets: LeaderMarket[];
  timeZone: string;
  refreshHour: number;
  refreshMinute: number;
}> = {
  US: {
    label: "데일리 나스닥",
    markets: ["US"],
    timeZone: "America/New_York",
    refreshHour: 17,
    refreshMinute: 30,
  },
  KR: {
    label: "데일리 한국장",
    markets: ["KOSPI", "KOSDAQ"],
    timeZone: "Asia/Seoul",
    refreshHour: 16,
    refreshMinute: 30,
  },
};

const formatPercent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "--";

const formatPrice = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "--";

const formatRange = (low: number | null | undefined, high: number | null | undefined) =>
  typeof low === "number" && typeof high === "number"
    ? `${formatPrice(low)} ~ ${formatPrice(high)}`
    : "--";

const average = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const getLeadershipScore = (candidate: Pick<LeaderCandidate, "leadershipScore" | "return50" | "return5" | "breakoutSignal" | "chartQuality" | "signalReliability">) =>
  typeof candidate.leadershipScore === "number" && Number.isFinite(candidate.leadershipScore)
    ? candidate.leadershipScore
    : candidate.return50 * 100 +
      (candidate.return5 ?? 0) * 40 +
      (candidate.chartQuality?.score ?? 0) * 0.25 +
      (candidate.signalReliability?.grade === "high"
        ? 16
        : candidate.signalReliability?.grade === "medium"
          ? 8
          : candidate.signalReliability?.grade === "low"
            ? -8
            : 0) +
      (candidate.breakoutSignal?.status === "confirmed"
        ? 35
        : candidate.breakoutSignal?.status === "retest"
          ? 28
          : candidate.breakoutSignal?.status === "triggered"
            ? 20
            : candidate.breakoutSignal?.status === "extended"
              ? 6
            : 0);

const sortByLeadership = <T extends Pick<LeaderCandidate, "leadershipScore" | "return50" | "return5" | "breakoutSignal" | "chartQuality" | "signalReliability">>(values: T[]) =>
  values.toSorted((left, right) =>
    getLeadershipScore(right) - getLeadershipScore(left) ||
    right.return50 - left.return50,
  );

const DEFAULT_MAX_AUTOMATION_RISK_PCT = 0.08;
const PROBE_BREAKOUT_DISTANCE_PCT = 0.035;
const EXTENDED_RETURN5_ARMED_PCT = 0.18;
const EXTENDED_RETURN5_BLOCK_PCT = 0.4;

const getTimeZoneParts = (date: Date, timeZone: string): TimeZoneParts => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
};

const zonedTimeToUtc = (
  parts: Pick<TimeZoneParts, "year" | "month" | "day" | "hour" | "minute">,
  timeZone: string,
) => {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const firstPass = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  return new Date(utcGuess - getTimeZoneOffsetMs(firstPass, timeZone));
};

const addDays = (parts: Pick<TimeZoneParts, "year" | "month" | "day">, days: number) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const isWeekday = (weekday: string) => weekday !== "Sat" && weekday !== "Sun";

const formatDateKey = (parts: Pick<TimeZoneParts, "year" | "month" | "day">) =>
  `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

const findPreviousTradingDate = (parts: TimeZoneParts, timeZone: string) => {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(parts, -offset);
    const weekday = getTimeZoneParts(zonedTimeToUtc({ ...candidate, hour: 12, minute: 0 }, timeZone), timeZone).weekday;
    if (isWeekday(weekday)) {
      return candidate;
    }
  }
  return parts;
};

const findNextRefresh = (
  parts: TimeZoneParts,
  config: (typeof sessionConfig)[DailyBriefingSession],
  now: Date,
) => {
  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = addDays(parts, offset);
    const refreshAt = zonedTimeToUtc(
      {
        ...candidate,
        hour: config.refreshHour,
        minute: config.refreshMinute,
      },
      config.timeZone,
    );
    const weekday = getTimeZoneParts(refreshAt, config.timeZone).weekday;
    if (isWeekday(weekday) && refreshAt.getTime() > now.getTime()) {
      return refreshAt;
    }
  }
  return now;
};

export const parseDailyBriefingSession = (rawSession: string | null): DailyBriefingSession =>
  rawSession?.toUpperCase() === "KR" ? "KR" : "US";

export const getDailyBriefingSessionLabel = (session: DailyBriefingSession) =>
  sessionConfig[session].label;

export const getDailyBriefingMarkets = (session: DailyBriefingSession) =>
  sessionConfig[session].markets;

export const getSessionSchedule = (session: DailyBriefingSession, now = new Date()) => {
  const config = sessionConfig[session];
  const parts = getTimeZoneParts(now, config.timeZone);
  const todayRefresh = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: config.refreshHour,
      minute: config.refreshMinute,
    },
    config.timeZone,
  );
  const todayIsWeekday = isWeekday(parts.weekday);
  const status: "ready" | "waiting-for-close" =
    todayIsWeekday && now.getTime() >= todayRefresh.getTime()
      ? "ready"
      : "waiting-for-close";
  const tradingDateParts =
    status === "ready"
      ? parts
      : findPreviousTradingDate(addDays(parts, -1) as TimeZoneParts, config.timeZone);

  return {
    session,
    label: config.label,
    timeZone: config.timeZone,
    status,
    tradingDate: formatDateKey(tradingDateParts),
    nextRefreshAt: findNextRefresh(parts, config, now).toISOString(),
  };
};

export const getMarketSession = (market: LeaderMarket): DailyBriefingSession =>
  market === "US" ? "US" : "KR";

const buildThemeBriefing = (candidates: LeaderCandidate[]): ThemeBriefing[] => {
  const byTheme = new Map<string, LeaderCandidate[]>();
  candidates.forEach((candidate) => {
    const themes = candidate.themes?.length ? candidate.themes : [candidate.sector ?? "기타"];
    themes.forEach((theme) => {
      byTheme.set(theme, [...(byTheme.get(theme) ?? []), candidate]);
    });
  });

  return [...byTheme.entries()]
    .map(([theme, themeCandidates]) => {
      const sorted = sortByLeadership(themeCandidates);
      const constructiveCount = sorted.filter((candidate) =>
        candidate.decision === "enter" || candidate.decision === "hold" || candidate.decision === "watch",
      ).length;
      const averageReturn5 = average(sorted.map((candidate) => candidate.return5 ?? 0));
      const averageReturn50 = average(sorted.map((candidate) => candidate.return50));
      const score = constructiveCount * 2 + averageReturn5 * 8 + averageReturn50 * 3;
      const strongest = sorted
        .filter((candidate) =>
          candidate.decision === "enter" || candidate.decision === "hold" || candidate.decision === "watch",
        )
        .slice(0, 8)
        .map((candidate) => ({
        symbol: candidate.symbol,
        name: candidate.name,
        sector: candidate.sector ?? "기타",
        themes: candidate.themes?.length ? candidate.themes : [candidate.sector ?? "기타"],
        rank: candidate.rank,
        price: candidate.price,
        decision: candidate.decision,
        reason: candidate.reason,
        return5: candidate.return5,
        return50: candidate.return50,
        leadershipScore: candidate.leadershipScore,
        leadershipReasons: candidate.leadershipReasons,
        candidateSourceDetail: candidate.candidateSourceDetail,
        breakoutRule: candidate.breakoutRule,
        tradeSetup: candidate.tradeSetup ?? buildTradeSetup(candidate),
        breakoutSignal: candidate.breakoutSignal,
        chartQuality: candidate.chartQuality,
        signalReliability: candidate.signalReliability,
        tradePlan: buildTradePlan(candidate),
      }));

      return {
        theme,
        sector: theme,
        score,
        averageReturn5,
        averageReturn50,
        leaderCount: constructiveCount,
        strongest,
        read:
          constructiveCount >= 2
            ? `${theme} 테마는 20일선 위 후보가 여러 개라 오늘의 주도테마로 우선 관찰합니다.`
            : constructiveCount === 1
              ? `${theme} 테마는 한 종목만 강합니다. 테마 전체보다 개별 대장주 중심으로 봅니다.`
              : `${theme} 테마는 아직 강한 흐름이 부족합니다.`,
      };
    })
    .toSorted((left, right) =>
      right.score - left.score,
    )
    .slice(0, 6);
};

const buildTradePlan = (candidate: LeaderCandidate) => {
  const levels = candidate.levels;
  const tradeSetup = candidate.tradeSetup ?? buildTradeSetup(candidate);
  const firstEntry = formatRange(levels?.aggressiveEntryLow, levels?.aggressiveEntryHigh);
  const conservativeEntry = formatRange(levels?.conservativeEntryLow, levels?.conservativeEntryHigh);
  const stop = formatPrice(levels?.newEntryStop ?? candidate.risk.stopPrice);
  const breakout = formatPrice(levels?.breakoutPrice);
  const breakoutBasis =
    candidate.breakoutRule?.status === "profit-tracking"
      ? "+20% 이후 20일선 추적 모드입니다."
      : candidate.breakoutRule?.status === "breakout-ready"
        ? "신고가 돌파 후보입니다. 추격보다 지지 확인이 우선입니다."
        : candidate.breakoutRule?.status === "risk-off"
          ? "20일선 이탈 주의 구간입니다."
          : null;
  const basis =
    candidate.decision === "enter"
      ? "신규 진입 가능 후보입니다. 현재가 추격보다 5일선 지지 후 분할 진입을 우선합니다."
      : candidate.decision === "hold"
        ? "이미 추세가 진행 중입니다. 신규 진입은 5일선 눌림을 기다리는 편이 낫습니다."
        : candidate.decision === "watch"
          ? "구조는 살아 있지만 당장 진입 신호는 약합니다. 20일선 지지 확인 후 접근합니다."
          : "신규 진입 대상에서 제외합니다.";

  return {
    firstEntry,
    conservativeEntry,
    stop,
    breakout,
    basis,
    tradeSetup,
    text: `${basis}${breakoutBasis ? ` ${breakoutBasis}` : ""} 핵심 기준선은 ${tradeSetup.keyLevelLabel} ${formatPrice(tradeSetup.keyLevel)}이고, 실패 기준은 ${formatPrice(tradeSetup.failureLevel)}입니다.`,
  };
};

const getEntrySetup = (candidate: LeaderCandidate): EntrySetup => {
  if (candidate.breakoutRule?.status === "breakout-ready") {
    return "breakout";
  }
  if (candidate.decision === "hold") {
    return "trend-continuation";
  }
  if (candidate.decision === "watch") {
    return "pullback-20d";
  }
  return "pullback-5d";
};

const getEntryType = (setup: EntrySetup): EntryType => {
  if (setup === "breakout") {
    return "stop-limit";
  }
  if (setup === "trend-continuation") {
    return "close-confirmation";
  }
  return "limit";
};

const getEntryReason = (candidate: LeaderCandidate, status: AutomationStatus) => {
  if (status === "tradable") {
    return "시장, 리더 순위, 모멘텀, 일봉 진입 조건이 모두 통과된 자동매매 후보입니다.";
  }
  if (status === "probe") {
    return "돌파 신호는 좋지만 이격 또는 손절폭 부담이 있어 1차 탐색 비중만 허용하는 후보입니다.";
  }
  if (status === "armed") {
    return "조건은 가깝지만 현재가 추격보다 지정가 또는 종가 확인이 필요한 대기 후보입니다.";
  }
  if (status === "watch") {
    return candidate.decision === "hold"
      ? "이미 추세가 진행 중이라 신규 자동매수보다 눌림 확인이 우선입니다."
      : "구조는 살아 있지만 당장 자동매매 진입 조건은 부족합니다.";
  }
  return "자동매매 후보에서 제외합니다.";
};

const buildEntryCandidate = (
  candidate: LeaderCandidate,
  marketPass: boolean,
  maxRiskPct: number,
): EntryCandidate => {
  const tradePlan = buildTradePlan(candidate);
  const tradeSetup = candidate.tradeSetup ?? tradePlan.tradeSetup;
  const setup = getEntrySetup(candidate);
  const riskPct =
    typeof candidate.risk.stopPct === "number" && Number.isFinite(candidate.risk.stopPct)
      ? Math.abs(candidate.risk.stopPct)
      : null;
  const breakoutDistancePct =
    typeof candidate.breakoutSignal?.breakoutLevel === "number" &&
    Number.isFinite(candidate.breakoutSignal.breakoutLevel) &&
    candidate.breakoutSignal.breakoutLevel > 0
      ? (candidate.price - candidate.breakoutSignal.breakoutLevel) / candidate.breakoutSignal.breakoutLevel
      : typeof candidate.breakoutRule?.breakoutDistancePct === "number"
        ? candidate.breakoutRule.breakoutDistancePct
        : null;
  const hasProbeBreakout =
    candidate.breakoutSignal?.status === "confirmed" ||
    candidate.breakoutSignal?.status === "triggered" ||
    candidate.breakoutSignal?.status === "retest" ||
    candidate.breakoutSignal?.status === "extended";
  const hasProbeVolume =
    typeof candidate.breakoutSignal?.volumeRatio === "number"
      ? candidate.breakoutSignal.volumeRatio >= 1.3
      : candidate.breakoutRule?.volumeConfirmation?.status === "confirmed" ||
        candidate.breakoutRule?.volumeConfirmation?.status === "strong";
  const chartAllowsProbe = candidate.chartQuality ? candidate.chartQuality.grade !== "weak" : true;
  const reliabilityAllowsProbe = candidate.signalReliability ? candidate.signalReliability.grade !== "low" : true;
  const probeBurden =
    candidate.breakoutSignal?.status === "extended" ||
    (typeof breakoutDistancePct === "number" && breakoutDistancePct >= PROBE_BREAKOUT_DISTANCE_PCT) ||
    (riskPct !== null && riskPct > maxRiskPct) ||
    (candidate.return5 ?? 0) >= EXTENDED_RETURN5_ARMED_PCT;
  const canProbe =
    marketPass &&
    candidate.decision === "enter" &&
    hasProbeBreakout &&
    hasProbeVolume &&
    chartAllowsProbe &&
    reliabilityAllowsProbe &&
    probeBurden;
  const blockers: string[] = [];
  const probeNotes: string[] = [];

  if (!marketPass) {
    blockers.push("시장폭 필터가 통과되지 않았습니다.");
  }
  if (candidate.decision === "avoid") {
    blockers.push(candidate.reason);
  }
  if (candidate.breakoutRule?.status === "risk-off") {
    blockers.push("신고가 룰 기준 20일선 이탈 주의 구간입니다.");
  }
  if (candidate.breakoutSignal?.status === "extended" && !canProbe) {
    blockers.push("돌파선 대비 이격이 커 추격 진입을 제한합니다.");
  } else if (candidate.breakoutSignal?.status === "extended") {
    probeNotes.push("돌파 이후 이격이 있어 탐색 비중만 허용합니다.");
  }
  if (riskPct === null) {
    blockers.push("손절폭을 계산할 수 없습니다.");
  } else if (riskPct > maxRiskPct && !canProbe) {
    blockers.push(`손절폭 ${formatPercent(riskPct)}가 자동매매 한도 ${formatPercent(maxRiskPct)}를 초과합니다.`);
  } else if (riskPct > maxRiskPct) {
    probeNotes.push(`손절폭 ${formatPercent(riskPct)}로 풀진입 대신 탐색 비중만 허용합니다.`);
  }
  if ((candidate.return5 ?? 0) >= EXTENDED_RETURN5_BLOCK_PCT) {
    blockers.push(`5일 상승률 ${formatPercent(candidate.return5)}로 단기 과열이 큽니다.`);
  }
  if (candidate.breakoutRule?.status === "profit-tracking") {
    blockers.push("+20% 이후 20일선 추적 모드라 신규 자동매수보다 보유 관리가 우선입니다.");
  }
  if (tradeSetup.type === "risk-off") {
    blockers.push(tradeSetup.invalidIf);
  }
  if (candidate.chartQuality?.grade === "weak") {
    blockers.push("차트 품질이 약해 탐색 진입도 제한합니다.");
  }
  if (candidate.signalReliability?.grade === "low") {
    blockers.push("신호 신뢰도가 낮아 탐색 진입도 제한합니다.");
  }
  if (typeof breakoutDistancePct === "number" && breakoutDistancePct >= PROBE_BREAKOUT_DISTANCE_PCT) {
    probeNotes.push(`돌파선 대비 이격 ${formatPercent(breakoutDistancePct)}로 1차 탐색 비중만 허용합니다.`);
  }
  if ((candidate.return5 ?? 0) >= EXTENDED_RETURN5_ARMED_PCT && (candidate.return5 ?? 0) < EXTENDED_RETURN5_BLOCK_PCT) {
    probeNotes.push(`5일 상승률 ${formatPercent(candidate.return5)}로 풀진입보다 탐색 비중이 우선입니다.`);
  }

  let automationStatus: AutomationStatus;
  if (blockers.length) {
    automationStatus = "blocked";
  } else if (canProbe) {
    automationStatus = "probe";
  } else if (candidate.decision === "enter") {
    const needsConfirmation =
      candidate.breakoutRule?.status === "breakout-ready" ||
      (candidate.return5 ?? 0) >= EXTENDED_RETURN5_ARMED_PCT;
    automationStatus = needsConfirmation ? "armed" : "tradable";
    if (needsConfirmation && candidate.breakoutRule?.status === "breakout-ready") {
      blockers.push("신고가 돌파 후 5일선 또는 전고점 지지 확인이 필요합니다.");
    }
    if (needsConfirmation && (candidate.return5 ?? 0) >= EXTENDED_RETURN5_ARMED_PCT) {
      blockers.push(`5일 상승률 ${formatPercent(candidate.return5)}로 시장가 추격은 제한합니다.`);
    }
  } else {
    automationStatus = "watch";
    blockers.push(
      candidate.decision === "hold"
        ? "이미 진행된 추세라 신규 자동매수는 눌림 확인 후 검토합니다."
        : "현재 일봉은 진입 트리거를 통과하지 못했습니다.",
    );
  }

  const entryRange = setup === "pullback-20d"
    ? tradePlan.conservativeEntry
    : tradePlan.firstEntry;

  return {
    symbol: candidate.symbol,
    name: candidate.name,
    sector: candidate.sector ?? "기타",
    rank: candidate.rank,
    price: candidate.price,
    decision: candidate.decision,
    automationStatus,
    setup,
    entryType: getEntryType(setup),
    entryRange,
    stop: tradePlan.stop,
    riskPct,
    reason: getEntryReason(candidate, automationStatus),
    blockers: automationStatus === "probe" ? [...new Set(probeNotes)] : blockers,
    breakoutRule: candidate.breakoutRule,
    tradeSetup,
    breakoutSignal: candidate.breakoutSignal,
    chartQuality: candidate.chartQuality,
    signalReliability: candidate.signalReliability,
  };
};

const buildEntryCandidates = (data: LeaderResponse): EntryCandidate[] => {
  const maxRiskPct = data.strategy.maxStopPct ?? DEFAULT_MAX_AUTOMATION_RISK_PCT;
  const statusWeight: Record<AutomationStatus, number> = {
    tradable: 5,
    probe: 4,
    armed: 3,
    watch: 2,
    blocked: 1,
  };

  return data.candidates
    .map((candidate) => buildEntryCandidate(candidate, data.marketHealth.pass, maxRiskPct))
    .filter((candidate) =>
      candidate.automationStatus !== "blocked" ||
      candidate.breakoutRule?.status === "breakout-ready" ||
      candidate.rank <= 6,
    )
    .toSorted((left, right) =>
      statusWeight[right.automationStatus] - statusWeight[left.automationStatus] ||
      left.rank - right.rank,
    )
    .slice(0, 6);
};

const breakoutStatusWeight: Record<BreakoutSignal["status"], number> = {
  confirmed: 5,
  retest: 4,
  triggered: 3,
  watch: 2,
  extended: 2,
  failed: 1,
};

const buildBreakoutCandidates = (candidates: LeaderCandidate[]): BreakoutCandidate[] =>
  candidates
    .filter((candidate): candidate is LeaderCandidate & { breakoutSignal: BreakoutSignal } =>
      Boolean(candidate.breakoutSignal) &&
      candidate.breakoutSignal?.status !== "failed" &&
      candidate.breakoutSignal?.pattern !== "none",
    )
    .map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      sector: candidate.sector ?? "기타",
      themes: candidate.themes?.length ? candidate.themes : [candidate.sector ?? "기타"],
      rank: candidate.rank,
      price: candidate.price,
      decision: candidate.decision,
      return5: candidate.return5,
      return50: candidate.return50,
      leadershipScore: candidate.leadershipScore,
      leadershipReasons: candidate.leadershipReasons,
      candidateSourceDetail: candidate.candidateSourceDetail,
      breakoutSignal: candidate.breakoutSignal,
      chartQuality: candidate.chartQuality,
      signalReliability: candidate.signalReliability,
      tradeSetup: candidate.tradeSetup ?? buildTradeSetup(candidate),
    }))
    .toSorted((left, right) =>
      breakoutStatusWeight[right.breakoutSignal.status] - breakoutStatusWeight[left.breakoutSignal.status] ||
      getLeadershipScore(right) - getLeadershipScore(left) ||
      (right.chartQuality?.score ?? 0) - (left.chartQuality?.score ?? 0) ||
      right.return50 - left.return50,
    )
    .slice(0, 6);

const toDailyFocusCandidate = (
  candidate: LeaderCandidate,
  whyToday: string,
): DailyFocusCandidate => ({
  symbol: candidate.symbol,
  name: candidate.name,
  sector: candidate.sector ?? "기타",
  themes: candidate.themes?.length ? candidate.themes : [candidate.sector ?? "기타"],
  rank: candidate.rank,
  price: candidate.price,
  decision: candidate.decision,
  return5: candidate.return5,
  return50: candidate.return50,
  leadershipScore: candidate.leadershipScore,
  leadershipReasons: candidate.leadershipReasons,
  breakoutSignal: candidate.breakoutSignal,
  chartQuality: candidate.chartQuality,
  signalReliability: candidate.signalReliability,
  tradeSetup: candidate.tradeSetup ?? buildTradeSetup(candidate),
  whyToday,
});

const buildSupportCandidates = (candidates: LeaderCandidate[]): DailyFocusCandidate[] =>
  sortByLeadership(
    candidates.filter((candidate) =>
      candidate.decision !== "avoid" &&
      (
        candidate.breakoutSignal?.status === "retest" ||
        candidate.breakoutSignal?.status === "extended" ||
        candidate.breakoutSignal?.status === "watch" ||
        candidate.tradeSetup?.type === "pullback" ||
        candidate.tradeSetup?.type === "reclaim"
      ),
    ),
  )
    .slice(0, 6)
    .map((candidate) =>
      toDailyFocusCandidate(
        candidate,
        candidate.breakoutSignal?.status === "retest"
          ? "돌파 기준선 위 지지 확인 구간입니다."
          : candidate.breakoutSignal?.status === "extended"
            ? "이미 추세가 진행된 구간이라 5일선/20일선 눌림을 기다릴 후보입니다."
          : candidate.tradeSetup?.type === "pullback"
            ? "5일선 또는 20일선 눌림 지지를 확인할 후보입니다."
            : "기준선 회복 여부를 확인할 후보입니다.",
      ),
    );

const buildCautionCandidates = (candidates: LeaderCandidate[]): DailyFocusCandidate[] =>
  candidates
    .filter((candidate) =>
      candidate.decision === "avoid" ||
      candidate.breakoutSignal?.status === "failed" ||
      candidate.breakoutRule?.status === "risk-off" ||
      candidate.signalReliability?.grade === "low" ||
      (typeof candidate.risk.stopPct === "number" && Math.abs(candidate.risk.stopPct) > 0.12),
    )
    .toSorted((left, right) =>
      (left.decision === "avoid" ? 0 : 1) - (right.decision === "avoid" ? 0 : 1) ||
      Math.abs(right.risk.stopPct ?? 0) - Math.abs(left.risk.stopPct ?? 0) ||
      getLeadershipScore(right) - getLeadershipScore(left),
    )
    .slice(0, 6)
    .map((candidate) => {
      const whyToday =
        candidate.breakoutSignal?.status === "failed"
          ? "돌파 실패선 아래 마감 여부를 먼저 확인해야 합니다."
          : candidate.breakoutRule?.status === "risk-off"
            ? "20일선 이탈 주의 구간이라 신규 진입보다 리스크 관리가 우선입니다."
            : candidate.signalReliability?.grade === "low"
              ? "신호 신뢰도가 낮아 공격적 접근을 낮춥니다."
              : "손절폭 또는 시장 조건이 부담스러워 관찰 우선입니다.";
      return toDailyFocusCandidate(candidate, whyToday);
    });

export const buildMarketReport = (data: LeaderResponse) => {
  const marketSubject =
    data.market === "US"
      ? "나스닥은"
      : data.market === "KOSPI"
        ? "코스피는"
        : "코스닥은";
  const constructive = data.candidates.filter((candidate) =>
    candidate.decision === "enter" || candidate.decision === "hold" || candidate.decision === "watch",
  );
  const strongestStocks = constructive
    .toSorted((left, right) =>
      getLeadershipScore(right) - getLeadershipScore(left) ||
      right.return50 - left.return50,
    )
    .slice(0, 6)
    .map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      sector: candidate.sector ?? "기타",
      themes: candidate.themes?.length ? candidate.themes : [candidate.sector ?? "기타"],
      rank: candidate.rank,
      price: candidate.price,
      return5: candidate.return5,
      return50: candidate.return50,
      leadershipScore: candidate.leadershipScore,
      leadershipReasons: candidate.leadershipReasons,
      candidateSourceDetail: candidate.candidateSourceDetail,
      decision: candidate.decision,
      reason: candidate.reason,
      breakoutRule: candidate.breakoutRule,
      tradeSetup: candidate.tradeSetup ?? buildTradeSetup(candidate),
      breakoutSignal: candidate.breakoutSignal,
      chartQuality: candidate.chartQuality,
      signalReliability: candidate.signalReliability,
      tradePlan: buildTradePlan(candidate),
    }));
  const leadingThemes = buildThemeBriefing(data.candidates);
  const entryCandidates = buildEntryCandidates(data);
  const breakoutCandidates = buildBreakoutCandidates(data.candidates);
  const supportCandidates = buildSupportCandidates(data.candidates);
  const cautionCandidates = buildCautionCandidates(data.candidates);
  const scanCandidates: ScanCandidate[] = sortByLeadership(data.candidates)
    .slice(0, 12)
    .map((candidate) => ({
      ...candidate,
      tradeSetup: candidate.tradeSetup ?? buildTradeSetup(candidate),
    }));
  const primaryTheme = leadingThemes[0];
  const primaryStock = strongestStocks[0];

  return {
    market: data.market,
    strategy: data.strategy.name,
    tradingDate: data.tradingDate,
    nextRefreshAt: data.nextRefreshAt,
    scanStatus: data.scanStatus,
    candidateSource: data.candidateSource,
    marketHealth: data.marketHealth,
    headline: data.marketHealth.pass
      ? `${marketSubject} 스캔 종목 중 20일 추세가 살아 있는 후보를 선별할 수 있습니다.`
      : `${marketSubject} 시장폭이 약해 신규 진입보다 강한 종목만 관찰하는 구간입니다.`,
    leadingThemes,
    leadingSectors: leadingThemes,
    strongestStocks,
    entryCandidates,
    breakoutCandidates,
    supportCandidates,
    cautionCandidates,
    scanCandidates,
    summary: [
      primaryTheme
        ? `오늘의 주도테마: ${primaryTheme.theme} / 5일 평균 ${formatPercent(primaryTheme.averageReturn5)} / 50일 평균 ${formatPercent(primaryTheme.averageReturn50)}`
        : "오늘의 주도테마: 아직 뚜렷하지 않습니다.",
      primaryStock
        ? `흐름 강한 종목: ${primaryStock.name}(${primaryStock.symbol}) / 신뢰도 ${primaryStock.signalReliability?.score ?? "--"}점 / ${primaryStock.tradePlan.text}`
        : "흐름 강한 종목: 아직 바로 접근할 후보가 부족합니다.",
      "시장 기준: 당일 테마 강도, 20일선 위 후보, 50일 상대강도를 함께 보고 신규 진입은 5일선/20일선 지지 확인 후 판단합니다.",
    ],
    errors: data.errors,
  };
};
