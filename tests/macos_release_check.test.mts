import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assessMacRelease,
  assessMacReleaseSet,
  summarizeMacSigningReadiness,
  type MacReleaseExpectations,
  type MacReleaseFileCheck,
  type MacReleaseIndex,
  type MacReleaseIndexFileCheck,
  type MacReleaseManifest,
} from "../scripts/check_macos_release.mts";
import {
  assessMacSigningReadiness,
  parseCodeSigningIdentities,
  type MacSigningEnvironment,
  type MacSigningToolCheck,
} from "../scripts/check_macos_signing.mts";
import {
  buildDmgInstallReadme,
  buildMacReleaseInstallGuide,
  type MacReleaseHandoffEntry,
} from "../scripts/package_macos_release.mts";
import {
  buildMacInfoPlist,
  normalizeMacBuildNumber,
  parseMacPackageVersion,
} from "../scripts/build_macos_app.mts";
import { assertMacAppVersionConsistency } from "../scripts/verify_macos_app.mts";
import {
  assertMacNodeVersion,
  assertMacNodeVersionOverride,
  readPinnedMacNodeVersion,
} from "../scripts/macos_release_config.mts";
import {
  mergeDmgInstallVerificationResults,
  sidecarEndpointChecksFromVerificationOutput,
  sidecarEndpointChecksVerified,
  type InstalledAppVerificationResult,
  type ReleaseIndex,
  type SidecarEndpointChecks,
  uiSmokeChecksFromVerificationOutput,
  uiSmokeChecksVerified,
  type UiSmokeChecks,
} from "../scripts/verify_macos_dmg_install.mts";
import { verifyMountedDmgLayout } from "../scripts/verify_macos_dmg.mts";

const completeFiles: MacReleaseFileCheck[] = [
  {
    path: "/tmp/StockAnalysis-0.1.0-macos-arm64.dmg",
    kind: "dmg",
    exists: true,
    sha256Expected: "abc",
    sha256Actual: "abc",
    sha256Matches: true,
    staplerValidated: true,
    staplerDetail: "accepted",
    gatekeeperAccepted: true,
    gatekeeperDetail: "accepted",
  },
  {
    path: "/tmp/StockAnalysis-0.1.0-macos-arm64.zip",
    kind: "zip",
    exists: true,
    sha256Expected: "def",
    sha256Actual: "def",
    sha256Matches: true,
    staplerValidated: null,
    staplerDetail: null,
    gatekeeperAccepted: null,
    gatekeeperDetail: null,
  },
];

const completeReleaseSetIndex = (readyForExternalDistribution: boolean): MacReleaseIndex => ({
  app: "StockAnalysis",
  version: "0.1.0",
  buildNumber: "1",
  bundledNodeVersion: "v22.17.0",
  platform: "macos",
  generatedAt: "2026-07-09T00:00:00.000Z",
  releaseRoot: "/tmp",
  installGuide: "StockAnalysis-0.1.0-macos-install.md",
  installChecklist: [
    "대상 Mac CPU에 맞는 DMG를 전달합니다.",
    "1.0.0은 Toss·Upbit·Bithumb 실제 주문을 차단하며 OrderIntent·RiskCheck 결과는 paper 전용입니다.",
  ],
  entries: [
    {
      arch: "arm64",
      label: "Apple Silicon Mac",
      readyForExternalDistribution,
      status: readyForExternalDistribution ? "external-ready" : "local-test",
      sidecarVerified: true,
      buildNumber: "1",
      bundledNodeVersion: "v22.17.0",
      minimumMacOS: "14.0",
      supportedArchitectures: ["arm64"],
      files: [],
    },
    {
      arch: "x64",
      label: "Intel Mac",
      readyForExternalDistribution,
      status: readyForExternalDistribution ? "external-ready" : "local-test",
      sidecarVerified: true,
      buildNumber: "1",
      bundledNodeVersion: "v22.17.0",
      minimumMacOS: "14.0",
      supportedArchitectures: ["x64"],
      files: [],
    },
  ],
});

const completeReleaseSetFiles: MacReleaseIndexFileCheck[] = [
  {
    arch: "arm64",
    label: "Apple Silicon Mac",
    fileName: "StockAnalysis-0.1.0-macos-arm64.dmg",
    path: "/tmp/StockAnalysis-0.1.0-macos-arm64.dmg",
    kind: "dmg",
    exists: true,
    sha256Expected: "arm64-dmg",
    sha256Actual: "arm64-dmg",
    sha256Matches: true,
    staplerValidated: true,
    staplerDetail: "accepted",
    gatekeeperAccepted: true,
    gatekeeperDetail: "accepted",
  },
  {
    arch: "arm64",
    label: "Apple Silicon Mac",
    fileName: "StockAnalysis-0.1.0-macos-arm64.zip",
    path: "/tmp/StockAnalysis-0.1.0-macos-arm64.zip",
    kind: "zip",
    exists: true,
    sha256Expected: "arm64-zip",
    sha256Actual: "arm64-zip",
    sha256Matches: true,
    staplerValidated: null,
    staplerDetail: null,
    gatekeeperAccepted: null,
    gatekeeperDetail: null,
  },
  {
    arch: "x64",
    label: "Intel Mac",
    fileName: "StockAnalysis-0.1.0-macos-x64.dmg",
    path: "/tmp/StockAnalysis-0.1.0-macos-x64.dmg",
    kind: "dmg",
    exists: true,
    sha256Expected: "x64-dmg",
    sha256Actual: "x64-dmg",
    sha256Matches: true,
    staplerValidated: true,
    staplerDetail: "accepted",
    gatekeeperAccepted: true,
    gatekeeperDetail: "accepted",
  },
  {
    arch: "x64",
    label: "Intel Mac",
    fileName: "StockAnalysis-0.1.0-macos-x64.zip",
    path: "/tmp/StockAnalysis-0.1.0-macos-x64.zip",
    kind: "zip",
    exists: true,
    sha256Expected: "x64-zip",
    sha256Actual: "x64-zip",
    sha256Matches: true,
    staplerValidated: null,
    staplerDetail: null,
    gatekeeperAccepted: null,
    gatekeeperDetail: null,
  },
];

const completeSigningTools: MacSigningToolCheck[] = [
  { name: "codesign", command: "codesign", available: true, detail: "/usr/bin/codesign" },
  { name: "security", command: "security", available: true, detail: "/usr/bin/security" },
  { name: "hdiutil", command: "hdiutil", available: true, detail: "/usr/bin/hdiutil" },
  { name: "ditto", command: "ditto", available: true, detail: "/usr/bin/ditto" },
  { name: "xcrun", command: "xcrun", available: true, detail: "/usr/bin/xcrun" },
  { name: "notarytool", command: "xcrun --find notarytool", available: true, detail: "/usr/bin/notarytool" },
  { name: "stapler", command: "xcrun --find stapler", available: true, detail: "/usr/bin/stapler" },
];

const signingEnvironment = (patch: Partial<MacSigningEnvironment> = {}): MacSigningEnvironment => ({
  platform: "darwin",
  signingIdentity: null,
  notarizeRequested: false,
  notarytoolProfile: null,
  appleIdProvided: false,
  appleTeamIdProvided: false,
  appleAppPasswordProvided: false,
  ...patch,
});

const installedAppVerificationResult = (
  fileName: string,
  dmgSha256: string,
): InstalledAppVerificationResult => ({
  ok: true,
  dmgPath: `/tmp/${fileName}`,
  dmgSha256,
  fileName,
  installedAppPath: `/tmp/Applications/${fileName}.app`,
  error: null,
  sidecarVerified: true,
  sidecarEndpointChecks: null,
  sidecarEndpointVerified: true,
  appLaunchVerified: true,
  appLaunchEndpointChecks: null,
  appLaunchOutputLines: [],
  uiSmokeVerified: true,
  uiSmokeChecks: null,
  uiSmokeOutputLines: [],
  nodeVersion: "v22.17.0",
  verificationOutputLines: [],
});

test("mac app plist uses the package version and a numeric build number", () => {
  const packageVersion = parseMacPackageVersion(readFileSync("package.json", "utf8"), "root package.json");
  const buildNumber = normalizeMacBuildNumber("42");
  const plist = buildMacInfoPlist({ version: packageVersion, buildNumber });

  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Yong'Desk<\/string>/);
  assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>YongDesk\.icns<\/string>/);
  assert.match(plist, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${packageVersion.replaceAll(".", "\\.")}</string>`));
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>42<\/string>/);
});

test("mac app build number accepts only positive integers", () => {
  assert.equal(normalizeMacBuildNumber(undefined), "1");
  assert.equal(normalizeMacBuildNumber(" 17 "), "17");
  for (const invalid of ["0", "-1", "1.2", "build-1"]) {
    assert.throws(() => normalizeMacBuildNumber(invalid), /positive integer/);
  }
});

test("mac release Node pin is loaded from .node-version and rejects overrides", async () => {
  const pinnedNodeVersion = await readPinnedMacNodeVersion(process.cwd());

  assert.equal(pinnedNodeVersion, "v22.17.0");
  assert.equal(assertMacNodeVersion("22.17.0", pinnedNodeVersion, "Bundled Node runtime"), "v22.17.0");
  assert.doesNotThrow(() => assertMacNodeVersionOverride("v22.17.0", pinnedNodeVersion));
  assert.throws(
    () => assertMacNodeVersionOverride("v25.4.0", pinnedNodeVersion),
    /Expected v22\.17\.0, got v25\.4\.0/,
  );
});

test("mac app verifier requires root, plist, and bundled package versions to match", () => {
  assert.deepEqual(assertMacAppVersionConsistency({
    rootPackageVersion: "1.0.0",
    infoPlistVersion: "1.0.0",
    bundledPackageVersion: "1.0.0",
  }), {
    rootPackageVersion: "1.0.0",
    infoPlistVersion: "1.0.0",
    bundledPackageVersion: "1.0.0",
    verified: true,
  });
  assert.throws(() => assertMacAppVersionConsistency({
    rootPackageVersion: "1.0.0",
    infoPlistVersion: "0.1.0",
    bundledPackageVersion: "1.0.0",
  }), /App version mismatch/);
});

test("mac release check rejects repo version and Node pin drift", async () => {
  const expectations: MacReleaseExpectations = {
    version: parseMacPackageVersion(readFileSync("package.json", "utf8"), "root package.json"),
    nodeVersion: await readPinnedMacNodeVersion(process.cwd()),
  };
  const manifest: MacReleaseManifest = {
    version: expectations.version,
    buildNumber: "7",
    arch: "arm64",
    compatibility: {
      targetArch: "arm64",
      supportedArchitectures: ["arm64"],
      bundledNodeVersion: expectations.nodeVersion,
      sidecarVerified: true,
    },
  };

  const matching = assessMacRelease(manifest, completeFiles, expectations);
  assert.equal(matching.ok, true);
  assert.equal(matching.buildNumber, "7");

  const staleVersion = assessMacRelease({ ...manifest, version: "0.1.0" }, completeFiles, expectations);
  assert.equal(staleVersion.ok, false);
  assert.ok(staleVersion.issues.some((issue) => issue.includes("package.json")));

  const wrongNode = assessMacRelease({
    ...manifest,
    compatibility: { ...manifest.compatibility, bundledNodeVersion: "v25.4.0" },
  }, completeFiles, expectations);
  assert.equal(wrongNode.ok, false);
  assert.ok(wrongNode.issues.some((issue) => issue.includes("Expected v22.17.0")));
});

test("mac release check classifies ad-hoc packages as local test builds", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "arm64",
    builtAt: "2026-07-09T00:00:00.000Z",
    signingIdentity: "ad-hoc",
    notarization: {
      requested: false,
      stapled: false,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "arm64",
      supportedArchitectures: ["arm64"],
      supportsAppleSilicon: true,
      supportsIntel: false,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: true,
    },
  };

  const report = assessMacRelease(manifest, completeFiles);

  assert.equal(report.ok, true);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "local-test");
  assert.equal(report.gatekeeperRisk, "high");
  assert.equal(report.compatibility.sidecarVerified, true);
  assert.deepEqual(report.compatibility.supportedArchitectures, ["arm64"]);
  assert.equal(report.issues.length, 0);
  assert.ok(report.warnings.some((warning) => warning.includes("Gatekeeper")));
  assert.ok(report.nextSteps.some((step) => step.includes("MACOS_CODESIGN_IDENTITY")));
});

test("mac release check requires Developer ID and stapled notarization for external distribution", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "universal",
    builtAt: "2026-07-09T00:00:00.000Z",
    signingIdentity: "Developer ID Application: StockAnalysis Team (ABCDE12345)",
    notarization: {
      requested: true,
      stapled: true,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "universal",
      supportedArchitectures: ["arm64", "x64"],
      supportsAppleSilicon: true,
      supportsIntel: true,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: true,
    },
  };

  const report = assessMacRelease(manifest, completeFiles);

  assert.equal(report.ok, true);
  assert.equal(report.readyForExternalDistribution, true);
  assert.equal(report.status, "external-ready");
  assert.equal(report.gatekeeperRisk, "low");
  assert.equal(report.warnings.length, 0);
});

test("mac release check verifies actual DMG stapler and Gatekeeper evidence", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "universal",
    builtAt: "2026-07-09T00:00:00.000Z",
    signingIdentity: "Developer ID Application: StockAnalysis Team (ABCDE12345)",
    notarization: {
      requested: true,
      stapled: true,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "universal",
      supportedArchitectures: ["arm64", "x64"],
      supportsAppleSilicon: true,
      supportsIntel: true,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: true,
    },
  };
  const files: MacReleaseFileCheck[] = completeFiles.map((file) =>
    file.kind === "dmg"
      ? {
          ...file,
          staplerValidated: false,
          staplerDetail: "The staple and validate action failed!",
          gatekeeperAccepted: false,
          gatekeeperDetail: "rejected",
        }
      : file,
  );

  const report = assessMacRelease(manifest, files);

  assert.equal(report.ok, false);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "incomplete");
  assert.ok(report.issues.some((issue) => issue.includes("stapler")));
  assert.ok(report.issues.some((issue) => issue.includes("Gatekeeper")));
});

test("mac release check marks missing artifacts as incomplete", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "arm64",
    signingIdentity: "Developer ID Application: StockAnalysis Team (ABCDE12345)",
    notarization: {
      requested: true,
      stapled: true,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "arm64",
      supportedArchitectures: ["arm64"],
      supportsAppleSilicon: true,
      supportsIntel: false,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: true,
    },
  };
  const files: MacReleaseFileCheck[] = [
    {
      ...completeFiles[0],
      exists: false,
      sha256Actual: null,
      sha256Matches: null,
    },
  ];

  const report = assessMacRelease(manifest, files);

  assert.equal(report.ok, false);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "incomplete");
  assert.ok(report.issues.some((issue) => issue.includes("DMG")));
  assert.ok(report.issues.some((issue) => issue.includes("ZIP")));
});

test("mac release check requires sidecar bundle verification evidence", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "universal",
    builtAt: "2026-07-09T00:00:00.000Z",
    signingIdentity: "Developer ID Application: StockAnalysis Team (ABCDE12345)",
    notarization: {
      requested: true,
      stapled: true,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "universal",
      supportedArchitectures: ["arm64", "x64"],
      supportsAppleSilicon: true,
      supportsIntel: true,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: false,
    },
  };

  const report = assessMacRelease(manifest, completeFiles);

  assert.equal(report.ok, false);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "incomplete");
  assert.equal(report.compatibility.sidecarVerified, false);
  assert.ok(report.issues.some((issue) => issue.includes("sidecar")));
});

test("mac release check reports the missing companion architecture for x64 builds", () => {
  const manifest: MacReleaseManifest = {
    app: "StockAnalysis",
    version: "0.1.0",
    arch: "x64",
    builtAt: "2026-07-09T00:00:00.000Z",
    signingIdentity: "ad-hoc",
    notarization: {
      requested: false,
      stapled: false,
    },
    compatibility: {
      minimumMacOS: "14.0",
      targetArch: "x64",
      supportedArchitectures: ["x64"],
      supportsAppleSilicon: false,
      supportsIntel: true,
      bundledNodeVersion: "v22.17.0",
      sidecarVerified: true,
    },
  };

  const report = assessMacRelease(manifest, completeFiles);

  assert.equal(report.ok, true);
  assert.equal(report.readyForExternalDistribution, false);
  assert.ok(report.warnings.some((warning) => warning.includes("Apple Silicon")));
  assert.equal(report.warnings.some((warning) => warning.includes("Intel Mac까지 지원하려면 x64")), false);
});

test("mac release set check accepts complete arm64 and x64 local test artifacts", () => {
  const report = assessMacReleaseSet(completeReleaseSetIndex(false), completeReleaseSetFiles);

  assert.equal(report.ok, true);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "local-test");
  assert.equal(report.gatekeeperRisk, "high");
  assert.equal(report.compatibility.supportsAppleSilicon, true);
  assert.equal(report.compatibility.supportsIntel, true);
  assert.deepEqual(report.compatibility.missingArchitectures, []);
  assert.equal(report.issues.length, 0);
  assert.ok(report.warnings.some((warning) => warning.includes("Gatekeeper")));
  assert.equal(report.warnings.some((warning) => warning.includes("Intel Mac까지 지원하려면 x64")), false);
});

test("mac release set check rejects current repo version and Node pin drift", async () => {
  const expectations: MacReleaseExpectations = {
    version: parseMacPackageVersion(readFileSync("package.json", "utf8"), "root package.json"),
    nodeVersion: await readPinnedMacNodeVersion(process.cwd()),
  };
  const matchingIndex = {
    ...completeReleaseSetIndex(false),
    version: expectations.version,
    bundledNodeVersion: expectations.nodeVersion,
  };
  const matching = assessMacReleaseSet(matchingIndex, completeReleaseSetFiles, expectations);
  assert.equal(matching.ok, true);
  assert.equal(matching.buildNumber, "1");
  assert.equal(matching.bundledNodeVersion, "v22.17.0");

  const staleVersion = assessMacReleaseSet({ ...matchingIndex, version: "0.1.0" }, completeReleaseSetFiles, expectations);
  assert.equal(staleVersion.ok, false);
  assert.ok(staleVersion.issues.some((issue) => issue.includes("package.json")));

  const wrongNode = assessMacReleaseSet({
    ...matchingIndex,
    bundledNodeVersion: "v25.4.0",
  }, completeReleaseSetFiles, expectations);
  assert.equal(wrongNode.ok, false);
  assert.ok(wrongNode.issues.some((issue) => issue.includes("Expected v22.17.0")));
});

test("mac release set check requires the Intel companion release", () => {
  const index = completeReleaseSetIndex(false);
  index.entries = index.entries?.filter((entry) => entry.arch === "arm64");
  const files = completeReleaseSetFiles.filter((file) => file.arch === "arm64");

  const report = assessMacReleaseSet(index, files);

  assert.equal(report.ok, false);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "incomplete");
  assert.deepEqual(report.compatibility.missingArchitectures, ["x64"]);
  assert.ok(report.issues.some((issue) => issue.includes("Intel Mac용 x64")));
  assert.ok(report.nextSteps.some((step) => step.includes("mac:package:x64")));
});

test("mac release set check marks Developer ID and notarized release sets as external ready", () => {
  const report = assessMacReleaseSet(completeReleaseSetIndex(true), completeReleaseSetFiles);

  assert.equal(report.ok, true);
  assert.equal(report.readyForExternalDistribution, true);
  assert.equal(report.status, "external-ready");
  assert.equal(report.gatekeeperRisk, "low");
  assert.equal(report.developerIdReady, true);
  assert.equal(report.sidecarVerified, true);
  assert.equal(report.warnings.length, 0);
});

test("mac release set check rejects public releases without actual DMG distribution evidence", () => {
  const files = completeReleaseSetFiles.map((file) =>
    file.kind === "dmg"
      ? {
          ...file,
          staplerValidated: false,
          staplerDetail: "ticket not found",
          gatekeeperAccepted: false,
          gatekeeperDetail: "rejected",
        }
      : file,
  );

  const report = assessMacReleaseSet(completeReleaseSetIndex(true), files);

  assert.equal(report.ok, false);
  assert.equal(report.readyForExternalDistribution, false);
  assert.equal(report.status, "incomplete");
  assert.equal(report.developerIdReady, false);
  assert.ok(report.issues.some((issue) => issue.includes("stapler")));
  assert.ok(report.issues.some((issue) => issue.includes("Gatekeeper")));
});

test("mac package all restores a runnable host app after cross-arch packaging", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const command = packageJson.scripts?.["mac:package:all"] ?? "";
  const steps = command.split("&&").map((step) => step.trim());

  assert.match(command, /mac:package:arm64/);
  assert.match(command, /mac:package:x64/);
  assert.match(command, /mac:release-check:all -- --write-report/);
  assert.match(command, /mac:verify:dmg:all/);
  assert.match(command, /mac:verify:install:all -- --write-report --ui-smoke/);
  assert.match(command, /mac:app/);
  assert.match(command, /mac:verify/);
  assert.match(command, /mac:verify:launch/);
  assert.equal(
    packageJson.scripts?.["mac:verify:ui"],
    "node --experimental-strip-types scripts/verify_macos_ui_smoke.mts",
  );
  assert.equal(
    command.includes("mac:verify:ui"),
    false,
    "GUI smoke should stay opt-in because it requires an active macOS accessibility session",
  );
  const installStepIndex = steps.findIndex((step) => step.startsWith("npm run mac:verify:install:all"));
  const releaseCheckStepIndex = steps.findIndex((step) => step.startsWith("npm run mac:release-check:all"));
  assert.notEqual(releaseCheckStepIndex, -1);
  assert.ok(
    releaseCheckStepIndex < steps.indexOf("npm run mac:verify:dmg:all"),
    "DMG layout should be verified only after release artifacts and checksums are checked",
  );
  assert.ok(
    steps[releaseCheckStepIndex]?.includes("--write-report"),
    "release check should write a report that the app distribution sheet can display",
  );
  assert.ok(
    steps.indexOf("npm run mac:verify:dmg:all") < steps.indexOf("npm run mac:app"),
    "host app should be rebuilt only after cross-arch DMG layout is checked",
  );
  assert.ok(
    steps.indexOf("npm run mac:verify:dmg:all") < installStepIndex,
    "DMG install verification should run only after DMG layout verification",
  );
  assert.ok(
    installStepIndex < steps.indexOf("npm run mac:app"),
    "host app should be rebuilt only after copied DMG apps are verified",
  );
  assert.ok(
    steps.indexOf("npm run mac:app") < steps.indexOf("npm run mac:verify"),
    "restored host app should be verified before the command succeeds",
  );
});

test("mac public packaging fails closed before handoff", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const command = packageJson.scripts?.["mac:package:public"] ?? "";
  const steps = command.split("&&").map((step) => step.trim());

  assert.equal(
    packageJson.scripts?.["mac:release-check:public"],
    "node --experimental-strip-types scripts/check_macos_release.mts --all --require-external",
  );
  assert.deepEqual(steps, [
    "npm run mac:signing-check -- --require-external",
    "npm run toss:contract",
    "npm run mac:package:all",
    "npm run mac:release-check:public",
  ]);
});

test("mac dmg install verification parses packaged sidecar endpoint checks", () => {
  const output = [
    "/tmp/StockAnalysis.app/Contents/Info.plist: OK",
    "{",
    "  \"ok\": true,",
    "  \"sidecar\": \"verified\",",
    "  \"sidecarEndpointChecks\": {",
    "    \"health\": true,",
    "    \"tossOpenApiContract\": true,",
    "    \"tossReadinessNoCredential\": true,",
    "    \"localSelfTest\": true,",
    "    \"brokerDiagnostics\": true,",
    "    \"publicIpCheckSkipped\": true,",
    "    \"brokerCredentials\": true,",
    "    \"accountPreferenceNoCredential\": true,",
    "    \"liveTradingNoCredential\": true,",
    "    \"strategyConfigs\": true,",
    "    \"strategyLifecycle\": true,",
    "    \"strategyBackupImport\": true,",
    "    \"newsEvents\": true,",
    "    \"terminalDashboard\": true,",
    "    \"dashboardPlaybook\": true,",
    "    \"paperOrderIntent\": true,",
    "    \"paperReset\": true,",
    "    \"killSwitch\": true,",
    "    \"workerControl\": true,",
    "    \"automationScheduler\": true,",
    "    \"symbolSearch\": true,",
    "    \"cryptoExchangeSafety\": true,",
    "    \"cryptoStrategyLifecycle\": true,",
    "    \"automationDryRun\": true,",
    "    \"orderSyncNoCredential\": true,",
    "    \"holdingsNoCredential\": true,",
    "    \"orderPrecheckNoCredential\": true",
    "  }",
    "}",
  ].join("\n");

  const checks = sidecarEndpointChecksFromVerificationOutput(output);

  assert.equal(checks?.strategyLifecycle, true);
  assert.equal(checks?.strategyBackupImport, true);
  assert.equal(checks?.tossOpenApiContract, true);
  assert.equal(checks?.tossReadinessNoCredential, true);
  assert.equal(checks?.publicIpCheckSkipped, true);
  assert.equal(checks?.orderSyncNoCredential, true);
  assert.equal(checks?.orderPrecheckNoCredential, true);
  assert.equal(checks?.symbolSearch, true);
  assert.equal(checks?.cryptoExchangeSafety, true);
  assert.equal(checks?.cryptoStrategyLifecycle, true);
  assert.equal(sidecarEndpointChecksVerified(checks), true);

  const missingLifecycle: SidecarEndpointChecks = {
    health: true,
    tossOpenApiContract: true,
    tossReadinessNoCredential: true,
    localSelfTest: true,
    brokerDiagnostics: true,
    publicIpCheckSkipped: true,
    brokerCredentials: true,
    accountPreferenceNoCredential: true,
    liveTradingNoCredential: true,
    strategyConfigs: true,
    strategyLifecycle: false,
    strategyBackupImport: true,
    newsEvents: true,
    terminalDashboard: true,
    dashboardPlaybook: true,
    paperOrderIntent: true,
    paperReset: true,
    killSwitch: true,
    workerControl: true,
    automationScheduler: true,
    symbolSearch: true,
    cryptoExchangeSafety: true,
    cryptoStrategyLifecycle: true,
    automationDryRun: true,
    orderSyncNoCredential: true,
    holdingsNoCredential: true,
    orderPrecheckNoCredential: true,
  };
  assert.equal(sidecarEndpointChecksVerified(missingLifecycle), false);
});

test("mac dmg install verification parses copied app UI smoke checks", () => {
  const output = [
    "{",
    "  \"ok\": true,",
    "  \"checks\": {",
    "    \"beginnerFirstOnboarding\": true,",
    "    \"samsungFixtureAnalysis\": true,",
    "    \"sourceCurrencyTimeframeVisible\": true,",
    "    \"horizonPlans\": true,",
    "    \"signalAndNewsSentimentTabs\": true,",
    "    \"paperOrderDrawerNoSubmit\": true,",
    "    \"assetsWorkspace\": true,",
    "    \"strategyWorkflowOrder\": true,",
    "    \"strategySheetReadOnlySmoke\": true,",
    "    \"automationPaperOnly\": true,",
    "    \"killSwitchReachable\": true,",
    "    \"settingsApiReachable\": true,",
    "    \"selfTestReachable\": true,",
    "    \"sidecarLogReachable\": true,",
    "    \"distributionReachable\": true,",
    "    \"responsiveWindowSizes\": true",
    "  }",
    "}",
  ].join("\n");

  const checks = uiSmokeChecksFromVerificationOutput(output);

  assert.ok(checks);
  assert.equal(checks?.beginnerFirstOnboarding, true);
  assert.equal(checks?.samsungFixtureAnalysis, true);
  assert.equal(checks?.horizonPlans, true);
  assert.equal(checks?.paperOrderDrawerNoSubmit, true);
  assert.equal(checks?.strategyWorkflowOrder, true);
  assert.equal(checks?.automationPaperOnly, true);
  assert.equal(checks?.responsiveWindowSizes, true);
  assert.equal(uiSmokeChecksVerified(checks), true);

  const installedCopyChecks: UiSmokeChecks = {
    ...checks,
  };
  assert.equal(uiSmokeChecksVerified(installedCopyChecks), true);

  const missingButtonGuard: UiSmokeChecks = {
    ...checks,
    paperOrderDrawerNoSubmit: false,
  };
  assert.equal(uiSmokeChecksVerified(missingButtonGuard), false);
});

test("mac dmg install report preserves existing current-arch verification by checksum", () => {
  const index: ReleaseIndex = {
    app: "StockAnalysis",
    version: "0.1.0",
    platform: "macos",
    entries: [
      {
        files: [
          {
            kind: "dmg",
            fileName: "StockAnalysis-0.1.0-macos-arm64.dmg",
            path: "/tmp/StockAnalysis-0.1.0-macos-arm64.dmg",
            sha256: "arm64-current",
          },
        ],
      },
      {
        files: [
          {
            kind: "dmg",
            fileName: "StockAnalysis-0.1.0-macos-x64.dmg",
            path: "/tmp/StockAnalysis-0.1.0-macos-x64.dmg",
            sha256: "x64-current",
          },
        ],
      },
    ],
  };

  const merged = mergeDmgInstallVerificationResults(
    index,
    [installedAppVerificationResult("StockAnalysis-0.1.0-macos-arm64.dmg", "arm64-current")],
    [installedAppVerificationResult("StockAnalysis-0.1.0-macos-x64.dmg", "x64-current")],
  );

  assert.equal(merged.checked, 2);
  assert.equal(merged.results.length, 2);
  assert.deepEqual(merged.missingIssues, []);

  const stale = mergeDmgInstallVerificationResults(
    index,
    [installedAppVerificationResult("StockAnalysis-0.1.0-macos-arm64.dmg", "arm64-current")],
    [installedAppVerificationResult("StockAnalysis-0.1.0-macos-x64.dmg", "x64-stale")],
  );

  assert.equal(stale.checked, 2);
  assert.equal(stale.results.length, 1);
  assert.ok(stale.missingIssues.some((issue) => issue.includes("x64")));
});

test("mac release install guide covers cross-arch handoff and Toss setup", () => {
  const entries: MacReleaseHandoffEntry[] = [
    {
      arch: "arm64",
      label: "Apple Silicon Mac",
      buildNumber: "1",
      bundledNodeVersion: "v22.17.0",
      readyForExternalDistribution: false,
      status: "local-test",
      sidecarVerified: true,
      minimumMacOS: "14.0",
      supportedArchitectures: ["arm64"],
      files: [
        {
          kind: "dmg",
          fileName: "StockAnalysis-0.1.0-macos-arm64.dmg",
          path: "/tmp/StockAnalysis-0.1.0-macos-arm64.dmg",
          exists: true,
          sha256: "arm64-dmg",
        },
      ],
    },
    {
      arch: "x64",
      label: "Intel Mac",
      buildNumber: "1",
      bundledNodeVersion: "v22.17.0",
      readyForExternalDistribution: false,
      status: "local-test",
      sidecarVerified: true,
      minimumMacOS: "14.0",
      supportedArchitectures: ["x64"],
      files: [
        {
          kind: "dmg",
          fileName: "StockAnalysis-0.1.0-macos-x64.dmg",
          path: "/tmp/StockAnalysis-0.1.0-macos-x64.dmg",
          exists: true,
          sha256: "x64-dmg",
        },
      ],
    },
  ];

  const guide = buildMacReleaseInstallGuide({
    version: "0.1.0",
    generatedAt: "2026-07-09T00:00:00.000Z",
    entries,
  });

  assert.match(guide, /Apple Silicon Mac/);
  assert.match(guide, /Intel Mac/);
  assert.match(guide, /별도 터미널이나 sidecar 명령을 실행하지 않습니다/);
  assert.match(guide, /첫 실행 설정/);
  assert.match(guide, /설치 후 점검/);
  assert.match(guide, /macOS Keychain/);
  assert.match(guide, /macos-install-verification\.json/);
  assert.match(guide, /appLaunchVerified/);
  assert.match(guide, /uiSmokeVerified/);
  assert.match(guide, /sidecarEndpointChecks\.strategyBackupImport=true/);
  assert.match(guide, /uiSmokeChecks\.samsungFixtureAnalysis=true/);
  assert.match(guide, /uiSmokeChecks\.horizonPlans=true/);
  assert.match(guide, /uiSmokeChecks\.paperOrderDrawerNoSubmit=true/);
  assert.match(guide, /uiSmokeChecks\.strategyWorkflowOrder=true/);
  assert.match(guide, /uiSmokeChecks\.responsiveWindowSizes=true/);
  assert.match(guide, /DMG SHA-256.*release index.*release-check/);
  assert.match(guide, /StockAnalysis-0\.1\.0-macos-release-check\.json/);
  assert.match(guide, /staplerValidated=true/);
  assert.match(guide, /gatekeeperAccepted=true/);
  assert.match(guide, /UI 버튼 smoke/);
  assert.match(guide, /Toss 개발자 콘솔 허용 IP/);
  assert.match(guide, /OrderIntent/);
  assert.match(guide, /RiskCheck/);
  assert.match(guide, /StockAnalysis-0.1.0-macos-arm64\.dmg/);
  assert.match(guide, /StockAnalysis-0.1.0-macos-x64\.dmg/);
});

test("mac dmg install readme guides drag install and live trading setup", () => {
  const readme = buildDmgInstallReadme({
    version: "0.1.0",
    arch: "arm64",
  });

  assert.match(readme, /StockAnalysis macOS 0\.1\.0 \(arm64\)/);
  assert.match(readme, /Applications 아이콘으로 드래그/);
  assert.match(readme, /별도 터미널 명령은 필요 없습니다/);
  assert.match(readme, /첫 실행 설정/);
  assert.match(readme, /설치 후 점검/);
  assert.match(readme, /Toss API 키/);
  assert.match(readme, /OrderIntent/);
  assert.match(readme, /RiskCheck/);
  assert.match(readme, /Gatekeeper/);
});

test("mac dmg verifier accepts Finder drag-install layout", async () => {
  const mountRoot = await mkdtemp(join(tmpdir(), "stockanalysis-dmg-test-"));
  try {
    await mkdir(join(mountRoot, "StockAnalysis.app", "Contents"), { recursive: true });
    await writeFile(join(mountRoot, "StockAnalysis.app", "Contents", "Info.plist"), "<plist></plist>", "utf8");
    await symlink("/Applications", join(mountRoot, "Applications"));
    await writeFile(
      join(mountRoot, "StockAnalysis 설치 안내.txt"),
      buildDmgInstallReadme({ version: "0.1.0", arch: "arm64" }),
      "utf8",
    );

    const check = await verifyMountedDmgLayout(mountRoot);

    assert.equal(check.ok, true);
    assert.deepEqual(check.entries, {
      app: true,
      infoPlist: true,
      applicationsSymlink: true,
      readme: true,
    });
    assert.deepEqual(check.issues, []);
  } finally {
    await rm(mountRoot, { recursive: true, force: true });
  }
});

test("mac dmg verifier reports missing Applications symlink", async () => {
  const mountRoot = await mkdtemp(join(tmpdir(), "stockanalysis-dmg-test-"));
  try {
    await mkdir(join(mountRoot, "StockAnalysis.app", "Contents"), { recursive: true });
    await writeFile(join(mountRoot, "StockAnalysis.app", "Contents", "Info.plist"), "<plist></plist>", "utf8");
    await writeFile(
      join(mountRoot, "StockAnalysis 설치 안내.txt"),
      buildDmgInstallReadme({ version: "0.1.0", arch: "arm64" }),
      "utf8",
    );

    const check = await verifyMountedDmgLayout(mountRoot);

    assert.equal(check.ok, false);
    assert.equal(check.entries.applicationsSymlink, false);
    assert.ok(check.issues.some((issue) => issue.includes("Applications")));
  } finally {
    await rm(mountRoot, { recursive: true, force: true });
  }
});

test("mac signing check parses Developer ID identities", () => {
  const identities = parseCodeSigningIdentities(`
  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: StockAnalysis Team (ABCDE12345)"
  2) 1111111111111111111111111111111111111111 "Apple Development: Dev User (XYZ9876543)"
     2 valid identities found
`);

  assert.deepEqual(identities, [
    {
      hash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
      name: "Developer ID Application: StockAnalysis Team (ABCDE12345)",
    },
    {
      hash: "1111111111111111111111111111111111111111",
      name: "Apple Development: Dev User (XYZ9876543)",
    },
  ]);
});

test("mac signing check reports local-test when Developer ID is missing", () => {
  const report = assessMacSigningReadiness({
    environment: signingEnvironment(),
    tools: completeSigningTools,
    identities: [],
  });

  assert.equal(report.ok, true);
  assert.equal(report.externalDistributionReady, false);
  assert.equal(report.status, "local-test");
  assert.equal(report.developerIdIdentityFound, false);
  assert.equal(report.notaryCredentialsProvided, false);
  assert.ok(report.warnings.some((warning) => warning.includes("MACOS_CODESIGN_IDENTITY")));
  assert.ok(report.nextSteps.some((step) => step.includes("Developer ID")));
});

test("mac signing check marks Developer ID and notary profile as external ready", () => {
  const identity = "Developer ID Application: StockAnalysis Team (ABCDE12345)";
  const report = assessMacSigningReadiness({
    environment: signingEnvironment({
      signingIdentity: identity,
      notarizeRequested: true,
      notarytoolProfile: "stockanalysis-notary",
    }),
    tools: completeSigningTools,
    identities: [
      {
        hash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        name: identity,
      },
    ],
  });

  assert.equal(report.ok, true);
  assert.equal(report.externalDistributionReady, true);
  assert.equal(report.status, "external-ready");
  assert.equal(report.developerIdIdentityFound, true);
  assert.equal(report.notaryCredentialsProvided, true);
  assert.equal(report.warnings.length, 0);
});

test("mac release check summarizes signing readiness for handoff reports", () => {
  const identity = "Developer ID Application: StockAnalysis Team (ABCDE12345)";
  const report = assessMacSigningReadiness({
    environment: signingEnvironment({
      signingIdentity: identity,
      notarizeRequested: true,
      notarytoolProfile: "stockanalysis-notary",
    }),
    tools: completeSigningTools,
    identities: [
      {
        hash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        name: identity,
      },
    ],
  });

  const summary = summarizeMacSigningReadiness(report);

  assert.equal(summary.status, "external-ready");
  assert.equal(summary.externalDistributionReady, true);
  assert.equal(summary.developerIdIdentityFound, true);
  assert.equal(summary.notarizationRequested, true);
  assert.equal(summary.notaryCredentialsProvided, true);
  assert.equal(summary.signingIdentity, identity);
  assert.deepEqual(summary.issues, []);
  assert.deepEqual(summary.warnings, []);
});

test("mac signing check blocks external readiness when required tools are missing", () => {
  const identity = "Developer ID Application: StockAnalysis Team (ABCDE12345)";
  const report = assessMacSigningReadiness({
    environment: signingEnvironment({
      signingIdentity: identity,
      notarizeRequested: true,
      notarytoolProfile: "stockanalysis-notary",
    }),
    tools: completeSigningTools.map((tool) =>
      tool.name === "notarytool" ? { ...tool, available: false, detail: "not found" } : tool,
    ),
    identities: [
      {
        hash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
        name: identity,
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.equal(report.externalDistributionReady, false);
  assert.equal(report.status, "local-test");
  assert.ok(report.issues.some((issue) => issue.includes("notarytool")));
});
