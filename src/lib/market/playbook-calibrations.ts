import type {
  TradePlanCalibration,
  TradePlanStage,
  TradePlaybookId,
} from "@/domain/market-playbook";
import type { StockPromotionEvidenceArtifact } from "@/lib/market/backtest";

export type PlaybookCalibrationMarket = "KR" | "US";

export type PromotionArtifactReference = {
  id: string;
  contentChecksum: string;
  fileChecksum: string;
  relativePath: string;
};

export type ApprovedPlaybookCalibrationManifestRecord = {
  playbookId: TradePlaybookId;
  market: PlaybookCalibrationMarket;
  reviewStatus: "approved";
  reviewedAt: string;
  reviewedBy: string;
  promotionArtifact: PromotionArtifactReference;
};

export type PlaybookCalibrationRegistryManifest = {
  version: 2;
  records: readonly ApprovedPlaybookCalibrationManifestRecord[];
};

export type ReviewedPlaybookCalibrationEvidence = {
  evidenceVersion: 2;
  promotionArtifact: PromotionArtifactReference;
};

export type ReviewedPlaybookCalibration = {
  playbookId: TradePlaybookId;
  market: PlaybookCalibrationMarket;
  reviewStatus: "approved";
  reviewedAt: string;
  reviewedBy: string;
  calibration: TradePlanCalibration & { status: "calibrated" };
  evidence: ReviewedPlaybookCalibrationEvidence;
};

export type PlaybookCalibrationRegistry = {
  version: 2;
  records: readonly ReviewedPlaybookCalibration[];
};

export type ResolvedPlaybookCalibration = {
  stage: TradePlanStage;
  calibration: TradePlanCalibration;
  reviewed: boolean;
};

export const EMPTY_PLAYBOOK_CALIBRATION_REGISTRY: PlaybookCalibrationRegistry = Object.freeze({
  version: 2,
  records: Object.freeze([]),
});

export const unverifiedPlaybookCalibration = (): TradePlanCalibration => ({
  status: "unverified",
  sampleSize: 0,
  holdoutSampleSize: 0,
  targetBeforeStopRate: null,
  averageNetR: null,
  confidence95: { lower: null, upper: null },
  costModel: null,
  validationStart: null,
  validationEnd: null,
  note: "비용 포함 walk-forward와 봉인 holdout 검증 전인 shadow 결과입니다.",
});

const verifiedRecords = new WeakSet<object>();

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isIsoInstant = (value: string) => Number.isFinite(Date.parse(value));

export const createVerifiedPlaybookCalibrationRecord = ({
  approval,
  artifact,
}: {
  approval: ApprovedPlaybookCalibrationManifestRecord;
  artifact: StockPromotionEvidenceArtifact;
}): ReviewedPlaybookCalibration => {
  const summary = artifact.summary;
  const reviewedAt = Date.parse(approval.reviewedAt);
  const validationStart = summary.validationStartTime === null
    ? null
    : new Date(summary.validationStartTime * 1_000).toISOString();
  const validationEnd = summary.validationEndTime === null
    ? null
    : new Date(summary.validationEndTime * 1_000).toISOString();
  if (
    approval.reviewStatus !== "approved" ||
    !isNonEmptyText(approval.reviewedBy) ||
    !Number.isFinite(reviewedAt) ||
    approval.playbookId !== artifact.spec.playbookId ||
    approval.market !== artifact.spec.market ||
    approval.promotionArtifact.id !== artifact.artifactId ||
    approval.promotionArtifact.contentChecksum !== artifact.artifactChecksum ||
    summary.status !== "calibrated" ||
    summary.targetBeforeStopRate === null ||
    summary.averageNetR === null ||
    summary.confidence95.lower === null ||
    summary.confidence95.upper === null ||
    validationStart === null ||
    validationEnd === null ||
    !isIsoInstant(validationStart) ||
    !isIsoInstant(validationEnd) ||
    Date.parse(validationStart) >= Date.parse(validationEnd) ||
    Date.parse(validationEnd) > reviewedAt
  ) {
    throw new Error("Verified promotion artifact does not satisfy its approval record.");
  }
  const record: ReviewedPlaybookCalibration = {
    playbookId: approval.playbookId,
    market: approval.market,
    reviewStatus: "approved",
    reviewedAt: approval.reviewedAt,
    reviewedBy: approval.reviewedBy,
    calibration: {
      status: "calibrated",
      sampleSize: summary.sampleSize,
      holdoutSampleSize: summary.holdoutSampleSize,
      targetBeforeStopRate: summary.targetBeforeStopRate,
      averageNetR: summary.averageNetR,
      confidence95: { ...summary.confidence95 },
      costModel: summary.costModel,
      validationStart,
      validationEnd,
      note: `검증 artifact ${artifact.artifactId}의 비용 포함 walk-forward/holdout 결과입니다.`,
    },
    evidence: {
      evidenceVersion: 2,
      promotionArtifact: { ...approval.promotionArtifact },
    },
  };
  verifiedRecords.add(record);
  return record;
};

const isVerifiedRecordStillValid = (record: ReviewedPlaybookCalibration) => {
  const calibration = record.calibration;
  return verifiedRecords.has(record) &&
    record.reviewStatus === "approved" &&
    isNonEmptyText(record.reviewedBy) &&
    calibration.status === "calibrated" &&
    Number.isInteger(calibration.sampleSize) &&
    calibration.sampleSize > 0 &&
    Number.isInteger(calibration.holdoutSampleSize) &&
    calibration.holdoutSampleSize > 0 &&
    typeof calibration.targetBeforeStopRate === "number" &&
    calibration.targetBeforeStopRate >= 0 &&
    calibration.targetBeforeStopRate <= 1 &&
    typeof calibration.averageNetR === "number" &&
    Number.isFinite(calibration.averageNetR) &&
    typeof calibration.confidence95.lower === "number" &&
    typeof calibration.confidence95.upper === "number" &&
    calibration.confidence95.lower > 0 &&
    calibration.confidence95.lower <= calibration.confidence95.upper &&
    isNonEmptyText(calibration.costModel) &&
    calibration.validationStart !== null &&
    calibration.validationEnd !== null &&
    isIsoInstant(calibration.validationStart) &&
    isIsoInstant(calibration.validationEnd);
};

export const resolvePlaybookCalibration = (
  registry: PlaybookCalibrationRegistry | undefined,
  playbookId: TradePlaybookId,
  market: PlaybookCalibrationMarket,
): ResolvedPlaybookCalibration => {
  const records = registry?.version === 2 && Array.isArray(registry.records)
    ? registry.records
    : EMPTY_PLAYBOOK_CALIBRATION_REGISTRY.records;
  const matches = records
    .filter((record) => record !== null && typeof record === "object")
    .filter((record) => record.playbookId === playbookId && record.market === market);
  if (matches.length !== 1 || !isVerifiedRecordStillValid(matches[0])) {
    return {
      stage: "shadow",
      calibration: unverifiedPlaybookCalibration(),
      reviewed: false,
    };
  }
  return {
    stage: "calibrated",
    calibration: {
      ...matches[0].calibration,
      confidence95: { ...matches[0].calibration.confidence95 },
    },
    reviewed: true,
  };
};
