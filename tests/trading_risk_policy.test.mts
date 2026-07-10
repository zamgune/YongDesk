import assert from "node:assert/strict";
import test from "node:test";

import { createOrderIntent } from "../src/use-cases/trading/create-order-intent.ts";

test("createOrderIntent blocks live trading by default", () => {
  const result = createOrderIntent({
    userId: "user-1",
    symbol: "nvda",
    side: "buy",
    type: "limit",
    quantity: 2,
    limitPrice: 100,
    currency: "USD",
    rationale: ["돌파 신호 확인"],
  });

  assert.equal(result.intent.symbol, "NVDA");
  assert.equal(result.intent.status, "draft");
  assert.equal(result.riskCheck.passed, false);
  assert.match(result.riskCheck.blockers.join(" "), /실거래 주문/);
});

test("createOrderIntent marks checked order only when risk policy allows it", () => {
  const result = createOrderIntent({
    userId: "user-1",
    symbol: "005930.ks",
    side: "buy",
    type: "limit",
    quantity: 3,
    limitPrice: 70_000,
    currency: "KRW",
    rationale: ["20일선 지지 확인"],
    riskPolicy: {
      allowLiveTrading: true,
      maxOrderValue: 300_000,
      maxPositionValue: 1_000_000,
    },
  });

  assert.equal(result.intent.symbol, "005930.KS");
  assert.equal(result.intent.status, "risk_checked");
  assert.equal(result.riskCheck.passed, true);
  assert.equal(result.riskCheck.estimatedOrderValue, 210_000);
});
