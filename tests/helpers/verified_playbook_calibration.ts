import type { TradePlaybookId } from "../../src/domain/market-playbook.ts";
import type { StockPromotionEvidenceArtifact } from "../../src/lib/market/backtest/index.ts";
import {
  createVerifiedPlaybookCalibrationRecord,
  type PlaybookCalibrationMarket,
} from "../../src/lib/market/playbook-calibrations.ts";

export const verifiedPlaybookCalibration = ({
  playbookId,
  market,
  reviewedAt = "2026-07-15T12:00:00.000Z",
  averageNetR = 0.21,
}: {
  playbookId: TradePlaybookId;
  market: PlaybookCalibrationMarket;
  reviewedAt?: string;
  averageNetR?: number;
}) => {
  const checksum = "a".repeat(64);
  const artifactId = `stock-promotion-${checksum.slice(0, 20)}`;
  const artifact = {
    artifactId,
    artifactChecksum: checksum,
    spec: { playbookId, market },
    summary: {
      status: "calibrated",
      sampleSize: 240,
      holdoutSampleSize: 60,
      targetBeforeStopRate: 0.58,
      averageNetR,
      confidence95: { lower: 0.05, upper: 0.37 },
      validationStartTime: Date.parse("2022-01-01T00:00:00.000Z") / 1_000,
      validationEndTime: Date.parse("2026-06-30T00:00:00.000Z") / 1_000,
      costModel: `${market} base+stress fixture`,
    },
  } as unknown as StockPromotionEvidenceArtifact;
  return createVerifiedPlaybookCalibrationRecord({
    approval: {
      playbookId,
      market,
      reviewStatus: "approved",
      reviewedAt,
      reviewedBy: "fixture-reviewer",
      promotionArtifact: {
        id: artifactId,
        contentChecksum: checksum,
        fileChecksum: "b".repeat(64),
        relativePath: `calibrations/evidence/${artifactId}/promotion.json`,
      },
    },
    artifact,
  });
};
