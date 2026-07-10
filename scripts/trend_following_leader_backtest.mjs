import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const markets = {
  nasdaq: [
    "NVDA",
    "AAPL",
    "MSFT",
    "AMZN",
    "GOOGL",
    "META",
    "AVGO",
    "TSLA",
    "NFLX",
    "AMD",
    "COST",
    "ASML",
    "PEP",
    "CSCO",
    "QCOM",
    "TXN",
    "AMAT",
    "INTC",
    "ADBE",
    "INTU",
    "BKNG",
    "SHOP",
  ],
  kospi: [
    "005930.KS",
    "000660.KS",
    "373220.KS",
    "207940.KS",
    "005380.KS",
    "000270.KS",
    "068270.KS",
    "035420.KS",
    "105560.KS",
    "055550.KS",
    "012330.KS",
    "005490.KS",
    "051910.KS",
    "035720.KS",
    "006400.KS",
    "012450.KS",
    "042660.KS",
    "086790.KS",
    "000810.KS",
  ],
};

const years = Number(process.env.YEARS ?? 5);
const startCash = Number(process.env.START_CASH ?? 100_000);
const transactionCostRate = Number(process.env.COST_RATE ?? 0.002);
const leaderCounts = (process.env.LEADER_COUNTS ?? "4,5")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

const thresholds = {
  minHistory: 50,
  sma20SlopeLookback: 3,
  sma50SlopeLookback: 5,
  minSma20SlopePct: 0.001,
  minSma50SlopePct: 0,
  volumeRatioThreshold: 1.2,
  breakoutVolumeRatioThreshold: 1.35,
  closeStrengthThreshold: 0.6,
  breakoutLookback: 20,
  structureLowLookback: 5,
  entryCooldown: 5,
  successMovePct: 0.05,
};

const strategyVariants = [
  {
    name: "leader-sma50",
    marketBreadthMin: 0,
    marketAverageReturn50Min: -Infinity,
    maxStopPct: null,
    minLeaderReturn50: -Infinity,
    breakEvenTriggerPct: null,
    profitProtectTriggerPct: null,
    profitProtectExit: "none",
  },
  {
    name: "leader-risk-managed",
    marketBreadthMin: 0.45,
    marketAverageReturn50Min: 0,
    maxStopPct: 0.08,
    minLeaderReturn50: -Infinity,
    breakEvenTriggerPct: 0.08,
    profitProtectTriggerPct: 0.14,
    profitProtectExit: "sma20",
  },
  {
    name: "leader-riskcap-hold",
    marketBreadthMin: 0.45,
    marketAverageReturn50Min: 0,
    maxStopPct: 0.08,
    minLeaderReturn50: -Infinity,
    breakEvenTriggerPct: null,
    profitProtectTriggerPct: null,
    profitProtectExit: "none",
  },
  {
    name: "leader-wide-hold",
    marketBreadthMin: 0.5,
    marketAverageReturn50Min: 0,
    maxStopPct: 0.1,
    minLeaderReturn50: -Infinity,
    breakEvenTriggerPct: null,
    profitProtectTriggerPct: null,
    profitProtectExit: "none",
  },
  {
    name: "leader-momentum-hold",
    marketBreadthMin: 0.5,
    marketAverageReturn50Min: 0,
    maxStopPct: 0.1,
    minLeaderReturn50: 0.08,
    breakEvenTriggerPct: null,
    profitProtectTriggerPct: null,
    profitProtectExit: "none",
  },
  {
    name: "leader-momentum-defensive",
    marketBreadthMin: 0.55,
    marketAverageReturn50Min: 0.03,
    maxStopPct: 0.08,
    minLeaderReturn50: 0.1,
    breakEvenTriggerPct: 0.08,
    profitProtectTriggerPct: 0.14,
    profitProtectExit: "sma20",
  },
  {
    name: "leader-defensive",
    marketBreadthMin: 0.55,
    marketAverageReturn50Min: 0.03,
    maxStopPct: 0.06,
    minLeaderReturn50: -Infinity,
    breakEvenTriggerPct: 0.06,
    profitProtectTriggerPct: 0.1,
    profitProtectExit: "sma20",
  },
];

const sma = (values, period) =>
  values.map((_, index) => {
    if (index + 1 < period) return null;
    const window = values.slice(index + 1 - period, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / period;
  });

const pct = (value) => `${(value * 100).toFixed(1)}%`;

const dateKey = (time) => new Date(time * 1000).toISOString().slice(0, 10);

const yearKey = (time) => new Date(time * 1000).getUTCFullYear().toString();

const closeLocation = (bar) => {
  const range = bar.high - bar.low;
  return range > 0 ? (bar.close - bar.low) / range : 0.5;
};

const fetchCandles = async (symbol) => {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - years);

  const chart = await yahooFinance.chart(symbol, {
    period1: start,
    period2: end,
    interval: "1d",
    return: "array",
  });
  const quotes = "quotes" in chart ? chart.quotes : [];

  return quotes
    .filter((quote) =>
      [quote.open, quote.high, quote.low, quote.close, quote.volume].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    )
    .map((quote) => ({
      time: Math.floor(quote.date.getTime() / 1000),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
    }))
    .sort((a, b) => a.time - b.time);
};

const withIndicators = (candles) => {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);

  return {
    candles,
    sma5: sma(closes, 5),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    volumeMa20: sma(volumes, 20),
  };
};

const buildMarketData = async (symbols) => {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const candles = await fetchCandles(symbol);
        if (candles.length < thresholds.minHistory + 20) {
          return { symbol, error: `insufficient candles: ${candles.length}` };
        }
        return { symbol, state: withIndicators(candles) };
      } catch (error) {
        return {
          symbol,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return {
    data: Object.fromEntries(
      entries
        .filter((entry) => entry.state)
        .map((entry) => [entry.symbol, entry.state]),
    ),
    errors: entries.filter((entry) => entry.error),
  };
};

const buildDateIndex = (marketData) => {
  const byDate = new Map();

  for (const [symbol, state] of Object.entries(marketData)) {
    state.candles.forEach((candle, index) => {
      const key = dateKey(candle.time);
      const row = byDate.get(key) ?? {
        time: candle.time,
        symbols: new Map(),
      };
      row.symbols.set(symbol, index);
      byDate.set(key, row);
    });
  }

  return [...byDate.values()].toSorted((a, b) => a.time - b.time);
};

const buildRelativeStrengthRanks = (marketData) => {
  const byDate = new Map();

  for (const [symbol, state] of Object.entries(marketData)) {
    for (let index = 50; index < state.candles.length; index += 1) {
      const baseClose = state.candles[index - 50].close;
      if (!baseClose || baseClose <= 0) continue;

      const key = dateKey(state.candles[index].time);
      const rows = byDate.get(key) ?? [];
      rows.push({
        symbol,
        time: state.candles[index].time,
        return50: state.candles[index].close / baseClose - 1,
      });
      byDate.set(key, rows);
    }
  }

  const ranks = new Map(
    Object.keys(marketData).map((symbol) => [symbol, new Map()]),
  );

  for (const rows of byDate.values()) {
    rows
      .toSorted((a, b) => b.return50 - a.return50)
      .forEach((row, index) => {
        ranks.get(row.symbol)?.set(row.time, {
          rank: index + 1,
          return50: row.return50,
        });
      });
  }

  return ranks;
};

const getMarketHealth = ({ row, marketData }) => {
  let total = 0;
  let aboveSma50 = 0;
  let return50Sum = 0;
  let return50Count = 0;

  for (const [symbol, index] of row.symbols) {
    const state = marketData[symbol];
    const candle = state.candles[index];
    const sma50Value = state.sma50[index];
    total += 1;

    if (typeof sma50Value === "number" && candle.close > sma50Value) {
      aboveSma50 += 1;
    }

    const base = state.candles[index - 50]?.close;
    if (base && base > 0) {
      return50Sum += candle.close / base - 1;
      return50Count += 1;
    }
  }

  return {
    breadth: total ? aboveSma50 / total : 0,
    averageReturn50: return50Count ? return50Sum / return50Count : 0,
  };
};

const getEntrySignal = ({
  state,
  index,
  rankInfo,
  leaderCount,
  lastEntryIndex,
  marketHealth,
  strategy,
}) => {
  if (
    index < thresholds.minHistory ||
    !rankInfo ||
    rankInfo.rank > leaderCount ||
    index - lastEntryIndex < thresholds.entryCooldown ||
    marketHealth.breadth < strategy.marketBreadthMin ||
    marketHealth.averageReturn50 < strategy.marketAverageReturn50Min ||
    rankInfo.return50 < strategy.minLeaderReturn50
  ) {
    return null;
  }

  const candle = state.candles[index];
  const sma5Value = state.sma5[index];
  const sma20Value = state.sma20[index];
  const sma50Value = state.sma50[index];
  const previousSma5 = state.sma5[index - 1];
  const previousSma20 = state.sma20[index - 1];
  const volumeMa20 = state.volumeMa20[index];
  const sma20SlopeBase = state.sma20[index - thresholds.sma20SlopeLookback];
  const sma50SlopeBase = state.sma50[index - thresholds.sma50SlopeLookback];

  if (
    [
      sma5Value,
      sma20Value,
      sma50Value,
      previousSma5,
      previousSma20,
      volumeMa20,
      sma20SlopeBase,
      sma50SlopeBase,
    ].some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    return null;
  }

  const recentHigh = Math.max(
    ...state.candles
      .slice(Math.max(0, index - thresholds.breakoutLookback), index)
      .map((bar) => bar.high),
  );
  const recentLow = Math.min(
    ...state.candles
      .slice(Math.max(0, index - thresholds.structureLowLookback + 1), index + 1)
      .map((bar) => bar.low),
  );
  const volumeRatio = candle.volume / volumeMa20;
  const sma20SlopePct = sma20Value / sma20SlopeBase - 1;
  const sma50SlopePct = sma50Value / sma50SlopeBase - 1;
  const stage2Trend =
    candle.close > sma20Value &&
    sma20Value > sma50Value &&
    sma50SlopePct >= thresholds.minSma50SlopePct;
  const sma5AboveSma20 = sma5Value > sma20Value;
  const sma5CrossUp = previousSma5 <= previousSma20 && sma5AboveSma20;
  const sma20Rising = sma20SlopePct >= thresholds.minSma20SlopePct;
  const strongClose = closeLocation(candle) >= thresholds.closeStrengthThreshold;
  const continuation =
    stage2Trend &&
    sma20Rising &&
    volumeRatio >= thresholds.volumeRatioThreshold &&
    strongClose &&
    (sma5CrossUp || sma5AboveSma20);
  const breakout =
    stage2Trend &&
    sma20Rising &&
    candle.close > recentHigh &&
    volumeRatio >= thresholds.breakoutVolumeRatioThreshold;

  if (!continuation && !breakout) return null;

  const entryPrice = candle.close;
  const structureStop = Math.min(candle.low, recentLow);
  const riskCappedStop = strategy.maxStopPct
    ? entryPrice * (1 - strategy.maxStopPct)
    : structureStop;
  const initialStop = Math.max(structureStop, riskCappedStop);
  const riskPerShare = Math.max(entryPrice - initialStop, entryPrice * 0.005);

  return {
    type: breakout ? "breakout" : "continuation",
    entryPrice,
    initialStop,
    riskPerShare,
    rank: rankInfo.rank,
    return50: rankInfo.return50,
  };
};

const closePosition = ({ position, exitTime, exitPrice, reason, trades }) => {
  const exitValue = position.quantity * exitPrice * (1 - transactionCostRate);
  const grossReturn = exitValue / position.costBasis - 1;
  trades.push({
    ...position,
    exitTime,
    exitPrice,
    exitValue,
    grossReturn,
    reason,
    holdDays: Math.max(
      1,
      Math.round((exitTime - position.entryTime) / 86_400),
    ),
    success: position.maxGainPct >= thresholds.successMovePct,
  });
  return exitValue;
};

const simulatePortfolio = ({ marketName, marketData, leaderCount, strategy }) => {
  const dateRows = buildDateIndex(marketData);
  const ranks = buildRelativeStrengthRanks(marketData);
  const cashByStart = startCash;
  let cash = cashByStart;
  const positions = new Map();
  const trades = [];
  const equityCurve = [];
  const lastEntryIndexes = new Map();

  for (const row of dateRows) {
    const entryCandidates = [];
    const marketHealth = getMarketHealth({ row, marketData });

    for (const [symbol, index] of row.symbols) {
      const state = marketData[symbol];
      const candle = state.candles[index];
      const position = positions.get(symbol);

      if (position) {
        position.maxHigh = Math.max(position.maxHigh, candle.high);
        position.maxGainPct = Math.max(
          position.maxGainPct,
          position.maxHigh / position.entryPrice - 1,
        );

        const sma20Value = state.sma20[index];
        const sma50Value = state.sma50[index];
        const breakEvenStop =
          strategy.breakEvenTriggerPct &&
          position.maxGainPct >= strategy.breakEvenTriggerPct
            ? position.entryPrice
            : position.initialStop;
        const activeStop = Math.max(position.initialStop, breakEvenStop);
        const profitProtectExit =
          strategy.profitProtectExit === "sma20" &&
          strategy.profitProtectTriggerPct &&
          position.maxGainPct >= strategy.profitProtectTriggerPct &&
          typeof sma20Value === "number" &&
          candle.close < sma20Value;
        const exitSignal =
          candle.close <= activeStop ||
          profitProtectExit ||
          (typeof sma50Value === "number" && candle.close < sma50Value);
        if (exitSignal) {
          cash += closePosition({
            position,
            exitTime: candle.time,
            exitPrice: candle.close,
            reason:
              candle.close <= activeStop
                ? "stop"
                : profitProtectExit
                  ? "profit-protect"
                  : "sma50-exit",
            trades,
          });
          positions.delete(symbol);
        }
        continue;
      }

      const rankInfo = ranks.get(symbol)?.get(candle.time);
      const signal = getEntrySignal({
        state,
        index,
        rankInfo,
        leaderCount,
        lastEntryIndex: lastEntryIndexes.get(symbol) ?? -thresholds.entryCooldown,
        marketHealth,
        strategy,
      });
      if (signal) {
        entryCandidates.push({
          symbol,
          index,
          time: candle.time,
          close: candle.close,
          signal,
        });
      }
    }

    entryCandidates
      .toSorted((a, b) => a.signal.rank - b.signal.rank)
      .forEach((candidate) => {
        if (positions.size >= leaderCount || positions.has(candidate.symbol)) {
          return;
        }
        const equity = getEquity({ cash, positions, row, marketData });
        const targetValue = equity / leaderCount;
        const investValue = Math.min(cash, targetValue);
        if (investValue <= equity * 0.03) return;

        const entryCost = investValue * (1 - transactionCostRate);
        const quantity = entryCost / candidate.signal.entryPrice;
        cash -= investValue;
        positions.set(candidate.symbol, {
          symbol: candidate.symbol,
          entryTime: candidate.time,
          entryPrice: candidate.signal.entryPrice,
          initialStop: candidate.signal.initialStop,
          quantity,
          costBasis: investValue,
          entryRank: candidate.signal.rank,
          entryReturn50: candidate.signal.return50,
          signalType: candidate.signal.type,
          maxHigh: candidate.signal.entryPrice,
          maxGainPct: 0,
        });
        lastEntryIndexes.set(candidate.symbol, candidate.index);
      });

    const equity = getEquity({ cash, positions, row, marketData });
    equityCurve.push({
      time: row.time,
      equity,
      cash,
      openPositions: positions.size,
    });
  }

  const lastRow = dateRows[dateRows.length - 1];
  if (lastRow) {
    for (const [symbol, position] of positions) {
      const index = lastRow.symbols.get(symbol);
      if (index === undefined) continue;
      const candle = marketData[symbol].candles[index];
      cash += closePosition({
        position,
        exitTime: candle.time,
        exitPrice: candle.close,
        reason: "mark-to-market",
        trades,
      });
    }
    positions.clear();
  }

  return summarizePortfolio({
    marketName,
    leaderCount,
    strategyName: strategy.name,
    equityCurve,
    trades,
    buyHoldReturn: calculateEqualWeightBuyHold(marketData),
  });
};

const getEquity = ({ cash, positions, row, marketData }) => {
  let equity = cash;
  for (const [symbol, position] of positions) {
    const index = row.symbols.get(symbol);
    if (index === undefined) {
      equity += position.quantity * position.entryPrice;
      continue;
    }
    equity += position.quantity * marketData[symbol].candles[index].close;
  }
  return equity;
};

const maxDrawdown = (equityCurve) => {
  let peak = equityCurve[0]?.equity ?? startCash;
  let maxDd = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.min(maxDd, point.equity / peak - 1);
  }
  return maxDd;
};

const calculateEqualWeightBuyHold = (marketData) => {
  const returns = Object.values(marketData)
    .map((state) => {
      const first = state.candles[0];
      const last = state.candles[state.candles.length - 1];
      return first && last ? last.close / first.close - 1 : null;
    })
    .filter((value) => value !== null);

  return returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
};

const summarizePortfolio = ({
  marketName,
  leaderCount,
  strategyName,
  equityCurve,
  trades,
  buyHoldReturn,
}) => {
  const firstEquity = equityCurve[0]?.equity ?? startCash;
  const lastEquity = equityCurve[equityCurve.length - 1]?.equity ?? firstEquity;
  const totalReturn = lastEquity / firstEquity - 1;
  const elapsedYears =
    equityCurve.length > 1
      ? (equityCurve[equityCurve.length - 1].time - equityCurve[0].time) /
        31_557_600
      : years;
  const cagr = (lastEquity / firstEquity) ** (1 / Math.max(elapsedYears, 0.1)) - 1;
  const winners = trades.filter((trade) => trade.grossReturn > 0);
  const successes = trades.filter((trade) => trade.success);
  const exposure =
    equityCurve.reduce((sum, point) => sum + point.openPositions / leaderCount, 0) /
    Math.max(equityCurve.length, 1);
  const yearly = summarizeByYear(trades);
  const tradedSymbols = summarizeSymbols(trades);

  return {
    marketName,
    leaderCount,
    strategyName,
    firstDate: equityCurve[0] ? dateKey(equityCurve[0].time) : "",
    lastDate: equityCurve[equityCurve.length - 1]
      ? dateKey(equityCurve[equityCurve.length - 1].time)
      : "",
    trades: trades.length,
    winRate: trades.length ? winners.length / trades.length : 0,
    signalSuccessRate: trades.length ? successes.length / trades.length : 0,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown(equityCurve),
    buyHoldReturn,
    exposure,
    avgHoldDays:
      trades.reduce((sum, trade) => sum + trade.holdDays, 0) /
      Math.max(trades.length, 1),
    tradedSymbols,
    yearly,
  };
};

const summarizeByYear = (trades) => {
  const byYear = new Map();
  for (const trade of trades) {
    const key = yearKey(trade.exitTime);
    const row = byYear.get(key) ?? { year: key, trades: 0, wins: 0, successes: 0 };
    row.trades += 1;
    if (trade.grossReturn > 0) row.wins += 1;
    if (trade.success) row.successes += 1;
    byYear.set(key, row);
  }

  return [...byYear.values()].map((row) => ({
    year: row.year,
    trades: row.trades,
    winRate: row.trades ? row.wins / row.trades : 0,
    signalSuccessRate: row.trades ? row.successes / row.trades : 0,
  }));
};

const summarizeSymbols = (trades) => {
  const bySymbol = new Map();
  for (const trade of trades) {
    const row = bySymbol.get(trade.symbol) ?? {
      symbol: trade.symbol,
      trades: 0,
      wins: 0,
      successes: 0,
      returnSum: 0,
    };
    row.trades += 1;
    if (trade.grossReturn > 0) row.wins += 1;
    if (trade.success) row.successes += 1;
    row.returnSum += trade.grossReturn;
    bySymbol.set(trade.symbol, row);
  }

  return [...bySymbol.values()]
    .toSorted((a, b) => b.trades - a.trades || b.returnSum - a.returnSum)
    .slice(0, 8)
    .map((row) => ({
      symbol: row.symbol,
      trades: row.trades,
      winRate: row.trades ? row.wins / row.trades : 0,
      signalSuccessRate: row.trades ? row.successes / row.trades : 0,
      avgTradeReturn: row.returnSum / row.trades,
    }));
};

const printResult = (result) => {
  if (process.env.DETAIL !== "1") return;

  console.log(`\n${result.marketName.toUpperCase()} top ${result.leaderCount} / ${result.strategyName}`);
  console.table([
    {
      strategy: result.strategyName,
      period: `${result.firstDate}..${result.lastDate}`,
      trades: result.trades,
      winRate: pct(result.winRate),
      signalSuccessRate: pct(result.signalSuccessRate),
      totalReturn: pct(result.totalReturn),
      cagr: pct(result.cagr),
      maxDrawdown: pct(result.maxDrawdown),
      buyHoldReturn: pct(result.buyHoldReturn),
      exposure: pct(result.exposure),
      avgHoldDays: result.avgHoldDays.toFixed(1),
    },
  ]);
  console.table(
    result.tradedSymbols.map((row) => ({
      symbol: row.symbol,
      trades: row.trades,
      winRate: pct(row.winRate),
      signalSuccessRate: pct(row.signalSuccessRate),
      avgTradeReturn: pct(row.avgTradeReturn),
    })),
  );
  console.table(
    result.yearly.map((row) => ({
      year: row.year,
      trades: row.trades,
      winRate: pct(row.winRate),
      signalSuccessRate: pct(row.signalSuccessRate),
    })),
  );
};

const run = async () => {
  const allResults = [];

  for (const [marketName, symbols] of Object.entries(markets)) {
    console.log(`Fetching ${marketName}: ${symbols.length} symbols`);
    const { data, errors } = await buildMarketData(symbols);
    if (errors.length) {
      console.table(errors);
    }
    console.log(`Loaded ${Object.keys(data).length}/${symbols.length} symbols`);

    for (const leaderCount of leaderCounts) {
      for (const strategy of strategyVariants) {
        const result = simulatePortfolio({
          marketName,
          marketData: data,
          leaderCount,
          strategy,
        });
        allResults.push(result);
        printResult(result);
      }
    }
  }

  console.log("\nSUMMARY");
  console.table(
    allResults.map((result) => ({
      market: result.marketName,
      top: result.leaderCount,
      strategy: result.strategyName,
      trades: result.trades,
      winRate: pct(result.winRate),
      signalSuccessRate: pct(result.signalSuccessRate),
      totalReturn: pct(result.totalReturn),
      cagr: pct(result.cagr),
      maxDrawdown: pct(result.maxDrawdown),
      buyHoldReturn: pct(result.buyHoldReturn),
      exposure: pct(result.exposure),
    })),
  );
};

await run();
