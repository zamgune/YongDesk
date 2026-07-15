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
  assert.equal(day.stop.price, 82_880);
  assert.equal(day.takeProfits[0]?.allocationPct, 50);
  assert.equal(day.takeProfits[1]?.basis, "2R");
  assert.match(day.formulaSteps.join(" "), /ATR1h/);

  const swing = plans[1];
  assert.equal(swing.stop.trigger, "daily-close");
  assert.equal(swing.stop.price, 80_900);
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
  assert.ok(plans.every((plan) => plan.stop.price !== null));
  assert.ok(plans.every((plan) => plan.takeProfits.length === 2));
  assert.ok(plans[0].blockers.some((reason) => reason.includes("형성 중")));
  assert.ok(plans[1].blockers.some((reason) => reason.includes("종목 일봉 위험 게이트")));
  assert.ok(plans[2].blockers.some((reason) => reason.includes("SMA20")));
});

test("a custom entry price recalculates targets without moving structural stops", () => {
  const defaultPlans = calculateHorizonExitPlans(baseContext());
  const customContext = baseContext();
  customContext.entryPrice = 90_000;
  const customPlans = calculateHorizonExitPlans(customContext);

  assert.ok(customPlans.every((plan) => plan.entryPrice === 90_000));
  for (let index = 0; index < customPlans.length; index += 1) {
    assert.notEqual(customPlans[index].takeProfits[0]?.price, defaultPlans[index].takeProfits[0]?.price);
    assert.equal(customPlans[index].stop.isBrokerStopEligible, false);
  }
  assert.equal(customPlans[0].stop.price, defaultPlans[0].stop.price);
  assert.equal(customPlans[1].stop.price, defaultPlans[1].stop.price);
  assert.equal(customPlans[2].stop.price, defaultPlans[2].stop.price, "장기 구조 무효선은 진입가와 무관해야 한다");
});

test("missing readiness indicators wait without hiding calculable prices", () => {
  const context = baseContext();
  context.day = {
    ...context.day!,
    higherTimeframeTrendUp: null,
    entryTrendUp: null,
    trendQualityPassed: null,
    volumeConfirmed: null,
  };
  context.swing = {
    ...context.swing!,
    marketGatePassed: null,
    dailyTrendUp: null,
    entryTrendUp: null,
  };
  context.long = {
    ...context.long!,
    marketGatePassed: null,
    weeklySma60: null,
  };

  const plans = calculateHorizonExitPlans(context);
  assert.deepEqual(plans.map((plan) => plan.status), ["wait", "wait", "wait"]);
  assert.ok(plans.every((plan) => plan.stop.price !== null));
  assert.ok(plans.every((plan) => plan.takeProfits.length === 2));
  assert.ok(plans[2].blockers.some((blocker) => blocker.includes("SMA60 표본")));
});

test("position management preserves original targets after the market breaches long invalidation", () => {
  const context = baseContext();
  context.planMode = "position-management";
  context.entryPrice = 90_000;
  context.currentPrice = 70_000;

  const long = calculateHorizonExitPlans(context)[2];
  assert.equal(long.status, "wait");
  assert.equal(long.planMode, "position-management");
  assert.equal(long.currentPrice, 70_000);
  assert.equal(long.stop.price, 74_000);
  assert.equal(long.managementState?.state, "invalidation-breached");
  assert.equal(long.managementState?.averagePrice, 90_000);
  assert.equal(long.managementState?.reentryConfirmationPrice, 78_000);
  assert.equal(long.takeProfits[0]?.price, 122_000);
  assert.ok(long.blockers.some((blocker) => blocker.includes("보유관리 상태")));
});

test("position management still reports invalidation when the average price cannot form positive R", () => {
  const context = baseContext();
  context.planMode = "position-management";
  context.entryPrice = 70_000;
  context.currentPrice = 68_000;

  const long = calculateHorizonExitPlans(context)[2];
  assert.equal(long.status, "wait");
  assert.equal(long.stop.price, 74_000);
  assert.deepEqual(long.takeProfits, []);
  assert.equal(long.managementState?.state, "invalidation-breached");
  assert.equal(long.riskPerShare, null);
  assert.ok(long.managementState?.actions.some((action) => action.includes("신규 매수")));
});

test("long plans never turn a monthly thesis line into a broker stop", () => {
  const long = calculateHorizonExitPlans(baseContext())[2];
  assert.equal(long.status, "actionable");
  assert.equal(long.stop.trigger, "monthly-close");
  assert.equal(long.stop.isBrokerStopEligible, false);
  assert.match(long.stop.reason, /월말 종가/);
});

test("ATR risk gates wait without replacing valid structural stops", () => {
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
  assert.equal(day.status, "wait");
  assert.equal(day.stop.price, 43_100);
  assert.ok(day.blockers.some((blocker) => blocker.includes("0.8 ATR1h")));
  assert.equal(swing.status, "wait");
  assert.equal(swing.stop.price, 80_900);
  assert.ok(swing.blockers.some((blocker) => blocker.includes("1.5 ATR1d")));
});

test("wide day and swing risks keep structure and never clamp stops inward", () => {
  const context = baseContext();
  context.day = {
    ...context.day!,
    recentLow20: 75_000,
  };
  context.swing = {
    ...context.swing!,
    failureLevel: 70_000,
  };

  const [day, swing] = calculateHorizonExitPlans(context);
  assert.equal(day.status, "wait");
  assert.equal(day.stop.price, 74_780);
  assert.equal(day.riskPerShare, 9_420);
  assert.ok(day.blockers.some((blocker) => blocker.includes("안쪽으로 당기지 않고")));
  assert.equal(swing.status, "wait");
  assert.equal(swing.stop.price, 70_000);
  assert.equal(swing.riskPerShare, 14_200);
  assert.ok(swing.blockers.some((blocker) => blocker.includes("안쪽으로 당기지 않고")));
});

test("narrow structural risks wait instead of moving the stop outward", () => {
  const context = baseContext();
  context.day = {
    ...context.day!,
    recentLow20: 84_000,
  };
  context.swing = {
    ...context.swing!,
    failureLevel: 82_000,
  };

  const [day, swing] = calculateHorizonExitPlans(context);
  assert.equal(day.status, "wait");
  assert.equal(day.stop.price, 83_780);
  assert.equal(day.riskPerShare, 420);
  assert.ok(day.blockers.some((blocker) => blocker.includes("0.8 ATR1h")));
  assert.equal(swing.status, "wait");
  assert.equal(swing.stop.price, 82_000);
  assert.equal(swing.riskPerShare, 2_200);
  assert.ok(swing.blockers.some((blocker) => blocker.includes("1.5 ATR1d")));
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
  assert.equal(swing.stop.price, context.entryPrice + 100);
  assert.equal(swing.riskPerShare, null);
  assert.deepEqual(swing.takeProfits, []);
  assert.equal(swing.trailingExit, null);
  assert.ok(swing.blockers.some((reason) => reason.includes("현재 진입가 아래")));
});
