export { runStockBacktest } from "./engine.ts";
export {
  resolvePinnedStockDatasetPath,
  stockBacktestDatasetRoot,
} from "./dataset-path.ts";
export { createChronologicalFolds } from "./folds.ts";
export {
  createBacktestConfig,
  createDatasetManifest,
  sha256Hex,
  stableSerialize,
  validateDatasetContents,
  verifyDatasetIdentity,
} from "./identity.ts";
export {
  evaluatePromotion,
  evaluatePromotionWithStatistics,
  promotionThresholdsFor,
} from "./promotion.ts";
export {
  canonicalEvidenceChecksum,
  createStockPromotionEvidenceArtifact,
  deriveStockPromotionCandidateId,
  targetBeforeStopRateFromTrades,
  verifyStockPromotionEvidenceArtifact,
} from "./promotion-evidence.ts";
export {
  CALIBRATION_POLICIES,
  MAX_CALIBRATION_CANDIDATES,
  stockCostScenariosFor,
  validateCalibrationDesign,
  validateDatasetForCalibration,
} from "./policy.ts";
export { applyHolmBonferroni, blockBootstrapAverageR95 } from "./statistics.ts";
export {
  addUtcMonths,
  assertUnixSeconds,
  completeUtcMonthsBetween,
  isUnixSeconds,
  MAX_UNIX_SECONDS,
  utcYearFromUnixSeconds,
} from "./time.ts";
export type * from "./policy.ts";
export type * from "./promotion.ts";
export type * from "./promotion-evidence.ts";
export type * from "./statistics.ts";
export type * from "./types.ts";
