import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const baskets = {
  nasdaq: ["NVDA", "GOOGL", "AAPL", "MSFT", "AMZN", "AVGO", "META", "TSLA"],
  kospi: ["005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "068270.KS"],
};

const thresholds = {
  minHistory: 20,
  trendHoldPeriod: 50,
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
};

const strategies = [
  {
    name: "v1-sma20-exit",
    requireSma50Trend: false,
    exit: "sma20",
    partialR: 2,
    partialWeight: 0.4,
  },
  {
    name: "v2-sma50-hold",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: null,
    partialWeight: 0,
  },
  {
    name: "v2-sma50-3r",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: 3,
    partialWeight: 0.25,
  },
  {
    name: "v2-sma50-trail20",
    requireSma50Trend: true,
    exit: "sma50-or-2day-sma20",
    partialR: null,
    partialWeight: 0,
  },
  {
    name: "v3-quality-stage2",
    requireSma50Trend: true,
    exit: "profit-protect-sma20-or-sma50",
    partialR: null,
    partialWeight: 0,
    minSma20SlopePct: 0.002,
    minSma50SlopePct: 0.001,
    minTrendReturn20Pct: 0.04,
    minTrendReturn50Pct: 0.08,
    minDistanceFromSma50Pct: 0.02,
    maxExtensionFromSma20Pct: 0.12,
    minRangePosition20: 0.65,
    continuationVolumeRatio: 0.9,
    breakoutVolumeRatio: 1.15,
    breakEvenTriggerPct: 0.06,
    breakEvenBufferPct: 0.005,
    maxLossPct: 0.07,
    profitProtectTriggerPct: 0.12,
  },
  {
    name: "v3-quality-stage2-tight",
    requireSma50Trend: true,
    exit: "profit-protect-sma20-or-sma50",
    partialR: null,
    partialWeight: 0,
    minSma20SlopePct: 0.003,
    minSma50SlopePct: 0.0015,
    minTrendReturn20Pct: 0.06,
    minTrendReturn50Pct: 0.12,
    minDistanceFromSma50Pct: 0.04,
    maxExtensionFromSma20Pct: 0.1,
    minRangePosition20: 0.72,
    continuationVolumeRatio: 0.95,
    breakoutVolumeRatio: 1.2,
    breakEvenTriggerPct: 0.05,
    breakEvenBufferPct: 0.003,
    maxLossPct: 0.055,
    profitProtectTriggerPct: 0.1,
  },
  {
    name: "v3-quality-breakout",
    requireSma50Trend: true,
    exit: "profit-protect-sma20-or-sma50",
    partialR: null,
    partialWeight: 0,
    breakoutOnly: true,
    minSma20SlopePct: 0.002,
    minSma50SlopePct: 0.001,
    minTrendReturn20Pct: 0.03,
    minTrendReturn50Pct: 0.08,
    minDistanceFromSma50Pct: 0.02,
    maxExtensionFromSma20Pct: 0.14,
    minRangePosition20: 0.75,
    continuationVolumeRatio: 1,
    breakoutVolumeRatio: 1.1,
    breakEvenTriggerPct: 0.05,
    breakEvenBufferPct: 0.003,
    maxLossPct: 0.06,
    profitProtectTriggerPct: 0.12,
  },
  {
    name: "v4-core-stage2",
    requireSma50Trend: true,
    requireSma100Trend: true,
    exit: "sma50-2day",
    partialR: null,
    partialWeight: 0,
    minSma20SlopePct: 0.0015,
    minSma50SlopePct: 0.001,
    minSma100SlopePct: 0,
    minTrendReturn20Pct: 0.03,
    minTrendReturn50Pct: 0.08,
    minDistanceFromSma50Pct: 0,
    maxExtensionFromSma20Pct: 0.1,
    minRangePosition20: 0.6,
    continuationVolumeRatio: 0.85,
    breakoutVolumeRatio: 1.05,
    breakEvenTriggerPct: 0.06,
    breakEvenBufferPct: 0.002,
    maxLossPct: 0.06,
  },
  {
    name: "v4-core-stage2-selective",
    requireSma50Trend: true,
    requireSma100Trend: true,
    exit: "sma50-2day",
    partialR: null,
    partialWeight: 0,
    minSma20SlopePct: 0.0025,
    minSma50SlopePct: 0.0015,
    minSma100SlopePct: 0,
    minTrendReturn20Pct: 0.05,
    minTrendReturn50Pct: 0.12,
    minDistanceFromSma50Pct: 0.02,
    maxExtensionFromSma20Pct: 0.11,
    minRangePosition20: 0.68,
    continuationVolumeRatio: 0.9,
    breakoutVolumeRatio: 1.1,
    breakEvenTriggerPct: 0.05,
    breakEvenBufferPct: 0.002,
    maxLossPct: 0.055,
  },
  {
    name: "v5-sma50-1r-third",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: 1,
    partialWeight: 0.33,
  },
  {
    name: "v5-sma50-1r-half",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: 1,
    partialWeight: 0.5,
  },
  {
    name: "v5-quality-1r-third",
    requireSma50Trend: true,
    exit: "profit-protect-sma20-or-sma50",
    partialR: 1,
    partialWeight: 0.33,
    minSma20SlopePct: 0.002,
    minSma50SlopePct: 0.001,
    minTrendReturn20Pct: 0.04,
    minTrendReturn50Pct: 0.08,
    minDistanceFromSma50Pct: 0.02,
    maxExtensionFromSma20Pct: 0.12,
    minRangePosition20: 0.65,
    continuationVolumeRatio: 0.9,
    breakoutVolumeRatio: 1.15,
    breakEvenTriggerPct: 0.06,
    breakEvenBufferPct: 0.005,
    maxLossPct: 0.07,
    profitProtectTriggerPct: 0.12,
  },
  {
    name: "v6-rs-top3-sma50",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: null,
    partialWeight: 0,
    relativeStrengthTop: 3,
  },
  {
    name: "v6-rs-top3-1r-third",
    requireSma50Trend: true,
    exit: "sma50",
    partialR: 1,
    partialWeight: 0.33,
    relativeStrengthTop: 3,
  },
];

const sma = (values, period) =>
  values.map((_, index) => {
    if (index + 1 < period) return null;
    const window = values.slice(index + 1 - period, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / period;
  });

const closeLocation = (bar) => {
  const range = bar.high - bar.low;
  return range > 0 ? (bar.close - bar.low) / range : 0.5;
};

const dateKey = (time) => new Date(time * 1000).toISOString().slice(0, 10);

const fetchCandles = async (symbol) => {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 2);
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

const runBacktest = (candles, relativeStrengthRanks = new Map()) => {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const volumeMa20 = sma(volumes, 20);
  return Object.fromEntries(
    strategies.map((strategy) => [
      strategy.name,
      runStrategyBacktest({
        candles,
        sma5,
        sma20,
        sma50,
        sma100,
        volumeMa20,
        relativeStrengthRanks,
        strategy,
      }),
    ]),
  );
};

const runStrategyBacktest = ({
  candles,
  sma5,
  sma20,
  sma50,
  sma100,
  volumeMa20,
  relativeStrengthRanks,
  strategy,
}) => {
  const trades = [];
  let invalidTrades = 0;
  let position = null;
  let lastEntryIndex = -thresholds.entryCooldown;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const relativeStrengthRank = relativeStrengthRanks.get(candle.time) ?? null;
    const sma5Value = sma5[index];
    const sma20Value = sma20[index];
    const previousSma5 = sma5[index - 1];
    const previousSma20 = sma20[index - 1];
    const slopeBase = sma20[index - thresholds.sma20SlopeLookback];
    const sma50Value = sma50[index];
    const sma50SlopeBase = sma50[index - thresholds.sma50SlopeLookback];
    const sma100Value = sma100[index];
    const sma100SlopeBase = sma100[index - 10];
    const volumeMa20Value = volumeMa20[index];
    const volumeRatio =
      volumeMa20Value && volumeMa20Value > 0 ? candle.volume / volumeMa20Value : null;
    const sma20SlopePct =
      sma20Value && slopeBase && slopeBase > 0 ? sma20Value / slopeBase - 1 : null;
    const sma50SlopePct =
      sma50Value && sma50SlopeBase && sma50SlopeBase > 0
        ? sma50Value / sma50SlopeBase - 1
        : null;
    const sma100SlopePct =
      sma100Value && sma100SlopeBase && sma100SlopeBase > 0
        ? sma100Value / sma100SlopeBase - 1
        : null;

    if (position) {
      position.maxHigh = Math.max(position.maxHigh, candle.high);
      position.maxGainPct = position.maxHigh / position.entryPrice - 1;

      if (
        strategy.partialR &&
        !position.partialTaken &&
        candle.high >= position.partialTakeProfitLevel
      ) {
        position.partialTaken = true;
        position.partialExitPrice = position.partialTakeProfitLevel;
        position.partialExitTime = candle.time;
      }

      const stopLevel =
        strategy.exit === "sma20"
          ? Math.max(position.initialStop, sma20Value ?? position.initialStop)
          : Math.max(position.initialStop, sma50Value ?? position.initialStop);
      const hardStop = Math.max(
        position.initialStop,
        strategy.maxLossPct ? position.entryPrice * (1 - strategy.maxLossPct) : position.initialStop,
        strategy.breakEvenTriggerPct &&
          position.maxGainPct >= strategy.breakEvenTriggerPct
          ? position.entryPrice * (1 + (strategy.breakEvenBufferPct ?? 0))
          : position.initialStop,
      );
      const belowSma20TwoDays =
        strategy.exit === "sma50-or-2day-sma20" &&
        sma20Value &&
        sma20[index - 1] &&
        candle.close < sma20Value &&
        candles[index - 1]?.close < sma20[index - 1];
      const profitProtectSma20 =
        strategy.exit === "profit-protect-sma20-or-sma50" &&
        strategy.profitProtectTriggerPct &&
        position.maxGainPct >= strategy.profitProtectTriggerPct &&
        sma20Value &&
        sma20[index - 1] &&
        candle.close < sma20Value &&
        candles[index - 1]?.close < sma20[index - 1];
      const slowTrendBreak =
        strategy.exit === "profit-protect-sma20-or-sma50" &&
        sma50Value &&
        sma50[index - 1] &&
        candle.close < sma50Value &&
        candles[index - 1]?.close < sma50[index - 1];
      const belowSma50TwoDays =
        strategy.exit === "sma50-2day" &&
        sma50Value &&
        sma50[index - 1] &&
        candle.close < sma50Value &&
        candles[index - 1]?.close < sma50[index - 1];
      const trendExit =
        strategy.exit === "sma20"
          ? Boolean(sma20Value && candle.close < sma20Value)
          : strategy.exit === "profit-protect-sma20-or-sma50"
            ? Boolean(profitProtectSma20) || Boolean(slowTrendBreak)
            : strategy.exit === "sma50-2day"
              ? Boolean(belowSma50TwoDays)
            : Boolean(sma50Value && candle.close < sma50Value) || Boolean(belowSma20TwoDays);
      if (candle.close <= hardStop || trendExit) {
        const finalExitPrice = candle.close;
        const partialWeight = position.partialTaken ? strategy.partialWeight : 0;
        const finalWeight = 1 - partialWeight;
        const partialExitPrice =
          position.partialExitPrice ?? position.partialTakeProfitLevel;
        const grossReturn =
          partialWeight * (partialExitPrice / position.entryPrice - 1) +
          finalWeight * (finalExitPrice / position.entryPrice - 1);
        if (Number.isFinite(grossReturn)) {
          trades.push({
            entryTime: position.entryTime,
            exitTime: candle.time,
            entryPrice: position.entryPrice,
            exitPrice: finalExitPrice,
            stopLevel: Math.max(stopLevel, hardStop),
            grossReturn,
            partialTaken: position.partialTaken,
            holdBars: index - position.entryIndex + 1,
            maxGainPct: position.maxGainPct,
          });
        } else {
          invalidTrades += 1;
        }
        position = null;
      }
      continue;
    }

    if (
      index < thresholds.minHistory ||
      !sma5Value ||
      !sma20Value ||
      !previousSma5 ||
      !previousSma20 ||
      !sma20SlopePct ||
      !volumeRatio
    ) {
      continue;
    }

    if (
      strategy.relativeStrengthTop &&
      (!relativeStrengthRank || relativeStrengthRank > strategy.relativeStrengthTop)
    ) {
      continue;
    }

    const recentHigh = Math.max(
      ...candles.slice(Math.max(0, index - thresholds.breakoutLookback), index).map((bar) => bar.high),
    );
    const recentLow20 = Math.min(
      ...candles.slice(Math.max(0, index - thresholds.breakoutLookback), index).map((bar) => bar.low),
    );
    const recentLow = Math.min(
      ...candles.slice(Math.max(0, index - thresholds.structureLowLookback + 1), index + 1).map((bar) => bar.low),
    );
    const return20 =
      candles[index - 20]?.close && candles[index - 20].close > 0
        ? candle.close / candles[index - 20].close - 1
        : null;
    const return50 =
      candles[index - 50]?.close && candles[index - 50].close > 0
        ? candle.close / candles[index - 50].close - 1
        : null;
    const rangePosition20 =
      recentHigh > recentLow20
        ? (candle.close - recentLow20) / (recentHigh - recentLow20)
        : 0.5;
    const priceAboveSma20 = candle.close > sma20Value;
    const sma5AboveSma20 = sma5Value > sma20Value;
    const sma5CrossUp = previousSma5 <= previousSma20 && sma5AboveSma20;
    const sma20Rising = sma20SlopePct >= thresholds.minSma20SlopePct;
    const strategySma20Rising =
      sma20SlopePct >= (strategy.minSma20SlopePct ?? thresholds.minSma20SlopePct);
    const strategySma50TrendOk =
      !strategy.requireSma50Trend ||
      (sma50Value &&
        sma50SlopePct !== null &&
        candle.close > sma50Value &&
        sma20Value > sma50Value &&
        sma50SlopePct >= (strategy.minSma50SlopePct ?? thresholds.minSma50SlopePct));
    const strategySma100TrendOk =
      !strategy.requireSma100Trend ||
      (sma100Value &&
        sma100SlopePct !== null &&
        sma50Value &&
        candle.close > sma100Value &&
        sma20Value > sma50Value &&
        sma50Value > sma100Value &&
        sma100SlopePct >= (strategy.minSma100SlopePct ?? 0));
    const trendReturnOk =
      (return20 === null || return20 >= (strategy.minTrendReturn20Pct ?? -Infinity)) &&
      (return50 === null || return50 >= (strategy.minTrendReturn50Pct ?? -Infinity));
    const distanceFromSma50Ok =
      !sma50Value ||
      candle.close / sma50Value - 1 >= (strategy.minDistanceFromSma50Pct ?? -Infinity);
    const extensionFromSma20Ok =
      candle.close / sma20Value - 1 <= (strategy.maxExtensionFromSma20Pct ?? Infinity);
    const rangePositionOk =
      rangePosition20 >= (strategy.minRangePosition20 ?? -Infinity);
    const qualityOk =
      strategySma50TrendOk &&
      strategySma100TrendOk &&
      strategySma20Rising &&
      trendReturnOk &&
      distanceFromSma50Ok &&
      extensionFromSma20Ok &&
      rangePositionOk;
    const volumeConfirmed =
      volumeRatio >= (strategy.continuationVolumeRatio ?? thresholds.volumeRatioThreshold);
    const breakoutVolumeConfirmed =
      volumeRatio >= (strategy.breakoutVolumeRatio ?? thresholds.breakoutVolumeRatioThreshold);
    const strongClose = closeLocation(candle) >= thresholds.closeStrengthThreshold;
    const breakout =
      candle.close > recentHigh &&
      (strategy.breakoutOnly ? qualityOk : sma20Rising && qualityOk) &&
      breakoutVolumeConfirmed;
    const continuation =
      !strategy.breakoutOnly &&
      priceAboveSma20 &&
      strategySma50TrendOk &&
      strategySma20Rising &&
      qualityOk &&
      volumeConfirmed &&
      strongClose &&
      (sma5CrossUp || sma5AboveSma20);
    const pullbackContinuation =
      !strategy.breakoutOnly &&
      strategy.requireSma50Trend &&
      priceAboveSma20 &&
      strategySma50TrendOk &&
      strategySma20Rising &&
      qualityOk &&
      sma5AboveSma20 &&
      volumeRatio >= 0.85 &&
      candle.close > candle.open &&
      strongClose;

    if ((breakout || continuation || pullbackContinuation) && index - lastEntryIndex >= thresholds.entryCooldown) {
      const entryPrice = candle.close;
      const initialStop = Math.min(candle.low, recentLow);
      const riskPerShare = Math.max(entryPrice - initialStop, entryPrice * 0.005);
      const partialTakeProfitLevel = entryPrice + riskPerShare * (strategy.partialR ?? 999);
      if (
        [entryPrice, initialStop, riskPerShare, partialTakeProfitLevel].every(Number.isFinite)
      ) {
        position = {
          entryIndex: index,
          entryTime: candle.time,
          entryPrice,
          initialStop,
          partialTakeProfitLevel,
          partialTaken: false,
          maxHigh: candle.high,
          maxGainPct: candle.high / entryPrice - 1,
        };
        lastEntryIndex = index;
      } else {
        invalidTrades += 1;
      }
    }
  }

  if (position) {
    const last = candles[candles.length - 1];
    const grossReturn = last.close / position.entryPrice - 1;
    if (Number.isFinite(grossReturn)) {
      trades.push({
        entryTime: position.entryTime,
        exitTime: last.time,
        entryPrice: position.entryPrice,
        exitPrice: last.close,
        stopLevel: position.initialStop,
        grossReturn,
        partialTaken: position.partialTaken,
        holdBars: candles.length - position.entryIndex,
        maxGainPct: position.maxGainPct,
        openAtEnd: true,
      });
    } else {
      invalidTrades += 1;
    }
  }

  return { trades, invalidTrades };
};

const summarize = (symbol, candles, backtest, strategyName) => {
  const { trades, invalidTrades } = backtest;
  const completed = trades.filter((trade) => !trade.openAtEnd);
  const wins = completed.filter((trade) => trade.grossReturn > 0);
  const markedWins = trades.filter((trade) => trade.grossReturn > 0);
  const signalSuccesses = trades.filter(
    (trade) => trade.maxGainPct !== undefined && trade.maxGainPct >= 0.05,
  );
  const totalReturn = trades.reduce(
    (equity, trade) => equity * (1 + trade.grossReturn),
    1,
  ) - 1;
  const buyHold =
    candles.length > 1 ? candles[candles.length - 1].close / candles[0].close - 1 : 0;
  const avgReturn =
    completed.length > 0
      ? completed.reduce((sum, trade) => sum + trade.grossReturn, 0) / completed.length
      : 0;
  const avgHold =
    completed.length > 0
      ? completed.reduce((sum, trade) => sum + trade.holdBars, 0) / completed.length
      : 0;

  return {
    symbol,
    strategy: strategyName,
    candles: candles.length,
    trades: trades.length,
    completedTrades: completed.length,
    winRate: completed.length ? wins.length / completed.length : 0,
    markedWinRate: trades.length ? markedWins.length / trades.length : 0,
    signalSuccessRate: trades.length ? signalSuccesses.length / trades.length : 0,
    avgReturn,
    totalReturn,
    buyHold,
    avgHoldBars: avgHold,
    openTrade: trades.some((trade) => trade.openAtEnd),
    invalidTrades,
  };
};

const buildRelativeStrengthRanks = (marketCandles) => {
  const dailyReturns = new Map();

  for (const [symbol, candles] of Object.entries(marketCandles)) {
    for (let index = 50; index < candles.length; index += 1) {
      const baseClose = candles[index - 50].close;
      if (!baseClose || baseClose <= 0) continue;

      const key = dateKey(candles[index].time);
      const rows = dailyReturns.get(key) ?? [];
      rows.push({
        symbol,
        time: candles[index].time,
        return50: candles[index].close / baseClose - 1,
      });
      dailyReturns.set(key, rows);
    }
  }

  const ranks = new Map(
    Object.keys(marketCandles).map((symbol) => [symbol, new Map()]),
  );

  for (const rows of dailyReturns.values()) {
    rows
      .toSorted((a, b) => b.return50 - a.return50)
      .forEach((row, index) => {
        ranks.get(row.symbol)?.set(row.time, index + 1);
      });
  }

  return ranks;
};

const run = async () => {
  const results = [];
  for (const [market, symbols] of Object.entries(baskets)) {
    const marketCandles = {};
    for (const symbol of symbols) {
      try {
        marketCandles[symbol] = await fetchCandles(symbol);
      } catch (error) {
        results.push({
          market,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const relativeStrengthRanks = buildRelativeStrengthRanks(marketCandles);
    for (const [symbol, candles] of Object.entries(marketCandles)) {
      try {
        const backtests = runBacktest(candles, relativeStrengthRanks.get(symbol));
        for (const [strategyName, backtest] of Object.entries(backtests)) {
          results.push({ market, ...summarize(symbol, candles, backtest, strategyName) });
        }
      } catch (error) {
        results.push({
          market,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const strategySummaries = strategies.map((strategy) => {
    const strategyRows = results.filter((result) => result.strategy === strategy.name);
    const completedTrades = strategyRows.reduce(
      (sum, result) => sum + (result.completedTrades ?? 0),
      0,
    );
    const wins = strategyRows.reduce(
      (sum, result) =>
        sum + Math.round((result.winRate ?? 0) * (result.completedTrades ?? 0)),
      0,
    );
    const avgStrategyReturn =
      strategyRows.reduce((sum, result) => sum + (result.totalReturn ?? 0), 0) /
      Math.max(strategyRows.length, 1);
    const avgBuyHold =
      strategyRows.reduce((sum, result) => sum + (result.buyHold ?? 0), 0) /
      Math.max(strategyRows.length, 1);
    return {
      strategy: strategy.name,
      symbols: strategyRows.length,
      trades: strategyRows.reduce((sum, result) => sum + (result.trades ?? 0), 0),
      winRate: completedTrades ? wins / completedTrades : 0,
      markedWinRate:
        strategyRows.reduce(
          (sum, result) =>
            sum + Math.round((result.markedWinRate ?? 0) * (result.trades ?? 0)),
          0,
        ) / Math.max(strategyRows.reduce((sum, result) => sum + (result.trades ?? 0), 0), 1),
      signalSuccessRate:
        strategyRows.reduce(
          (sum, result) =>
            sum +
            Math.round((result.signalSuccessRate ?? 0) * (result.trades ?? 0)),
          0,
        ) / Math.max(strategyRows.reduce((sum, result) => sum + (result.trades ?? 0), 0), 1),
      avgStrategyReturn,
      avgBuyHold,
    };
  });

  console.table(
    strategySummaries.map((result) => ({
      strategy: result.strategy,
      symbols: result.symbols,
      trades: result.trades,
      winRate: pct(result.winRate),
      markedWinRate: pct(result.markedWinRate),
      signalSuccessRate: pct(result.signalSuccessRate),
      avgStrategyReturn: pct(result.avgStrategyReturn),
      avgBuyHold: pct(result.avgBuyHold),
    })),
  );

  if (process.env.DETAIL === "1") {
    const rows = results.map((result) => ({
      market: result.market,
      symbol: result.symbol,
      strategy: result.strategy,
      trades: result.trades ?? "-",
      winRate: result.winRate === undefined ? "-" : pct(result.winRate),
      markedWinRate:
        result.markedWinRate === undefined ? "-" : pct(result.markedWinRate),
      signalSuccessRate:
        result.signalSuccessRate === undefined ? "-" : pct(result.signalSuccessRate),
      avgReturn: result.avgReturn === undefined ? "-" : pct(result.avgReturn),
      strategyReturn: result.totalReturn === undefined ? "-" : pct(result.totalReturn),
      buyHold: result.buyHold === undefined ? "-" : pct(result.buyHold),
      avgHoldBars:
        result.avgHoldBars === undefined ? "-" : result.avgHoldBars.toFixed(1),
      openTrade: result.openTrade ? "yes" : "",
      invalidTrades: result.invalidTrades ?? "-",
      error: result.error ?? "",
    }));

    console.table(rows);
  }
};

await run();
