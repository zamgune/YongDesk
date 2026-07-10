import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateHorizonExitPlans,
  type HorizonPlanContext,
} from "../src/lib/market/horizon-exit-plans.ts";

const baseContext = (): HorizonPlanContext => ({
  symbol: "005930.KS",
  market: "KR",
  currency: "KRW",
  dataSource: "fixture",
  quoteAt: "2026-07-10T06:30:00.000Z",
  generatedAt: "2026-07-10T06:31:00.000Z",
  entryPrice: 84_200,
  stale: false,
  reliabilityGrade: "medium",
  day: {
    atr14: 1_100,
    recentLow20: 83_100,
    resistance: 85_500,
    higherTimeframe: "1d",
    higherTimeframeTrendUp: true,
    entryTrendUp: true,
    trendQualityPassed: true,
    volumeConfirmed: true,
    latestBarClosed: true,
  },
  swing: {
    atr14Daily: 2_000,
    failureLevel: 80_900,
    resistance: 89_000,
    sma20: 81_800,
    chandelierLong: 82_100,
    marketGatePassed: true,
    dailyTrendUp: true,
    entryTimeframe: "1h",
    entryTrendUp: true,
    confirmationTimeframe: null,
    confirmationTrendUp: null,
    latestBarClosed: true,
  },
  long: {
    sma200: 72_000,
    tenMonthAverage: 74_000,
    weeklySma20: 78_000,
    weeklySma60: 70_000,
    marketGatePassed: true,
    latestBarClosed: true,
  },
});

test("horizon plans calculate explainable day, swing, and long exits", () => {
  const plans = calculateHorizonExitPlans(baseContext());
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map((plan) => plan.status), ["actionable", "actionable", "actionable"]);

  const day = plans[0];
  assert.equal(day.horizon, "day");
  assert.equal(day.stop.trigger, "hourly-close");
  assert.equal(day.stop.isBrokerStopEligible, false);
  assert.ok((day.stop.price ?? 0) < day.entryPrice);
  assert.equal(day.takeProfits[0]?.allocationPct, 50);
  assert.equal(day.takeProfits[1]?.basis, "2R");
  assert.match(day.formulaSteps.join(" "), /ATR1h/);

  const swing = plans[1];
  assert.equal(swing.stop.trigger, "daily-close");
  assert.equal(swing.trailingExit?.allocationPct, 40);
  assert.equal(swing.trailingExit?.price, 82_100);

  const long = plans[2];
  assert.equal(long.stop.trigger, "monthly-close");
  assert.equal(long.stop.price, 74_000);
  assert.equal(long.trailingExit?.allocationPct, 60);
  assert.equal(long.stop.isBrokerStopEligible, false);
});

test("missing timeframe inputs return unavailable without percentage fallbacks", () => {
  const context = baseContext();
  context.day = {
    ...context.day!,
    atr14: null,
    recentLow20: null,
  };
  context.long = undefined;

  const [day, , long] = calculateHorizonExitPlans(context);
  assert.equal(day.status, "unavailable");
  assert.equal(day.stop.price, null);
  assert.deepEqual(day.takeProfits, []);
  assert.ok(day.blockers.includes("1시간봉 ATR14"));
  assert.ok(day.blockers.includes("최근 20개 1시간봉 저점"));

  assert.equal(long.status, "unavailable");
  assert.equal(long.stop.price, null);
  assert.ok(long.blockers.includes("장기 일봉·주봉 분석"));
});

test("stale, forming, weak-trend, and low-reward inputs produce wait plans", () => {
  const context = baseContext();
  context.stale = true;
  context.day = {
    ...context.day!,
    resistance: 84_500,
    higherTimeframeTrendUp: false,
    latestBarClosed: false,
  };
  context.swing = {
    ...context.swing!,
    marketGatePassed: false,
    entryTrendUp: false,
  };
  context.long = {
    ...context.long!,
    weeklySma20: 68_000,
    weeklySma60: 70_000,
  };

  const plans = calculateHorizonExitPlans(context);
  assert.deepEqual(plans.map((plan) => plan.status), ["wait", "wait", "wait"]);
  assert.ok(plans[0].blockers.some((reason) => reason.includes("형성 중")));
  assert.ok(plans[1].blockers.some((reason) => reason.includes("종목 일봉 위험 게이트")));
  assert.ok(plans[2].blockers.some((reason) => reason.includes("SMA20")));
});

test("long plans never turn a monthly thesis line into a broker stop", () => {
  const long = calculateHorizonExitPlans(baseContext())[2];
  assert.equal(long.status, "actionable");
  assert.equal(long.stop.trigger, "monthly-close");
  assert.equal(long.stop.isBrokerStopEligible, false);
  assert.match(long.stop.reason, /월말 종가/);
});

test("plans reject non-positive stops and never emit negative prices", () => {
  const context = baseContext();
  context.day = {
    ...context.day!,
    atr14: 200_000,
  };
  context.swing = {
    ...context.swing!,
    atr14Daily: 100_000,
  };

  const [day, swing] = calculateHorizonExitPlans(context);
  assert.equal(day.status, "unavailable");
  assert.equal(day.stop.price, null);
  assert.equal(swing.status, "unavailable");
  assert.equal(swing.stop.price, null);
});

test("swing plans require real trailing inputs instead of allocating forty percent to null", () => {
  const context = baseContext();
  context.swing = {
    ...context.swing!,
    sma20: null,
    chandelierLong: null,
  };

  const swing = calculateHorizonExitPlans(context)[1];
  assert.equal(swing.status, "unavailable");
  assert.equal(swing.trailingExit, null);
  assert.ok(swing.blockers.includes("일봉 SMA20"));
  assert.ok(swing.blockers.includes("일봉 Chandelier 추적선"));
});

test("trailing lines above entry keep swing and long plans in wait state", () => {
  const context = baseContext();
  context.swing = {
    ...context.swing!,
    sma20: 85_000,
    chandelierLong: 84_600,
  };
  context.long = {
    ...context.long!,
    weeklySma20: 86_000,
  };

  const [, swing, long] = calculateHorizonExitPlans(context);
  assert.equal(swing.status, "wait");
  assert.ok(swing.blockers.some((reason) => reason.includes("추적선")));
  assert.equal(long.status, "wait");
  assert.ok(long.blockers.some((reason) => reason.includes("현재가")));
});

test("actionable plan allocations always sum to one hundred percent", () => {
  for (const plan of calculateHorizonExitPlans(baseContext())) {
    assert.equal(plan.status, "actionable");
    const allocated = plan.takeProfits.reduce((sum, target) => sum + target.allocationPct, 0)
      + (plan.trailingExit?.allocationPct ?? 0);
    assert.equal(allocated, 100);
  }
});

test("swing plan waits when its failure level is not below entry", () => {
  const context = baseContext();
  context.swing = {
    ...context.swing!,
    failureLevel: context.entryPrice + 100,
  };

  const swing = calculateHorizonExitPlans(context)[1];
  assert.equal(swing.status, "wait");
  assert.ok(swing.blockers.some((reason) => reason.includes("현재 진입가 아래")));
});
