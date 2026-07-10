import { runCryptoBacktest } from "./backtest.mts";
import {
  calculateCryptoFeatures,
  calculateLowerTfConfirmations,
} from "./features.mts";
import { fetchBinanceBars, normalizeCryptoSymbol } from "./provider.mts";
import { generateCryptoSignals } from "./signals.mts";
import {
  COST_CONFIGS,
  DEFAULT_BACKTEST_CONFIG,
  type BacktestSummary,
  type SymbolBacktestResult,
  type CostScenario,
  type CryptoExecutionMode,
  type CryptoFeatureRow,
  type CryptoInterval,
  type CryptoParentTimeframe,
  type SellWarningEvent,
  type SignalSide,
  type TradeDirection,
} from "./types.mts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PARENT_TIMEFRAME_REQUIREMENTS: Record<
  CryptoParentTimeframe,
  {
    warmupMs: number;
    primary: CryptoInterval;
    secondary: CryptoInterval;
  }
> = {
  "1d": {
    warmupMs: 180 * DAY_MS,
    primary: "4h",
    secondary: "1h",
  },
  "4h": {
    warmupMs: 60 * DAY_MS,
    primary: "1h",
    secondary: "30m",
  },
};

const reindexFeatureRows = (rows: CryptoFeatureRow[]) =>
  rows.map((row, index) => ({
    ...row,
    index,
  }));

const sideToDirection = (side: SignalSide): TradeDirection =>
  side === "buy" ? "long" : "short";

const createEmptyBacktestResult = ({
  symbol,
  side,
  timeframe,
  mode,
  costScenario,
}: {
  symbol: string;
  side: SignalSide;
  timeframe: CryptoParentTimeframe;
  mode: CryptoExecutionMode;
  costScenario: CostScenario;
}): SymbolBacktestResult => {
  const summary: BacktestSummary = {
    symbol,
    side,
    direction: side === "buy" ? "long" : "short",
    timeframe,
    mode,
    costScenario,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    endingEquity: DEFAULT_BACKTEST_CONFIG.startingEquity,
    totalReturn: 0,
    maxDrawdown: 0,
    profitFactor: null,
    expectancy: 0,
    averageHoldBars: 0,
    averageWin: null,
    averageLoss: null,
    averageRMultiple: null,
  };

  return {
    summary,
    trades: [],
    signals: [],
    equityCurve: [],
    skippedSignals: 0,
  };
};

export const buildSellWarningEvents = (
  featureRows: CryptoFeatureRow[],
): SellWarningEvent[] => {
  const events: SellWarningEvent[] = [];
  let previousLevel = 0;

  for (const row of featureRows) {
    const currentLevel = row.sellWarningLevel ?? 0;
    if (currentLevel > previousLevel) {
      events.push({
        time: row.bar.time,
        level: currentLevel as 1 | 2 | 3,
        reasons: row.sellWarningReasons,
      });
    }
    previousLevel = currentLevel;
  }

  return events;
};

export const buildCryptoBacktestDataset = async ({
  symbol,
  side,
  timeframe,
  startTimeMs,
  endTimeMs,
}: {
  symbol: string;
  side: SignalSide;
  timeframe: CryptoParentTimeframe;
  startTimeMs: number;
  endTimeMs: number;
}) => {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);
  const timeframeRequirement = PARENT_TIMEFRAME_REQUIREMENTS[timeframe];
  const warmupStartMs = startTimeMs - timeframeRequirement.warmupMs;
  const [parentBars, primaryLowerBars, secondaryLowerBars] = await Promise.all([
    fetchBinanceBars({
      symbol: normalizedSymbol,
      interval: timeframe,
      startTimeMs: warmupStartMs,
      endTimeMs,
    }),
    fetchBinanceBars({
      symbol: normalizedSymbol,
      interval: timeframeRequirement.primary,
      startTimeMs: warmupStartMs,
      endTimeMs,
    }),
    fetchBinanceBars({
      symbol: normalizedSymbol,
      interval: timeframeRequirement.secondary,
      startTimeMs: warmupStartMs,
      endTimeMs,
    }),
  ]);

  const primaryLowerTfConfirmations = calculateLowerTfConfirmations({
    parentBars,
    childBars: primaryLowerBars,
    interval: timeframeRequirement.primary,
    required: true,
    direction: sideToDirection(side),
  });
  const secondaryLowerTfConfirmations = calculateLowerTfConfirmations({
    parentBars,
    childBars: secondaryLowerBars,
    interval: timeframeRequirement.secondary,
    required: false,
    direction: sideToDirection(side),
  });

  const featureRows = calculateCryptoFeatures({
    bars: parentBars,
    side,
    parentTimeframe: timeframe,
    config: DEFAULT_BACKTEST_CONFIG,
    primaryLowerTfConfirmations,
    secondaryLowerTfConfirmations,
  });

  const firstVisibleIndex = Math.max(
    0,
    parentBars.findIndex((bar) => bar.closeTime * 1000 >= startTimeMs),
  );
  const visibleBars = parentBars.slice(firstVisibleIndex);
  const visibleFeatures = reindexFeatureRows(featureRows.slice(firstVisibleIndex));
  const signalsByMode =
    side === "buy"
      ? generateCryptoSignals({
          symbol: normalizedSymbol,
          side,
          featureRows: visibleFeatures,
        }).signalsByMode
      : {
          A: [],
          B: [],
        };

  return {
    symbol: normalizedSymbol,
    side,
    timeframe,
    bars: visibleBars,
    features: visibleFeatures,
    signalsByMode,
  };
};

export const runCryptoBacktestForSymbol = async ({
  symbol,
  side,
  timeframe,
  startTimeMs,
  endTimeMs,
  mode,
  costScenario,
}: {
  symbol: string;
  side: SignalSide;
  timeframe: CryptoParentTimeframe;
  startTimeMs: number;
  endTimeMs: number;
  mode: CryptoExecutionMode;
  costScenario: CostScenario;
}) => {
  const dataset = await buildCryptoBacktestDataset({
    symbol,
    side,
    timeframe,
    startTimeMs,
    endTimeMs,
  });

  return {
    ...dataset,
    result:
      side === "buy"
        ? runCryptoBacktest({
            symbol: dataset.symbol,
            side: dataset.side,
            timeframe: dataset.timeframe,
            mode,
            bars: dataset.bars,
            signals: dataset.signalsByMode[mode],
            cost: COST_CONFIGS[costScenario],
            config: DEFAULT_BACKTEST_CONFIG,
          })
        : createEmptyBacktestResult({
            symbol: dataset.symbol,
            side: dataset.side,
            timeframe: dataset.timeframe,
            mode,
            costScenario,
          }),
  };
};
