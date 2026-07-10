import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import type { PaperPosition } from "../src/domain/paper-trading.ts";
import {
  applyPaperTradingRunResult,
  readPaperTradingState,
  writePaperTradingRunSnapshot,
  writePaperTradingState,
} from "../src/lib/paper-trading/state-store.ts";
import type { PaperTradingCandidate } from "../src/use-cases/trading/run-paper-trading-daily.ts";
import {
  createDefaultPaperAccount,
  runPaperTradingDaily,
} from "../src/use-cases/trading/run-paper-trading-daily.ts";
import { GET as getPaperTradingState } from "../src/app/api/paper-trading/state/route.ts";

const candidate = ({
  symbol,
  rank,
  price = 100,
  status = "tradable",
  failureLevel = 92,
}: {
  symbol: string;
  rank: number;
  price?: number;
  status?: PaperTradingCandidate["automationStatus"];
  failureLevel?: number;
}): PaperTradingCandidate => ({
  market: "US",
  symbol,
  name: symbol,
  sector: "Tech",
  rank,
  price,
  decision: status === "tradable" ? "enter" : "watch",
  automationStatus: status,
  setup: "breakout",
  entryType: "stop-limit",
  entryRange: "100",
  stop: String(failureLevel),
  riskPct: (price - failureLevel) / price,
  reason: "test candidate",
  blockers: status === "tradable" ? [] : ["조건 미충족"],
  tradeSetup: {
    type: "breakout",
    label: "돌파 지지 확인",
    keyLevel: price,
    keyLevelLabel: "돌파 지지선",
    failureLevel,
    validIf: "기준선 위 종가 유지",
    invalidIf: "실패선 이탈",
    entryPlan: "분할 접근",
    stopReason: "돌파 실패",
  },
  breakoutRule: {
    status: "breakout-ready",
    newHighLevel: price,
    breakoutDistancePct: 0,
    avgTradedValue20: 1_000_000,
    volumeConfirmation: {
      ratio20: 1.5,
      status: "confirmed",
      context: "breakout",
    },
    fixedStopPrice: price * 0.9,
    profitSwitchPrice: price * 1.2,
    trailingExitPrice: price * 0.96,
    reasons: ["test breakout"],
  },
});

test("createDefaultPaperAccount creates separate session balances", () => {
  const us = createDefaultPaperAccount("US", "2026-05-31T00:00:00.000Z");
  const kr = createDefaultPaperAccount("KR", "2026-05-31T00:00:00.000Z");

  assert.equal(us.cash, 10_000);
  assert.equal(us.currency, "USD");
  assert.equal(kr.cash, 10_000_000);
  assert.equal(kr.currency, "KRW");
});

test("runPaperTradingDaily enters tradable candidates only", () => {
  const result = runPaperTradingDaily({
    session: "US",
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [
      candidate({ symbol: "AAA", rank: 1 }),
      candidate({ symbol: "WATCH", rank: 2, status: "watch" }),
    ],
  });

  assert.equal(result.nextPositions.length, 1);
  assert.equal(result.nextPositions[0]?.symbol, "AAA");
  assert.equal(result.orders.filter((order) => order.side === "buy").length, 1);
  assert.match(result.logs.map((log) => log.message).join(" "), /WATCH/);
});

test("runPaperTradingDaily caps daily entries at three and position size at fifteen percent", () => {
  const result = runPaperTradingDaily({
    session: "US",
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [1, 2, 3, 4].map((index) => candidate({ symbol: `T${index}`, rank: index })),
  });

  const buyOrders = result.orders.filter((order) => order.side === "buy");
  assert.equal(buyOrders.length, 3);
  assert.equal(buyOrders[0]?.quantity, 12);
  assert.equal(result.nextAccount.cash, 6_400);
});

test("runPaperTradingDaily enters probe candidates with thirty percent sizing", () => {
  const result = runPaperTradingDaily({
    session: "US",
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [candidate({ symbol: "PROBE", rank: 1, status: "probe", failureLevel: 92 })],
  });

  const buyOrder = result.orders.find((order) => order.side === "buy");
  assert.equal(result.run.probeCount, 1);
  assert.equal(buyOrder?.quantity, 4);
  assert.match(buyOrder?.reason ?? "", /probe 후보 1차 탐색 진입/);
  assert.match(result.run.summary, /probe 1개/);
});

test("runPaperTradingDaily records probe count in duplicate runs", () => {
  const account = {
    ...createDefaultPaperAccount("US", "2026-05-30T00:00:00.000Z"),
    lastRunDate: "2026-05-31",
  };
  const result = runPaperTradingDaily({
    session: "US",
    account,
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [candidate({ symbol: "PROBE", rank: 1, status: "probe" })],
  });

  assert.equal(result.run.status, "skipped");
  assert.equal(result.run.probeCount, 1);
});

test("runPaperTradingDaily records staged stop exits", () => {
  const position: PaperPosition = {
    id: "pos-1",
    session: "US",
    market: "US",
    symbol: "STOP",
    name: "STOP",
    quantity: 10,
    averagePrice: 100,
    lastPrice: 100,
    currency: "USD",
    openedAt: "2026-05-30T20:00:00.000Z",
    updatedAt: "2026-05-30T20:00:00.000Z",
    completedStages: [],
  };

  const result = runPaperTradingDaily({
    session: "US",
    account: createDefaultPaperAccount("US", "2026-05-30T00:00:00.000Z"),
    positions: [position],
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [candidate({ symbol: "STOP", rank: 1, price: 94, failureLevel: 96 })],
  });

  assert.equal(result.orders[0]?.side, "sell");
  assert.equal(result.orders[0]?.quantity, 3);
  assert.match(result.orders[0]?.reason ?? "", /30%/);
});

test("runPaperTradingDaily records partial take profit exits", () => {
  const position: PaperPosition = {
    id: "pos-1",
    session: "US",
    market: "US",
    symbol: "WIN",
    name: "WIN",
    quantity: 10,
    averagePrice: 100,
    lastPrice: 100,
    currency: "USD",
    openedAt: "2026-05-30T20:00:00.000Z",
    updatedAt: "2026-05-30T20:00:00.000Z",
    completedStages: [],
  };

  const result = runPaperTradingDaily({
    session: "US",
    account: createDefaultPaperAccount("US", "2026-05-30T00:00:00.000Z"),
    positions: [position],
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [candidate({ symbol: "WIN", rank: 1, price: 120, failureLevel: 92 })],
  });

  assert.equal(result.orders[0]?.side, "sell");
  assert.equal(result.orders[0]?.quantity, 3);
  assert.match(result.orders[0]?.reason ?? "", /분할익절/);
});

test("runPaperTradingDaily skips duplicate runs for the same date", () => {
  const account = {
    ...createDefaultPaperAccount("US", "2026-05-30T00:00:00.000Z"),
    lastRunDate: "2026-05-31",
  };
  const result = runPaperTradingDaily({
    session: "US",
    account,
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    entryCandidates: [candidate({ symbol: "AAA", rank: 1 })],
  });

  assert.equal(result.run.status, "skipped");
  assert.equal(result.orders.length, 0);
  assert.equal(result.nextAccount.lastRunDate, "2026-05-31");
});

test("paper trading file store creates default state when missing", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "paper-store-"));
  const result = await readPaperTradingState(storageRoot);

  assert.equal(result.state.accounts.KR.cash, 10_000_000);
  assert.equal(result.state.accounts.US.cash, 10_000);
  assert.equal(result.repaired, true);
});

test("paper trading file store persists state and run snapshots", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "paper-store-"));
  const readResult = await readPaperTradingState(storageRoot);
  const runResult = runPaperTradingDaily({
    session: "US",
    today: "2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    source: "script",
    entryCandidates: [candidate({ symbol: "AAA", rank: 1 })],
  });
  const nextState = applyPaperTradingRunResult(readResult.state, "US", runResult);

  await writePaperTradingState(nextState, storageRoot);
  const snapshotPath = await writePaperTradingRunSnapshot(runResult, storageRoot);
  const persisted = await readPaperTradingState(storageRoot);
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as typeof runResult;

  assert.equal(persisted.state.runs[0]?.source, "script");
  assert.equal(snapshot.run.id, runResult.run.id);
});

test("paper trading file store rejects unsafe snapshot dates", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "paper-store-"));
  const runResult = runPaperTradingDaily({
    session: "US",
    today: "../../2026-05-31",
    now: "2026-05-31T20:00:00.000Z",
    source: "script",
    entryCandidates: [candidate({ symbol: "AAA", rank: 1 })],
  });

  await assert.rejects(
    () => writePaperTradingRunSnapshot(runResult, storageRoot),
    /YYYY-MM-DD/,
  );
});

test("paper trading state route requires authenticated user", async () => {
  const response = await getPaperTradingState(
    new Request("http://stockanalysis.test/api/paper-trading/state"),
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.match(payload.error, /Supabase|로그인/);
});

test("paper trading file store backs up corrupted state", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "paper-store-"));
  await writeFile(join(storageRoot, "state.json"), "{bad json", "utf8");

  const result = await readPaperTradingState(storageRoot);

  assert.equal(result.repaired, true);
  assert.ok(result.backupPath?.includes("state.corrupt-"));
  assert.equal(result.state.accounts.US.cash, 10_000);
});
