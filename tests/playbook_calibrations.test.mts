import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  canonicalEvidenceChecksum,
  sha256Hex,
} from "../src/lib/market/backtest/index.ts";
import { loadPlaybookCalibrationRegistry } from "../src/lib/local-engine/playbook-calibration-registry.ts";
import {
  EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
  resolvePlaybookCalibration,
  type PlaybookCalibrationRegistry,
} from "../src/lib/market/playbook-calibrations.ts";
import { writePromotionEvidenceFixture } from "./helpers/stock_promotion_evidence.ts";

test("empty and plain JSON registries remain unverified shadow data", () => {
  const empty = resolvePlaybookCalibration(
    EMPTY_PLAYBOOK_CALIBRATION_REGISTRY,
    "short-hold-trend",
    "US",
  );
  const selfAsserted = {
    version: 2,
    records: [{
      playbookId: "short-hold-trend",
      market: "US",
      reviewStatus: "approved",
      reviewedAt: "2026-07-15T12:00:00.000Z",
      reviewedBy: "json-forgery",
      calibration: {
        status: "calibrated",
        sampleSize: 999_999,
        holdoutSampleSize: 999_999,
        targetBeforeStopRate: 1,
        averageNetR: 999,
        confidence95: { lower: 998, upper: 1_000 },
        costModel: "forged",
        validationStart: "2020-01-01T00:00:00.000Z",
        validationEnd: "2026-01-01T00:00:00.000Z",
        note: "forged",
      },
      evidence: {
        evidenceVersion: 2,
        promotionArtifact: {
          id: `stock-promotion-${"a".repeat(20)}`,
          contentChecksum: "a".repeat(64),
          fileChecksum: "b".repeat(64),
          relativePath:
            `calibrations/evidence/stock-promotion-${"a".repeat(20)}/promotion.json`,
        },
      },
    }],
  } as unknown as PlaybookCalibrationRegistry;
  const forged = resolvePlaybookCalibration(
    selfAsserted,
    "short-hold-trend",
    "US",
  );

  assert.equal(empty.stage, "shadow");
  assert.equal(empty.calibration.status, "unverified");
  assert.equal(forged.stage, "shadow");
  assert.equal(forged.calibration.status, "unverified");
});

test("runtime registry loader fails closed for missing and malformed manifests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playbook-calibration-"));
  const sourcePath = path.join(
    directory,
    "backtests",
    "calibrations",
    "registry.json",
  );
  try {
    const missing = await loadPlaybookCalibrationRegistry(sourcePath);
    assert.equal(missing.status, "missing");
    assert.equal(missing.registry.records.length, 0);

    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, '{"version":1,"records":[]}', "utf8");
    const legacy = await loadPlaybookCalibrationRegistry(sourcePath);
    assert.equal(legacy.status, "invalid");
    assert.equal(legacy.registry.records.length, 0);
    assert.match(legacy.warning ?? "", /shadow/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loader replays pinned evidence before creating a calibrated runtime record", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playbook-calibration-"));
  try {
    const fixture = await writePromotionEvidenceFixture(directory);
    const loaded = await loadPlaybookCalibrationRegistry(fixture.registryPath);
    const resolved = resolvePlaybookCalibration(
      loaded.registry,
      "short-hold-trend",
      "US",
    );

    assert.equal(loaded.status, "loaded");
    assert.equal(loaded.registry.version, 2);
    assert.equal(loaded.registry.records.length, 1);
    assert.equal(resolved.stage, "calibrated");
    assert.equal(resolved.reviewed, true);
    assert.equal(resolved.calibration.sampleSize, 120);
    assert.equal(resolved.calibration.holdoutSampleSize, 32);
    assert.ok((resolved.calibration.confidence95.lower ?? 0) > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("numeric artifact forgery is rejected even when its file checksum is updated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playbook-calibration-"));
  try {
    const fixture = await writePromotionEvidenceFixture(directory);
    const tampered = structuredClone(fixture.artifact);
    tampered.summary.averageNetR = 99;
    const artifactText = `${JSON.stringify(tampered, null, 2)}\n`;
    await writeFile(fixture.artifactPath, artifactText, "utf8");
    const registry = {
      version: 2,
      records: [{
        ...fixture.approval,
        promotionArtifact: {
          ...fixture.approval.promotionArtifact,
          fileChecksum: sha256Hex(artifactText),
        },
      }],
    };
    await writeFile(
      fixture.registryPath,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );

    const loaded = await loadPlaybookCalibrationRegistry(fixture.registryPath);
    assert.equal(loaded.status, "invalid");
    assert.equal(loaded.registry.records.length, 0);
    assert.equal(
      resolvePlaybookCalibration(
        loaded.registry,
        "short-hold-trend",
        "US",
      ).stage,
      "shadow",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-consistent fabricated trades are rejected by pinned engine replay", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "playbook-calibration-"));
  try {
    const fixture = await writePromotionEvidenceFixture(directory);
    const tampered = structuredClone(fixture.artifact);
    tampered.results.base[0].trades[0].signalId = "fabricated-signal";
    const payload = Object.fromEntries(
      Object.entries(tampered).filter(
        ([key]) => key !== "artifactId" && key !== "artifactChecksum",
      ),
    );
    const artifactChecksum = canonicalEvidenceChecksum(payload);
    const artifactId = `stock-promotion-${artifactChecksum.slice(0, 20)}`;
    const forgedArtifact = { ...payload, artifactId, artifactChecksum };
    const artifactText = `${JSON.stringify(forgedArtifact, null, 2)}\n`;
    const relativePath =
      `calibrations/evidence/${artifactId}/promotion.json`;
    const artifactPath = path.join(fixture.backtestRoot, relativePath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, artifactText, "utf8");
    const registry = {
      version: 2,
      records: [{
        ...fixture.approval,
        promotionArtifact: {
          id: artifactId,
          contentChecksum: artifactChecksum,
          fileChecksum: sha256Hex(artifactText),
          relativePath,
        },
      }],
    };
    await writeFile(
      fixture.registryPath,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );

    const loaded = await loadPlaybookCalibrationRegistry(fixture.registryPath);
    assert.equal(loaded.status, "invalid");
    assert.equal(loaded.registry.records.length, 0);
    assert.match(loaded.warning ?? "", /rerun|재현|검증/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
