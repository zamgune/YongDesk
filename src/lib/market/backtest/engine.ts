import type {
  StockBacktestBar,
  StockBacktestConfig,
  StockBacktestResult,
  StockBacktestSignal,
  StockBacktestSummary,
  StockBacktestTrade,
  StockEquityPoint,
  StockFill,
  StockFillReason,
  StockSignalRejection,
  StockSignalRejectionReason,
  StockTargetSpec,
  StockTradeDirection,
  StockTradeSide,
} from "./types.ts";
import { isUnixSeconds } from "./time.ts";

type ResolvedTarget = StockTargetSpec & {
  resolvedPrice: number;
  filled: boolean;
};

type OpenPosition = {
  signal: StockBacktestSignal;
  direction: StockTradeDirection;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  initialStopPrice: number;
  quantity: number;
  quantityRemaining: number;
  riskPerUnit: number;
  riskCapital: number;
  targets: ResolvedTarget[];
  fills: StockFill[];
  grossPnl: number;
  totalCosts: number;
  maxAdverseExcursionFraction: number;
  maxFavorableExcursionFraction: number;
  excursionFrozen: boolean;
  pendingTrailExit: { triggerTime: number; level: number } | null;
};

type ExitResult = {
  realizedEquity: number;
  fill: StockFill;
};

const EPSILON = 1e-9;

const isFinitePositive = (value: number) =>
  Number.isFinite(value) && value > 0;

const exitSideFor = (direction: StockTradeDirection): StockTradeSide =>
  direction === "long" ? "sell" : "buy";

const entrySideFor = (direction: StockTradeDirection): StockTradeSide =>
  direction === "long" ? "buy" : "sell";

const executionPriceFor = ({
  referencePrice,
  side,
  adverseSlippageBps,
}: {
  referencePrice: number;
  side: StockTradeSide;
  adverseSlippageBps: number;
}) => {
  const slippage = adverseSlippageBps / 10_000;
  return side === "buy"
    ? referencePrice * (1 + slippage)
    : referencePrice * (1 - slippage);
};

const fillCosts = ({
  executionPrice,
  quantity,
  side,
  config,
}: {
  executionPrice: number;
  quantity: number;
  side: StockTradeSide;
  config: StockBacktestConfig;
}) => {
  const notional = executionPrice * quantity;
  return {
    commission: notional * config.cost.commissionRate,
    tax: side === "sell" ? notional * config.cost.sellTaxRate : 0,
  };
};

const createFill = ({
  position,
  referencePrice,
  quantity,
  side,
  reason,
  targetId,
  time,
  barIndex,
  config,
}: {
  position: OpenPosition | null;
  referencePrice: number;
  quantity: number;
  side: StockTradeSide;
  reason: StockFillReason;
  targetId: string | null;
  time: number;
  barIndex: number;
  config: StockBacktestConfig;
}): StockFill => {
  const executionPrice = executionPriceFor({
    referencePrice,
    side,
    adverseSlippageBps: config.cost.adverseSlippageBps,
  });
  const { commission, tax } = fillCosts({
    executionPrice,
    quantity,
    side,
    config,
  });
  const grossPnl = position
    ? position.direction === "long"
      ? (executionPrice - position.entryPrice) * quantity
      : (position.entryPrice - executionPrice) * quantity
    : 0;
  return {
    time,
    barIndex,
    side,
    reason,
    targetId,
    referencePrice,
    executionPrice,
    quantity,
    commission,
    tax,
    grossPnl,
  };
};

const applyExit = ({
  position,
  realizedEquity,
  referencePrice,
  quantity,
  reason,
  targetId = null,
  time,
  barIndex,
  config,
}: {
  position: OpenPosition;
  realizedEquity: number;
  referencePrice: number;
  quantity: number;
  reason: Exclude<StockFillReason, "entry">;
  targetId?: string | null;
  time: number;
  barIndex: number;
  config: StockBacktestConfig;
}): ExitResult => {
  const safeQuantity = Math.min(quantity, position.quantityRemaining);
  const fill = createFill({
    position,
    referencePrice,
    quantity: safeQuantity,
    side: exitSideFor(position.direction),
    reason,
    targetId,
    time,
    barIndex,
    config,
  });
  position.quantityRemaining = Math.max(0, position.quantityRemaining - safeQuantity);
  position.grossPnl += fill.grossPnl;
  position.totalCosts += fill.commission + fill.tax;
  position.fills.push(fill);
  return {
    realizedEquity:
      realizedEquity + fill.grossPnl - fill.commission - fill.tax,
    fill,
  };
};

const updateExcursion = ({
  position,
  adversePrice,
  favorablePrice,
}: {
  position: OpenPosition;
  adversePrice: number;
  favorablePrice: number;
}) => {
  if (position.excursionFrozen) {
    return;
  }
  const adverse =
    position.direction === "long"
      ? (adversePrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - adversePrice) / position.entryPrice;
  const favorable =
    position.direction === "long"
      ? (favorablePrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - favorablePrice) / position.entryPrice;
  position.maxAdverseExcursionFraction = Math.min(
    position.maxAdverseExcursionFraction,
    adverse,
  );
  position.maxFavorableExcursionFraction = Math.max(
    position.maxFavorableExcursionFraction,
    favorable,
  );
};

const rejection = (
  signal: StockBacktestSignal,
  reason: StockSignalRejectionReason,
  detail: string,
): StockSignalRejection => ({
  signalId: signal.id,
  symbol: signal.symbol,
  confirmedAt: signal.confirmedAt,
  reason,
  detail,
});

const validateBars = ({
  bars,
  symbol,
  config,
}: {
  bars: StockBacktestBar[];
  symbol: string;
  config: StockBacktestConfig;
}) => {
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.symbol !== symbol) {
      throw new Error(`Bar ${index} belongs to ${bar.symbol}, expected ${symbol}.`);
    }
    if (bar.market !== config.market || bar.timeframe !== config.timeframe) {
      throw new Error(`Bar ${index} does not match the configured market/timeframe.`);
    }
    if (
      !isFinitePositive(bar.open) ||
      !isFinitePositive(bar.high) ||
      !isFinitePositive(bar.low) ||
      !isFinitePositive(bar.close) ||
      !Number.isFinite(bar.volume) ||
      bar.volume < 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > bar.high ||
      !isUnixSeconds(bar.openTime) ||
      !isUnixSeconds(bar.closeTime) ||
      bar.closeTime <= bar.openTime
    ) {
      throw new Error(`Bar ${index} contains invalid OHLCV or timestamps.`);
    }
    if (index > 0 && bar.openTime <= bars[index - 1].openTime) {
      throw new Error("Bars must be strictly ordered by openTime.");
    }
  }
};

const validateConfig = (config: StockBacktestConfig) => {
  if (!isFinitePositive(config.startingEquity)) {
    throw new Error("startingEquity must be positive.");
  }
  if (
    !isFinitePositive(config.riskPerTradeFraction) ||
    config.riskPerTradeFraction > 1 ||
    !isFinitePositive(config.maxPositionFraction) ||
    config.maxPositionFraction > 1
  ) {
    throw new Error("Risk and position fractions must be in (0, 1].");
  }
  if (
    (config.maxHoldBars !== null &&
      (!Number.isInteger(config.maxHoldBars) || config.maxHoldBars <= 0)) ||
    config.cost.commissionRate < 0 ||
    config.cost.sellTaxRate < 0 ||
    config.cost.adverseSlippageBps < 0
  ) {
    throw new Error("Backtest holding and cost configuration is invalid.");
  }
};

const validateSignalShape = (
  signal: StockBacktestSignal,
): { reason: StockSignalRejectionReason; detail: string } | null => {
  if (
    !isUnixSeconds(signal.occurredAt) ||
    !isUnixSeconds(signal.confirmedAt) ||
    signal.confirmedAt < signal.occurredAt
  ) {
    return {
      reason: "invalid-signal-time",
      detail: "confirmedAt must be finite and no earlier than occurredAt.",
    };
  }
  if (!isFinitePositive(signal.stopPrice)) {
    return { reason: "invalid-stop", detail: "stopPrice must be positive." };
  }
  const allocation = signal.targets.reduce(
    (sum, target) => sum + target.allocationFraction,
    0,
  );
  const targetIds = new Set(signal.targets.map((target) => target.id));
  if (
    allocation > 1 + EPSILON ||
    targetIds.size !== signal.targets.length ||
    signal.targets.some(
      (target) =>
        !target.id ||
        !isFinitePositive(target.allocationFraction) ||
        target.allocationFraction > 1 ||
        (target.price === undefined) === (target.rMultiple === undefined) ||
        (target.price !== undefined && !isFinitePositive(target.price)) ||
        (target.rMultiple !== undefined && !isFinitePositive(target.rMultiple)),
    )
  ) {
    return {
      reason: "invalid-target",
      detail:
        "Targets need unique IDs, one positive price or R multiple, and total allocation <= 1.",
    };
  }
  const trailingLevels = signal.trailingLevels ?? [];
  if (
    trailingLevels.some(
      (level, index) =>
        !isFinitePositive(level.price) ||
        !isUnixSeconds(level.observedAtCloseTime) ||
        level.observedAtCloseTime < signal.confirmedAt ||
        (index > 0 &&
          level.observedAtCloseTime <= trailingLevels[index - 1].observedAtCloseTime),
    )
  ) {
    return {
      reason: "invalid-trail",
      detail: "Trailing levels must be causal, positive, and strictly ordered.",
    };
  }
  return null;
};

const findNextBarIndex = (bars: StockBacktestBar[], confirmedAt: number) => {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (bars[middle].openTime < confirmedAt) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < bars.length ? low : -1;
};

const prepareEntrySchedule = ({
  bars,
  signals,
  symbol,
  config,
  rejections,
}: {
  bars: StockBacktestBar[];
  signals: StockBacktestSignal[];
  symbol: string;
  config: StockBacktestConfig;
  rejections: StockSignalRejection[];
}) => {
  const seenIds = new Set<string>();
  const candidates = new Map<number, StockBacktestSignal[]>();
  for (const signal of signals.toSorted((left, right) =>
    left.confirmedAt !== right.confirmedAt
      ? left.confirmedAt - right.confirmedAt
      : left.id.localeCompare(right.id),
  )) {
    if (seenIds.has(signal.id)) {
      rejections.push(rejection(signal, "duplicate-signal-id", "Signal ID was repeated."));
      continue;
    }
    seenIds.add(signal.id);
    if (signal.symbol !== symbol) {
      rejections.push(rejection(signal, "wrong-symbol", `Expected ${symbol}.`));
      continue;
    }
    if (signal.playbookId !== config.playbookId) {
      rejections.push(
        rejection(signal, "playbook-mismatch", `Expected ${config.playbookId}.`),
      );
      continue;
    }
    const shapeError = validateSignalShape(signal);
    if (shapeError) {
      rejections.push(rejection(signal, shapeError.reason, shapeError.detail));
      continue;
    }
    const entryIndex = findNextBarIndex(bars, signal.confirmedAt);
    if (entryIndex < 0) {
      rejections.push(
        rejection(signal, "missing-next-bar", "No later bar is available for entry."),
      );
      continue;
    }
    const entryBar = bars[entryIndex];
    if (
      config.horizon === "intraday" &&
      (!signal.sessionDate || entryBar.sessionDate !== signal.sessionDate)
    ) {
      rejections.push(
        rejection(
          signal,
          "cross-session-entry",
          `Signal session ${signal.sessionDate ?? "missing"} does not match ${entryBar.sessionDate}.`,
        ),
      );
      continue;
    }
    candidates.set(entryIndex, [...(candidates.get(entryIndex) ?? []), signal]);
  }

  const schedule = new Map<number, StockBacktestSignal>();
  for (const [entryIndex, scheduled] of candidates) {
    if (scheduled.length === 1) {
      schedule.set(entryIndex, scheduled[0]);
      continue;
    }
    for (const signal of scheduled) {
      rejections.push(
        rejection(
          signal,
          "entry-conflict",
          `${scheduled.length} signals resolve to the same next-bar open.`,
        ),
      );
    }
  }
  return schedule;
};

const resolveTargets = ({
  signal,
  entryPrice,
  riskPerUnit,
}: {
  signal: StockBacktestSignal;
  entryPrice: number;
  riskPerUnit: number;
}) =>
  signal.targets
    .map((target) => ({
      ...target,
      resolvedPrice:
        target.price ??
        (signal.direction === "long"
          ? entryPrice + riskPerUnit * (target.rMultiple ?? 0)
          : entryPrice - riskPerUnit * (target.rMultiple ?? 0)),
      filled: false,
    }))
    .toSorted((left, right) =>
      signal.direction === "long"
        ? left.resolvedPrice - right.resolvedPrice
        : right.resolvedPrice - left.resolvedPrice,
    );

const maybeOpenPosition = ({
  signal,
  bar,
  barIndex,
  realizedEquity,
  config,
}: {
  signal: StockBacktestSignal;
  bar: StockBacktestBar;
  barIndex: number;
  realizedEquity: number;
  config: StockBacktestConfig;
}):
  | { position: OpenPosition; realizedEquity: number }
  | { rejectionReason: StockSignalRejectionReason; detail: string } => {
  const entrySide = entrySideFor(signal.direction);
  const entryPrice = executionPriceFor({
    referencePrice: bar.open,
    side: entrySide,
    adverseSlippageBps: config.cost.adverseSlippageBps,
  });
  const riskPerUnit =
    signal.direction === "long"
      ? entryPrice - signal.stopPrice
      : signal.stopPrice - entryPrice;
  if (!isFinitePositive(riskPerUnit)) {
    return {
      rejectionReason: "invalid-stop",
      detail: "Structural stop is not beyond the slipped entry price.",
    };
  }
  const targets = resolveTargets({ signal, entryPrice, riskPerUnit });
  if (
    targets.some((target) =>
      signal.direction === "long"
        ? target.resolvedPrice <= entryPrice
        : target.resolvedPrice >= entryPrice,
    )
  ) {
    return {
      rejectionReason: "invalid-target",
      detail: "Target is not favorable relative to the slipped entry price.",
    };
  }
  const riskQuantity =
    (realizedEquity * config.riskPerTradeFraction) / riskPerUnit;
  const positionQuantity =
    (realizedEquity * config.maxPositionFraction) / entryPrice;
  const quantity = Math.min(riskQuantity, positionQuantity);
  if (!isFinitePositive(quantity)) {
    return {
      rejectionReason: "invalid-risk",
      detail: "Risk sizing produced no tradable quantity.",
    };
  }
  const entryFill = createFill({
    position: null,
    referencePrice: bar.open,
    quantity,
    side: entrySide,
    reason: "entry",
    targetId: null,
    time: bar.openTime,
    barIndex,
    config,
  });
  const entryCosts = entryFill.commission + entryFill.tax;
  if (entryCosts >= realizedEquity) {
    return {
      rejectionReason: "insufficient-equity",
      detail: "Entry costs consume the available equity.",
    };
  }
  return {
    realizedEquity: realizedEquity - entryCosts,
    position: {
      signal,
      direction: signal.direction,
      entryIndex: barIndex,
      entryTime: bar.openTime,
      entryPrice: entryFill.executionPrice,
      initialStopPrice: signal.stopPrice,
      quantity,
      quantityRemaining: quantity,
      riskPerUnit,
      riskCapital: riskPerUnit * quantity,
      targets,
      fills: [entryFill],
      grossPnl: 0,
      totalCosts: entryCosts,
      maxAdverseExcursionFraction: 0,
      maxFavorableExcursionFraction: 0,
      excursionFrozen: false,
      pendingTrailExit: null,
    },
  };
};

const stopReferenceFor = (position: OpenPosition, bar: StockBacktestBar) => {
  if (position.direction === "long") {
    return bar.open < position.initialStopPrice ? bar.open : position.initialStopPrice;
  }
  return bar.open > position.initialStopPrice ? bar.open : position.initialStopPrice;
};

const stopHappenedAtOpen = (position: OpenPosition, bar: StockBacktestBar) =>
  position.direction === "long"
    ? bar.open <= position.initialStopPrice
    : bar.open >= position.initialStopPrice;

const targetHappenedAtOpen = (
  position: OpenPosition,
  target: ResolvedTarget,
  bar: StockBacktestBar,
) =>
  position.direction === "long"
    ? bar.open >= target.resolvedPrice
    : bar.open <= target.resolvedPrice;

const finalizeTrade = ({
  position,
  exitIndex,
  exitTime,
  exitReason,
}: {
  position: OpenPosition;
  exitIndex: number;
  exitTime: number;
  exitReason: StockBacktestTrade["exitReason"];
}): StockBacktestTrade => {
  const netPnl = position.grossPnl - position.totalCosts;
  const entryRiskFraction = position.riskPerUnit / position.entryPrice;
  return {
    signalId: position.signal.id,
    symbol: position.signal.symbol,
    playbookId: position.signal.playbookId,
    direction: position.direction,
    signalTime: position.signal.occurredAt,
    confirmedAt: position.signal.confirmedAt,
    entryTime: position.entryTime,
    exitTime,
    entryIndex: position.entryIndex,
    exitIndex,
    entryPrice: position.entryPrice,
    initialStopPrice: position.initialStopPrice,
    quantity: position.quantity,
    riskPerUnit: position.riskPerUnit,
    riskCapital: position.riskCapital,
    grossPnl: position.grossPnl,
    totalCosts: position.totalCosts,
    netPnl,
    rMultiple: position.riskCapital > 0 ? netPnl / position.riskCapital : 0,
    holdBars: exitIndex - position.entryIndex + 1,
    maxAdverseExcursionFraction: position.maxAdverseExcursionFraction,
    maxFavorableExcursionFraction: position.maxFavorableExcursionFraction,
    maxAdverseExcursionR:
      entryRiskFraction > 0
        ? position.maxAdverseExcursionFraction / entryRiskFraction
        : 0,
    maxFavorableExcursionR:
      entryRiskFraction > 0
        ? position.maxFavorableExcursionFraction / entryRiskFraction
        : 0,
    exitReason,
    fills: position.fills,
  };
};

const createSummary = ({
  datasetId,
  config,
  symbol,
  trades,
  equityCurve,
  endingEquity,
}: {
  datasetId: string;
  config: StockBacktestConfig;
  symbol: string;
  trades: StockBacktestTrade[];
  equityCurve: StockEquityPoint[];
  endingEquity: number;
}): StockBacktestSummary => {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl <= 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(
    losses.reduce((sum, trade) => sum + trade.netPnl, 0),
  );
  let peak = config.startingEquity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, (point.equity - peak) / peak);
  }
  return {
    datasetId,
    configId: config.configId,
    symbol,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    endingEquity,
    totalReturn: (endingEquity - config.startingEquity) / config.startingEquity,
    maxDrawdown,
    profitFactor:
      grossLosses > 0
        ? grossWins / grossLosses
        : grossWins > 0
          ? Number.POSITIVE_INFINITY
          : null,
    averageNetPnl:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length
        : 0,
    averageRMultiple:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
        : null,
    averageHoldBars:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.holdBars, 0) / trades.length
        : 0,
  };
};

export const runStockBacktest = ({
  datasetId,
  config,
  symbol,
  bars,
  signals,
}: {
  datasetId: string;
  config: StockBacktestConfig;
  symbol: string;
  bars: StockBacktestBar[];
  signals: StockBacktestSignal[];
}): StockBacktestResult => {
  validateConfig(config);
  validateBars({ bars, symbol, config });
  const rejections: StockSignalRejection[] = [];
  const schedule = prepareEntrySchedule({
    bars,
    signals,
    symbol,
    config,
    rejections,
  });
  const trades: StockBacktestTrade[] = [];
  const equityCurve: StockEquityPoint[] = [];
  let realizedEquity = config.startingEquity;
  let position: OpenPosition | null = null;

  const closePosition = ({
    index,
    referencePrice,
    reason,
    time,
  }: {
    index: number;
    referencePrice: number;
    reason: StockBacktestTrade["exitReason"];
    time: number;
  }) => {
    if (!position) {
      return;
    }
    const closingPosition = position;
    const exited = applyExit({
      position: closingPosition,
      realizedEquity,
      referencePrice,
      quantity: closingPosition.quantityRemaining,
      reason,
      time,
      barIndex: index,
      config,
    });
    realizedEquity = exited.realizedEquity;
    closingPosition.excursionFrozen = true;
    trades.push(
      finalizeTrade({
        position: closingPosition,
        exitIndex: index,
        exitTime: time,
        exitReason: reason,
      }),
    );
    position = null;
  };

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const positionAtOpen = position;
    const hadPositionAtOpen = Boolean(positionAtOpen);

    if (position?.pendingTrailExit) {
      updateExcursion({
        position,
        adversePrice: bar.open,
        favorablePrice: bar.open,
      });
      closePosition({
        index,
        referencePrice: bar.open,
        reason: "trail",
        time: bar.openTime,
      });
    }

    if (position) {
      const stopTriggered =
        position.direction === "long"
          ? bar.low <= position.initialStopPrice
          : bar.high >= position.initialStopPrice;
      if (stopTriggered) {
        const stoppedAtOpen = stopHappenedAtOpen(position, bar);
        const stopReference = stopReferenceFor(position, bar);
        const stopExecution = executionPriceFor({
          referencePrice: stopReference,
          side: exitSideFor(position.direction),
          adverseSlippageBps: config.cost.adverseSlippageBps,
        });
        updateExcursion({
          position,
          adversePrice: stopExecution,
          favorablePrice: bar.open,
        });
        closePosition({
          index,
          referencePrice: stopReference,
          reason: "stop",
          time: stoppedAtOpen ? bar.openTime : bar.closeTime,
        });
      } else {
        const hitTargets = position.targets.filter(
          (target) =>
            !target.filled &&
            (position?.direction === "long"
              ? bar.high >= target.resolvedPrice
              : bar.low <= target.resolvedPrice),
        );
        if (hitTargets.length > 0) {
          const farthest = hitTargets[hitTargets.length - 1].resolvedPrice;
          updateExcursion({
            position,
            adversePrice: position.direction === "long" ? bar.low : bar.high,
            favorablePrice: farthest,
          });
          position.excursionFrozen = true;
          for (const target of hitTargets) {
            if (!position) {
              break;
            }
            const quantity = Math.min(
              position.quantity * target.allocationFraction,
              position.quantityRemaining,
            );
            const exited = applyExit({
              position,
              realizedEquity,
              referencePrice: target.resolvedPrice,
              quantity,
              reason: "target",
              targetId: target.id,
              time: targetHappenedAtOpen(position, target, bar)
                ? bar.openTime
                : bar.closeTime,
              barIndex: index,
              config,
            });
            realizedEquity = exited.realizedEquity;
            target.filled = true;
          }
          if (position && position.quantityRemaining <= EPSILON) {
            const completed = position;
            trades.push(
              finalizeTrade({
                position: completed,
                exitIndex: index,
                exitTime: completed.fills.at(-1)?.time ?? bar.closeTime,
                exitReason: "target",
              }),
            );
            position = null;
          }
        } else {
          updateExcursion({
            position,
            adversePrice: position.direction === "long" ? bar.low : bar.high,
            favorablePrice: position.direction === "long" ? bar.high : bar.low,
          });
        }
      }
    }

    const signal = schedule.get(index);
    if (signal) {
      if (hadPositionAtOpen || position) {
        rejections.push(
          rejection(signal, "position-open", "Another position occupied the entry bar."),
        );
      } else {
        const opened = maybeOpenPosition({
          signal,
          bar,
          barIndex: index,
          realizedEquity,
          config,
        });
        if ("rejectionReason" in opened) {
          rejections.push(rejection(signal, opened.rejectionReason, opened.detail));
        } else {
          realizedEquity = opened.realizedEquity;
          position = opened.position;

          const stopTriggered =
            position.direction === "long"
              ? bar.low <= position.initialStopPrice
              : bar.high >= position.initialStopPrice;
          if (stopTriggered) {
            const stoppedAtOpen = stopHappenedAtOpen(position, bar);
            const stopReference = stopReferenceFor(position, bar);
            const stopExecution = executionPriceFor({
              referencePrice: stopReference,
              side: exitSideFor(position.direction),
              adverseSlippageBps: config.cost.adverseSlippageBps,
            });
            updateExcursion({
              position,
              adversePrice: stopExecution,
              favorablePrice: bar.open,
            });
            closePosition({
              index,
              referencePrice: stopReference,
              reason: "stop",
              time: stoppedAtOpen ? bar.openTime : bar.closeTime,
            });
          } else {
            const hitTargets = position.targets.filter((target) =>
              position?.direction === "long"
                ? bar.high >= target.resolvedPrice
                : bar.low <= target.resolvedPrice,
            );
            if (hitTargets.length > 0) {
              updateExcursion({
                position,
                adversePrice: position.direction === "long" ? bar.low : bar.high,
                favorablePrice: hitTargets[hitTargets.length - 1].resolvedPrice,
              });
              position.excursionFrozen = true;
              for (const target of hitTargets) {
                if (!position) {
                  break;
                }
                const exited = applyExit({
                  position,
                  realizedEquity,
                  referencePrice: target.resolvedPrice,
                  quantity: position.quantity * target.allocationFraction,
                  reason: "target",
                  targetId: target.id,
                  time: targetHappenedAtOpen(position, target, bar)
                    ? bar.openTime
                    : bar.closeTime,
                  barIndex: index,
                  config,
                });
                realizedEquity = exited.realizedEquity;
                target.filled = true;
              }
              if (position && position.quantityRemaining <= EPSILON) {
                const completed = position;
                trades.push(
                  finalizeTrade({
                    position: completed,
                    exitIndex: index,
                    exitTime: completed.fills.at(-1)?.time ?? bar.closeTime,
                    exitReason: "target",
                  }),
                );
                position = null;
              }
            } else {
              updateExcursion({
                position,
                adversePrice: position.direction === "long" ? bar.low : bar.high,
                favorablePrice: position.direction === "long" ? bar.high : bar.low,
              });
            }
          }
        }
      }
    }

    if (position) {
      const holdBars = index - position.entryIndex + 1;
      if (config.forceSessionEndExit && bar.isSessionEnd) {
        closePosition({
          index,
          referencePrice: bar.close,
          reason: "session-end",
          time: bar.closeTime,
        });
      } else if (config.maxHoldBars !== null && holdBars >= config.maxHoldBars) {
        closePosition({
          index,
          referencePrice: bar.close,
          reason: "time",
          time: bar.closeTime,
        });
      } else if (index === bars.length - 1) {
        closePosition({
          index,
          referencePrice: bar.close,
          reason: "end-of-data",
          time: bar.closeTime,
        });
      } else {
        const trailLevel = position.signal.trailingLevels?.find(
          (level) => level.observedAtCloseTime === bar.closeTime,
        );
        const trailTriggered =
          trailLevel &&
          (position.direction === "long"
            ? bar.close <= trailLevel.price
            : bar.close >= trailLevel.price);
        if (trailLevel && trailTriggered) {
          position.pendingTrailExit = {
            triggerTime: bar.closeTime,
            level: trailLevel.price,
          };
        }
      }
    }

    const markToMarket = position
      ? position.direction === "long"
        ? (bar.close - position.entryPrice) * position.quantityRemaining
        : (position.entryPrice - bar.close) * position.quantityRemaining
      : 0;
    equityCurve.push({
      time: bar.closeTime,
      equity: realizedEquity + markToMarket,
      realizedEquity,
      openSignalId: position?.signal.id ?? null,
    });
  }

  return {
    summary: createSummary({
      datasetId,
      config,
      symbol,
      trades,
      equityCurve,
      endingEquity: realizedEquity,
    }),
    trades,
    equityCurve,
    rejections,
  };
};
