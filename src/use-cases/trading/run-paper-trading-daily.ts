import type {
  PaperAccount,
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PaperRun,
  PaperTradingLog,
  PaperTradingMarket,
  PaperTradingRunSource,
  PaperTradingSession,
} from "@/domain/paper-trading";
import type { Currency } from "@/domain/portfolio";
import type { EntryCandidate } from "@/lib/market/market-briefing-report";
import { calculatePositionManagementPlan } from "../../lib/market/position-management-plan.ts";

export const PAPER_STRATEGY_VERSION = "paper-breakout-v1";

export type PaperTradingCandidate = EntryCandidate & {
  market: PaperTradingMarket;
};

export type RunPaperTradingDailyInput = {
  session: PaperTradingSession;
  account?: PaperAccount | null;
  positions?: PaperPosition[];
  entryCandidates: PaperTradingCandidate[];
  today?: string;
  now?: string;
  source?: PaperTradingRunSource;
  strategyVersion?: string;
};

export type RunPaperTradingDailyResult = {
  run: PaperRun;
  nextAccount: PaperAccount;
  nextPositions: PaperPosition[];
  orders: PaperOrder[];
  executions: PaperExecution[];
  logs: PaperTradingLog[];
};

const SESSION_DEFAULTS: Record<PaperTradingSession, { currency: Currency; initialCash: number }> = {
  KR: { currency: "KRW", initialCash: 10_000_000 },
  US: { currency: "USD", initialCash: 10_000 },
};

const MAX_DAILY_NEW_ENTRIES = 3;
const MAX_OPEN_POSITIONS = 8;
const MAX_POSITION_PCT = 0.15;
const PROBE_POSITION_MULTIPLIER = 0.3;
const MAX_RISK_PCT = 0.01;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getToday = () => new Date().toISOString().slice(0, 10);

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const createDefaultPaperAccount = (
  session: PaperTradingSession,
  now = new Date().toISOString(),
): PaperAccount => {
  const defaults = SESSION_DEFAULTS[session];
  return {
    id: `paper-${session.toLowerCase()}`,
    session,
    currency: defaults.currency,
    initialCash: defaults.initialCash,
    cash: defaults.initialCash,
    realizedPnl: 0,
    strategyVersion: PAPER_STRATEGY_VERSION,
    createdAt: now,
    updatedAt: now,
  };
};

const roundQuantity = (quantity: number) =>
  Math.max(0, Math.floor(quantity));

const estimateEquity = (
  account: PaperAccount,
  positions: PaperPosition[],
  candidatesBySymbol: Map<string, PaperTradingCandidate>,
) =>
  account.cash +
  positions.reduce((sum, position) => {
    const price = candidatesBySymbol.get(normalizeSymbol(position.symbol))?.price ?? position.lastPrice;
    return sum + position.quantity * price;
  }, 0);

const createLog = ({
  runId,
  session,
  source,
  strategyVersion,
  message,
  level = "info",
  market,
  symbol,
  now,
}: {
  runId: string;
  session: PaperTradingSession;
  source: PaperTradingRunSource;
  strategyVersion: string;
  message: string;
  level?: PaperTradingLog["level"];
  market?: PaperTradingMarket;
  symbol?: string;
  now: string;
}): PaperTradingLog => ({
  id: makeId("paper-log"),
  runId,
  session,
  source,
  market,
  symbol,
  level,
  message,
  strategyVersion,
  createdAt: now,
});

const createFilledOrder = ({
  runId,
  session,
  market,
  symbol,
  name,
  side,
  quantity,
  price,
  currency,
  reason,
  strategyVersion,
  now,
}: {
  runId: string;
  session: PaperTradingSession;
  market: PaperTradingMarket;
  symbol: string;
  name?: string;
  side: PaperOrder["side"];
  quantity: number;
  price: number;
  currency: Currency;
  reason: string;
  strategyVersion: string;
  now: string;
}): PaperOrder => ({
  id: makeId("paper-order"),
  runId,
  session,
  market,
  symbol: normalizeSymbol(symbol),
  name,
  side,
  type: "market",
  quantity,
  price,
  currency,
  status: "filled",
  reason,
  strategyVersion,
  createdAt: now,
});

export const runPaperTradingDaily = ({
  session,
  account,
  positions = [],
  entryCandidates,
  today = getToday(),
  now = new Date().toISOString(),
  source = "manual",
  strategyVersion = PAPER_STRATEGY_VERSION,
}: RunPaperTradingDailyInput): RunPaperTradingDailyResult => {
  const runId = makeId("paper-run");
  const baseAccount = account ?? createDefaultPaperAccount(session, now);
  const activeAccount: PaperAccount = {
    ...baseAccount,
    strategyVersion,
  };
  const sessionPositions = positions
    .filter((position) => position.session === session)
    .map((position) => ({
      ...position,
      symbol: normalizeSymbol(position.symbol),
      completedStages: position.completedStages ?? [],
    }));
  const candidatesBySymbol = new Map(
    entryCandidates.map((candidate) => [normalizeSymbol(candidate.symbol), candidate]),
  );
  const orders: PaperOrder[] = [];
  const executions: PaperExecution[] = [];
  const logs: PaperTradingLog[] = [];
  const tradableCandidates = entryCandidates.filter((candidate) => candidate.automationStatus === "tradable");
  const probeCandidates = entryCandidates.filter((candidate) => candidate.automationStatus === "probe");
  const executableCandidates = entryCandidates.filter((candidate) =>
    candidate.automationStatus === "tradable" || candidate.automationStatus === "probe",
  );

  if (activeAccount.lastRunDate === today) {
    const run: PaperRun = {
      id: runId,
      session,
      source,
      today,
      strategyVersion,
      status: "skipped",
      candidateCount: entryCandidates.length,
      tradableCount: tradableCandidates.length,
      probeCount: probeCandidates.length,
      ordersCount: 0,
      executionsCount: 0,
      startedAt: now,
      finishedAt: now,
      summary: "오늘 이미 페이퍼 자동운용을 실행했습니다.",
    };
    logs.push(createLog({
      runId,
      session,
      source,
      strategyVersion,
      message: run.summary,
      level: "warning",
      now,
    }));
    return {
      run,
      nextAccount: activeAccount,
      nextPositions: sessionPositions,
      orders,
      executions,
      logs,
    };
  }

  let cash = activeAccount.cash;
  let realizedPnl = activeAccount.realizedPnl;
  let nextPositions = [...sessionPositions];

  const sellPosition = ({
    position,
    candidate,
    quantity,
    stage,
    reason,
  }: {
    position: PaperPosition;
    candidate: PaperTradingCandidate;
    quantity: number;
    stage: string;
    reason: string;
  }) => {
    const sellQuantity = Math.min(position.quantity, roundQuantity(quantity));
    if (sellQuantity <= 0 || position.completedStages.includes(stage)) {
      return;
    }
    const order = createFilledOrder({
      runId,
      session,
      market: position.market,
      symbol: position.symbol,
      name: position.name,
      side: "sell",
      quantity: sellQuantity,
      price: candidate.price,
      currency: position.currency,
      reason,
      strategyVersion,
      now,
    });
    const pnl = (candidate.price - position.averagePrice) * sellQuantity;
    orders.push(order);
    executions.push({
      id: makeId("paper-execution"),
      runId,
      orderId: order.id,
      session,
      market: position.market,
      symbol: position.symbol,
      side: "sell",
      quantity: sellQuantity,
      price: candidate.price,
      currency: position.currency,
      realizedPnl: pnl,
      executedAt: now,
    });
    cash += sellQuantity * candidate.price;
    realizedPnl += pnl;
    nextPositions = nextPositions
      .map((item) =>
        item.id === position.id
          ? {
            ...item,
            quantity: item.quantity - sellQuantity,
            lastPrice: candidate.price,
            updatedAt: now,
            completedStages: [...new Set([...item.completedStages, stage])],
          }
          : item,
      )
      .filter((item) => item.quantity > 0);
    logs.push(createLog({
      runId,
      session,
      source,
      strategyVersion,
      market: position.market,
      symbol: position.symbol,
      message: `${position.symbol} ${reason}`,
      now,
    }));
  };

  for (const position of sessionPositions) {
    const candidate = candidatesBySymbol.get(normalizeSymbol(position.symbol));
    if (!candidate) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: position.market,
        symbol: position.symbol,
        message: `${position.symbol} 현재 후보 데이터가 없어 보유 기준만 유지합니다.`,
        level: "warning",
        now,
      }));
      continue;
    }

    const plan = calculatePositionManagementPlan({
      currentPrice: candidate.price,
      averagePrice: position.averagePrice,
      quantity: position.quantity,
      currencyMatched: true,
      breakoutRule: candidate.breakoutRule,
      breakoutSignal: candidate.breakoutSignal,
      tradeSetup: candidate.tradeSetup,
      signalReliability: candidate.signalReliability,
    });

    if (plan.portfolioStop.status === "triggered") {
      sellPosition({
        position,
        candidate,
        quantity: position.quantity,
        stage: "portfolio-stop",
        reason: "최종 손절 기준 이탈로 잔여 비중 정리",
      });
      continue;
    }
    if (plan.setupStop.status === "triggered") {
      sellPosition({
        position,
        candidate,
        quantity: position.quantity * 0.3,
        stage: "setup-stop",
        reason: "돌파매매 손절 기준 이탈로 30% 축소",
      });
      continue;
    }
    const secondTakeProfit = plan.takeProfitLevels[1];
    if (secondTakeProfit?.status === "triggered") {
      sellPosition({
        position,
        candidate,
        quantity: position.quantity * 0.3,
        stage: "take-profit-2",
        reason: "2차 분할익절 기준 도달로 30% 수익 실현",
      });
      continue;
    }
    const firstTakeProfit = plan.takeProfitLevels[0];
    if (firstTakeProfit?.status === "triggered") {
      sellPosition({
        position,
        candidate,
        quantity: position.quantity * 0.3,
        stage: "take-profit-1",
        reason: "1차 분할익절 기준 도달로 30% 수익 실현",
      });
    }
  }

  let newEntries = 0;
  const existingSymbols = new Set(nextPositions.map((position) => normalizeSymbol(position.symbol)));

  for (const candidate of executableCandidates.sort((left, right) => left.rank - right.rank)) {
    if (newEntries >= MAX_DAILY_NEW_ENTRIES) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: candidate.market,
        symbol: candidate.symbol,
        message: `${candidate.symbol} 하루 신규 진입 3개 제한으로 제외했습니다.`,
        now,
      }));
      continue;
    }
    if (nextPositions.length >= MAX_OPEN_POSITIONS) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: candidate.market,
        symbol: candidate.symbol,
        message: `${candidate.symbol} 시장별 최대 보유 8종목 제한으로 제외했습니다.`,
        now,
      }));
      continue;
    }
    const symbol = normalizeSymbol(candidate.symbol);
    if (existingSymbols.has(symbol)) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: candidate.market,
        symbol,
        message: `${symbol} 이미 보유 중이라 신규 진입은 건너뜁니다.`,
        now,
      }));
      continue;
    }
    const stopPrice =
      candidate.tradeSetup.failureLevel ??
      candidate.breakoutSignal?.failureLevel ??
      (isNumber(candidate.riskPct) ? candidate.price * (1 - candidate.riskPct) : null);
    if (!isNumber(stopPrice) || stopPrice >= candidate.price) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: candidate.market,
        symbol,
        level: "warning",
        message: `${symbol} 손절 기준을 계산할 수 없어 신규 진입에서 제외했습니다.`,
        now,
      }));
      continue;
    }

    const equity = estimateEquity(
      { ...activeAccount, cash, realizedPnl },
      nextPositions,
      candidatesBySymbol,
    );
    const positionMultiplier = candidate.automationStatus === "probe" ? PROBE_POSITION_MULTIPLIER : 1;
    const maxPositionValue = equity * MAX_POSITION_PCT * positionMultiplier;
    const riskBudget = equity * MAX_RISK_PCT;
    const riskPerShare = candidate.price - stopPrice;
    const quantity = roundQuantity(
      Math.min(maxPositionValue / candidate.price, riskBudget / riskPerShare, cash / candidate.price),
    );
    if (quantity <= 0) {
      logs.push(createLog({
        runId,
        session,
        source,
        strategyVersion,
        market: candidate.market,
        symbol,
        level: "warning",
        message: `${symbol} 현금 또는 1회 손실 한도 부족으로 제외했습니다.`,
        now,
      }));
      continue;
    }

    const order = createFilledOrder({
      runId,
      session,
      market: candidate.market,
      symbol,
      name: candidate.name,
      side: "buy",
      quantity,
      price: candidate.price,
      currency: activeAccount.currency,
      reason: candidate.automationStatus === "probe"
        ? "probe 후보 1차 탐색 진입"
        : "tradable 후보 페이퍼 신규 진입",
      strategyVersion,
      now,
    });
    orders.push(order);
    executions.push({
      id: makeId("paper-execution"),
      runId,
      orderId: order.id,
      session,
      market: candidate.market,
      symbol,
      side: "buy",
      quantity,
      price: candidate.price,
      currency: activeAccount.currency,
      realizedPnl: 0,
      executedAt: now,
    });
    cash -= quantity * candidate.price;
    nextPositions.push({
      id: makeId("paper-position"),
      session,
      market: candidate.market,
      symbol,
      name: candidate.name,
      quantity,
      averagePrice: candidate.price,
      lastPrice: candidate.price,
      currency: activeAccount.currency,
      openedAt: now,
      updatedAt: now,
      completedStages: [],
    });
    existingSymbols.add(symbol);
    newEntries += 1;
    logs.push(createLog({
      runId,
      session,
      source,
      strategyVersion,
      market: candidate.market,
      symbol,
      message: candidate.automationStatus === "probe"
        ? `${symbol} probe 후보로 ${quantity}주 1차 탐색 진입했습니다.`
        : `${symbol} tradable 후보로 ${quantity}주 페이퍼 진입했습니다.`,
      now,
    }));
  }

  for (const candidate of entryCandidates.filter((item) =>
    item.automationStatus !== "tradable" && item.automationStatus !== "probe",
  ).slice(0, 12)) {
    logs.push(createLog({
      runId,
      session,
      source,
      strategyVersion,
      market: candidate.market,
      symbol: candidate.symbol,
      level: candidate.automationStatus === "blocked" ? "warning" : "info",
      message: `${candidate.symbol} ${candidate.automationStatus} 후보로 체결하지 않았습니다. ${candidate.blockers[0] ?? candidate.reason}`,
      now,
    }));
  }

  const nextAccount: PaperAccount = {
    ...activeAccount,
    cash,
    realizedPnl,
    lastRunDate: today,
    updatedAt: now,
  };
  const run: PaperRun = {
    id: runId,
    session,
    source,
    today,
    strategyVersion,
    status: "executed",
    candidateCount: entryCandidates.length,
    tradableCount: tradableCandidates.length,
    probeCount: probeCandidates.length,
    ordersCount: orders.length,
    executionsCount: executions.length,
    startedAt: now,
    finishedAt: now,
    summary: `${session} 페이퍼 실행: 후보 ${entryCandidates.length}개, tradable ${tradableCandidates.length}개, probe ${probeCandidates.length}개, 체결 ${orders.length}건`,
  };

  return {
    run,
    nextAccount,
    nextPositions,
    orders,
    executions,
    logs,
  };
};
