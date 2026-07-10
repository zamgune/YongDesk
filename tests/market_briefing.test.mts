import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartBriefing,
  buildDailyBriefing,
  type BriefingCandle,
  type BriefingMarketData,
  type BriefingPoint,
  type BriefingRow,
} from "../src/lib/market/briefing.ts";
import {
  buildMarketReport,
  type LeaderCandidate,
  type LeaderResponse,
} from "../src/lib/market/market-briefing-report.ts";
import { calculatePatternSignals } from "../src/lib/market/pattern-signals.ts";

const makeCandles = (
  count: number,
  overrides: Record<number, Partial<BriefingCandle>> = {},
): BriefingCandle[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index + 1,
    open: 94,
    high: 96,
    low: 92,
    close: 95,
    volume: 1_000_000,
    ...overrides[index],
  }));

const makeSeries = (candles: BriefingCandle[], value: number, previousValue = value): BriefingPoint[] =>
  candles.map((candle, index) => ({
    time: candle.time,
    value: index < candles.length - 5 ? previousValue : value,
  }));

const makeData = ({
  symbol = "TEST",
  candles,
  sma5 = 100,
  sma20 = 90,
  sma60 = 80,
  previousSma20 = 88,
  breakoutRule,
  volumeRatio = 1.2,
}: {
  symbol?: string;
  candles: BriefingCandle[];
  sma5?: number;
  sma20?: number;
  sma60?: number;
  previousSma20?: number;
  breakoutRule?: BriefingMarketData["breakoutRule"];
  volumeRatio?: number | null;
}): BriefingMarketData => ({
  symbol,
  candles,
  breakoutRule,
  indicators: {
    sma: {
      "5": makeSeries(candles, sma5),
      "20": makeSeries(candles, sma20, previousSma20),
      "60": makeSeries(candles, sma60),
    },
  },
  trendFollowing: {
    latestFeature: {
      sma20SlopePct: 0.02,
      volumeRatio,
    },
  },
});

const makeRow = (symbol: string, data: BriefingMarketData): BriefingRow => ({
  symbol,
  name: symbol,
  market: "US",
  data,
});

const makeLeaderCandidate = (
  symbol: string,
  overrides: Partial<LeaderCandidate> = {},
): LeaderCandidate => ({
  symbol,
  name: symbol,
  sector: "Technology",
  themes: ["AI"],
  rank: 1,
  price: 100,
  return5: 0.04,
  return50: 0.5,
  decision: "enter",
  reason: "Continuation entry conditions passed.",
  risk: {
    entryPrice: 100,
    stopPrice: 94,
    stopPct: -0.06,
    twoR: 112,
    trendExitLevel: 90,
  },
  levels: {
    sma5: 98,
    sma20: 92,
    aggressiveEntryLow: 97.02,
    aggressiveEntryHigh: 99.47,
    conservativeEntryLow: 90.62,
    conservativeEntryHigh: 93.84,
    newEntryStop: 91,
    breakoutPrice: 101,
  },
  ...overrides,
});

const makeLeaderResponse = (
  candidates: LeaderCandidate[],
  marketPass = true,
): LeaderResponse => ({
  market: "US",
  strategy: {
    name: "leader-risk-managed",
    maxStopPct: 0.08,
  },
  marketHealth: {
    breadth: marketPass ? 0.8 : 0.2,
    averageReturn50: marketPass ? 0.2 : -0.1,
    pass: marketPass,
    loadedSymbols: candidates.length,
    totalSymbols: candidates.length,
  },
  candidates,
  errors: [],
});

test("buildChartBriefing prioritizes confirmed breakout over double-top shape", () => {
  const candles = makeCandles(80, {
    59: { high: 100, close: 98 },
    70: { high: 99, close: 96 },
    79: { open: 101, high: 106, low: 100, close: 105, volume: 1_500_000 },
  });
  const briefing = buildChartBriefing(makeRow("CRDO", makeData({
    symbol: "CRDO",
    candles,
    breakoutRule: {
      status: "breakout-ready",
      newHighLevel: 100,
      breakoutDistancePct: 0.05,
      avgTradedValue20: 100_000_000,
      fixedStopPrice: 90,
      profitSwitchPrice: 120,
      trailingExitPrice: 90,
      reasons: [],
    },
  })));

  assert.equal(briefing?.pattern.kind, "breakout-confirmed");
  assert.equal(briefing?.pattern.label, "신고가 돌파");
});

test("buildChartBriefing keeps double-top only when breakout fails by close", () => {
  const candles = makeCandles(80, {
    51: { high: 100, close: 98 },
    65: { high: 99, close: 97 },
    79: { open: 100, high: 101, low: 94, close: 99, volume: 1_300_000 },
  });
  const briefing = buildChartBriefing(makeRow("FAIL", makeData({ candles })));

  assert.equal(briefing?.pattern.kind, "double-top");
  assert.equal(briefing?.pattern.label, "쌍봉 의심");
});

test("buildChartBriefing keeps breakdown risk above breakout evidence", () => {
  const candles = makeCandles(80, {
    79: { open: 99, high: 106, low: 94, close: 95, volume: 1_500_000 },
  });
  const briefing = buildChartBriefing(makeRow("RISK", makeData({
    candles,
    sma20: 100,
    previousSma20: 100,
    breakoutRule: {
      status: "breakout-ready",
      newHighLevel: 100,
      breakoutDistancePct: 0.05,
      avgTradedValue20: 100_000_000,
      fixedStopPrice: 90,
      profitSwitchPrice: 120,
      trailingExitPrice: 100,
      reasons: [],
    },
  })));

  assert.equal(briefing?.pattern.kind, "breakdown-risk");
});

test("buildDailyBriefing promotes breakout-confirmed rows in leadership", () => {
  const breakoutCandles = makeCandles(80, {
    55: { high: 100, close: 98 },
    79: { open: 101, high: 106, low: 100, close: 105, volume: 1_500_000 },
  });
  const steadyCandles = makeCandles(80, {
    78: { close: 95 },
    79: { open: 95, high: 98, low: 94, close: 98, volume: 1_000_000 },
  });
  const briefing = buildDailyBriefing([
    makeRow("STEADY", makeData({ symbol: "STEADY", candles: steadyCandles, sma20: 90 })),
    makeRow("CRDO", makeData({
      symbol: "CRDO",
      candles: breakoutCandles,
      sma5: 110,
      breakoutRule: {
        status: "breakout-ready",
        newHighLevel: 100,
        breakoutDistancePct: 0.05,
        avgTradedValue20: 100_000_000,
        fixedStopPrice: 90,
        profitSwitchPrice: 120,
        trailingExitPrice: 90,
        reasons: [],
      },
    })),
  ]);

  assert.match(briefing?.leadership[0] ?? "", /^CRDO: 신고가 돌파/);
});

test("buildMarketReport separates entry candidates from strongest stocks for automation", () => {
  const tradable = makeLeaderCandidate("READY");
  const breakoutWatch = makeLeaderCandidate("CRDO", {
    rank: 10,
    decision: "avoid",
    reason: "Outside top 4 leaders.",
    breakoutRule: {
      status: "breakout-ready",
      newHighLevel: 100,
      breakoutDistancePct: 0.05,
      avgTradedValue20: 100_000_000,
      fixedStopPrice: 90,
      profitSwitchPrice: 120,
      trailingExitPrice: 90,
      reasons: [],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([tradable, breakoutWatch]));
  const readyCandidate = report.entryCandidates.find((candidate) => candidate.symbol === "READY");
  const blockedCandidate = report.entryCandidates.find((candidate) => candidate.symbol === "CRDO");

  assert.equal(readyCandidate?.automationStatus, "tradable");
  assert.equal(blockedCandidate?.automationStatus, "blocked");
  assert.match(blockedCandidate?.blockers.join(" ") ?? "", /Outside top 4 leaders/);
});

test("buildMarketReport marks strong but extended breakout candidates as probe", () => {
  const probe = makeLeaderCandidate("PROBE", {
    price: 105,
    risk: {
      entryPrice: 105,
      stopPrice: 94,
      stopPct: -0.1048,
      twoR: 127,
      trendExitLevel: 92,
    },
    chartQuality: {
      score: 74,
      grade: "good",
      reasons: ["박스권 상단 돌파 품질 양호"],
    },
    signalReliability: {
      pattern: "box-breakout",
      grade: "medium",
      score: 62,
      sampleSize: 8,
      successRate: 0.58,
      stopHitRate: 0.28,
      averageMaxGainPct: 0.14,
      averageMaxDrawdownPct: -0.06,
      averageBarsHeld: 8,
      riskReward: 2.3,
      reasons: ["신호 신뢰도: 보통"],
    },
    breakoutSignal: {
      status: "confirmed",
      pattern: "box-breakout",
      breakoutLevel: 100,
      supportLevel: 100,
      failureLevel: 94,
      volumeRatio: 2,
      entryPlan: "박스권 상단 위 종가 유지",
      invalidation: "94 아래 마감 시 실패입니다.",
      reasons: ["거래량 동반 박스권 상단 돌파"],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([probe]));
  const candidate = report.entryCandidates.find((item) => item.symbol === "PROBE");

  assert.equal(candidate?.automationStatus, "probe");
  assert.match(candidate?.reason ?? "", /1차 탐색/);
  assert.match(candidate?.blockers.join(" ") ?? "", /탐색 비중/);
});

test("buildMarketReport keeps low reliability breakouts blocked instead of probe", () => {
  const lowReliability = makeLeaderCandidate("LOWREL", {
    price: 105,
    breakoutSignal: {
      status: "confirmed",
      pattern: "box-breakout",
      breakoutLevel: 100,
      supportLevel: 100,
      failureLevel: 94,
      volumeRatio: 2,
      entryPlan: "박스권 상단 위 종가 유지",
      invalidation: "94 아래 마감 시 실패입니다.",
      reasons: ["거래량 동반 박스권 상단 돌파"],
    },
    signalReliability: {
      pattern: "box-breakout",
      grade: "low",
      score: 38,
      sampleSize: 8,
      successRate: 0.36,
      stopHitRate: 0.44,
      averageMaxGainPct: 0.08,
      averageMaxDrawdownPct: -0.07,
      averageBarsHeld: 5,
      riskReward: 1.1,
      reasons: ["신호 신뢰도: 낮음"],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([lowReliability]));
  const candidate = report.entryCandidates.find((item) => item.symbol === "LOWREL");

  assert.equal(candidate?.automationStatus, "blocked");
  assert.match(candidate?.blockers.join(" ") ?? "", /신호 신뢰도/);
});

test("calculatePatternSignals separates fresh, retest, and extended breakouts", () => {
  const baseCandles = makeCandles(10, {
    8: { open: 99, high: 101, low: 98, close: 99, volume: 1_000_000 },
    9: { open: 101, high: 104, low: 100, close: 103, volume: 1_600_000 },
  });
  const breakoutRule = {
    status: "breakout-ready" as const,
    newHighLevel: 100,
    breakoutDistancePct: 0.03,
    avgTradedValue20: 100_000_000,
    volumeConfirmation: {
      ratio20: 1.6,
      status: "strong" as const,
      context: "breakout" as const,
      label: "강한 수급",
      reason: "돌파 거래량은 1.60배로 확인됩니다.",
    },
    fixedStopPrice: 90,
    profitSwitchPrice: 120,
    trailingExitPrice: 90,
    reasons: ["신고가 기준 100 돌파 여부를 확인합니다."],
  };
  const confirmed = calculatePatternSignals({
    candles: baseCandles,
    sma5: Array(10).fill(101),
    volumeMa20: Array(10).fill(1_000_000),
    breakoutRule,
    return5: 0.03,
  });
  const retest = calculatePatternSignals({
    candles: makeCandles(10, {
      8: { open: 102, high: 106, low: 101, close: 105, volume: 1_500_000 },
      9: { open: 103, high: 104, low: 100, close: 102, volume: 1_600_000 },
    }),
    sma5: Array(10).fill(101),
    volumeMa20: Array(10).fill(1_000_000),
    breakoutRule,
    return5: 0.02,
  });
  const distanceExtended = calculatePatternSignals({
    candles: makeCandles(10, {
      9: { open: 109, high: 112, low: 108, close: 110, volume: 1_600_000 },
    }),
    sma5: Array(10).fill(101),
    volumeMa20: Array(10).fill(1_000_000),
    breakoutRule,
    return5: 0.1,
  });
  const returnExtended = calculatePatternSignals({
    candles: baseCandles,
    sma5: Array(10).fill(101),
    volumeMa20: Array(10).fill(1_000_000),
    breakoutRule,
    return5: 0.18,
  });

  assert.equal(confirmed.breakoutSignal.status, "confirmed");
  assert.equal(retest.breakoutSignal.status, "retest");
  assert.equal(distanceExtended.breakoutSignal.status, "extended");
  assert.equal(returnExtended.breakoutSignal.status, "extended");
});

test("buildMarketReport preserves scan candidates for daily detail view", () => {
  const candidates = [
    makeLeaderCandidate("AAA", { rank: 1, return50: 0.6 }),
    makeLeaderCandidate("BBB", { rank: 2, return50: 0.4, decision: "watch" }),
    makeLeaderCandidate("CCC", { rank: 3, return50: -0.1, decision: "avoid" }),
  ];
  const report = buildMarketReport(makeLeaderResponse(candidates));

  assert.equal(report.scanCandidates.length, 3);
  assert.deepEqual(
    report.scanCandidates.map((candidate) => candidate.symbol),
    ["AAA", "BBB", "CCC"],
  );
  assert.equal(report.scanCandidates[0].tradeSetup.keyLevelLabel.length > 0, true);
});

test("buildMarketReport blocks extended breakout automation candidates", () => {
  const extended = makeLeaderCandidate("EXTENDED", {
    decision: "enter",
    return5: 0.41,
    breakoutSignal: {
      status: "extended",
      pattern: "new-high",
      breakoutLevel: 100,
      supportLevel: 100,
      failureLevel: 97,
      volumeRatio: 2.1,
      entryPlan: "이미 추세가 진행된 구간입니다. 추격보다 눌림을 기다립니다.",
      invalidation: "추격 진입은 제한합니다.",
      reasons: ["돌파선 대비 이격이 큽니다."],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([extended]));
  const candidate = report.entryCandidates.find((item) => item.symbol === "EXTENDED");

  assert.equal(candidate?.automationStatus, "blocked");
  assert.match(candidate?.blockers.join(" ") ?? "", /돌파선 대비 이격|5일 상승률/);
});

test("buildMarketReport ranks confirmed breakouts above extended breakouts", () => {
  const extended = makeLeaderCandidate("EXTENDED", {
    return5: 0.25,
    return50: 0.7,
    breakoutSignal: {
      status: "extended",
      pattern: "new-high",
      breakoutLevel: 100,
      supportLevel: 100,
      failureLevel: 97,
      volumeRatio: 2.1,
      entryPlan: "이미 추세가 진행된 구간입니다. 추격보다 눌림을 기다립니다.",
      invalidation: "추격 진입은 제한합니다.",
      reasons: [],
    },
  });
  const confirmed = makeLeaderCandidate("CONFIRMED", {
    return5: 0.04,
    return50: 0.6,
    breakoutSignal: {
      status: "confirmed",
      pattern: "new-high",
      breakoutLevel: 100,
      supportLevel: 100,
      failureLevel: 97,
      volumeRatio: 1.6,
      entryPlan: "돌파 직후 확인 구간입니다.",
      invalidation: "97 아래 마감 시 실패입니다.",
      reasons: [],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([extended, confirmed]));

  assert.equal(report.breakoutCandidates?.[0]?.symbol, "CONFIRMED");
});

test("buildMarketReport ranks breakout leadership above plain return strength", () => {
  const plainStrong = makeLeaderCandidate("PLAIN", {
    return50: 0.9,
    leadershipScore: 72,
    leadershipReasons: ["50일 상대강도 상위"],
  });
  const lgBreakout = makeLeaderCandidate("066570.KS", {
    name: "LG전자",
    return5: 0.18,
    return50: 0.35,
    leadershipScore: 118,
    leadershipReasons: ["돌파 확인", "거래량 2.4배", "차트품질 84"],
    candidateSourceDetail: "curated",
    chartQuality: {
      score: 84,
      grade: "excellent",
      reasons: ["신고가 기준 패턴 점수 85점"],
    },
    signalReliability: {
      pattern: "new-high",
      grade: "high",
      score: 76,
      sampleSize: 8,
      successRate: 0.63,
      stopHitRate: 0.25,
      averageMaxGainPct: 0.18,
      averageMaxDrawdownPct: -0.06,
      averageBarsHeld: 9,
      riskReward: 3,
      reasons: ["신호 신뢰도: 높음"],
    },
    breakoutSignal: {
      status: "confirmed",
      pattern: "new-high",
      breakoutLevel: 266_500,
      supportLevel: 266_500,
      failureLevel: 258_505,
      volumeRatio: 2.4,
      entryPlan: "신고가 기준선 위 일봉 종가 유지와 거래량 확인으로 진입 가능 후보입니다.",
      invalidation: "258,505 아래 일봉 마감 시 돌파 아이디어를 무효로 봅니다.",
      reasons: ["신고가 돌파 후보입니다."],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([plainStrong, lgBreakout]));

  assert.equal(report.strongestStocks[0]?.symbol, "066570.KS");
  assert.equal(report.breakoutCandidates?.[0]?.symbol, "066570.KS");
  assert.equal(report.breakoutCandidates?.[0]?.signalReliability?.grade, "high");
  assert.equal(report.scanCandidates?.[0]?.symbol, "066570.KS");
  assert.deepEqual(report.scanCandidates?.[0]?.leadershipReasons?.slice(0, 2), ["돌파 확인", "거래량 2.4배"]);
});

test("buildMarketReport exposes support and caution candidate sections", () => {
  const support = makeLeaderCandidate("SUPPORT", {
    decision: "watch",
    breakoutSignal: {
      status: "retest",
      pattern: "box-breakout",
      breakoutLevel: 110,
      supportLevel: 110,
      failureLevel: 103,
      volumeRatio: 1.6,
      entryPlan: "박스권 상단 지지 확인 후 접근합니다.",
      invalidation: "103 아래 마감 시 실패입니다.",
      reasons: [],
    },
    signalReliability: {
      pattern: "box-breakout",
      grade: "medium",
      score: 56,
      sampleSize: 5,
      successRate: 0.5,
      stopHitRate: 0.3,
      averageMaxGainPct: 0.12,
      averageMaxDrawdownPct: -0.06,
      averageBarsHeld: 8,
      riskReward: 2,
      reasons: ["신호 신뢰도: 보통"],
    },
  });
  const caution = makeLeaderCandidate("CAUTION", {
    decision: "avoid",
    risk: {
      entryPrice: 100,
      stopPrice: 84,
      stopPct: -0.16,
      twoR: 132,
      trendExitLevel: 90,
    },
    signalReliability: {
      pattern: "new-high",
      grade: "low",
      score: 25,
      sampleSize: 4,
      successRate: 0.25,
      stopHitRate: 0.75,
      averageMaxGainPct: 0.08,
      averageMaxDrawdownPct: -0.12,
      averageBarsHeld: 4,
      riskReward: 0.67,
      reasons: ["신호 신뢰도: 낮음"],
    },
  });

  const report = buildMarketReport(makeLeaderResponse([support, caution]));

  assert.equal(report.supportCandidates?.[0]?.symbol, "SUPPORT");
  assert.equal(report.cautionCandidates?.[0]?.symbol, "CAUTION");
  assert.match(report.cautionCandidates?.[0]?.whyToday ?? "", /신뢰도|손절폭|관찰/);
});

test("buildMarketReport blocks automation when market breadth fails", () => {
  const report = buildMarketReport(makeLeaderResponse([
    makeLeaderCandidate("WEAK", {
      decision: "enter",
    }),
  ], false));

  assert.equal(report.entryCandidates[0]?.automationStatus, "blocked");
  assert.match(report.entryCandidates[0]?.blockers.join(" ") ?? "", /시장폭 필터/);
});
