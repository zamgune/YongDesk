import assert from "node:assert/strict";
import test from "node:test";

import { buildTossConditionalOrderPayload } from "../src/adapters/toss/toss-conditional-order.ts";
import { createManagedTradePlan } from "../src/use-cases/trading/create-managed-trade-plan.ts";

const base = {
  userId: "local-user",
  symbol: "005930",
  assetClass: "stock" as const,
  currency: "KRW" as const,
  purpose: "new-position" as const,
  mode: "paper" as const,
  horizon: "day" as const,
  quantity: 2,
  entryPrice: 70_000,
  expiryDate: "2026-07-16",
};

test("managed paper plans support all four exit combinations", () => {
  for (const [takeProfit, stopLoss] of [[false, false], [true, false], [false, true], [true, true]]) {
    const result = createManagedTradePlan({
      ...base,
      takeProfit: { enabled: takeProfit, triggerPrice: takeProfit ? 73_000 : null },
      stopLoss: { enabled: stopLoss, triggerPrice: stopLoss ? 68_000 : null },
    });
    assert.equal(result.riskCheck.passed, true, result.riskCheck.blockers.join(" | "));
    assert.equal(result.plan.exits.takeProfit.enabled, takeProfit);
    assert.equal(result.plan.exits.stopLoss.enabled, stopLoss);
    assert.equal(result.legIntents.length, 1 + Number(takeProfit) + Number(stopLoss));
  }
});

test("managed live plans reject a new-position three-leg bracket", () => {
  const result = createManagedTradePlan({
    ...base,
    mode: "toss-live",
    takeProfit: { enabled: true, triggerPrice: 73_000 },
    stopLoss: { enabled: true, triggerPrice: 68_000 },
  });
  assert.equal(result.riskCheck.passed, false);
  assert.ok(result.riskCheck.blockers.some((item) => item.includes("3단 브래킷")));
});

test("managed plan validates exit direction around the entry", () => {
  const result = createManagedTradePlan({
    ...base,
    takeProfit: { enabled: true, triggerPrice: 69_000 },
    stopLoss: { enabled: true, triggerPrice: 71_000 },
  });
  assert.equal(result.riskCheck.passed, false);
  assert.ok(result.riskCheck.blockers.some((item) => item.includes("익절가")));
  assert.ok(result.riskCheck.blockers.some((item) => item.includes("손절가")));
});

test("Toss maps a single new-position exit to OTO", () => {
  const result = createManagedTradePlan({
    ...base,
    mode: "toss-live",
    takeProfit: { enabled: true, triggerPrice: 73_000 },
  });
  assert.equal(result.riskCheck.passed, true);
  const payload = buildTossConditionalOrderPayload(result.plan, "managed-oto-1");
  assert.equal(payload?.type, "OTO");
  assert.equal(payload?.first.orderSide, "BUY");
  assert.equal(payload?.second?.orderSide, "SELL");
  assert.equal(payload?.expireDate, "2026-07-16");
});

test("Toss maps held take-profit and stop-loss to ordered OCO legs", () => {
  const result = createManagedTradePlan({
    ...base,
    mode: "toss-live",
    purpose: "manage-position",
    entryPrice: 70_000,
    takeProfit: { enabled: true, triggerPrice: 73_000 },
    stopLoss: { enabled: true, triggerPrice: 68_000 },
  });
  const payload = buildTossConditionalOrderPayload(result.plan, "managed-oco-1");
  assert.equal(payload?.type, "OCO");
  assert.equal(payload?.first.triggerPrice, "73000");
  assert.equal(payload?.second?.triggerPrice, "68000");
  assert.equal(payload?.second?.orderPrice, "67900");
});

test("Toss maps one held exit to SINGLE", () => {
  const result = createManagedTradePlan({
    ...base,
    mode: "toss-live",
    purpose: "manage-position",
    stopLoss: { enabled: true, triggerPrice: 68_000 },
  });
  const payload = buildTossConditionalOrderPayload(result.plan, "managed-single-1");
  assert.equal(payload?.type, "SINGLE");
  assert.equal(payload?.second, undefined);
});
