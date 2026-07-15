import { CALIBRATION_POLICIES, validateDatasetForCalibration } from "./policy.ts";
import { evaluatePromotionWithStatistics } from "./promotion.ts";
import { sha256Hex, stableSerialize } from "./identity.ts";
import { runStockBacktest } from "./engine.ts";
import { isUnixSeconds } from "./time.ts";
import type { HolmComparisonInput } from "./statistics.ts";
import type {
  PromotionEvaluation,
  StockBacktestConfig,
  StockBacktestDataset,
  StockBacktestHorizon,
  StockBacktestResult,
  StockBacktestSignal,
  StockBacktestTrade,
  StockMarket,
  UnixSeconds,
} from "./types.ts";

export type StockEvidenceDatasetReference = {
  datasetId: string;
  barContentChecksum: string;
  canonicalChecksum: string;
  fileChecksum: string;
  relativePath: string;
};

export type StockEvidenceConfigReference = {
  configId: string;
  canonicalChecksum: string;
  fileChecksum: string;
  relativePath: string;
};

export type StockEvidenceSignalsReference = {
  canonicalChecksum: string;
  fileChecksum: string;
  relativePath: string;
};

export type StockWalkForwardFoldEvidence = {
  id: string;
  startTime: UnixSeconds;
  endTime: UnixSeconds;
};

export type StockPromotionEvidenceSpec = {
  schemaVersion: 2;
  playbookId: string;
  horizon: StockBacktestHorizon;
  market: StockMarket;
  candidateCount: number;
  holdoutStartTime: UnixSeconds;
  walkForwardFolds: StockWalkForwardFoldEvidence[];
  baselineMaxDrawdown: number;
  bootstrap: {
    blockSize: number;
    samples: number;
    seed: number;
  };
  candidatePValues: HolmComparisonInput[];
  selectedCandidateId: string;
  holmAlpha: number;
  reviewerInputSources: {
    baselineMaxDrawdown: string;
    candidatePValues: string;
  };
};

export type StockPromotionEvidenceSummary = {
  status: PromotionEvaluation["status"];
  sampleSize: number;
  holdoutSampleSize: number;
  targetBeforeStopRate: number | null;
  averageNetR: number | null;
  confidence95: {
    lower: number | null;
    upper: number | null;
  };
  validationStartTime: UnixSeconds | null;
  validationEndTime: UnixSeconds | null;
  costModel: string;
  foldNetReturns: number[];
  evaluation: PromotionEvaluation;
  bootstrap: {
    sampleSize: number;
    blockSize: number;
    samples: number;
    seed: number;
    mean: number;
    lower95: number;
    upper95: number;
  } | null;
  holm: {
    alpha: number;
    comparisons: Array<{
      id: string;
      pValue: number;
      rank: number;
      threshold: number;
      rejected: boolean;
    }>;
    rejectedIds: string[];
  };
};

export type StockPromotionEvidenceArtifactPayload = {
  schemaVersion: 2;
  kind: "stock-promotion-evidence";
  spec: StockPromotionEvidenceSpec;
  dataset: StockEvidenceDatasetReference;
  configs: {
    base: StockEvidenceConfigReference;
    stress: StockEvidenceConfigReference;
  };
  signals: StockEvidenceSignalsReference;
  results: {
    base: StockBacktestResult[];
    stress: StockBacktestResult[];
  };
  summary: StockPromotionEvidenceSummary;
};

export type StockPromotionEvidenceArtifact = StockPromotionEvidenceArtifactPayload & {
  artifactId: string;
  artifactChecksum: string;
};

export type StockPromotionEvidenceBuildInput = {
  spec: StockPromotionEvidenceSpec;
  dataset: StockBacktestDataset;
  baseConfig: StockBacktestConfig;
  stressConfig: StockBacktestConfig;
  signals: StockBacktestSignal[];
  references: {
    dataset: StockEvidenceDatasetReference;
    configs: {
      base: StockEvidenceConfigReference;
      stress: StockEvidenceConfigReference;
    };
    signals: StockEvidenceSignalsReference;
  };
  results: {
    base: StockBacktestResult[];
    stress: StockBacktestResult[];
  };
};

const exactNumber = (left: number | null, right: number | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= 1e-12);

const resultDrawdown = (
  result: StockBacktestResult,
  startingEquity: number,
) => {
  let peak = startingEquity;
  let maxDrawdown = 0;
  for (const point of result.equityCurve) {
    if (!Number.isFinite(point.equity) || point.equity <= 0) {
      throw new Error("Backtest evidence contains an invalid equity curve.");
    }
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, (point.equity - peak) / peak);
  }
  return maxDrawdown;
};

const profitFactor = (trades: StockBacktestTrade[]) => {
  const wins = trades.reduce((sum, trade) => sum + Math.max(trade.netPnl, 0), 0);
  const losses = Math.abs(
    trades.reduce((sum, trade) => sum + Math.min(trade.netPnl, 0), 0),
  );
  return losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : null;
};

const validateResultBundle = ({
  results,
  dataset,
  config,
}: {
  results: StockBacktestResult[];
  dataset: StockBacktestDataset;
  config: StockBacktestConfig;
}) => {
  const expectedSymbols = dataset.manifest.symbols.toSorted();
  const actualSymbols = results.map((result) => result.summary.symbol).toSorted();
  if (
    new Set(actualSymbols).size !== actualSymbols.length ||
    stableSerialize(actualSymbols) !== stableSerialize(expectedSymbols)
  ) {
    throw new Error("Backtest evidence must contain exactly one result per dataset symbol.");
  }

  for (const result of results) {
    const { summary, trades, equityCurve } = result;
    if (
      summary.datasetId !== dataset.manifest.datasetId ||
      summary.configId !== config.configId ||
      trades.some(
        (trade) =>
          trade.symbol !== summary.symbol ||
          trade.playbookId !== config.playbookId ||
          !Number.isFinite(trade.netPnl) ||
          !Number.isFinite(trade.rMultiple),
      )
    ) {
      throw new Error("Backtest evidence result identity does not match its dataset/config.");
    }
    const wins = trades.filter((trade) => trade.netPnl > 0);
    const losses = trades.filter((trade) => trade.netPnl <= 0);
    const endingEquity = equityCurve.at(-1)?.equity ?? config.startingEquity;
    const expectedProfitFactor = profitFactor(trades);
    const expectedAveragePnl = trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length
      : 0;
    const expectedAverageR = trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
      : null;
    const expectedAverageHold = trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.holdBars, 0) / trades.length
      : 0;
    if (
      summary.trades !== trades.length ||
      summary.wins !== wins.length ||
      summary.losses !== losses.length ||
      !exactNumber(summary.winRate, trades.length > 0 ? wins.length / trades.length : 0) ||
      !exactNumber(summary.endingEquity, endingEquity) ||
      !exactNumber(
        summary.totalReturn,
        (endingEquity - config.startingEquity) / config.startingEquity,
      ) ||
      !exactNumber(summary.maxDrawdown, resultDrawdown(result, config.startingEquity)) ||
      !exactNumber(summary.profitFactor, expectedProfitFactor) ||
      !exactNumber(summary.averageNetPnl, expectedAveragePnl) ||
      !exactNumber(summary.averageRMultiple, expectedAverageR) ||
      !exactNumber(summary.averageHoldBars, expectedAverageHold)
    ) {
      throw new Error("Backtest evidence summary does not match its raw trades/equity curve.");
    }
  }
  return results.flatMap((result) => result.trades);
};

const normalizedConfigWithoutCost = (config: StockBacktestConfig) => ({
  schemaVersion: config.schemaVersion,
  playbookId: config.playbookId,
  horizon: config.horizon,
  market: config.market,
  timeframe: config.timeframe,
  startingEquity: config.startingEquity,
  riskPerTradeFraction: config.riskPerTradeFraction,
  maxPositionFraction: config.maxPositionFraction,
  maxHoldBars: config.maxHoldBars,
  forceSessionEndExit: config.forceSessionEndExit,
});

export const deriveStockPromotionCandidateId = ({
  config,
  signalsCanonicalChecksum,
}: {
  config: StockBacktestConfig;
  signalsCanonicalChecksum: string;
}) => `stock-candidate-${sha256Hex(stableSerialize({
  strategyConfig: normalizedConfigWithoutCost(config),
  signalsCanonicalChecksum,
})).slice(0, 20)}`;

const validateInputs = (input: StockPromotionEvidenceBuildInput) => {
  const { spec, dataset, baseConfig, stressConfig, references, signals } = input;
  const policy = CALIBRATION_POLICIES[spec.horizon];
  if (
    spec.schemaVersion !== 2 ||
    !spec.playbookId ||
    spec.playbookId !== baseConfig.playbookId ||
    spec.playbookId !== stressConfig.playbookId ||
    spec.horizon !== baseConfig.horizon ||
    spec.horizon !== stressConfig.horizon ||
    spec.market !== baseConfig.market ||
    spec.market !== stressConfig.market ||
    baseConfig.timeframe !== stressConfig.timeframe ||
    dataset.manifest.timeframe !== baseConfig.timeframe ||
    !dataset.manifest.markets.includes(spec.market) ||
    stableSerialize(normalizedConfigWithoutCost(baseConfig)) !==
      stableSerialize(normalizedConfigWithoutCost(stressConfig))
  ) {
    throw new Error("Promotion evidence dataset/base/stress contracts do not match.");
  }
  if (
    baseConfig.cost.commissionRate !== stressConfig.cost.commissionRate ||
    baseConfig.cost.sellTaxRate !== stressConfig.cost.sellTaxRate ||
    baseConfig.cost.adverseSlippageBps !== policy.baseAdverseSlippageBps ||
    stressConfig.cost.adverseSlippageBps !== policy.stressAdverseSlippageBps ||
    baseConfig.configId === stressConfig.configId
  ) {
    throw new Error("Promotion evidence must use the fixed base/stress cost policy.");
  }
  if (
    !Number.isInteger(spec.candidateCount) ||
    spec.candidateCount < 1 ||
    spec.candidateCount > policy.maximumCandidates ||
    spec.candidatePValues.length !== spec.candidateCount ||
    spec.holmAlpha !== 0.05 ||
    !Number.isFinite(spec.baselineMaxDrawdown) ||
    spec.baselineMaxDrawdown > 0 ||
    !spec.reviewerInputSources ||
    typeof spec.reviewerInputSources.baselineMaxDrawdown !== "string" ||
    spec.reviewerInputSources.baselineMaxDrawdown.trim().length === 0 ||
    typeof spec.reviewerInputSources.candidatePValues !== "string" ||
    spec.reviewerInputSources.candidatePValues.trim().length === 0
  ) {
    throw new Error("Promotion evidence candidate/statistical policy is invalid.");
  }
  const folds = spec.walkForwardFolds;
  if (
    folds.length === 0 ||
    folds.some(
      (fold, index) =>
        !fold.id ||
        !isUnixSeconds(fold.startTime) ||
        !isUnixSeconds(fold.endTime) ||
        fold.startTime > fold.endTime ||
        fold.endTime >= spec.holdoutStartTime ||
        (index > 0 && fold.startTime <= folds[index - 1].endTime),
    ) ||
    new Set(folds.map((fold) => fold.id)).size !== folds.length
  ) {
    throw new Error("Promotion evidence walk-forward folds must be ordered and isolated.");
  }

  const canonicalDatasetChecksum = sha256Hex(stableSerialize(dataset));
  const canonicalBaseConfigChecksum = sha256Hex(stableSerialize(baseConfig));
  const canonicalStressConfigChecksum = sha256Hex(stableSerialize(stressConfig));
  const canonicalSignalsChecksum = sha256Hex(stableSerialize(signals));
  const selectedCandidateId = deriveStockPromotionCandidateId({
    config: baseConfig,
    signalsCanonicalChecksum: canonicalSignalsChecksum,
  });
  if (
    references.dataset.datasetId !== dataset.manifest.datasetId ||
    references.dataset.barContentChecksum !== dataset.manifest.contentChecksum ||
    references.dataset.canonicalChecksum !== canonicalDatasetChecksum ||
    references.configs.base.configId !== baseConfig.configId ||
    references.configs.base.canonicalChecksum !== canonicalBaseConfigChecksum ||
    references.configs.stress.configId !== stressConfig.configId ||
    references.configs.stress.canonicalChecksum !== canonicalStressConfigChecksum ||
    references.signals.canonicalChecksum !== canonicalSignalsChecksum ||
    spec.selectedCandidateId !== selectedCandidateId ||
    !spec.candidatePValues.some((candidate) => candidate.id === selectedCandidateId)
  ) {
    throw new Error("Promotion evidence file references do not match canonical inputs.");
  }
  const datasetValidation = validateDatasetForCalibration({
    dataset,
    horizon: spec.horizon,
    candidateCount: spec.candidateCount,
    holdoutStartTime: spec.holdoutStartTime,
  });
  if (!datasetValidation.valid) {
    throw new Error(
      `Promotion evidence dataset/design is not calibratable: ${datasetValidation.blockers.join(", ")}.`,
    );
  }
};

const tradeKey = (trade: StockBacktestTrade) => `${trade.symbol}:${trade.signalId}`;

export const targetBeforeStopRateFromTrades = (
  trades: StockBacktestTrade[],
) => trades.length > 0
  ? trades.filter((trade) =>
      trade.fills.some((fill) => fill.reason === "target")).length / trades.length
  : null;

const deriveSummary = ({
  input,
  baseTrades,
  stressTrades,
}: {
  input: StockPromotionEvidenceBuildInput;
  baseTrades: StockBacktestTrade[];
  stressTrades: StockBacktestTrade[];
}): StockPromotionEvidenceSummary => {
  const { spec, dataset } = input;
  if (
    baseTrades.some(
      (trade) => trade.entryTime < spec.holdoutStartTime && trade.exitTime >= spec.holdoutStartTime,
    )
  ) {
    throw new Error("A trade crosses the sealed holdout boundary.");
  }
  const foldFor = (trade: StockBacktestTrade) =>
    spec.walkForwardFolds.find(
      (fold) => trade.entryTime >= fold.startTime && trade.exitTime <= fold.endTime,
    ) ?? null;
  const oosTrades = baseTrades.filter((trade) => foldFor(trade) !== null);
  const holdoutTrades = baseTrades.filter(
    (trade) => trade.entryTime >= spec.holdoutStartTime,
  );
  const oosKeys = new Set(oosTrades.map(tradeKey));
  const stressOosTrades = stressTrades.filter((trade) => oosKeys.has(tradeKey(trade)));
  if (
    new Set(oosTrades.map(tradeKey)).size !== oosTrades.length ||
    new Set(stressOosTrades.map(tradeKey)).size !== stressOosTrades.length ||
    stressOosTrades.length !== oosTrades.length
  ) {
    throw new Error("Base and stress evidence must cover the same unique OOS trades.");
  }
  const foldNetReturns = spec.walkForwardFolds.map((fold) => {
    const trades = oosTrades.filter((trade) => foldFor(trade)?.id === fold.id);
    return trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
      : 0;
  });
  const maxDrawdown = Math.min(
    0,
    ...input.results.base.map((result) =>
      resultDrawdown(result, input.baseConfig.startingEquity)),
  );
  const statistical = evaluatePromotionWithStatistics({
    horizon: spec.horizon,
    oosTrades,
    holdoutTrades,
    stressTrades: stressOosTrades,
    foldNetReturns,
    maxDrawdown,
    baselineMaxDrawdown: spec.baselineMaxDrawdown,
    pointInTimeUniverse: dataset.manifest.pointInTimeUniverse,
    delistingsIncluded: dataset.manifest.delistingsIncluded,
    bootstrap: spec.bootstrap,
    candidatePValues: spec.candidatePValues,
    selectedCandidateId: spec.selectedCandidateId,
    holmAlpha: spec.holmAlpha,
  });
  const orderedTrades = [...oosTrades, ...holdoutTrades];
  const validationStartTime = orderedTrades.length > 0
    ? Math.min(...orderedTrades.map((trade) => trade.entryTime))
    : null;
  const validationEndTime = orderedTrades.length > 0
    ? Math.max(...orderedTrades.map((trade) => trade.exitTime))
    : null;
  return {
    status: statistical.evaluation.status,
    sampleSize: oosTrades.length,
    holdoutSampleSize: holdoutTrades.length,
    targetBeforeStopRate: targetBeforeStopRateFromTrades(oosTrades),
    averageNetR: oosTrades.length > 0
      ? oosTrades.reduce((sum, trade) => sum + trade.rMultiple, 0) /
        oosTrades.length
      : null,
    confidence95: {
      lower: statistical.bootstrap?.lower95 ?? null,
      upper: statistical.bootstrap?.upper95 ?? null,
    },
    validationStartTime,
    validationEndTime,
    costModel: `${input.baseConfig.cost.id}+${input.stressConfig.cost.id}`,
    foldNetReturns,
    evaluation: statistical.evaluation,
    bootstrap: statistical.bootstrap,
    holm: statistical.holm,
  };
};

export const createStockPromotionEvidenceArtifact = (
  input: StockPromotionEvidenceBuildInput,
): StockPromotionEvidenceArtifact => {
  const normalizedInput: StockPromotionEvidenceBuildInput = {
    ...input,
    results: {
      base: input.results.base.toSorted((left, right) =>
        left.summary.symbol.localeCompare(right.summary.symbol)),
      stress: input.results.stress.toSorted((left, right) =>
        left.summary.symbol.localeCompare(right.summary.symbol)),
    },
  };
  validateInputs(normalizedInput);
  const baseTrades = validateResultBundle({
    results: normalizedInput.results.base,
    dataset: normalizedInput.dataset,
    config: normalizedInput.baseConfig,
  });
  const stressTrades = validateResultBundle({
    results: normalizedInput.results.stress,
    dataset: normalizedInput.dataset,
    config: normalizedInput.stressConfig,
  });
  const payload: StockPromotionEvidenceArtifactPayload = {
    schemaVersion: 2,
    kind: "stock-promotion-evidence",
    spec: normalizedInput.spec,
    dataset: normalizedInput.references.dataset,
    configs: normalizedInput.references.configs,
    signals: normalizedInput.references.signals,
    results: normalizedInput.results,
    summary: deriveSummary({ input: normalizedInput, baseTrades, stressTrades }),
  };
  const artifactChecksum = sha256Hex(stableSerialize(payload));
  return {
    ...payload,
    artifactId: `stock-promotion-${artifactChecksum.slice(0, 20)}`,
    artifactChecksum,
  };
};

export const verifyStockPromotionEvidenceArtifact = ({
  artifact,
  dataset,
  baseConfig,
  stressConfig,
  signals,
}: {
  artifact: StockPromotionEvidenceArtifact;
  dataset: StockBacktestDataset;
  baseConfig: StockBacktestConfig;
  stressConfig: StockBacktestConfig;
  signals: StockBacktestSignal[];
}) => {
  try {
    const symbols = dataset.manifest.symbols.toSorted();
    const rerun = (config: StockBacktestConfig) =>
      symbols.map((symbol) =>
        runStockBacktest({
          datasetId: dataset.manifest.datasetId,
          config,
          symbol,
          bars: dataset.bars.filter((bar) => bar.symbol === symbol),
          signals: signals.filter((signal) => signal.symbol === symbol),
        }),
      );
    const rerunResults = {
      base: rerun(baseConfig),
      stress: rerun(stressConfig),
    };
    if (stableSerialize(rerunResults) !== stableSerialize(artifact.results)) {
      return {
        valid: false,
        expected: null,
        error: "Pinned dataset/config/signals rerun does not match artifact results.",
      };
    }
    const expected = createStockPromotionEvidenceArtifact({
      spec: artifact.spec,
      dataset,
      baseConfig,
      stressConfig,
      signals,
      references: {
        dataset: artifact.dataset,
        configs: artifact.configs,
        signals: artifact.signals,
      },
      results: rerunResults,
    });
    return {
      valid: stableSerialize(expected) === stableSerialize(artifact),
      expected,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      expected: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const canonicalEvidenceChecksum = (value: unknown) =>
  sha256Hex(stableSerialize(value));
