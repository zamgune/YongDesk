import assert from "node:assert/strict";
import test from "node:test";

import { calculatePositionManagementPlan } from "../src/lib/market/position-management-plan.ts";

const baseInput = {
  currentPrice: 120,
  averagePrice: 100,
  quantity: 10,
  currencyMatched: true,
  levels: {
    sma20: 108,
    primaryStop: 96,
    hardStop: 90,
    resistance: 115,
  },
  breakoutRule: {
    status: "profit-tracking" as const,
    newHighLevel: 100,
    breakoutDistancePct: 0.2,
    avgTradedValue20: 2_000_000_000,
    volumeConfirmation: {
      ratio20: 1.5,
      status: "confirmed" as const,
      context: "support" as const,
    },
    fixedStopPrice: 90,
    profitSwitchPrice: 120,
    trailingExitPrice: 108,
    reasons: ["+20% 이후 20일선 추적"],
  },
  breakoutSignal: {
    status: "confirmed" as const,
    pattern: "new-high" as const,
    breakoutLevel: 100,
    supportLevel: 100,
    failureLevel: 96,
    volumeRatio: 1.5,
    entryPlan: "기준선 회복과 거래량 재확인 후 재진입을 검토합니다.",
    invalidation: "96 아래 마감은 실패입니다.",
    reasons: ["돌파 확인"],
  },
  tradeSetup: {
    type: "breakout" as const,
    label: "돌파 지지 확인",
    keyLevel: 100,
    keyLevelLabel: "돌파 지지선" as const,
    failureLevel: 96,
    validIf: "100 위 종가 유지",
    invalidIf: "96 아래 마감",
    entryPlan: "돌파 지지 확인 후 분할 접근",
    stopReason: "돌파 지지선 이탈",
  },
};

test("calculatePositionManagementPlan prioritizes stop defense near setup stop", () => {
  const plan = calculatePositionManagementPlan({
    ...baseInput,
    currentPrice: 98,
  });

  assert.equal(plan.bias, "defense");
  assert.equal(plan.setupStop.price, 96);
  assert.equal(plan.portfolioStop.price, 90);
  assert.match(plan.headline, /분할 방어/);
});

test("calculatePositionManagementPlan marks first partial take profit at resistance or 1R", () => {
  const plan = calculatePositionManagementPlan(baseInput);

  assert.equal(plan.bias, "take-profit");
  assert.equal(plan.takeProfitLevels[0].price, 104);
  assert.equal(plan.takeProfitLevels[0].allocationPct, 30);
  assert.equal(plan.takeProfitLevels[0].status, "triggered");
});

test("calculatePositionManagementPlan uses second target and trailing runner", () => {
  const plan = calculatePositionManagementPlan(baseInput);

  assert.equal(plan.takeProfitLevels[1].price, 108);
  assert.equal(plan.takeProfitLevels[1].allocationPct, 30);
  assert.equal(plan.takeProfitLevels[2].price, 108);
  assert.equal(plan.takeProfitLevels[2].allocationPct, 40);
});

test("calculatePositionManagementPlan blocks new exposure when setup stop is broken", () => {
  const plan = calculatePositionManagementPlan({
    ...baseInput,
    currentPrice: 94,
  });

  assert.equal(plan.bias, "defense");
  assert.equal(plan.setupStop.status, "triggered");
  assert.match(plan.riskWarnings.join(" "), /이미 이탈/);
});

test("calculatePositionManagementPlan excludes pnl-based take profit when currencies differ", () => {
  const plan = calculatePositionManagementPlan({
    ...baseInput,
    currencyMatched: false,
  });

  assert.match(plan.riskWarnings.join(" "), /통화/);
  assert.equal(plan.takeProfitLevels[0].allocationPct, 30);
});
