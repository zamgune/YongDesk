import assert from "node:assert/strict";
import test from "node:test";

import type { Order } from "../src/lib/toss/types.ts";
import type { TrackedOrder } from "../src/lib/automation/order-tracker.ts";
import { syncOrderFills } from "../src/use-cases/trading/sync-order-fills.ts";

const tossOrder = (patch: Partial<Order> = {}): Order => ({
  orderId: "order-1",
  symbol: "NVDA",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  status: "FILLED",
  price: "100",
  quantity: "2",
  orderAmount: null,
  currency: "USD",
  orderedAt: "2026-07-09T00:00:00.000Z",
  canceledAt: null,
  execution: {
    filledQuantity: "2",
    averageFilledPrice: "101.5",
    filledAmount: "203",
    commission: "0.1",
    tax: "0",
    filledAt: "2026-07-09T00:01:00.000Z",
    settlementDate: "2026-07-10",
  },
  ...patch,
});

const trackedOrder = (patch: Partial<TrackedOrder> = {}): TrackedOrder => ({
  userId: "user-1",
  brokerOrderId: "order-1",
  clientOrderId: "client-order-1",
  accountSeq: 7,
  strategyId: "strategy-1",
  stepId: "buy-1",
  symbol: "NVDA",
  side: "buy",
  quantity: 2,
  limitPrice: 100,
  status: "PENDING",
  filledQuantity: 0,
  averageFilledPrice: null,
  terminal: false,
  submittedAt: "2026-07-09T00:00:00.000Z",
  lastSyncedAt: null,
  ...patch,
});

test("syncOrderFills uses OPEN order list before detail fallback", async () => {
  let detailCalls = 0;
  const openOrder = tossOrder({
    status: "PARTIAL_FILLED",
    execution: {
      ...tossOrder().execution,
      filledQuantity: "1",
      commission: null,
      tax: null,
    },
  });
  const result = await syncOrderFills({
    userId: "user-1",
    accountSeq: 7,
    trackedOrders: [trackedOrder()],
    now: "2026-07-09T00:02:00.000Z",
    fetcher: {
      getOpenOrders: async () => ({ orders: [openOrder] }),
      getOrder: async () => {
        detailCalls += 1;
        return tossOrder();
      },
    },
  });

  assert.equal(detailCalls, 0);
  assert.equal(result.orderUpdates.length, 1);
  assert.equal(result.orderUpdates[0]?.status, "PARTIAL_FILLED");
  assert.equal(result.orderUpdates[0]?.terminal, false);
  assert.equal(result.orderUpdates[0]?.filledQuantity, 1);
  assert.equal(result.newFills.length, 1);
  assert.equal(result.newFills[0]?.filledQuantity, 1);
  assert.equal(result.newFills[0]?.averageFilledPrice, 101.5);
  assert.equal(result.newFills[0]?.commission, null);
  assert.equal(result.logs.some((log) => log.level === "warning"), false);
});

test("syncOrderFills uses order detail when an order is missing from OPEN", async () => {
  let detailCalls = 0;
  const result = await syncOrderFills({
    userId: "user-1",
    accountSeq: 7,
    trackedOrders: [trackedOrder()],
    now: "2026-07-09T00:02:00.000Z",
    fetcher: {
      getOpenOrders: async () => ({ orders: [] }),
      getOrder: async () => {
        detailCalls += 1;
        return tossOrder();
      },
    },
  });

  assert.equal(detailCalls, 1);
  assert.equal(result.orderUpdates[0]?.status, "FILLED");
  assert.equal(result.newFills.length, 1);
  assert.equal(result.logs.some((log) => log.level === "warning" && log.brokerOrderId === "*"), false);
});
