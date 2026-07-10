import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.STOCK_ANALYSIS_STORAGE_ROOT = await mkdtemp(join(tmpdir(), "stock-analysis-live-policy-"));

const {
  LOCAL_LIVE_TRADING_MANUAL_CONFIRMATION,
  LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
  LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW,
  LOCAL_LIVE_TRADING_QA_CONFIRMATION,
  approveLocalManualQa,
  getLocalLiveTradingGate,
  getLocalLiveTradingSnapshot,
  kstDate,
  markLocalLiveOrderRejected,
  markLocalLiveOrderUnknown,
  prepareLocalLiveOrderAttempt,
  setLocalManualLiveTrading,
} = await import("../src/lib/automation/local-live-trading.ts");

const userId = "local-live-policy-test";
const accountSeq = 77;

const gateInput = () => ({
  userId,
  accountSeq,
  source: "manual" as const,
  globalGateOpen: true,
  globalGateReason: null,
  killSwitchEngaged: false,
  workerPaused: false,
});

test("local live policy defaults off and binds QA to one account", async () => {
  const initial = await getLocalLiveTradingSnapshot();
  assert.equal(initial.policy.manualEnabled, false);
  assert.equal(initial.policy.automationEnabled, false);

  const closed = await getLocalLiveTradingGate(gateInput());
  assert.equal(closed.effective, false);
  assert.match(closed.reason ?? "", /QA/);

  await approveLocalManualQa({
    userId,
    accountSeq,
    confirmation: LOCAL_LIVE_TRADING_QA_CONFIRMATION,
  });
  await assert.rejects(
    () => setLocalManualLiveTrading({ userId, accountSeq, enabled: true, confirmation: "잘못된 문구" }),
    /정확히 입력/,
  );
  await setLocalManualLiveTrading({
    userId,
    accountSeq,
    enabled: true,
    confirmation: LOCAL_LIVE_TRADING_MANUAL_CONFIRMATION,
  });
  const open = await getLocalLiveTradingGate(gateInput());
  assert.equal(open.effective, true);
});

test("local live policy preserves submitted buy budget and unknown locks every submission", async () => {
  const first = await prepareLocalLiveOrderAttempt({
    userId,
    accountSeq,
    source: "manual",
    previewId: "preview-1",
    clientOrderId: "client-order-1",
    payloadHash: "hash-1",
    symbol: "005930",
    side: "buy",
    quantity: 1,
    limitPrice: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    currency: "KRW",
    krwEquivalent: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    exchangeRate: 1,
  });
  await markLocalLiveOrderRejected(first.id, "broker rejected after POST");
  const afterRejected = await getLocalLiveTradingSnapshot();
  assert.equal(afterRejected.policy.dailyBuyKrwSubmitted, LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW);

  await prepareLocalLiveOrderAttempt({
    userId,
    accountSeq,
    source: "manual",
    previewId: "preview-2",
    clientOrderId: "client-order-2",
    payloadHash: "hash-2",
    symbol: "AAPL",
    side: "buy",
    quantity: 1,
    limitPrice: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    currency: "USD",
    krwEquivalent: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    exchangeRate: 1_300,
  });
  await prepareLocalLiveOrderAttempt({
    userId,
    accountSeq,
    source: "manual",
    previewId: "preview-3",
    clientOrderId: "client-order-3",
    payloadHash: "hash-3",
    symbol: "AAPL",
    side: "buy",
    quantity: 1,
    limitPrice: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    currency: "USD",
    krwEquivalent: LOCAL_LIVE_TRADING_MAX_BUY_ORDER_KRW,
    exchangeRate: 1_300,
  });
  await assert.rejects(
    () => prepareLocalLiveOrderAttempt({
      userId,
      accountSeq,
      source: "manual",
      previewId: "preview-4",
      clientOrderId: "client-order-4",
      payloadHash: "hash-4",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      limitPrice: 1,
      currency: "USD",
      krwEquivalent: 1,
      exchangeRate: 1_300,
    }),
    /일일 매수 한도/,
  );

  const sell = await prepareLocalLiveOrderAttempt({
    userId,
    accountSeq,
    source: "manual",
    previewId: "preview-sell",
    clientOrderId: "client-order-sell",
    payloadHash: "hash-sell",
    symbol: "005930",
    side: "sell",
    quantity: 1,
    limitPrice: 70_000,
    currency: "KRW",
    krwEquivalent: 70_000,
    exchangeRate: 1,
  });
  await markLocalLiveOrderUnknown(sell.id, "request-in-progress");
  const locked = await getLocalLiveTradingGate(gateInput());
  assert.equal(locked.effective, false);
  assert.match(locked.reason ?? "", /결과 불명/);

  const snapshot = await getLocalLiveTradingSnapshot();
  assert.equal(snapshot.policy.dailyBuyKrwSubmitted, LOCAL_LIVE_TRADING_MAX_DAILY_BUY_KRW);
  await assert.rejects(
    () => approveLocalManualQa({
      userId,
      accountSeq: accountSeq + 1,
      confirmation: LOCAL_LIVE_TRADING_QA_CONFIRMATION,
    }),
    /결과 불명 주문/,
  );
  assert.equal(kstDate(new Date("2026-07-11T14:59:59.000Z")), "2026-07-11");
  assert.equal(kstDate(new Date("2026-07-11T15:00:00.000Z")), "2026-07-12");
});

test.after(async () => {
  const root = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});
