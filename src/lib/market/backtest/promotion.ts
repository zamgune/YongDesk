import type {
  PromotionEvaluation,
  PromotionInputs,
  PromotionThresholds,
  StockBacktestHorizon,
  StockBacktestTrade,
} from "./types.ts";
import { applyHolmBonferroni, blockBootstrapAverageR95 } from "./statistics.ts";
import type {
  BlockBootstrapAverageRResult,
  HolmBonferroniResult,
  HolmComparisonInput,
} from "./statistics.ts";
import { utcYearFromUnixSeconds } from "./time.ts";

const SAMPLE_THRESHOLDS: Record<
  StockBacktestHorizon,
  Pick<PromotionThresholds, "minimumOosTrades" | "minimumHoldoutTrades">
> = {
  intraday: { minimumOosTrades: 200, minimumHoldoutTrades: 40 },
  "short-hold": { minimumOosTrades: 120, minimumHoldoutTrades: 30 },
  swing: { minimumOosTrades: 80, minimumHoldoutTrades: 20 },
};

export const promotionThresholdsFor = (
  horizon: StockBacktestHorizon,
  overrides: Partial<PromotionThresholds> = {},
): PromotionThresholds => ({
  ...SAMPLE_THRESHOLDS[horizon],
  minimumAverageRLower95: 0,
  minimumBaseProfitFactor: 1.15,
  minimumStressProfitFactor: 1,
  minimumPositiveFoldRatio: 0.7,
  maximumSymbolContribution: 0.3,
  maximumYearContribution: 0.3,
  maximumDrawdownVsBaseline: 0,
  ...overrides,
});

const profitFactor = (trades: StockBacktestTrade[]) => {
  const gains = trades.reduce(
    (sum, trade) => sum + Math.max(trade.netPnl, 0),
    0,
  );
  const losses = Math.abs(
    trades.reduce((sum, trade) => sum + Math.min(trade.netPnl, 0), 0),
  );
  return losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null;
};

const maximumPositiveContribution = (
  trades: StockBacktestTrade[],
  keyFor: (trade: StockBacktestTrade) => string,
) => {
  const grouped = new Map<string, number>();
  for (const trade of trades) {
    grouped.set(keyFor(trade), (grouped.get(keyFor(trade)) ?? 0) + trade.netPnl);
  }
  const totalNetProfit = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  if (totalNetProfit <= 0) {
    return 1;
  }
  return Math.max(0, ...grouped.values()) / totalNetProfit;
};

const topOnePercentRemovedAverageR = (trades: StockBacktestTrade[]) => {
  if (trades.length === 0) {
    return null;
  }
  const removeCount = Math.max(1, Math.ceil(trades.length * 0.01));
  const remaining = trades
    .toSorted((left, right) => right.netPnl - left.netPnl)
    .slice(removeCount);
  if (remaining.length === 0) {
    return null;
  }
  return remaining.reduce((sum, trade) => sum + trade.rMultiple, 0) / remaining.length;
};

export const evaluatePromotion = (inputs: PromotionInputs): PromotionEvaluation => {
  const thresholds = promotionThresholdsFor(inputs.horizon, inputs.thresholds);
  const baseProfitFactor = profitFactor(inputs.oosTrades);
  const stressProfitFactor = profitFactor(inputs.stressTrades);
  const positiveFoldRatio =
    inputs.foldNetReturns.length > 0
      ? inputs.foldNetReturns.filter((value) => value > 0).length /
        inputs.foldNetReturns.length
      : 0;
  const strippedAverageR = topOnePercentRemovedAverageR(inputs.oosTrades);
  const symbolContribution = maximumPositiveContribution(
    inputs.oosTrades,
    (trade) => trade.symbol,
  );
  const yearContribution = maximumPositiveContribution(
    inputs.oosTrades,
    (trade) => String(utcYearFromUnixSeconds(trade.exitTime)),
  );
  const drawdownDelta = Math.abs(inputs.maxDrawdown) - Math.abs(inputs.baselineMaxDrawdown);

  const checks: PromotionEvaluation["checks"] = [
    {
      id: "oos-sample",
      passed: inputs.oosTrades.length >= thresholds.minimumOosTrades,
      actual: inputs.oosTrades.length,
      required: thresholds.minimumOosTrades,
    },
    {
      id: "holdout-sample",
      passed: inputs.holdoutTrades.length >= thresholds.minimumHoldoutTrades,
      actual: inputs.holdoutTrades.length,
      required: thresholds.minimumHoldoutTrades,
    },
    {
      id: "average-r-ci",
      passed:
        inputs.averageRLower95 !== null &&
        inputs.averageRLower95 > thresholds.minimumAverageRLower95,
      actual: inputs.averageRLower95,
      required: thresholds.minimumAverageRLower95,
    },
    {
      id: "base-profit-factor",
      passed:
        baseProfitFactor !== null &&
        baseProfitFactor >= thresholds.minimumBaseProfitFactor,
      actual: baseProfitFactor,
      required: thresholds.minimumBaseProfitFactor,
    },
    {
      id: "stress-profit-factor",
      passed:
        stressProfitFactor !== null &&
        stressProfitFactor >= thresholds.minimumStressProfitFactor,
      actual: stressProfitFactor,
      required: thresholds.minimumStressProfitFactor,
    },
    {
      id: "positive-fold-ratio",
      passed: positiveFoldRatio >= thresholds.minimumPositiveFoldRatio,
      actual: positiveFoldRatio,
      required: thresholds.minimumPositiveFoldRatio,
    },
    {
      id: "top-one-percent",
      passed: strippedAverageR !== null && strippedAverageR > 0,
      actual: strippedAverageR,
      required: 0,
    },
    {
      id: "symbol-concentration",
      passed: symbolContribution <= thresholds.maximumSymbolContribution,
      actual: symbolContribution,
      required: thresholds.maximumSymbolContribution,
    },
    {
      id: "year-concentration",
      passed: yearContribution <= thresholds.maximumYearContribution,
      actual: yearContribution,
      required: thresholds.maximumYearContribution,
    },
    {
      id: "drawdown",
      passed: drawdownDelta <= thresholds.maximumDrawdownVsBaseline,
      actual: drawdownDelta,
      required: thresholds.maximumDrawdownVsBaseline,
    },
    {
      id: "point-in-time-universe",
      passed: inputs.pointInTimeUniverse,
      actual: inputs.pointInTimeUniverse,
      required: true,
    },
    {
      id: "delistings",
      passed: inputs.delistingsIncluded,
      actual: inputs.delistingsIncluded,
      required: true,
    },
    {
      id: "holm-adjustment",
      passed: inputs.holmAdjustedPassed,
      actual: inputs.holmAdjustedPassed,
      required: true,
    },
  ];
  const blockers = checks.filter((check) => !check.passed).map((check) => check.id);
  const minimumUsableSample = 30;

  return {
    status:
      blockers.length === 0
        ? "calibrated"
        : inputs.oosTrades.length >= minimumUsableSample
          ? "provisional"
          : "insufficient-data",
    checks,
    metrics: {
      oosTrades: inputs.oosTrades.length,
      holdoutTrades: inputs.holdoutTrades.length,
      averageRLower95: inputs.averageRLower95,
      baseProfitFactor,
      stressProfitFactor,
      positiveFoldRatio,
      topOnePercentRemovedAverageR: strippedAverageR,
      maximumSymbolContribution: symbolContribution,
      maximumYearContribution: yearContribution,
      maxDrawdown: inputs.maxDrawdown,
      baselineMaxDrawdown: inputs.baselineMaxDrawdown,
    },
    thresholds,
    blockers,
  };
};

export type StatisticalPromotionInputs = Omit<
  PromotionInputs,
  "averageRLower95" | "holmAdjustedPassed"
> & {
  bootstrap: {
    blockSize: number;
    samples?: number;
    seed?: number;
  };
  candidatePValues: HolmComparisonInput[];
  selectedCandidateId: string;
  holmAlpha?: number;
};

export type StatisticalPromotionEvaluation = {
  evaluation: PromotionEvaluation;
  bootstrap: BlockBootstrapAverageRResult | null;
  holm: HolmBonferroniResult;
};

export const evaluatePromotionWithStatistics = (
  inputs: StatisticalPromotionInputs,
): StatisticalPromotionEvaluation => {
  const orderedOosTrades = inputs.oosTrades.toSorted((left, right) =>
    left.exitTime !== right.exitTime
      ? left.exitTime - right.exitTime
      : left.symbol !== right.symbol
        ? left.symbol.localeCompare(right.symbol)
        : left.signalId.localeCompare(right.signalId),
  );
  const bootstrap =
    orderedOosTrades.length > 0
      ? blockBootstrapAverageR95({
          values: orderedOosTrades.map((trade) => trade.rMultiple),
          ...inputs.bootstrap,
        })
      : null;
  const holm = applyHolmBonferroni({
    comparisons: inputs.candidatePValues,
    alpha: inputs.holmAlpha,
  });
  const selected = holm.comparisons.find(
    (comparison) => comparison.id === inputs.selectedCandidateId,
  );
  if (!selected) {
    throw new Error("selectedCandidateId must appear in candidatePValues.");
  }
  return {
    evaluation: evaluatePromotion({
      horizon: inputs.horizon,
      oosTrades: orderedOosTrades,
      holdoutTrades: inputs.holdoutTrades,
      stressTrades: inputs.stressTrades,
      averageRLower95: bootstrap?.lower95 ?? null,
      foldNetReturns: inputs.foldNetReturns,
      maxDrawdown: inputs.maxDrawdown,
      baselineMaxDrawdown: inputs.baselineMaxDrawdown,
      pointInTimeUniverse: inputs.pointInTimeUniverse,
      delistingsIncluded: inputs.delistingsIncluded,
      holmAdjustedPassed: selected.rejected,
      thresholds: inputs.thresholds,
    }),
    bootstrap,
    holm,
  };
};
