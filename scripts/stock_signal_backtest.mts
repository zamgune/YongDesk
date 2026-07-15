#!/usr/bin/env node

import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalEvidenceChecksum,
  createBacktestConfig,
  createStockPromotionEvidenceArtifact,
  resolvePinnedStockDatasetPath,
  runStockBacktest,
  sha256Hex,
  stockBacktestDatasetRoot,
  verifyDatasetIdentity,
  type StockBacktestConfig,
  type StockBacktestConfigSeed,
  type StockBacktestDataset,
  type StockBacktestSignal,
  type StockPromotionEvidenceSpec,
} from "../src/lib/market/backtest/index.ts";

const args = process.argv.slice(2);

const readArg = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};

const datasetPath = readArg("dataset");
const signalsPath = readArg("signals");
const configPath = readArg("config");
const outputPath = readArg("out");
const stressConfigPath = readArg("stress-config");
const promotionSpecPath = readArg("promotion-spec");

if (!datasetPath || !signalsPath || !configPath) {
  console.error(
    "Usage: yarn backtest:stock-signals --dataset <dataset.json> --signals <signals.json> --config <config.json> [--out <result.json> | --stress-config <config.json> --promotion-spec <spec.json>]",
  );
  process.exitCode = 2;
} else {
  const readJson = async <T,>(filePath: string): Promise<T> =>
    JSON.parse(await readFile(path.resolve(filePath), "utf8")) as T;

  const candidateDatasetId = path.basename(path.dirname(path.resolve(datasetPath)));
  const pinnedDatasetPath = resolvePinnedStockDatasetPath({
    repoPath: process.cwd(),
    requestedPath: datasetPath,
    datasetId: candidateDatasetId,
  });
  const [realDatasetPath, realDatasetRoot] = await Promise.all([
    realpath(pinnedDatasetPath),
    realpath(stockBacktestDatasetRoot(process.cwd())),
  ]);
  if (path.dirname(realDatasetPath) !== path.join(realDatasetRoot, candidateDatasetId)) {
    throw new Error("Dataset cache path resolves outside its manifest-matched pinned directory.");
  }
  const datasetText = await readFile(pinnedDatasetPath, "utf8");
  const dataset = JSON.parse(datasetText) as StockBacktestDataset;
  if (dataset.manifest.datasetId !== candidateDatasetId) {
    throw new Error(
      `Dataset cache directory ${candidateDatasetId} does not match manifest.datasetId ${dataset.manifest.datasetId}.`,
    );
  }
  const signalsText = await readFile(path.resolve(signalsPath), "utf8");
  const signals = JSON.parse(signalsText) as StockBacktestSignal[];
  const rawConfig = await readJson<StockBacktestConfig | StockBacktestConfigSeed>(
    configPath,
  );
  const toConfig = (
    value: StockBacktestConfig | StockBacktestConfigSeed,
  ): StockBacktestConfig => {
    const seed: StockBacktestConfigSeed = {
      schemaVersion: value.schemaVersion,
      playbookId: value.playbookId,
      horizon: value.horizon,
      market: value.market,
      timeframe: value.timeframe,
      startingEquity: value.startingEquity,
      riskPerTradeFraction: value.riskPerTradeFraction,
      maxPositionFraction: value.maxPositionFraction,
      maxHoldBars: value.maxHoldBars,
      forceSessionEndExit: value.forceSessionEndExit,
      cost: value.cost,
    };
    const canonical = createBacktestConfig(seed);
    if ("configId" in value && value.configId !== canonical.configId) {
      throw new Error(
        `Config identity mismatch: expected ${canonical.configId}, received ${value.configId}.`,
      );
    }
    return canonical;
  };
  const config = toConfig(rawConfig);

  const identity = verifyDatasetIdentity(dataset);
  if (!identity.valid) {
    throw new Error(
      identity.identityValid
        ? `Dataset content validation failed: ${identity.contentValidation.blockers.join(", ")}.`
        : `Dataset identity mismatch: expected ${identity.expected.datasetId}/${identity.expected.contentChecksum}.`,
    );
  }
  if (
    dataset.manifest.timeframe !== config.timeframe ||
    !dataset.manifest.markets.includes(config.market)
  ) {
    throw new Error(
      `Dataset contract mismatch: config requires ${config.market}/${config.timeframe}.`,
    );
  }

  const symbols = [...new Set(dataset.bars.map((bar) => bar.symbol))].toSorted();
  const results = symbols.map((symbol) =>
    runStockBacktest({
      datasetId: dataset.manifest.datasetId,
      config,
      symbol,
      bars: dataset.bars.filter((bar) => bar.symbol === symbol),
      signals: signals.filter((signal) => signal.symbol === symbol),
    }),
  );
  const output = {
    schemaVersion: 1,
    datasetId: dataset.manifest.datasetId,
    configId: config.configId,
    generatedFrom: {
      dataset: pinnedDatasetPath,
      signals: path.resolve(signalsPath),
      config: path.resolve(configPath),
    },
    results,
  };

  const promotionMode = stressConfigPath !== null || promotionSpecPath !== null;
  if (promotionMode) {
    if (!stressConfigPath || !promotionSpecPath || outputPath) {
      throw new Error(
        "Promotion evidence requires --stress-config and --promotion-spec together, without --out.",
      );
    }
    if (path.basename(pinnedDatasetPath) !== "dataset.json") {
      throw new Error("Promotion evidence requires the pinned dataset.json filename.");
    }
    const [rawStressConfig, promotionSpec] = await Promise.all([
      readJson<StockBacktestConfig | StockBacktestConfigSeed>(stressConfigPath),
      readJson<StockPromotionEvidenceSpec>(promotionSpecPath),
    ]);
    const stressConfig = toConfig(rawStressConfig);
    const stressResults = symbols.map((symbol) =>
      runStockBacktest({
        datasetId: dataset.manifest.datasetId,
        config: stressConfig,
        symbol,
        bars: dataset.bars.filter((bar) => bar.symbol === symbol),
        signals: signals.filter((signal) => signal.symbol === symbol),
      }),
    );
    const backtestRoot = path.dirname(stockBacktestDatasetRoot(process.cwd()));
    const baseConfigRelativePath = `configs/${config.configId}/config.json`;
    const stressConfigRelativePath = `configs/${stressConfig.configId}/config.json`;
    const canonicalSignalsChecksum = canonicalEvidenceChecksum(signals);
    const signalsRelativePath = `signals/${canonicalSignalsChecksum}/signals.json`;
    const baseConfigText = `${JSON.stringify(config, null, 2)}\n`;
    const stressConfigText = `${JSON.stringify(stressConfig, null, 2)}\n`;
    const canonicalSignalsText = `${JSON.stringify(signals, null, 2)}\n`;
    await Promise.all([
      mkdir(path.join(backtestRoot, path.dirname(baseConfigRelativePath)), {
        recursive: true,
      }),
      mkdir(path.join(backtestRoot, path.dirname(stressConfigRelativePath)), {
        recursive: true,
      }),
      mkdir(path.join(backtestRoot, path.dirname(signalsRelativePath)), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(path.join(backtestRoot, baseConfigRelativePath), baseConfigText, "utf8"),
      writeFile(path.join(backtestRoot, stressConfigRelativePath), stressConfigText, "utf8"),
      writeFile(path.join(backtestRoot, signalsRelativePath), canonicalSignalsText, "utf8"),
    ]);
    const artifact = createStockPromotionEvidenceArtifact({
      spec: promotionSpec,
      dataset,
      baseConfig: config,
      stressConfig,
      signals,
      references: {
        dataset: {
          datasetId: dataset.manifest.datasetId,
          barContentChecksum: dataset.manifest.contentChecksum,
          canonicalChecksum: canonicalEvidenceChecksum(dataset),
          fileChecksum: sha256Hex(datasetText),
          relativePath: `datasets/${dataset.manifest.datasetId}/dataset.json`,
        },
        configs: {
          base: {
            configId: config.configId,
            canonicalChecksum: canonicalEvidenceChecksum(config),
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
          canonicalChecksum: canonicalSignalsChecksum,
          fileChecksum: sha256Hex(canonicalSignalsText),
          relativePath: signalsRelativePath,
        },
      },
      results: { base: results, stress: stressResults },
    });
    const artifactRelativePath =
      `calibrations/evidence/${artifact.artifactId}/promotion.json`;
    const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
    const artifactPath = path.join(backtestRoot, artifactRelativePath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, artifactText, "utf8");
    process.stdout.write(`${JSON.stringify({
      artifactPath,
      registryEvidence: {
        id: artifact.artifactId,
        contentChecksum: artifact.artifactChecksum,
        fileChecksum: sha256Hex(artifactText),
        relativePath: artifactRelativePath,
      },
      status: artifact.summary.status,
      blockers: artifact.summary.evaluation.blockers,
    }, null, 2)}\n`);
    process.exitCode = artifact.summary.status === "calibrated" ? 0 : 3;
  } else {
    const serialized = `${JSON.stringify(output, null, 2)}\n`;

    if (outputPath) {
      const absoluteOutput = path.resolve(outputPath);
      await mkdir(path.dirname(absoluteOutput), { recursive: true });
      await writeFile(absoluteOutput, serialized, "utf8");
      console.log(
        `Wrote ${results.length} deterministic stock backtest result(s) to ${absoluteOutput}.`,
      );
    } else {
      process.stdout.write(serialized);
    }
  }
}
