import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";
import {
  canonicalEvidenceChecksum,
  createBacktestConfig,
  sha256Hex,
  verifyDatasetIdentity,
  verifyStockPromotionEvidenceArtifact,
  type StockBacktestConfig,
  type StockBacktestConfigSeed,
  type StockBacktestDataset,
  type StockBacktestSignal,
  type StockPromotionEvidenceArtifact,
} from "@/lib/market/backtest";
import {
  createVerifiedPlaybookCalibrationRecord,
  EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
  type ApprovedPlaybookCalibrationManifestRecord,
  type PlaybookCalibrationRegistry,
  type PlaybookCalibrationRegistryManifest,
  type PromotionArtifactReference,
} from "@/lib/market/playbook-calibrations";

export type LoadedPlaybookCalibrationRegistry = {
  status: "loaded" | "missing" | "invalid";
  sourcePath: string;
  registry: PlaybookCalibrationRegistry;
  warning: string | null;
};

export const playbookCalibrationRegistryPath = () =>
  stockAnalysisStoragePath("backtests", "calibrations", "registry.json");

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_ID_PATTERN = /^stock-promotion-[a-f0-9]{20}$/;

const isArtifactReference = (
  value: unknown,
): value is PromotionArtifactReference => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reference = value as Partial<PromotionArtifactReference>;
  return typeof reference.id === "string" &&
    ARTIFACT_ID_PATTERN.test(reference.id) &&
    typeof reference.contentChecksum === "string" &&
    SHA256_PATTERN.test(reference.contentChecksum) &&
    typeof reference.fileChecksum === "string" &&
    SHA256_PATTERN.test(reference.fileChecksum) &&
    typeof reference.relativePath === "string" &&
    reference.relativePath ===
      `calibrations/evidence/${reference.id}/promotion.json`;
};

const isApprovalRecord = (
  value: unknown,
): value is ApprovedPlaybookCalibrationManifestRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ApprovedPlaybookCalibrationManifestRecord>;
  return (
    [
      "kr-intraday-crash-reversal",
      "short-hold-trend",
      "swing-mean-reversion",
      "swing-trend",
    ].includes(record.playbookId ?? "") &&
    (record.market === "KR" || record.market === "US") &&
    record.reviewStatus === "approved" &&
    typeof record.reviewedAt === "string" &&
    Number.isFinite(Date.parse(record.reviewedAt)) &&
    typeof record.reviewedBy === "string" &&
    record.reviewedBy.trim().length > 0 &&
    isArtifactReference(record.promotionArtifact)
  );
};

const readPinnedFile = async ({
  backtestRoot,
  relativePath,
  expectedRelativePath,
}: {
  backtestRoot: string;
  relativePath: string;
  expectedRelativePath: string;
}) => {
  if (relativePath !== expectedRelativePath) {
    throw new Error("Evidence file path does not match its pinned identity directory.");
  }
  const absolutePath = path.resolve(backtestRoot, relativePath);
  const expectedPath = path.join(backtestRoot, expectedRelativePath);
  if (absolutePath !== expectedPath) {
    throw new Error("Evidence file resolves outside the pinned backtest root.");
  }
  const [fileStat, resolvedPath, text] = await Promise.all([
    lstat(absolutePath),
    realpath(absolutePath),
    readFile(absolutePath, "utf8"),
  ]);
  if (fileStat.isSymbolicLink() || resolvedPath !== expectedPath) {
    throw new Error("Symlinked evidence files are not accepted.");
  }
  return { absolutePath, text, fileChecksum: sha256Hex(text) };
};

const configSeed = (config: StockBacktestConfig): StockBacktestConfigSeed => ({
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
  cost: config.cost,
});

const verifyRecord = async ({
  approval,
  backtestRoot,
}: {
  approval: ApprovedPlaybookCalibrationManifestRecord;
  backtestRoot: string;
}) => {
  const artifactFile = await readPinnedFile({
    backtestRoot,
    relativePath: approval.promotionArtifact.relativePath,
    expectedRelativePath:
      `calibrations/evidence/${approval.promotionArtifact.id}/promotion.json`,
  });
  if (artifactFile.fileChecksum !== approval.promotionArtifact.fileChecksum) {
    throw new Error("Promotion artifact file checksum mismatch.");
  }
  const artifact = JSON.parse(artifactFile.text) as StockPromotionEvidenceArtifact;
  if (
    artifact.artifactId !== approval.promotionArtifact.id ||
    artifact.artifactChecksum !== approval.promotionArtifact.contentChecksum
  ) {
    throw new Error("Promotion artifact identity mismatch.");
  }

  const [datasetFile, baseConfigFile, stressConfigFile, signalsFile] = await Promise.all([
    readPinnedFile({
      backtestRoot,
      relativePath: artifact.dataset.relativePath,
      expectedRelativePath: `datasets/${artifact.dataset.datasetId}/dataset.json`,
    }),
    readPinnedFile({
      backtestRoot,
      relativePath: artifact.configs.base.relativePath,
      expectedRelativePath: `configs/${artifact.configs.base.configId}/config.json`,
    }),
    readPinnedFile({
      backtestRoot,
      relativePath: artifact.configs.stress.relativePath,
      expectedRelativePath: `configs/${artifact.configs.stress.configId}/config.json`,
    }),
    readPinnedFile({
      backtestRoot,
      relativePath: artifact.signals.relativePath,
      expectedRelativePath:
        `signals/${artifact.signals.canonicalChecksum}/signals.json`,
    }),
  ]);
  const dataset = JSON.parse(datasetFile.text) as StockBacktestDataset;
  const rawBaseConfig = JSON.parse(baseConfigFile.text) as StockBacktestConfig;
  const rawStressConfig = JSON.parse(stressConfigFile.text) as StockBacktestConfig;
  const signals = JSON.parse(signalsFile.text) as StockBacktestSignal[];
  const baseConfig = createBacktestConfig(configSeed(rawBaseConfig));
  const stressConfig = createBacktestConfig(configSeed(rawStressConfig));
  const datasetIdentity = verifyDatasetIdentity(dataset);
  if (
    !datasetIdentity.valid ||
    baseConfig.configId !== rawBaseConfig.configId ||
    stressConfig.configId !== rawStressConfig.configId ||
    dataset.manifest.datasetId !== artifact.dataset.datasetId ||
    dataset.manifest.contentChecksum !== artifact.dataset.barContentChecksum ||
    canonicalEvidenceChecksum(dataset) !== artifact.dataset.canonicalChecksum ||
    datasetFile.fileChecksum !== artifact.dataset.fileChecksum ||
    baseConfig.configId !== artifact.configs.base.configId ||
    canonicalEvidenceChecksum(baseConfig) !== artifact.configs.base.canonicalChecksum ||
    baseConfigFile.fileChecksum !== artifact.configs.base.fileChecksum ||
    stressConfig.configId !== artifact.configs.stress.configId ||
    canonicalEvidenceChecksum(stressConfig) !== artifact.configs.stress.canonicalChecksum ||
    stressConfigFile.fileChecksum !== artifact.configs.stress.fileChecksum ||
    canonicalEvidenceChecksum(signals) !== artifact.signals.canonicalChecksum ||
    signalsFile.fileChecksum !== artifact.signals.fileChecksum
  ) {
    throw new Error("Pinned dataset/config/signals evidence mismatch.");
  }
  const verification = verifyStockPromotionEvidenceArtifact({
    artifact,
    dataset,
    baseConfig,
    stressConfig,
    signals,
  });
  if (!verification.valid) {
    throw new Error(
      `Promotion artifact result/summary verification failed: ${verification.error ?? "identity mismatch"}`,
    );
  }
  return createVerifiedPlaybookCalibrationRecord({ approval, artifact });
};

const invalidResult = (
  sourcePath: string,
  warning = "승인 calibration evidence가 유효하지 않아 모든 플레이북을 shadow로 유지합니다.",
): LoadedPlaybookCalibrationRegistry => ({
  status: "invalid",
  sourcePath,
  registry: EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
  warning,
});

export const loadPlaybookCalibrationRegistry = async (
  sourcePath = playbookCalibrationRegistryPath(),
): Promise<LoadedPlaybookCalibrationRegistry> => {
  try {
    const absoluteSourcePath = path.resolve(sourcePath);
    const expectedBacktestRoot = path.dirname(path.dirname(absoluteSourcePath));
    const expectedRegistryPath = path.join(
      expectedBacktestRoot,
      "calibrations",
      "registry.json",
    );
    if (absoluteSourcePath !== expectedRegistryPath) {
      return invalidResult(sourcePath, "승인 registry가 고정 backtest 경로 밖에 있어 shadow로 유지합니다.");
    }
    const [sourceStat, resolvedSourcePath, sourceText] = await Promise.all([
      lstat(absoluteSourcePath),
      realpath(absoluteSourcePath),
      readFile(absoluteSourcePath, "utf8"),
    ]);
    const resolvedBacktestRoot = path.dirname(path.dirname(resolvedSourcePath));
    if (
      sourceStat.isSymbolicLink() ||
      resolvedSourcePath !== path.join(
        resolvedBacktestRoot,
        "calibrations",
        "registry.json",
      )
    ) {
      return invalidResult(sourcePath, "symlink registry는 승인 evidence로 사용하지 않습니다.");
    }
    const parsed = JSON.parse(sourceText) as Partial<PlaybookCalibrationRegistryManifest>;
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.records) ||
      !parsed.records.every(isApprovalRecord)
    ) {
      return invalidResult(sourcePath, "승인 calibration registry 형식이 유효하지 않아 모든 플레이북을 shadow로 유지합니다.");
    }
    const duplicateKeys = parsed.records.map(
      (record) => `${record.playbookId}:${record.market}`,
    );
    if (new Set(duplicateKeys).size !== duplicateKeys.length) {
      return invalidResult(sourcePath, "중복 승인 record가 있어 모든 플레이북을 shadow로 유지합니다.");
    }
    const records = await Promise.all(
      parsed.records.map((approval) =>
        verifyRecord({ approval, backtestRoot: resolvedBacktestRoot })),
    );
    return {
      status: "loaded",
      sourcePath,
      registry: { version: 2, records },
      warning: null,
    };
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return {
      status: missing ? "missing" : "invalid",
      sourcePath,
      registry: EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
      warning: missing
        ? null
        : `승인 calibration registry나 결박된 evidence를 검증하지 못해 모든 플레이북을 shadow로 유지합니다: ${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  }
};
