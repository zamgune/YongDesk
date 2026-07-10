import assert from "node:assert/strict";
import test from "node:test";

import type { AutomationStrategyConfig, LoopGridPlan, LoopGridState } from "../src/domain/automation.ts";
import { LiveTradingDisabledError } from "../src/adapters/toss/toss-broker.ts";
import { createCryptoBroker } from "../src/adapters/crypto/crypto-broker.ts";
import { createDevAuthSession, DEV_AUTH_COOKIE } from "../src/lib/auth/dev-session.ts";
import { getLiveTradingGate } from "../src/lib/automation/live-trading.ts";
import { getLoopGridState, recordLoopGridBuy, recordLoopGridSell } from "../src/lib/automation/loop-state.ts";
import { parseStrategyConfigPayload } from "../src/lib/automation/http.ts";
import {
  countActiveFeatureUsers,
  grantAutomationFeature,
  hasAutomationFeature,
  revokeAutomationFeature,
} from "../src/lib/automation/store.ts";
import { getStrategyConfigHash, simulateAutomationStrategy, validateStrategyConfig } from "../src/lib/automation/simulation.ts";
import type { BrokerPort } from "../src/ports/broker.ts";
import { POST as createStrategyConfig } from "../src/app/api/strategy-configs/route.ts";
import { PUT as updateStrategyConfig } from "../src/app/api/strategy-configs/[id]/route.ts";
import { POST as simulateStrategyConfig } from "../src/app/api/strategy-configs/[id]/simulate/route.ts";
import { evaluatePercentGrid } from "../src/use-cases/trading/evaluate-percent-grid.ts";
import { evaluateLoopGrid } from "../src/use-cases/trading/evaluate-loop-grid.ts";
import { runAutomationWorkerTick } from "../src/use-cases/trading/run-automation-worker.ts";

const buildStrategy = (patch: Partial<AutomationStrategyConfig> = {}): AutomationStrategyConfig => {
  const now = new Date().toISOString();
  return {
    id: "strategy-1",
    userId: "user-1",
    name: "AAPL support rebound",
    symbol: "AAPL",
    market: "US",
    preset: "support-rebound",
    status: "draft",
    supportPrice: 182,
    resistancePrice: 205,
    currentPrice: 193,
    ladder: [
      {
        id: "buy-1",
        side: "buy",
        price: 182.91,
        notional: 1200,
        condition: "near support",
      },
      {
        id: "sell-1",
        side: "sell",
        price: 203.97,
        notional: 1000,
        condition: "near resistance",
      },
    ],
    riskLimits: {
      maxDailyBuys: 2,
      maxDailySells: 2,
      maxPositionValue: 3500,
      maxLossPct: 6,
      maxHoldHours: 48,
    },
    exitRules: {
      takeProfitPct: 5,
      stopLossPct: 4,
      rescueMode: "cancel-and-liquidate",
    },
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
};

const createApiUser = async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const session = await createDevAuthSession({
    email: `automation-${suffix}@example.com`,
    password: "password123",
  });
  if ("error" in session) {
    throw new Error(session.error);
  }
  await grantAutomationFeature(session.user.id, "automation_beta");
  return session;
};

const authRequest = (
  token: string,
  url: string,
  init: RequestInit = {},
) => {
  const headers = init.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : Array.isArray(init.headers)
      ? Object.fromEntries(init.headers)
      : init.headers;
  return new Request(url, {
    ...init,
    headers: {
      ...headers,
      cookie: `${DEV_AUTH_COOKIE}=${encodeURIComponent(token)}`,
      "x-forwarded-for": `${Date.now()}-${Math.random()}`,
    },
  });
};

const strategyPayload = (patch: Partial<AutomationStrategyConfig> = {}) => {
  const config = buildStrategy({
    mode: "loop-grid",
    market: "KR",
    symbol: `9${String(Date.now()).slice(-5)}`,
    currentPrice: 100,
    loop: loopPlan,
    riskLimits: {
      maxDailyBuys: 2,
      maxDailySells: 2,
      maxPositionValue: 1000,
      maxLossPct: 15,
      maxHoldHours: 24 * 365,
    },
    exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    ...patch,
  });
  const payload = { ...config } as Record<string, unknown>;
  delete payload.id;
  delete payload.userId;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.lastSimulation;
  return payload;
};

const postStrategy = async (
  token: string,
  payload: ReturnType<typeof strategyPayload>,
) => {
  const response = await createStrategyConfig(authRequest(token, "http://stockanalysis.test/api/strategy-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  const body = await response.json() as { config: AutomationStrategyConfig; error?: string };
  assert.equal(response.status, 201, body.error);
  return body.config;
};

const putStrategy = async (
  token: string,
  id: string,
  payload: Record<string, unknown>,
) => {
  const response = await updateStrategyConfig(
    authRequest(token, `http://stockanalysis.test/api/strategy-configs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) },
  );
  const body = await response.json() as { config?: AutomationStrategyConfig; error?: string; errors?: string[] };
  return { response, body };
};

test("simulateAutomationStrategy creates draft order intents without live trading", () => {
  const result = simulateAutomationStrategy({
    userId: "user-1",
    config: buildStrategy(),
  });

  assert.equal(result.liveTradingEnabled, false);
  assert.equal(result.mode, "paper");
  assert.equal(result.riskCheck.passed, true);
  assert.equal(result.orderIntents.length, 2);
  assert.deepEqual(result.orderIntents.map((intent) => intent.status), ["draft", "draft"]);
});

test("simulateAutomationStrategy blocks orders that exceed loss limits", () => {
  const result = simulateAutomationStrategy({
    userId: "user-1",
    config: buildStrategy({
      riskLimits: {
        maxDailyBuys: 2,
        maxDailySells: 2,
        maxPositionValue: 3500,
        maxLossPct: 1,
        maxHoldHours: 48,
      },
    }),
  });

  assert.equal(result.riskCheck.passed, false);
  assert.equal(result.orderIntents.every((intent) => intent.status === "blocked"), true);
  assert.match(result.riskCheck.blockers.join(" "), /최대 손실률/);
});

const loopPlan: LoopGridPlan = {
  anchorPrice: 100,
  buyDropPct: 1,
  sellRisePct: 1,
  notional: 1000,
  cooldownMinutes: 5,
};

const emptyLoopState = (patch: Partial<LoopGridState> = {}): LoopGridState => ({
  anchorPrice: 100,
  positionState: "empty",
  entryPrice: null,
  quantity: 0,
  lastCycleAt: null,
  cycleCount: 0,
  updatedAt: "2026-06-18T00:00:00.000Z",
  ...patch,
});

test("evaluateLoopGrid buys when price falls by configured percent", () => {
  const result = evaluateLoopGrid({
    plan: loopPlan,
    marketPrice: 99,
    state: emptyLoopState(),
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 2,
    maxDailySells: 2,
    maxPositionValue: 1000,
    maxLossPct: 15,
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.sell, null);
  assert.equal(result.buy?.side, "buy");
  assert.equal(result.buy?.buyLevel, 99);
  assert.equal(result.buy?.quantity, 10);
});

test("evaluateLoopGrid waits when buy drop is not reached", () => {
  const result = evaluateLoopGrid({
    plan: loopPlan,
    marketPrice: 99.1,
    state: emptyLoopState(),
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 2,
    maxDailySells: 2,
    maxPositionValue: 1000,
    maxLossPct: 15,
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.buy, null);
  assert.equal(result.sell, null);
});

test("evaluateLoopGrid sells when held position rises by configured percent", () => {
  const result = evaluateLoopGrid({
    plan: loopPlan,
    marketPrice: 100,
    state: emptyLoopState({ positionState: "holding", entryPrice: 99, quantity: 10 }),
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 2,
    maxDailySells: 2,
    maxPositionValue: 1000,
    maxLossPct: 15,
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.buy, null);
  assert.equal(result.sell?.side, "sell");
  assert.equal(result.sell?.sellLevel, 99.99);
  assert.equal(result.sell?.quantity, 10);
});

test("evaluateLoopGrid blocks during cooldown", () => {
  const result = evaluateLoopGrid({
    plan: loopPlan,
    marketPrice: 99,
    state: emptyLoopState({ lastCycleAt: "2026-06-18T00:08:00.000Z" }),
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 2,
    maxDailySells: 2,
    maxPositionValue: 1000,
    maxLossPct: 15,
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.buy, null);
  assert.match(result.blockers.join(" "), /쿨다운/);
});

test("evaluateLoopGrid blocks new buys past the loss limit", () => {
  const result = evaluateLoopGrid({
    plan: loopPlan,
    marketPrice: 90,
    state: emptyLoopState(),
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 2,
    maxDailySells: 2,
    maxPositionValue: 1000,
    maxLossPct: 5,
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.buy, null);
  assert.match(result.blockers.join(" "), /추가매수 중단선/);
});

test("evaluatePercentGrid blocks new buys past the loss limit but keeps sells", () => {
  const result = evaluatePercentGrid({
    plan: {
      basePrice: 100,
      rungs: [
        { index: 1, buyDropPct: 5, sellRisePct: 2, notional: 1000 },
        { index: 2, buyDropPct: 8, sellRisePct: 2, notional: 1000 },
      ],
    },
    marketPrice: 90,
    openLots: [
      {
        lotId: "lot-1",
        rungIndex: 1,
        entryPrice: 80,
        quantity: 10,
        openedAt: "2026-06-18T00:00:00.000Z",
      },
    ],
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 5,
    maxDailySells: 5,
    maxLossPct: 5,
  });

  assert.equal(result.buys.length, 0);
  assert.equal(result.sells.length, 1);
  assert.match(result.blockers.join(" "), /추가매수 중단선/);
});

test("evaluatePercentGrid emits fractional crypto quantity", () => {
  const result = evaluatePercentGrid({
    plan: {
      basePrice: 100_000_000,
      rungs: [{ index: 1, buyDropPct: 1, sellRisePct: 1, notional: 10_000 }],
    },
    marketPrice: 98_000_000,
    openLots: [],
    dailyBuys: 0,
    dailySells: 0,
    maxDailyBuys: 5,
    maxDailySells: 5,
    maxLossPct: 20,
    fractionalQuantity: true,
  });
  assert.equal(result.buys[0]?.quantity, 0.00010101);
});

test("loop-grid state opens on buy and resets anchor on sell", async () => {
  const userId = `user-${Date.now()}-state`;
  const strategyId = `strategy-${Date.now()}-state`;
  await recordLoopGridBuy(userId, strategyId, {
    anchorPrice: 100,
    entryPrice: 99,
    quantity: 10,
    executedAt: "2026-06-18T00:10:00.000Z",
  });
  const holding = await getLoopGridState(userId, strategyId, loopPlan);
  assert.equal(holding.positionState, "holding");
  assert.equal(holding.entryPrice, 99);
  assert.equal(holding.quantity, 10);

  await recordLoopGridSell(userId, strategyId, {
    sellPrice: 100,
    executedAt: "2026-06-18T00:20:00.000Z",
  });
  const empty = await getLoopGridState(userId, strategyId, loopPlan);
  assert.equal(empty.positionState, "empty");
  assert.equal(empty.anchorPrice, 100);
  assert.equal(empty.entryPrice, null);
  assert.equal(empty.cycleCount, 1);
});

test("parseStrategyConfigPayload preserves loop-grid payload", () => {
  const parsed = parseStrategyConfigPayload({
    name: "1% loop",
    symbol: "005930",
    market: "KR",
    mode: "loop-grid",
    currentPrice: 72000,
    loop: {
      anchorPrice: 72000,
      buyDropPct: 1,
      sellRisePct: 1,
      notional: 300000,
      cooldownMinutes: 5,
    },
  }, "user-1");

  assert.equal(parsed.mode, "loop-grid");
  assert.equal(parsed.loop?.anchorPrice, 72000);
  assert.equal(parsed.loop?.buyDropPct, 1);
  assert.equal(parsed.loop?.cooldownMinutes, 5);
});

test("parseStrategyConfigPayload preserves crypto execution venue", () => {
  const config = parseStrategyConfigPayload({
    name: "BTC 순환분할",
    symbol: "KRW-BTC",
    market: "CRYPTO",
    executionVenue: "bithumb",
    currentPrice: 100_000_000,
  }, "crypto-user");
  assert.equal(config.market, "CRYPTO");
  assert.equal(config.executionVenue, "bithumb");
});

test("validateStrategyConfig rejects unsafe percent-grid rung structure", () => {
  const config = buildStrategy({
    mode: "percent-grid",
    preset: "magic-split",
    currentPrice: 100,
    grid: {
      basePrice: 100,
      rungs: [
        { index: 1, buyDropPct: 3, sellRisePct: 1, notional: 600 },
        { index: 1, buyDropPct: 2, sellRisePct: 1, notional: 600 },
      ],
    },
    riskLimits: {
      maxDailyBuys: 1,
      maxDailySells: 2,
      maxPositionValue: 1000,
      maxLossPct: 15,
      maxHoldHours: 24 * 365,
    },
    exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
  });

  const errors = validateStrategyConfig(config);
  assert.match(errors.join(" "), /중복/);
  assert.match(errors.join(" "), /차수가 올라갈수록/);
  assert.match(errors.join(" "), /최대 보유 금액/);
  assert.match(errors.join(" "), /일일 최대 매수/);

  const missingRungErrors = validateStrategyConfig({
    ...config,
    grid: {
      basePrice: 100,
      rungs: [
        { index: 1, buyDropPct: 1, sellRisePct: 1, notional: 300 },
        { index: 3, buyDropPct: 3, sellRisePct: 1, notional: 300 },
      ],
    },
    riskLimits: {
      ...config.riskLimits,
      maxDailyBuys: 3,
      maxPositionValue: 1000,
    },
  });
  assert.match(missingRungErrors.join(" "), /순서대로/);
});

test("simulateAutomationStrategy blocks unsafe percent-grid order intents", () => {
  const result = simulateAutomationStrategy({
    userId: "user-1",
    config: buildStrategy({
      mode: "percent-grid",
      preset: "magic-split",
      currentPrice: 100,
      grid: {
        basePrice: 100,
        rungs: [
          { index: 1, buyDropPct: 1, sellRisePct: 1, notional: 800 },
          { index: 2, buyDropPct: 2, sellRisePct: 1, notional: 800 },
        ],
      },
      riskLimits: {
        maxDailyBuys: 2,
        maxDailySells: 2,
        maxPositionValue: 1000,
        maxLossPct: 15,
        maxHoldHours: 24 * 365,
      },
      exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    }),
  });

  assert.equal(result.riskCheck.passed, false);
  assert.match(result.riskCheck.blockers.join(" "), /최대 보유 금액/);
  assert.equal(result.orderIntents.every((intent) => intent.status === "blocked"), true);
});

test("strategy config API stores new strategies as draft even when enabled is requested", async () => {
  const session = await createApiUser();
  const config = await postStrategy(session.token, strategyPayload({ status: "enabled" }));

  assert.equal(config.status, "draft");
  assert.equal(config.lastSimulation, undefined);
});

test("strategy activation requires a passing simulation", async () => {
  const session = await createApiUser();
  const config = await postStrategy(session.token, strategyPayload());
  const { response, body } = await putStrategy(session.token, config.id, { status: "enabled" });

  assert.equal(response.status, 428);
  assert.match(body.error ?? "", /시뮬레이션/);
});

test("strategy activation rejects stale simulations after config changes", async () => {
  const session = await createApiUser();
  const config = await postStrategy(session.token, strategyPayload());
  const simulationResponse = await simulateStrategyConfig(
    authRequest(session.token, `http://stockanalysis.test/api/strategy-configs/${config.id}/simulate`, { method: "POST" }),
    { params: Promise.resolve({ id: config.id }) },
  );
  assert.equal(simulationResponse.status, 200);

  const { response, body } = await putStrategy(session.token, config.id, {
    status: "enabled",
    currentPrice: config.currentPrice + 1,
  });

  assert.equal(response.status, 428);
  assert.match(body.error ?? "", /시뮬레이션/);
});

test("strategy activation blocks duplicate enabled strategies for the same symbol", async () => {
  const session = await createApiUser();
  const symbol = `8${String(Date.now()).slice(-5)}`;
  const first = await postStrategy(session.token, strategyPayload({ symbol }));
  const second = await postStrategy(session.token, strategyPayload({ symbol }));

  for (const config of [first, second]) {
    const simulationResponse = await simulateStrategyConfig(
      authRequest(session.token, `http://stockanalysis.test/api/strategy-configs/${config.id}/simulate`, { method: "POST" }),
      { params: Promise.resolve({ id: config.id }) },
    );
    assert.equal(simulationResponse.status, 200);
  }

  const firstEnable = await putStrategy(session.token, first.id, { status: "enabled" });
  assert.equal(firstEnable.response.status, 200, firstEnable.body.error);

  const secondEnable = await putStrategy(session.token, second.id, { status: "enabled" });
  assert.equal(secondEnable.response.status, 409);
  assert.match(secondEnable.body.error ?? "", /동일 종목/);
});

test("strategy config hash ignores status and simulation metadata", () => {
  const base = buildStrategy();
  assert.equal(
    getStrategyConfigHash(base),
    getStrategyConfigHash({
      ...base,
      status: "enabled",
      lastSimulation: {
        configHash: "old",
        passed: true,
        blockers: [],
        warnings: [],
        expectedReturnPct: 1,
        expectedLossPct: 1,
        summary: "ok",
        simulatedAt: "2026-06-18T00:00:00.000Z",
      },
      updatedAt: "2026-06-18T00:00:00.000Z",
    }),
  );
});

test("runAutomationWorkerTick blocks loop-grid orders when live trading is disabled", async () => {
  const userId = `user-${Date.now()}-worker`;
  const config = buildStrategy({
    id: `strategy-${Date.now()}-worker`,
    name: "1% loop",
    symbol: "005930",
    market: "KR",
    mode: "loop-grid",
    currentPrice: 100,
    loop: loopPlan,
    riskLimits: {
      maxDailyBuys: 2,
      maxDailySells: 2,
      maxPositionValue: 1000,
      maxLossPct: 15,
      maxHoldHours: 24 * 365,
    },
    exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
  });
  const broker: BrokerPort = {
    async submitOrder(request) {
      throw new LiveTradingDisabledError(request);
    },
    async cancelOrder() {
      throw new Error("not used");
    },
  };

  const result = await runAutomationWorkerTick({
    userId,
    config,
    marketPrice: 99,
    broker,
    liveTradingEnabled: false,
    accountSeq: 1,
    today: "2026-06-18",
    now: "2026-06-18T00:10:00.000Z",
  });

  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0]?.status, "blocked");
  assert.equal(result.orders[0]?.side, "buy");
  const state = await getLoopGridState(userId, config.id, loopPlan);
  assert.equal(state.positionState, "empty");
  assert.equal(state.cycleCount, 0);
});

test("live trading feature can be toggled per user", async () => {
  const userId = `user-${Date.now()}-live-toggle`;
  const before = await countActiveFeatureUsers("live_trading");

  await grantAutomationFeature(userId, "live_trading");
  assert.equal(await hasAutomationFeature(userId, "live_trading"), true);
  assert.equal(await countActiveFeatureUsers("live_trading") >= before + 1, true);

  await revokeAutomationFeature(userId, "live_trading");
  assert.equal(await hasAutomationFeature(userId, "live_trading"), false);
});

test("live trading gate stays closed without durable Supabase store", async () => {
  const keys = [
    "ENABLE_LIVE_TRADING",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "BROKER_CREDENTIAL_ENC_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;

  try {
    process.env.ENABLE_LIVE_TRADING = "true";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.BROKER_CREDENTIAL_ENC_KEY;

    const gate = await getLiveTradingGate("user-with-live-toggle", true);
    assert.equal(gate.effective, false);
    assert.equal(gate.status, 503);
    assert.match(gate.reason ?? "", /Supabase/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("crypto broker blocks all network submission while its live gate is false", async () => {
  const broker = createCryptoBroker({
    exchange: "upbit",
    credentials: { accessKey: "unused", secretKey: "unused" },
  });
  await assert.rejects(
    broker.submitOrder({
      orderIntentId: "crypto-disabled",
      accountSeq: 0,
      symbol: "KRW-BTC",
      side: "buy",
      type: "limit",
      quantity: 0.001,
      limitPrice: 100_000_000,
      stopPrice: null,
    }),
    LiveTradingDisabledError,
  );
});

test("crypto broker rejects unsupported market buys before exchange submission", async () => {
  const broker = createCryptoBroker({
    exchange: "bithumb",
    credentials: { accessKey: "unused", secretKey: "unused" },
    liveTradingEnabled: true,
  });
  await assert.rejects(
    broker.submitOrder({
      orderIntentId: "crypto-market-buy",
      accountSeq: 0,
      symbol: "KRW-BTC",
      side: "buy",
      type: "market",
      quantity: 0.001,
      limitPrice: null,
      stopPrice: null,
    }),
    /주문 총액이 필요/,
  );
});
