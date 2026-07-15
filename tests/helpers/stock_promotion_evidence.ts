import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalEvidenceChecksum,
  createBacktestConfig,
  createDatasetManifest,
  createStockPromotionEvidenceArtifact,
  deriveStockPromotionCandidateId,
  runStockBacktest,
  sha256Hex,
  type StockBacktestBar,
  type StockBacktestSignal,
  type StockDatasetManifestSeed,
  type StockPromotionEvidenceArtifact,
  type StockPromotionEvidenceSpec,
} from "../../src/lib/market/backtest/index.ts";
import type {
  ApprovedPlaybookCalibrationManifestRecord,
  PlaybookCalibrationRegistryManifest,
} from "../../src/lib/market/playbook-calibrations.ts";

const HOUR = 60 * 60;
const SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN"];
const unix = (value: string) => Date.parse(value) / 1_000;

const makeBar = ({
  symbol,
  openTime,
  outcome = "neutral",
}: {
  symbol: string;
  openTime: number;
  outcome?: "neutral" | "win" | "loss";
}): StockBacktestBar => ({
  symbol,
  market: "US",
  timeframe: "1h",
  openTime,
  closeTime: openTime + HOUR - 1,
  sessionDate: new Date(openTime * 1_000).toISOString().slice(0, 10),
  open: 100,
  high: outcome === "win" ? 106 : 102,
  low: outcome === "loss" ? 94 : 96,
  close: outcome === "win" ? 105 : outcome === "loss" ? 95 : 100,
  volume: 1_000_000,
});

const resultText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type PromotionEvidenceFixture = {
  backtestRoot: string;
  registryPath: string;
  artifactPath: string;
  artifact: StockPromotionEvidenceArtifact;
  approval: ApprovedPlaybookCalibrationManifestRecord;
};

export const writePromotionEvidenceFixture = async (
  directory: string,
): Promise<PromotionEvidenceFixture> => {
  const backtestRoot = path.join(directory, "backtests");
  const datasetStart = unix("2020-01-01T14:00:00.000Z");
  const datasetEndOpen = unix("2026-01-01T20:00:00.000Z");
  const bars: StockBacktestBar[] = [];
  const signals: StockBacktestSignal[] = [];
  for (const symbol of SYMBOLS) {
    bars.push(makeBar({ symbol, openTime: datasetStart }));
    bars.push(makeBar({ symbol, openTime: datasetEndOpen }));
  }

  const schedules: Array<{
    id: string;
    symbol: string;
    confirmedAt: number;
    outcome: "win" | "loss";
  }> = [];
  for (let index = 0; index < 120; index += 1) {
    const year = 2021 + Math.floor(index / 30);
    const dayOffset = index % 30;
    schedules.push({
      id: `oos-${index}`,
      symbol: SYMBOLS[index % SYMBOLS.length],
      confirmedAt: Date.UTC(year, 1, 1 + dayOffset, 15) / 1_000,
      outcome: index % 5 === 0 ? "loss" : "win",
    });
  }
  for (let index = 0; index < 32; index += 1) {
    schedules.push({
      id: `holdout-${index}`,
      symbol: SYMBOLS[index % SYMBOLS.length],
      confirmedAt: Date.UTC(2025, 6, 2 + index, 15) / 1_000,
      outcome: index % 5 === 0 ? "loss" : "win",
    });
  }
  for (const schedule of schedules) {
    bars.push(makeBar({
      symbol: schedule.symbol,
      openTime: schedule.confirmedAt - HOUR + 1,
    }));
    bars.push(makeBar({
      symbol: schedule.symbol,
      openTime: schedule.confirmedAt,
      outcome: schedule.outcome,
    }));
    signals.push({
      id: schedule.id,
      symbol: schedule.symbol,
      playbookId: "short-hold-trend",
      direction: "long",
      occurredAt: schedule.confirmedAt,
      confirmedAt: schedule.confirmedAt,
      sessionDate: new Date(schedule.confirmedAt * 1_000)
        .toISOString()
        .slice(0, 10),
      stopPrice: 95,
      targets: [{ id: "1R", allocationFraction: 1, rMultiple: 1 }],
    });
  }
  bars.sort((left, right) =>
    left.openTime - right.openTime || left.symbol.localeCompare(right.symbol));
  signals.sort((left, right) =>
    left.confirmedAt - right.confirmedAt || left.id.localeCompare(right.id));

  const seed: StockDatasetManifestSeed = {
    schemaVersion: 1,
    provider: "promotion-fixture",
    retrievedAt: "2026-01-02T00:00:00.000Z",
    timeframe: "1h",
    markets: ["US"],
    symbols: [...SYMBOLS],
    startTime: datasetStart,
    endTime: datasetEndOpen + HOUR - 1,
    priceAdjustment: "split-adjusted",
    sessionPolicy: "regular-session",
    missingBarPolicy: "explicit-sparse-fixture",
    pointInTimeUniverse: true,
    delistingsIncluded: true,
    symbolEvidence: SYMBOLS.map((symbol) => ({
      symbol,
      market: "US",
      validFrom: datasetStart,
      validTo: null,
      universeMemberships: [{ from: datasetStart, to: null }],
      delisting: { status: "active", effectiveTime: null },
      source: "fixture-security-master",
      recordedAt: "2026-01-02T00:00:00.000Z",
    })),
  };
  const manifest = createDatasetManifest({ seed, bars });
  const dataset = { manifest, bars };
  const baseConfig = createBacktestConfig({
    schemaVersion: 1,
    playbookId: "short-hold-trend",
    horizon: "short-hold",
    market: "US",
    timeframe: "1h",
    startingEquity: 100_000,
    riskPerTradeFraction: 0.001,
    maxPositionFraction: 1,
    maxHoldBars: 2,
    forceSessionEndExit: false,
    cost: {
      id: "us-short-fixture-base",
      commissionRate: 0,
      sellTaxRate: 0,
      adverseSlippageBps: 5,
    },
  });
  const stressConfig = createBacktestConfig({
    schemaVersion: baseConfig.schemaVersion,
    playbookId: baseConfig.playbookId,
    horizon: baseConfig.horizon,
    market: baseConfig.market,
    timeframe: baseConfig.timeframe,
    startingEquity: baseConfig.startingEquity,
    riskPerTradeFraction: baseConfig.riskPerTradeFraction,
    maxPositionFraction: baseConfig.maxPositionFraction,
    maxHoldBars: baseConfig.maxHoldBars,
    forceSessionEndExit: baseConfig.forceSessionEndExit,
    cost: {
      id: "us-short-fixture-stress",
      commissionRate: 0,
      sellTaxRate: 0,
      adverseSlippageBps: 15,
    },
  });
  const run = (config: typeof baseConfig) => SYMBOLS.map((symbol) =>
    runStockBacktest({
      datasetId: manifest.datasetId,
      config,
      symbol,
      bars: bars.filter((bar) => bar.symbol === symbol),
      signals: signals.filter((signal) => signal.symbol === symbol),
    }));
  const results = { base: run(baseConfig), stress: run(stressConfig) };
  const datasetRelativePath = `datasets/${manifest.datasetId}/dataset.json`;
  const baseConfigRelativePath = `configs/${baseConfig.configId}/config.json`;
  const stressConfigRelativePath = `configs/${stressConfig.configId}/config.json`;
  const signalsChecksum = canonicalEvidenceChecksum(signals);
  const selectedCandidateId = deriveStockPromotionCandidateId({
    config: baseConfig,
    signalsCanonicalChecksum: signalsChecksum,
  });
  const signalsRelativePath = `signals/${signalsChecksum}/signals.json`;
  const datasetText = resultText(dataset);
  const baseConfigText = resultText(baseConfig);
  const stressConfigText = resultText(stressConfig);
  const signalsText = resultText(signals);
  const spec: StockPromotionEvidenceSpec = {
    schemaVersion: 2,
    playbookId: "short-hold-trend",
    horizon: "short-hold",
    market: "US",
    candidateCount: 1,
    holdoutStartTime: unix("2025-07-01T00:00:00.000Z"),
    walkForwardFolds: [2021, 2022, 2023, 2024].map((year) => ({
      id: `fold-${year}`,
      startTime: Date.UTC(year, 0, 1) / 1_000,
      endTime: Date.UTC(year, 11, 31, 23, 59, 59) / 1_000,
    })),
    baselineMaxDrawdown: -0.2,
    bootstrap: { blockSize: 5, samples: 500, seed: 7 },
    candidatePValues: [{ id: selectedCandidateId, pValue: 0.01 }],
    selectedCandidateId,
    holmAlpha: 0.05,
    reviewerInputSources: {
      baselineMaxDrawdown: "fixture-baseline-artifact-review",
      candidatePValues: "fixture-candidate-comparison-review",
    },
  };
  const artifact = createStockPromotionEvidenceArtifact({
    spec,
    dataset,
    baseConfig,
    stressConfig,
    signals,
    references: {
      dataset: {
        datasetId: manifest.datasetId,
        barContentChecksum: manifest.contentChecksum,
        canonicalChecksum: canonicalEvidenceChecksum(dataset),
        fileChecksum: sha256Hex(datasetText),
        relativePath: datasetRelativePath,
      },
      configs: {
        base: {
          configId: baseConfig.configId,
          canonicalChecksum: canonicalEvidenceChecksum(baseConfig),
          fileChecksum: sha256Hex(baseConfigText),
          relativePath: baseConfigRelativePath,
        },
        stress: {
          configId: stressConfig.configId,
          canonicalChecksum: canonicalEvidenceChecksum(stressConfig),
          fileChecksum: sha256Hex(stressConfigText),
          relativePath: stressConfigRelativePath,
        },
      },
      signals: {
        canonicalChecksum: signalsChecksum,
        fileChecksum: sha256Hex(signalsText),
        relativePath: signalsRelativePath,
      },
    },
    results,
  });
  const artifactRelativePath =
    `calibrations/evidence/${artifact.artifactId}/promotion.json`;
  const artifactText = resultText(artifact);
  const artifactPath = path.join(backtestRoot, artifactRelativePath);
  const approval: ApprovedPlaybookCalibrationManifestRecord = {
    playbookId: "short-hold-trend",
    market: "US",
    reviewStatus: "approved",
    reviewedAt: "2026-07-15T12:00:00.000Z",
    reviewedBy: "fixture-reviewer",
    promotionArtifact: {
      id: artifact.artifactId,
      contentChecksum: artifact.artifactChecksum,
      fileChecksum: sha256Hex(artifactText),
      relativePath: artifactRelativePath,
    },
  };
  const registry: PlaybookCalibrationRegistryManifest = {
    version: 2,
    records: [approval],
  };
  const files = [
    [datasetRelativePath, datasetText],
    [baseConfigRelativePath, baseConfigText],
    [stressConfigRelativePath, stressConfigText],
    [signalsRelativePath, signalsText],
    [artifactRelativePath, artifactText],
    ["calibrations/registry.json", resultText(registry)],
  ] as const;
  for (const [relativePath, text] of files) {
    const filePath = path.join(backtestRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text, "utf8");
  }
  return {
    backtestRoot,
    registryPath: path.join(backtestRoot, "calibrations", "registry.json"),
    artifactPath,
    artifact,
    approval,
  };
};
