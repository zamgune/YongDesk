import assert from "node:assert/strict";
import test from "node:test";

import type { CrashReversalSignal } from "../src/lib/market/crash-reversal-signal.ts";
import type { HorizonExitPlan } from "../src/lib/market/horizon-exit-plans.ts";
import type { PlaybookCalibrationRegistry } from "../src/lib/market/playbook-calibrations.ts";
import {
  buildCrashReversalTradePlan,
  buildTradeSignalEvents,
  buildTradeSignalSet,
  type TradePlaybookAnalysis,
  type TradePlaybookExternalGate,
} from "../src/lib/market/trade-playbook.ts";
import { verifiedPlaybookCalibration } from "./helpers/verified_playbook_calibration.ts";

const GENERATED_AT = "2026-07-10T12:00:00.000Z";
const LATEST_TIME = 1_752_148_800;

const passGate = (label: string): TradePlaybookExternalGate => ({
  status: "pass",
  label,
  reason: `${label} 조건을 충족했습니다.`,
  source: "fixture",
  asOf: GENERATED_AT,
});

const weakGate = (label: string): TradePlaybookExternalGate => ({
  status: "weak",
  label,
  reason: `${label} 조건이 약합니다.`,
  source: "fixture",
  asOf: GENERATED_AT,
});

const analysis = ({
  timeframe,
  atr,
  includeMeanSignal = false,
  includeTrendSignal = false,
}: {
  timeframe: "1h" | "1d";
  atr: number;
  includeMeanSignal?: boolean;
  includeTrendSignal?: boolean;
}): TradePlaybookAnalysis => ({
  timeframe,
  quoteAt: GENERATED_AT,
  stale: false,
  candles: [{
    time: LATEST_TIME,
    closeTime: LATEST_TIME + (timeframe === "1h" ? 3_600 : 86_400),
    open: 99,
    high: 102,
    low: 98,
    close: 100,
    volume: 1_500,
  }],
  tradeSetup: {
    type: "pullback",
    failureLevel: timeframe === "1d" ? 92 : 96,
  },
  analysisBasis: {
    atr14: atr,
    volumeRatio20: 1.35,
  },
  signals: includeMeanSignal
    ? [{
        time: LATEST_TIME,
        type: "buy",
        label: "Swing Trap BUY",
        reason: "base panic reclaim",
        price: 100,
        stopLevel: 92,
        profile: "base-panic",
        setupFamilies: ["oscillator", "volatility-band", "drawdown"],
      }]
    : [],
  trendFollowing: {
    signals: includeTrendSignal
      ? [{
          time: LATEST_TIME,
          type: "buy",
          action: "breakout-entry",
          label: "Trend Breakout Entry",
          reason: "daily breakout with volume",
          entryPrice: 100,
          initialStop: timeframe === "1d" ? 92 : 96,
        }]
      : [],
    activeSetup: includeTrendSignal
      ? {
          entryTime: LATEST_TIME,
          entryPrice: 100,
          initialStop: timeframe === "1d" ? 92 : 96,
          riskPerShare: timeframe === "1d" ? 8 : 4,
          partialTakeProfitLevel: timeframe === "1d" ? 116 : 108,
          trendExitLevel: timeframe === "1d" ? 94 : 97,
        }
      : null,
  },
});

const horizonPlan = (
  horizon: "day" | "swing",
  stopPrice: number,
): HorizonExitPlan => ({
  horizon,
  status: "actionable",
  planMode: "new-entry",
  currentPrice: 100,
  entryPrice: 100,
  managementState: null,
  stop: {
    price: stopPrice,
    trigger: horizon === "day" ? "hourly-close" : "daily-close",
    isBrokerStopEligible: false,
    reason: "fixture structure stop",
  },
  takeProfits: [
    { price: 100 + (100 - stopPrice), allocationPct: 50, basis: "1R" },
    { price: 100 + (100 - stopPrice) * 2, allocationPct: 50, basis: "2R" },
  ],
  trailingExit: horizon === "swing"
    ? { price: 94, allocationPct: 40, basis: "fixture trail" }
    : null,
  riskPerShare: 100 - stopPrice,
  stopPct: stopPrice - 100,
  rewardRisk: 2,
  basis: {
    symbol: "AAPL",
    market: "US",
    currency: "USD",
    dataSource: "fixture",
    quoteAt: GENERATED_AT,
    generatedAt: GENERATED_AT,
    timeframeLabel: horizon,
    entryPrice: 100,
    atr14: horizon === "day" ? 3 : 4,
    support: stopPrice,
    resistance: null,
    sma20: 96,
    sma200: 80,
    tenMonthAverage: 82,
    weeklySma20: 90,
    weeklySma60: 85,
    chandelierLong: 94,
    reliabilityGrade: "medium",
  },
  formulaSteps: [],
  reasons: [],
  blockers: [],
});

const build = ({
  externalContext,
  dayStop = 96,
  calibrationRegistry,
}: {
  externalContext?: {
    market: TradePlaybookExternalGate;
    sector: TradePlaybookExternalGate;
    leader50?: TradePlaybookExternalGate;
  };
  dayStop?: number;
  calibrationRegistry?: PlaybookCalibrationRegistry;
} = {}) => buildTradeSignalSet({
  market: "US",
  generatedAt: GENERATED_AT,
  oneHour: analysis({ timeframe: "1h", atr: 3, includeTrendSignal: true }),
  daily: analysis({ timeframe: "1d", atr: 4, includeMeanSignal: true, includeTrendSignal: true }),
  horizonPlans: [horizonPlan("day", dayStop), horizonPlan("swing", 92)],
  externalContext: externalContext
    ? {
        ...externalContext,
        leader50: externalContext.leader50 ?? passGate("50일 leader 확인"),
      }
    : undefined,
  calibrationRegistry,
});

const approvedCalibrationRecord = (
  playbookId: PlaybookCalibrationRegistry["records"][number]["playbookId"],
): PlaybookCalibrationRegistry["records"][number] =>
  verifiedPlaybookCalibration({
    playbookId,
    market: "US",
    reviewedAt: GENERATED_AT,
  });

test("shadow contract exposes four playbooks and fails closed without real market and sector context", () => {
  const result = build();

  assert.equal(result.contractVersion, 2);
  assert.equal(result.stage, "shadow");
  assert.deepEqual(
    result.plans.map((plan) => plan.id),
    [
      "kr-intraday-crash-reversal",
      "short-hold-trend",
      "swing-mean-reversion",
      "swing-trend",
    ],
  );
  assert.equal(result.primaryByHorizon.shortHold, null);
  assert.equal(result.primaryByHorizon.swing, null);
  assert.equal(result.isBrokerStopEligible, false);
  assert.equal(result.orderSubmissionAttempted, false);

  for (const plan of result.plans) {
    assert.equal(plan.action, "unavailable");
    assert.equal(plan.stage, "shadow");
    assert.equal(plan.calibration.status, "unverified");
    assert.equal(plan.isBrokerStopEligible, false);
    assert.equal(plan.orderSubmissionAttempted, false);
    assert.equal(plan.riskPlan.isBrokerStopEligible, false);
    assert.equal(plan.riskPlan.orderSubmissionAttempted, false);
    assert.ok(plan.gates.some((item) => item.kind === "market" && item.status === "unavailable"));
    assert.ok(plan.gates.some((item) => item.kind === "sector" && item.status === "unavailable"));
  }
});

test("two ready swing families return an explicit conflict instead of choosing a primary", () => {
  const result = build({
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
  });

  assert.equal(result.primaryByHorizon.shortHold, "short-hold-trend");
  assert.equal(
    result.plans.find((plan) => plan.id === "short-hold-trend")?.events[0]?.confirmedAt,
    LATEST_TIME + 3_600,
  );
  assert.equal(result.primaryByHorizon.swing, null);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(
    result.conflicts[0].playbookIds,
    ["swing-mean-reversion", "swing-trend"],
  );
  assert.equal(result.plans.find((plan) => plan.id === "swing-mean-reversion")?.setupVariant, "base-panic");
  assert.ok(result.plans.filter((plan) => plan.horizon === "swing").every((plan) => plan.action === "watch"));
});

test("one weak external gate is a warning but two weak gates block every entry candidate", () => {
  const oneWeak = build({
    externalContext: {
      market: weakGate("시장 breadth 약세"),
      sector: passGate("섹터 상대강도 양호"),
    },
  });
  const shortWithWarning = oneWeak.plans.find((plan) => plan.id === "short-hold-trend")!;
  assert.equal(shortWithWarning.action, "watch");
  assert.equal(shortWithWarning.gates.find((item) => item.kind === "market")?.status, "warning");
  assert.equal(shortWithWarning.gates.find((item) => item.kind === "market")?.blocking, false);

  const bothWeak = build({
    externalContext: {
      market: weakGate("시장 breadth 약세"),
      sector: weakGate("섹터 상대강도 약세"),
    },
  });
  const blockedShort = bothWeak.plans.find((plan) => plan.id === "short-hold-trend")!;
  assert.equal(blockedShort.action, "wait");
  assert.equal(blockedShort.gates.find((item) => item.kind === "market")?.status, "fail");
  assert.equal(blockedShort.gates.find((item) => item.kind === "sector")?.status, "fail");
});

test("swing trend requires an explicit passing 50-day leader gate", () => {
  const result = build({
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
      leader50: weakGate("50일 leader 순위 밖"),
    },
  });
  const swingTrend = result.plans.find((plan) => plan.id === "swing-trend")!;
  const leader = swingTrend.gates.find((item) => item.label === "50일 leader 순위 밖")!;

  assert.equal(leader.kind, "setup");
  assert.equal(leader.status, "fail");
  assert.equal(leader.blocking, true);
  assert.equal(leader.source, "fixture");
  assert.equal(leader.asOf, GENERATED_AT);
  assert.equal(swingTrend.action, "wait");
});

test("generic pullback entry is not promoted without a reclaim trigger", () => {
  const oneHour = analysis({ timeframe: "1h", atr: 3 });
  oneHour.trendFollowing = {
    signals: [{
      time: LATEST_TIME,
      type: "buy",
      action: "entry",
      label: "Generic Pullback Entry",
      reason: "pullback only",
      entryPrice: 100,
      initialStop: 96,
    }],
    activeSetup: {
      entryTime: LATEST_TIME,
      entryPrice: 100,
      initialStop: 96,
      riskPerShare: 4,
      partialTakeProfitLevel: 108,
      trendExitLevel: 97,
    },
  };
  const result = buildTradeSignalSet({
    market: "US",
    generatedAt: GENERATED_AT,
    oneHour,
    daily: analysis({ timeframe: "1d", atr: 4 }),
    horizonPlans: [horizonPlan("day", 96), horizonPlan("swing", 92)],
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
      leader50: passGate("50일 leader 확인"),
    },
  });
  const short = result.plans.find((plan) => plan.id === "short-hold-trend")!;

  assert.equal(short.gates.find((item) => item.kind === "trigger")?.status, "fail");
  assert.equal(short.action, "wait");
});

test("mean reversion counts RSI CCI Stochastic and Williams as one oscillator family", () => {
  const daily = analysis({ timeframe: "1d", atr: 4, includeMeanSignal: true });
  const dailySignal = daily.signals?.[0] as Record<string, unknown>;
  dailySignal.setupFamilies = ["oscillator", "oscillator", "oscillator"];

  const result = buildTradeSignalSet({
    market: "US",
    generatedAt: GENERATED_AT,
    oneHour: analysis({ timeframe: "1h", atr: 3, includeTrendSignal: true }),
    daily,
    horizonPlans: [horizonPlan("day", 96), horizonPlan("swing", 92)],
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
      leader50: passGate("50일 leader 확인"),
    },
  });
  const meanPlan = result.plans.find((plan) => plan.id === "swing-mean-reversion")!;
  const setup = meanPlan.gates.find((item) => item.kind === "setup")!;

  assert.equal(setup.status, "fail");
  assert.match(setup.reason, /하나의 oscillator family/);
  assert.equal(meanPlan.action, "wait");
});

test("a calibrated swing candidate wins over a ready shadow candidate without conflict", () => {
  const result = build({
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
    calibrationRegistry: {
      version: 2,
      records: [approvedCalibrationRecord("swing-trend")],
    },
  });

  assert.equal(result.primaryByHorizon.swing, "swing-trend");
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plans.find((plan) => plan.id === "swing-trend")?.stage, "calibrated");
  assert.equal(result.plans.find((plan) => plan.id === "swing-mean-reversion")?.stage, "shadow");
});

test("only an explicit reviewed calibration can promote a clear shadow candidate", () => {
  const calibrationRegistry: PlaybookCalibrationRegistry = {
    version: 2,
    records: [approvedCalibrationRecord("short-hold-trend")],
  };
  const result = build({
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
    calibrationRegistry,
  });
  const short = result.plans.find((plan) => plan.id === "short-hold-trend")!;
  const swing = result.plans.find((plan) => plan.id === "swing-trend")!;

  assert.equal(short.stage, "calibrated");
  assert.equal(short.action, "entry-ready");
  assert.equal(short.calibration.averageNetR, 0.21);
  assert.equal(swing.stage, "shadow");
  assert.equal(swing.action, "watch");
});

test("risk policy rejects an over-wide structure stop without moving the stop inward", () => {
  const result = build({
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
    dayStop: 90,
  });
  const short = result.plans.find((plan) => plan.id === "short-hold-trend")!;

  assert.equal(short.riskPlan.structureInvalidationPrice, 90);
  assert.equal(short.riskPlan.riskStatus, "outside-policy");
  assert.equal(short.gates.find((item) => item.kind === "risk")?.status, "fail");
  assert.equal(short.action, "wait");
});

test("signal event normalization preserves causal timestamps and deterministically merges duplicate sources", () => {
  const input: TradePlaybookAnalysis = {
    tradeSetup: { failureLevel: 90 },
    signals: [
      {
        time: 300,
        occurredAt: 250,
        confirmedAt: 300,
        type: "buy",
        label: "Shared Entry",
        reason: "legacy reason",
        stopLevel: 95,
      },
      {
        time: 100,
        type: "buy",
        label: "Capitulation (Watch)",
        reason: "legacy only",
        price: 98,
      },
      { time: 400, type: "buy" },
    ],
    trendFollowing: {
      signals: [
        {
          time: 200,
          type: "sell",
          action: "management-warning",
          label: "Trend Warning",
          reason: "close below SMA20",
        },
        {
          time: 300,
          occurredAt: 250,
          confirmedAt: 300,
          type: "buy",
          action: "entry",
          label: "Shared Entry",
          reason: "richer trend confirmation reason",
          entryPrice: 101,
          initialStop: 95,
        },
      ],
    },
  };
  const events = buildTradeSignalEvents(input);
  const reversed = buildTradeSignalEvents({
    ...input,
    signals: [...input.signals!].reverse(),
    trendFollowing: {
      signals: [...(input.trendFollowing!.signals as unknown[])].reverse(),
    },
  });

  assert.deepEqual(reversed, events);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.confirmedAt), [100, 200, 300]);
  assert.equal(events[0].role, "setup");
  assert.equal(events[1].role, "warning");
  assert.equal(events[2].occurredAt, 250);
  assert.equal(events[2].confirmedAt, 300);
  assert.equal(events[2].price, 101);
  assert.equal(events[2].structureInvalidationPrice, 95);
  assert.equal(events[2].reason, "richer trend confirmation reason");
});

const crashSignal = (overrides: Partial<CrashReversalSignal> = {}): CrashReversalSignal => ({
  stage: "entry-ready",
  confidence: "high",
  label: "매수 검토 가능",
  detail: "확정 5분봉 반전과 거래량·가격 회복 조건을 통과했습니다.",
  reasons: ["급락 이후 반전 캔들 확인", "급락봉 중간값 회복"],
  blockers: [],
  panicAt: 1_752_528_600,
  confirmationAt: 1_752_528_900,
  quoteAt: 1_752_528_900,
  sessionChangePct: -4.5,
  recentDropPct: -3.2,
  volumeRatio: 1.6,
  rsi14: 23,
  rsi2: 8,
  marketContext: {
    status: "supportive",
    label: "KOSPI 회복·중립",
    changePct: -0.8,
    recoveryPct: 55,
    quoteAt: GENERATED_AT,
  },
  exitPlan: {
    entryPrice: 96,
    stopPrice: 89,
    firstTakeProfit: 103,
    secondTakeProfit: 110,
    firstAllocationPct: 50,
    secondAllocationPct: 50,
    riskPerShare: 7,
    rewardRisk: 2,
    firstTargetBasis: "1R",
    isBrokerStopEligible: false,
  },
  orderSubmissionAttempted: false,
  ...overrides,
});

test("crash mapper keeps causal panic-to-confirmation timing and fails closed without explicit context", () => {
  const plan = buildCrashReversalTradePlan(crashSignal(), GENERATED_AT);

  assert.equal(plan.id, "kr-intraday-crash-reversal");
  assert.equal(plan.action, "unavailable");
  assert.equal(plan.stage, "shadow");
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].occurredAt, 1_752_528_600);
  assert.equal(plan.events[0].confirmedAt, 1_752_528_900);
  assert.equal(plan.events[0].price, 96);
  assert.equal(plan.riskPlan.structureInvalidationPrice, 89);
  assert.deepEqual(plan.riskPlan.targets.map((target) => target.allocationPct), [50, 50]);
  assert.equal(plan.gates.find((item) => item.kind === "market")?.status, "unavailable");
  assert.equal(plan.gates.find((item) => item.kind === "sector")?.status, "unavailable");
  assert.equal(plan.isBrokerStopEligible, false);
  assert.equal(plan.orderSubmissionAttempted, false);
});

test("crash mapper remains shadow watch with explicit context until reviewed calibration exists", () => {
  const plan = buildCrashReversalTradePlan(crashSignal(), GENERATED_AT, {
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
  });

  assert.equal(plan.action, "watch");
  assert.equal(plan.calibration.status, "unverified");
  assert.ok(plan.gates.every((item) => item.status === "pass"));
});

test("crash mapper preserves a rejected structural stop instead of moving it inward", () => {
  const plan = buildCrashReversalTradePlan(crashSignal({
    stage: "insufficient-reward",
    confidence: "low",
    blockers: ["구조 손절 거리가 1.8 ATR보다 넓어 손절선을 안쪽으로 당기지 않고 신규 진입을 보류합니다."],
  }), GENERATED_AT, {
    externalContext: {
      market: passGate("시장 breadth 양호"),
      sector: passGate("섹터 상대강도 양호"),
    },
  });

  assert.equal(plan.riskPlan.structureInvalidationPrice, 89);
  assert.equal(plan.riskPlan.riskStatus, "outside-policy");
  assert.equal(plan.gates.find((item) => item.kind === "risk")?.status, "fail");
  assert.equal(plan.action, "wait");
});
