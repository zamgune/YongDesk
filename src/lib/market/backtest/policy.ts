import { completeUtcMonthsBetween, isUnixSeconds } from "./time.ts";
import { verifyDatasetIdentity } from "./identity.ts";
import type {
  StockBacktestDataset,
  StockBacktestHorizon,
  StockCostModel,
  StockDatasetContentCheckId,
  StockDatasetContentValidation,
  StockMarket,
  UnixSeconds,
} from "./types.ts";

export const MAX_CALIBRATION_CANDIDATES = 12;

export type StockCalibrationPolicy = {
  horizon: StockBacktestHorizon;
  minimumHistoryMonths: number;
  minimumHoldoutMonths: number;
  baseAdverseSlippageBps: number;
  stressAdverseSlippageBps: number;
  maximumCandidates: number;
};

export type CalibrationDesignCheck = {
  id: "timestamp-unit" | "candidate-count" | "history-period" | "holdout-period";
  passed: boolean;
  actual: number | boolean;
  required: number | boolean;
};

export type CalibrationDesignValidation = {
  valid: boolean;
  policy: StockCalibrationPolicy;
  checks: CalibrationDesignCheck[];
  blockers: CalibrationDesignCheck["id"][];
};

export type DatasetCalibrationValidation = {
  valid: boolean;
  identityValid: boolean;
  policy: StockCalibrationPolicy;
  dataset: StockDatasetContentValidation;
  design: CalibrationDesignValidation;
  blockers: Array<
    | "dataset-identity"
    | StockDatasetContentCheckId
    | CalibrationDesignCheck["id"]
  >;
};

export const CALIBRATION_POLICIES: Record<
  StockBacktestHorizon,
  StockCalibrationPolicy
> = {
  intraday: {
    horizon: "intraday",
    minimumHistoryMonths: 36,
    minimumHoldoutMonths: 6,
    baseAdverseSlippageBps: 10,
    stressAdverseSlippageBps: 30,
    maximumCandidates: MAX_CALIBRATION_CANDIDATES,
  },
  "short-hold": {
    horizon: "short-hold",
    minimumHistoryMonths: 24,
    minimumHoldoutMonths: 6,
    baseAdverseSlippageBps: 5,
    stressAdverseSlippageBps: 15,
    maximumCandidates: MAX_CALIBRATION_CANDIDATES,
  },
  swing: {
    horizon: "swing",
    minimumHistoryMonths: 96,
    minimumHoldoutMonths: 24,
    baseAdverseSlippageBps: 5,
    stressAdverseSlippageBps: 15,
    maximumCandidates: MAX_CALIBRATION_CANDIDATES,
  },
};

export const stockCostScenariosFor = ({
  market,
  horizon,
  scheduleId,
  commissionRate,
  sellTaxRate,
}: {
  market: StockMarket;
  horizon: StockBacktestHorizon;
  scheduleId: string;
  commissionRate: number;
  sellTaxRate: number;
}): { base: StockCostModel; stress: StockCostModel } => {
  if (
    !scheduleId ||
    !Number.isFinite(commissionRate) ||
    commissionRate < 0 ||
    !Number.isFinite(sellTaxRate) ||
    sellTaxRate < 0
  ) {
    throw new Error("A dated fee/tax schedule with non-negative rates is required.");
  }
  const policy = CALIBRATION_POLICIES[horizon];
  const prefix = `${market.toLowerCase()}-${horizon}-${scheduleId}`;
  return {
    base: {
      id: `${prefix}-base`,
      commissionRate,
      sellTaxRate,
      adverseSlippageBps: policy.baseAdverseSlippageBps,
    },
    stress: {
      id: `${prefix}-stress`,
      commissionRate,
      sellTaxRate,
      adverseSlippageBps: policy.stressAdverseSlippageBps,
    },
  };
};

export const validateCalibrationDesign = ({
  horizon,
  candidateCount,
  dataStartTime,
  dataEndTime,
  holdoutStartTime,
}: {
  horizon: StockBacktestHorizon;
  candidateCount: number;
  dataStartTime: UnixSeconds;
  dataEndTime: UnixSeconds;
  holdoutStartTime: UnixSeconds;
}): CalibrationDesignValidation => {
  const policy = CALIBRATION_POLICIES[horizon];
  const timestampsValid =
    isUnixSeconds(dataStartTime) &&
    isUnixSeconds(dataEndTime) &&
    isUnixSeconds(holdoutStartTime) &&
    dataStartTime < holdoutStartTime &&
    holdoutStartTime < dataEndTime;
  const historyMonths = timestampsValid
    ? completeUtcMonthsBetween(dataStartTime, dataEndTime)
    : 0;
  const holdoutMonths = timestampsValid
    ? completeUtcMonthsBetween(holdoutStartTime, dataEndTime)
    : 0;
  const historyPassed = historyMonths >= policy.minimumHistoryMonths;
  const holdoutPassed = holdoutMonths >= policy.minimumHoldoutMonths;
  const checks: CalibrationDesignCheck[] = [
    {
      id: "timestamp-unit",
      passed: timestampsValid,
      actual: timestampsValid,
      required: true,
    },
    {
      id: "candidate-count",
      passed:
        Number.isInteger(candidateCount) &&
        candidateCount > 0 &&
        candidateCount <= policy.maximumCandidates,
      actual: candidateCount,
      required: policy.maximumCandidates,
    },
    {
      id: "history-period",
      passed: historyPassed,
      actual: historyMonths,
      required: policy.minimumHistoryMonths,
    },
    {
      id: "holdout-period",
      passed: holdoutPassed,
      actual: holdoutMonths,
      required: policy.minimumHoldoutMonths,
    },
  ];
  const blockers = checks.filter((check) => !check.passed).map((check) => check.id);
  return { valid: blockers.length === 0, policy, checks, blockers };
};

export const validateDatasetForCalibration = ({
  dataset,
  horizon,
  candidateCount,
  holdoutStartTime,
}: {
  dataset: StockBacktestDataset;
  horizon: StockBacktestHorizon;
  candidateCount: number;
  holdoutStartTime: UnixSeconds;
}): DatasetCalibrationValidation => {
  const verification = verifyDatasetIdentity(dataset);
  const dataStartTime = verification.contentValidation.actualStartTime ?? 0;
  const dataEndTime = verification.contentValidation.actualEndTime ?? 0;
  const design = validateCalibrationDesign({
    horizon,
    candidateCount,
    dataStartTime,
    dataEndTime,
    holdoutStartTime,
  });
  const blockers: DatasetCalibrationValidation["blockers"] = [
    ...(!verification.identityValid ? (["dataset-identity"] as const) : []),
    ...verification.contentValidation.blockers,
    ...design.blockers,
  ];
  return {
    valid: blockers.length === 0,
    identityValid: verification.identityValid,
    policy: design.policy,
    dataset: verification.contentValidation,
    design,
    blockers,
  };
};
