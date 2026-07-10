import type {
  BacktestConfig,
  BacktestSummary,
  BacktestTrade,
  CostConfig,
  CryptoBar,
  CryptoParentTimeframe,
  CryptoSignal,
  EquityPoint,
  SignalSide,
  SymbolBacktestResult,
  TradeDirection,
  TradeExitReason,
} from "./types.mts";

type Fill = {
  price: number;
  quantity: number;
  fee: number;
};

type OpenPosition = {
  signal: CryptoSignal;
  side: SignalSide;
  direction: TradeDirection;
  entryPrice: number;
  entryFee: number;
  entryEquity: number;
  initialQuantity: number;
  quantityRemaining: number;
  remainingTp1Quantity: number;
  riskPerUnit: number;
  stopPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp1Hit: boolean;
  realizedGrossPnl: number;
  realizedExitFees: number;
  maxAdverseExcursion: number;
  maxFavorableExcursion: number;
};

type PositionStepResult = {
  cash: number;
  position: OpenPosition | null;
  closedTrade: BacktestTrade | null;
  cooldownUntilIndex: number | null;
};

const toFraction = (value: number, denominator: number) =>
  denominator === 0 ? 0 : value / denominator;

const createSummary = ({
  symbol,
  side,
  direction,
  timeframe,
  mode,
  costScenario,
  trades,
  endingEquity,
  startingEquity,
  equityCurve,
}: {
  symbol: string;
  side: SignalSide;
  direction: TradeDirection;
  timeframe: CryptoParentTimeframe;
  mode: "A" | "B";
  costScenario: CostConfig["scenario"];
  trades: BacktestTrade[];
  endingEquity: number;
  startingEquity: number;
  equityCurve: EquityPoint[];
}): BacktestSummary => {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, trade) => sum + trade.netPnl, 0),
  );
  const averageHoldBars =
    trades.reduce((sum, trade) => sum + trade.holdBars, 0) / Math.max(trades.length, 1);
  const averageWin =
    wins.length > 0
      ? wins.reduce((sum, trade) => sum + trade.netPnl, 0) / wins.length
      : null;
  const averageLoss =
    losses.length > 0
      ? losses.reduce((sum, trade) => sum + trade.netPnl, 0) / losses.length
      : null;
  const averageRMultiple =
    trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
      : null;

  let peak = equityCurve[0]?.equity ?? startingEquity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = toFraction(point.equity - peak, peak);
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  return {
    symbol,
    side,
    direction,
    timeframe,
    mode,
    costScenario,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: toFraction(wins.length, Math.max(trades.length, 1)),
    endingEquity,
    totalReturn: toFraction(endingEquity - startingEquity, startingEquity),
    maxDrawdown,
    profitFactor:
      grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
    expectancy:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length
        : 0,
    averageHoldBars,
    averageWin,
    averageLoss,
    averageRMultiple,
  };
};

const sellFill = ({
  targetPrice,
  quantity,
  cost,
}: {
  targetPrice: number;
  quantity: number;
  cost: CostConfig;
}): Fill => {
  const price = targetPrice * (1 - cost.slippageRate);
  const fee = price * quantity * cost.feeRate;
  return { price, quantity, fee };
};

const buyFill = ({
  targetPrice,
  quantity,
  cost,
}: {
  targetPrice: number;
  quantity: number;
  cost: CostConfig;
}): Fill => {
  const price = targetPrice * (1 + cost.slippageRate);
  const fee = price * quantity * cost.feeRate;
  return { price, quantity, fee };
};

const closePartial = ({
  cash,
  position,
  fill,
}: {
  cash: number;
  position: OpenPosition;
  fill: Fill;
}) => {
  position.quantityRemaining -= fill.quantity;
  position.realizedExitFees += fill.fee;
  const grossPnl =
    position.direction === "long"
      ? (fill.price - position.entryPrice) * fill.quantity
      : (position.entryPrice - fill.price) * fill.quantity;
  position.realizedGrossPnl += grossPnl;
  return cash + grossPnl - fill.fee;
};

const finalizeTrade = ({
  position,
  symbol,
  timeframe,
  mode,
  costScenario,
  exitIndex,
  exitTime,
  exitReason,
}: {
  position: OpenPosition;
  symbol: string;
  timeframe: CryptoParentTimeframe;
  mode: "A" | "B";
  costScenario: CostConfig["scenario"];
  exitIndex: number;
  exitTime: number;
  exitReason: TradeExitReason;
}): BacktestTrade => {
  const holdBars = exitIndex - position.signal.entryIndex + 1;
  const riskCapital = position.riskPerUnit * position.initialQuantity;
  const netPnl = position.realizedGrossPnl - position.entryFee - position.realizedExitFees;

  return {
    symbol,
    side: position.side,
    direction: position.direction,
    timeframe,
    mode,
    costScenario,
    signalTime: position.signal.signalTime,
    entryTime: position.signal.entryTime,
    exitTime,
    signalIndex: position.signal.signalIndex,
    entryIndex: position.signal.entryIndex,
    exitIndex,
    score: position.signal.score,
    signalFamily: position.signal.signalFamily,
    signalLane: position.signal.signalLane,
    reasons: position.signal.reasons,
    entryPrice: position.entryPrice,
    stopPrice: position.signal.stopLevel,
    tp1Price: position.tp1Price,
    tp2Price: position.tp2Price,
    exitReason,
    quantity: position.initialQuantity,
    entryEquity: position.entryEquity,
    grossPnl: position.realizedGrossPnl,
    netPnl,
    netReturn: position.entryEquity > 0 ? netPnl / position.entryEquity : 0,
    riskPerUnit: position.riskPerUnit,
    rMultiple: riskCapital > 0 ? netPnl / riskCapital : 0,
    holdBars,
    tp1Hit: position.tp1Hit,
    maxAdverseExcursion: position.maxAdverseExcursion,
    maxFavorableExcursion: position.maxFavorableExcursion,
  };
};

const stepOpenPosition = ({
  cash,
  position,
  bar,
  index,
  cost,
  config,
  symbol,
  timeframe,
  mode,
}: {
  cash: number;
  position: OpenPosition;
  bar: CryptoBar;
  index: number;
  cost: CostConfig;
  config: BacktestConfig;
  symbol: string;
  timeframe: CryptoParentTimeframe;
  mode: "A" | "B";
}): PositionStepResult => {
  const nextPosition = position;
  const adverse =
    nextPosition.direction === "long"
      ? (bar.low - nextPosition.entryPrice) / nextPosition.entryPrice
      : (nextPosition.entryPrice - bar.high) / nextPosition.entryPrice;
  const favorable =
    nextPosition.direction === "long"
      ? (bar.high - nextPosition.entryPrice) / nextPosition.entryPrice
      : (nextPosition.entryPrice - bar.low) / nextPosition.entryPrice;
  nextPosition.maxAdverseExcursion = Math.min(
    nextPosition.maxAdverseExcursion,
    adverse,
  );
  nextPosition.maxFavorableExcursion = Math.max(
    nextPosition.maxFavorableExcursion,
    favorable,
  );

  const exitFillFor = (targetPrice: number, quantity: number) =>
    nextPosition.direction === "long"
      ? sellFill({ targetPrice, quantity, cost })
      : buyFill({ targetPrice, quantity, cost });

  const stopTriggered =
    nextPosition.direction === "long"
      ? bar.low <= nextPosition.stopPrice
      : bar.high >= nextPosition.stopPrice;
  const tp1Triggered =
    !nextPosition.tp1Hit &&
    (nextPosition.direction === "long"
      ? bar.high >= nextPosition.tp1Price
      : bar.low <= nextPosition.tp1Price);
  const tp2Triggered =
    nextPosition.tp1Hit &&
    (nextPosition.direction === "long"
      ? bar.high >= nextPosition.tp2Price
      : bar.low <= nextPosition.tp2Price);

  let nextCash = cash;
  let exitReason: TradeExitReason | null = null;

  if (stopTriggered) {
    const stopFill = exitFillFor(nextPosition.stopPrice, nextPosition.quantityRemaining);
    nextCash = closePartial({ cash: nextCash, position: nextPosition, fill: stopFill });
    exitReason = nextPosition.tp1Hit ? "breakeven_stop" : "stop";
  } else if (tp1Triggered) {
    const tp1Fill = exitFillFor(nextPosition.tp1Price, nextPosition.remainingTp1Quantity);
    nextCash = closePartial({ cash: nextCash, position: nextPosition, fill: tp1Fill });
    nextPosition.tp1Hit = true;
    nextPosition.stopPrice = nextPosition.entryPrice;
  } else if (tp2Triggered) {
    const tp2Fill = exitFillFor(nextPosition.tp2Price, nextPosition.quantityRemaining);
    nextCash = closePartial({ cash: nextCash, position: nextPosition, fill: tp2Fill });
    exitReason = "tp2";
  } else if (index - nextPosition.signal.entryIndex + 1 >= config.maxHoldBars) {
    const timeFill = exitFillFor(bar.close, nextPosition.quantityRemaining);
    nextCash = closePartial({ cash: nextCash, position: nextPosition, fill: timeFill });
    exitReason = "time";
  }

  if (!exitReason) {
    return {
      cash: nextCash,
      position: nextPosition,
      closedTrade: null,
      cooldownUntilIndex: null,
    };
  }

  return {
    cash: nextCash,
    position: null,
    closedTrade: finalizeTrade({
      position: nextPosition,
      symbol,
      timeframe,
      mode,
      costScenario: cost.scenario,
      exitIndex: index,
      exitTime: bar.closeTime,
      exitReason,
    }),
    cooldownUntilIndex: exitReason === "stop" ? index + config.cooldownBars + 1 : null,
  };
};

const maybeOpenPosition = ({
  cash,
  signal,
  entryBar,
  cost,
  config,
}: {
  cash: number;
  signal: CryptoSignal;
  entryBar: CryptoBar;
  cost: CostConfig;
  config: BacktestConfig;
}) => {
  const direction = signal.direction ?? (signal.side === "sell" ? "short" : "long");
  const side = signal.side ?? (direction === "short" ? "sell" : "buy");
  const entryFill =
    direction === "long"
      ? buyFill({ targetPrice: entryBar.open, quantity: 1, cost })
      : sellFill({ targetPrice: entryBar.open, quantity: 1, cost });
  const entryPrice = entryFill.price;
  const riskPerUnit =
    direction === "long"
      ? entryPrice - signal.stopLevel
      : signal.stopLevel - entryPrice;
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
    return null;
  }

  const riskBudget = cash * config.riskPerTrade;
  const maxAffordableQuantity = cash / (entryPrice * (1 + cost.feeRate));
  const quantity = Math.min(riskBudget / riskPerUnit, maxAffordableQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const actualEntryFill =
    direction === "long"
      ? buyFill({ targetPrice: entryBar.open, quantity, cost })
      : sellFill({ targetPrice: entryBar.open, quantity, cost });
  const entryFee = actualEntryFill.fee;
  const totalEntryCost =
    direction === "long"
      ? actualEntryFill.price * quantity + entryFee
      : entryFee;
  if (totalEntryCost > cash + 1e-9) {
    return null;
  }

  const halfQuantity = quantity / 2;

  return {
    cashAfterEntry: cash - totalEntryCost,
    position: {
      signal,
      side,
      direction,
      entryPrice: actualEntryFill.price,
      entryFee,
      entryEquity: cash,
      initialQuantity: quantity,
      quantityRemaining: quantity,
      remainingTp1Quantity: halfQuantity,
      riskPerUnit,
      stopPrice: signal.stopLevel,
      tp1Price:
        direction === "long"
          ? actualEntryFill.price + riskPerUnit
          : actualEntryFill.price - riskPerUnit,
      tp2Price:
        direction === "long"
          ? actualEntryFill.price + riskPerUnit * 2
          : actualEntryFill.price - riskPerUnit * 2,
      tp1Hit: false,
      realizedGrossPnl: 0,
      realizedExitFees: 0,
      maxAdverseExcursion: 0,
      maxFavorableExcursion: 0,
    } satisfies OpenPosition,
  };
};

export const runCryptoBacktest = ({
  symbol,
  side = "buy",
  timeframe,
  mode,
  bars,
  signals,
  cost,
  config,
}: {
  symbol: string;
  side?: SignalSide;
  timeframe: CryptoParentTimeframe;
  mode: "A" | "B";
  bars: CryptoBar[];
  signals: CryptoSignal[];
  cost: CostConfig;
  config: BacktestConfig;
}): SymbolBacktestResult => {
  const signalByEntryIndex = new Map<number, CryptoSignal>();
  for (const signal of signals) {
    if (!signalByEntryIndex.has(signal.entryIndex)) {
      signalByEntryIndex.set(signal.entryIndex, signal);
    }
  }

  let cash = config.startingEquity;
  let position: OpenPosition | null = null;
  let cooldownUntilIndex = -1;
  let skippedSignals = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const hadPositionAtBarOpen = Boolean(position);

    if (position) {
      const stepped = stepOpenPosition({
        cash,
        position,
        bar,
        index,
        cost,
        config,
        symbol,
        timeframe,
        mode,
      });
      cash = stepped.cash;
      position = stepped.position;
      if (stepped.closedTrade) {
        trades.push(stepped.closedTrade);
      }
      if (stepped.cooldownUntilIndex !== null) {
        cooldownUntilIndex = stepped.cooldownUntilIndex;
      }
    }

    const signal = signalByEntryIndex.get(index);
    if (signal) {
      if (hadPositionAtBarOpen || position) {
        skippedSignals += 1;
      } else if (index < cooldownUntilIndex) {
        skippedSignals += 1;
      } else {
        const opened = maybeOpenPosition({
          cash,
          signal,
          entryBar: bar,
          cost,
          config,
        });
        if (!opened) {
          skippedSignals += 1;
        } else {
          cash = opened.cashAfterEntry;
          position = opened.position;
          const stepped = stepOpenPosition({
            cash,
            position,
            bar,
            index,
            cost,
            config,
            symbol,
            timeframe,
            mode,
          });
          cash = stepped.cash;
          position = stepped.position;
          if (stepped.closedTrade) {
            trades.push(stepped.closedTrade);
          }
          if (stepped.cooldownUntilIndex !== null) {
            cooldownUntilIndex = stepped.cooldownUntilIndex;
          }
        }
      }
    }

    const markToMarketEquity =
      cash +
      (position
        ? position.direction === "long"
          ? position.quantityRemaining * bar.close
          : (position.entryPrice - bar.close) * position.quantityRemaining
        : 0);
    equityCurve.push({
      time: bar.closeTime,
      equity: markToMarketEquity,
    });
  }

  if (position) {
    const lastBar = bars[bars.length - 1];
    const finalFill =
      position.direction === "long"
        ? sellFill({
            targetPrice: lastBar.close,
            quantity: position.quantityRemaining,
            cost,
          })
        : buyFill({
            targetPrice: lastBar.close,
            quantity: position.quantityRemaining,
            cost,
          });
    cash = closePartial({ cash, position, fill: finalFill });
    trades.push(
      finalizeTrade({
        position,
        symbol,
        timeframe,
        mode,
        costScenario: cost.scenario,
        exitIndex: bars.length - 1,
        exitTime: lastBar.closeTime,
        exitReason: "end_of_data",
      }),
    );
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) {
      lastPoint.equity = cash;
    }
  }

  return {
    summary: createSummary({
      symbol,
      side,
      direction: side === "buy" ? "long" : "short",
      timeframe,
      mode,
      costScenario: cost.scenario,
      trades,
      endingEquity: cash,
      startingEquity: config.startingEquity,
      equityCurve,
    }),
    trades,
    signals,
    equityCurve,
    skippedSignals,
  };
};
