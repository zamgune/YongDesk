import assert from "node:assert/strict";
import test from "node:test";

import { calculatePortfolioDailyAction } from "../src/lib/portfolio/daily-action.ts";

const baseInput = {
  marketCurrency: "USD" as const,
  currentPrice: 120,
  pnlPct: 10,
  currencyMatched: true,
  levels: {
    sma5: 116,
    sma20: 108,
    primaryStop: 100,
    hardStop: 96,
    resistance: 130,
  },
  signalReliability: {
    pattern: "new-high" as const,
    grade: "medium" as const,
    score: 58,
    sampleSize: 5,
    successRate: 0.5,
    stopHitRate: 0.3,
    averageMaxGainPct: 0.14,
    averageMaxDrawdownPct: -0.06,
    averageBarsHeld: 8,
    riskReward: 2.3,
    reasons: ["신호 신뢰도: 보통"],
  },
};

test("calculatePortfolioDailyAction prioritizes near-stop risk", () => {
  const action = calculatePortfolioDailyAction({
    ...baseInput,
    currentPrice: 101,
  });

  assert.equal(action.type, "near-stop");
  assert.equal(action.riskLevel, "danger");
});

test("calculatePortfolioDailyAction switches winners to take-profit review", () => {
  const action = calculatePortfolioDailyAction({
    ...baseInput,
    currentPrice: 132,
    pnlPct: 24,
  });

  assert.equal(action.type, "take-profit");
  assert.match(action.headline, /20일선 추적/);
});

test("calculatePortfolioDailyAction avoids adding when reliability is low", () => {
  const action = calculatePortfolioDailyAction({
    ...baseInput,
    signalReliability: {
      ...baseInput.signalReliability,
      grade: "low",
      score: 24,
    },
  });

  assert.equal(action.type, "avoid-new-entry");
  assert.match(action.criteria.join(" "), /신호 신뢰도/);
});
