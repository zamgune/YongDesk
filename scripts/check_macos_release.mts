import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectMacSigningReadinessReport,
  type MacSigningReadinessReport,
} from "./check_macos_signing.mts";
import {
  assertMacNodeVersion,
  readMacPackageVersion,
  readPinnedMacNodeVersion,
} from "./macos_release_config.mts";

export type MacReleaseManifest = {
  app?: string;
  version?: string;
  buildNumber?: string;
  platform?: string;
  arch?: string;
  builtAt?: string;
  signingIdentity?: string;
  notarization?: {
    requested?: boolean;
    stapled?: boolean;
  };
  compatibility?: {
    minimumMacOS?: string;
    targetArch?: string;
    supportedArchitectures?: string[];
    supportsAppleSilicon?: boolean;
    supportsIntel?: boolean;
    bundledNodeVersion?: string;
    sidecarVerified?: boolean;
  };
  files?: Array<{
    path?: string;
    sha256?: string;
  }>;
};

export type MacReleaseIndexArtifact = {
  kind?: string;
  fileName?: string;
  path?: string;
  exists?: boolean;
  sha256?: string | null;
};

export type MacReleaseIndexEntry = {
  arch?: string;
  label?: string;
  readyForExternalDistribution?: boolean | null;
  status?: string | null;
  sidecarVerified?: boolean | null;
  buildNumber?: string | null;
  bundledNodeVersion?: string | null;
  minimumMacOS?: string | null;
  supportedArchitectures?: string[];
  files?: MacReleaseIndexArtifact[];
};

export type MacReleaseIndex = {
  app?: string;
  version?: string;
  buildNumber?: string;
  bundledNodeVersion?: string;
  platform?: string;
  generatedAt?: string;
  releaseRoot?: string;
  installGuide?: string;
  entries?: MacReleaseIndexEntry[];
  installChecklist?: string[];
};

export type MacReleaseFileCheck = {
  path: string;
  kind: "dmg" | "zip" | "manifest" | "other";
  exists: boolean;
  sha256Expected: string | null;
  sha256Actual: string | null;
  sha256Matches: boolean | null;
  staplerValidated: boolean | null;
  staplerDetail: string | null;
  gatekeeperAccepted: boolean | null;
  gatekeeperDetail: string | null;
};

export type MacReleaseIndexFileCheck = MacReleaseFileCheck & {
  arch: string;
  label: string;
  fileName: string | null;
};

export type MacReleaseCheckReport = {
  ok: boolean;
  readyForExternalDistribution: boolean;
  status: "external-ready" | "local-test" | "incomplete";
  label: string;
  app: string;
  version: string;
  buildNumber: string;
  arch: string;
  builtAt: string;
  signingIdentity: string;
  developerIdSigned: boolean;
  notarizationStapled: boolean;
  gatekeeperRisk: "low" | "high";
  compatibility: {
    minimumMacOS: string;
    targetArch: string;
    supportedArchitectures: string[];
    supportsAppleSilicon: boolean;
    supportsIntel: boolean;
    bundledNodeVersion: string | null;
    sidecarVerified: boolean;
  };
  artifactCounts: {
    total: number;
    existing: number;
    checksumVerified: number;
  };
  issues: string[];
  warnings: string[];
  nextSteps: string[];
  operatorChecklist: string[];
  files: MacReleaseFileCheck[];
};

export type MacReleaseSetCheckReport = {
  ok: boolean;
  readyForExternalDistribution: boolean;
  status: "external-ready" | "local-test" | "incomplete";
  label: string;
  app: string;
  version: string;
  buildNumber: string;
  bundledNodeVersion: string | null;
  generatedAt: string;
  releaseRoot: string;
  installGuide: string | null;
  developerIdReady: boolean;
  sidecarVerified: boolean;
  gatekeeperRisk: "low" | "high";
  compatibility: {
    minimumMacOS: string;
    requiredArchitectures: string[];
    presentArchitectures: string[];
    missingArchitectures: string[];
    supportsAppleSilicon: boolean;
    supportsIntel: boolean;
  };
  artifactCounts: {
    total: number;
    existing: number;
    checksumVerified: number;
  };
  issues: string[];
  warnings: string[];
  nextSteps: string[];
  operatorChecklist: string[];
  files: MacReleaseIndexFileCheck[];
};

export type MacReleaseSigningReadinessSummary = {
  status: MacSigningReadinessReport["status"];
  label: string;
  externalDistributionReady: boolean;
  developerIdIdentityFound: boolean;
  notarizationRequested: boolean;
  notaryCredentialsProvided: boolean;
  signingIdentity: string | null;
  issues: string[];
  warnings: string[];
  nextSteps: string[];
};

export type MacReleaseExpectations = {
  version: string;
  nodeVersion: string;
};

export const summarizeMacSigningReadiness = (
  report: MacSigningReadinessReport,
): MacReleaseSigningReadinessSummary => ({
  status: report.status,
  label: report.label,
  externalDistributionReady: report.externalDistributionReady,
  developerIdIdentityFound: report.developerIdIdentityFound,
  notarizationRequested: report.environment.notarizeRequested,
  notaryCredentialsProvided: report.notaryCredentialsProvided,
  signingIdentity: report.environment.signingIdentity,
  issues: report.issues,
  warnings: report.warnings,
  nextSteps: report.nextSteps,
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultReleaseRoot = join(repoRoot, "dist", "macos", "release");
const requiredReleaseArchitectures = ["arm64", "x64"];

const releaseSetCheckFileName = (version: string) => `StockAnalysis-${version}-macos-release-check.json`;

const releaseManifestCheckFileName = (version: string, arch: string) =>
  `StockAnalysis-${version}-macos-${arch}-release-check.json`;

const kindFromPath = (path: string): MacReleaseFileCheck["kind"] => {
  if (path.endsWith(".dmg")) {
    return "dmg";
  }
  if (path.endsWith(".zip")) {
    return "zip";
  }
  if (path.endsWith(".json")) {
    return "manifest";
  }
  return "other";
};

const sha256File = async (path: string) => {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
};

const commandOutput = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    ok: result.status === 0,
    output: output || `${command} ${args.join(" ")} exited with status ${result.status ?? "unknown"}`,
  };
};

const assessDistributionDmg = (path: string, kind: MacReleaseFileCheck["kind"], exists: boolean) => {
  if (kind !== "dmg" || !exists) {
    return {
      staplerValidated: null,
      staplerDetail: null,
      gatekeeperAccepted: null,
      gatekeeperDetail: null,
    };
  }
  const stapler = commandOutput("xcrun", ["stapler", "validate", path]);
  const gatekeeper = commandOutput("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose",
    path,
  ]);
  return {
    staplerValidated: stapler.ok,
    staplerDetail: stapler.output,
    gatekeeperAccepted: gatekeeper.ok,
    gatekeeperDetail: gatekeeper.output,
  };
};

export const findLatestMacReleaseManifest = async (releaseRoot = defaultReleaseRoot) => {
  const files = await readdir(releaseRoot);
  const manifests = await Promise.all(
    files
      .filter((file) => file.startsWith("StockAnalysis-") && file.endsWith(".manifest.json"))
      .map(async (file) => {
        const path = join(releaseRoot, file);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }),
  );
  manifests.sort((lhs, rhs) => rhs.mtimeMs - lhs.mtimeMs);
  return manifests[0]?.path ?? null;
};

export const findLatestMacReleaseIndex = async (releaseRoot = defaultReleaseRoot) => {
  const files = await readdir(releaseRoot);
  const indexes = await Promise.all(
    files
      .filter((file) => file.startsWith("StockAnalysis-") && file.endsWith("-macos-release-index.json"))
      .map(async (file) => {
        const path = join(releaseRoot, file);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }),
  );
  indexes.sort((lhs, rhs) => rhs.mtimeMs - lhs.mtimeMs);
  return indexes[0]?.path ?? null;
};

export const readMacReleaseManifest = async (manifestPath: string) => {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as MacReleaseManifest;
};

export const readMacReleaseIndex = async (indexPath: string) => {
  const raw = await readFile(indexPath, "utf8");
  return JSON.parse(raw) as MacReleaseIndex;
};

export const checkMacReleaseFiles = async (manifest: MacReleaseManifest): Promise<MacReleaseFileCheck[]> => {
  const files = manifest.files ?? [];
  const checks: MacReleaseFileCheck[] = [];
  for (const file of files) {
    const path = file.path ?? "";
    const kind = kindFromPath(path);
    const exists = path.length > 0 && existsSync(path);
    const sha256Expected = file.sha256 ?? null;
    const sha256Actual = exists && sha256Expected ? await sha256File(path) : null;
    const distributionCheck = assessDistributionDmg(path, kind, exists);
    checks.push({
      path,
      kind,
      exists,
      sha256Expected,
      sha256Actual,
      sha256Matches: sha256Expected ? sha256Actual === sha256Expected : null,
      ...distributionCheck,
    });
  }
  return checks;
};

export const checkMacReleaseIndexFiles = async (index: MacReleaseIndex): Promise<MacReleaseIndexFileCheck[]> => {
  const entries = index.entries ?? [];
  const checks: MacReleaseIndexFileCheck[] = [];
  for (const entry of entries) {
    const arch = entry.arch ?? "unknown";
    const label = entry.label ?? arch;
    for (const file of entry.files ?? []) {
      const filePath = file.path ?? "";
      const fileName = file.fileName ?? null;
      const kind = kindFromPath(filePath || fileName || "");
      const exists = filePath.length > 0 && existsSync(filePath);
      const sha256Expected = file.sha256 ?? null;
      const sha256Actual = exists && sha256Expected ? await sha256File(filePath) : null;
      const distributionCheck = assessDistributionDmg(filePath, kind, exists);
      checks.push({
        arch,
        label,
        fileName,
        path: filePath,
        kind,
        exists,
        sha256Expected,
        sha256Actual,
        sha256Matches: sha256Expected ? sha256Actual === sha256Expected : null,
        ...distributionCheck,
      });
    }
  }
  return checks;
};

const architectureWarning = (arch: string) => {
  if (arch === "arm64") {
    return "현재 릴리즈는 arm64 전용입니다. Intel Mac까지 지원하려면 x64 빌드를 추가로 생성하거나 universal 빌드가 필요합니다.";
  }
  if (arch === "x64") {
    return "현재 릴리즈는 x64 전용입니다. Apple Silicon Mac까지 지원하려면 arm64 빌드를 추가로 생성하거나 universal 빌드가 필요합니다.";
  }
  if (arch !== "universal") {
    return `현재 릴리즈는 ${arch} 전용입니다. 모든 Mac을 지원하려면 arm64/x64 빌드 또는 universal 빌드가 필요합니다.`;
  }
  return null;
};

export const assessMacRelease = (
  manifest: MacReleaseManifest,
  files: MacReleaseFileCheck[],
  expectations?: MacReleaseExpectations,
): MacReleaseCheckReport => {
  const signingIdentity = manifest.signingIdentity?.trim() || "ad-hoc";
  const developerIdSigned = signingIdentity.startsWith("Developer ID Application:");
  const notarizationStapled = manifest.notarization?.stapled === true;
  const targetArch = manifest.compatibility?.targetArch ?? manifest.arch ?? "unknown";
  const supportedArchitectures = manifest.compatibility?.supportedArchitectures?.length
    ? manifest.compatibility.supportedArchitectures
    : targetArch === "universal"
      ? ["arm64", "x64"]
      : targetArch === "unknown"
        ? []
        : [targetArch];
  const sidecarVerified = manifest.compatibility?.sidecarVerified === true;
  const compatibility = {
    minimumMacOS: manifest.compatibility?.minimumMacOS ?? "14.0",
    targetArch,
    supportedArchitectures,
    supportsAppleSilicon: manifest.compatibility?.supportsAppleSilicon ?? supportedArchitectures.includes("arm64"),
    supportsIntel: manifest.compatibility?.supportsIntel ?? supportedArchitectures.includes("x64"),
    bundledNodeVersion: manifest.compatibility?.bundledNodeVersion ?? null,
    sidecarVerified,
  };
  const hasDmg = files.some((file) => file.kind === "dmg" && file.exists);
  const hasZip = files.some((file) => file.kind === "zip" && file.exists);
  const missingFiles = files.filter((file) => !file.exists);
  const checksumFailures = files.filter((file) => file.sha256Matches === false);
  const checksumVerified = files.filter((file) => file.sha256Matches === true).length;
  const dmgFiles = files.filter((file) => file.kind === "dmg" && file.exists);
  const staplerFailures = dmgFiles.filter((file) => file.staplerValidated !== true);
  const gatekeeperFailures = dmgFiles.filter((file) => file.gatekeeperAccepted !== true);
  const issues: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (expectations && manifest.version !== expectations.version) {
    issues.push(`릴리즈 버전이 현재 package.json과 다릅니다: expected ${expectations.version}, got ${manifest.version ?? "missing"}`);
    nextSteps.push("현재 package.json 기준으로 macOS 릴리즈를 다시 생성하세요.");
  }
  if (expectations) {
    try {
      assertMacNodeVersion(
        compatibility.bundledNodeVersion ?? "",
        expectations.nodeVersion,
        "Manifest bundled Node version",
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      nextSteps.push(".node-version 기준으로 macOS 릴리즈를 다시 생성하세요.");
    }
  }

  if (!hasDmg) {
    issues.push("DMG 설치 파일이 없습니다.");
    nextSteps.push("npm run mac:package로 DMG를 다시 생성하세요.");
  }
  if (!hasZip) {
    issues.push("ZIP 백업 파일이 없습니다.");
    nextSteps.push("npm run mac:package로 ZIP 백업 파일을 다시 생성하세요.");
  }
  for (const file of missingFiles) {
    issues.push(`아티팩트를 찾지 못했습니다: ${file.path || "(경로 없음)"}`);
  }
  for (const file of checksumFailures) {
    issues.push(`SHA-256 checksum이 manifest와 다릅니다: ${file.path}`);
    nextSteps.push("릴리즈 폴더를 지우고 npm run mac:package를 다시 실행하세요.");
  }
  if (!sidecarVerified) {
    issues.push("앱 번들 sidecar health 검증 결과가 없습니다.");
    nextSteps.push("npm run mac:package를 다시 실행해 번들 Node와 local-engine health check를 통과시키세요.");
  }
  if (!developerIdSigned) {
    warnings.push("현재 앱은 ad-hoc 또는 비 Developer ID 서명입니다. 다른 Mac에서 Gatekeeper 경고가 날 수 있습니다.");
    nextSteps.push("MACOS_CODESIGN_IDENTITY=\"Developer ID Application: ...\" 환경변수로 다시 패키징하세요.");
  }
  if (!notarizationStapled) {
    warnings.push("Apple 공증 티켓이 stapled 상태가 아닙니다. 외부 배포 전 공증이 필요합니다.");
    nextSteps.push("MACOS_NOTARIZE=1과 notarytool credential을 설정한 뒤 npm run mac:package를 실행하세요.");
  }
  if (developerIdSigned && notarizationStapled) {
    for (const file of staplerFailures) {
      issues.push(`DMG 공증 티켓 stapler 검증이 실패했습니다: ${file.path}`);
      nextSteps.push("MACOS_NOTARIZE=1로 다시 패키징하고 xcrun stapler validate 결과를 확인하세요.");
    }
    for (const file of gatekeeperFailures) {
      issues.push(`DMG Gatekeeper 평가가 실패했습니다: ${file.path}`);
      nextSteps.push("spctl --assess --type open --context context:primary-signature 결과를 확인하세요.");
    }
  } else {
    if (staplerFailures.length > 0) {
      warnings.push("DMG 공증 티켓 stapler 검증이 통과하지 않았습니다. 로컬 테스트는 가능하지만 외부 배포 전 공증이 필요합니다.");
    }
    if (gatekeeperFailures.length > 0) {
      warnings.push("DMG Gatekeeper 평가가 통과하지 않았습니다. 다른 Mac에서 경고가 날 수 있습니다.");
    }
  }
  const archWarning = architectureWarning(targetArch);
  if (archWarning) {
    warnings.push(archWarning);
  }

  const completeArtifacts = issues.length === 0;
  const distributionChecksPassed =
    dmgFiles.length > 0 &&
    dmgFiles.every((file) => file.staplerValidated === true && file.gatekeeperAccepted === true);
  const readyForExternalDistribution =
    completeArtifacts && developerIdSigned && notarizationStapled && distributionChecksPassed;
  const status = !completeArtifacts
    ? "incomplete"
    : readyForExternalDistribution
      ? "external-ready"
      : "local-test";

  return {
    ok: completeArtifacts,
    readyForExternalDistribution,
    status,
    label: status === "external-ready" ? "외부 배포 준비" : status === "local-test" ? "로컬 테스트 빌드" : "배포물 불완전",
    app: manifest.app ?? "StockAnalysis",
    version: manifest.version ?? "0.0.0",
    buildNumber: manifest.buildNumber ?? "-",
    arch: manifest.arch ?? "unknown",
    builtAt: manifest.builtAt ?? "-",
    signingIdentity,
    developerIdSigned,
    notarizationStapled,
    gatekeeperRisk: readyForExternalDistribution ? "low" : "high",
    compatibility,
    artifactCounts: {
      total: files.length,
      existing: files.filter((file) => file.exists).length,
      checksumVerified,
    },
    issues,
    warnings,
    nextSteps: Array.from(new Set(nextSteps)),
    operatorChecklist: [
      `macOS ${compatibility.minimumMacOS} 이상과 ${supportedArchitectures.length ? supportedArchitectures.join("/") : targetArch} Mac 대상 빌드인지 확인하세요.`,
      "DMG에서 StockAnalysis.app을 Applications로 옮긴 뒤 실행하세요.",
      "앱 배포 시트의 설치 후 점검을 실행해 sidecar, App Support 저장소, 뉴스/RSS, 전략 저장소 상태를 확인하세요.",
      "새 Mac에서는 Toss API 키를 앱 설정에서 다시 검증해 sidecar 저장소와 macOS Keychain에 저장하고 자동거래 계좌를 선택해야 합니다.",
      "Toss 개발자 콘솔의 허용 IP와 앱의 연결 진단 공인 IP가 일치해야 합니다.",
      "Toss 실거래는 단일 Mac·선택 계좌의 QA 승인과 별도 수동/자동화 토글을 모두 통과한 지정가 주문만 허용합니다. Upbit는 KRW 마켓 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장은 paper 전용입니다.",
    ],
    files,
  };
};

const entrySupportsArchitecture = (entry: MacReleaseIndexEntry, arch: string) => {
  const supportedArchitectures = entry.supportedArchitectures ?? [];
  return entry.arch === arch || entry.arch === "universal" || supportedArchitectures.includes(arch);
};

const defaultReleaseSetChecklist = [
  "대상 Mac CPU에 맞는 DMG를 전달합니다.",
  "Applications로 앱을 옮긴 뒤 배포 > 설치 후 점검을 실행합니다.",
  "Toss API 키는 Mac마다 다시 검증해 sidecar 저장소와 macOS Keychain에 저장하고 자동거래 계좌를 다시 선택합니다.",
  "Toss 허용 IP와 앱 연결 진단 공인 IP가 일치해야 합니다.",
  "Toss 실거래는 단일 Mac·선택 계좌의 QA 승인과 별도 수동/자동화 토글을 모두 통과한 지정가 주문만 허용합니다. Upbit는 KRW 마켓 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장은 paper 전용입니다.",
];

export const assessMacReleaseSet = (
  index: MacReleaseIndex,
  files: MacReleaseIndexFileCheck[],
  expectations?: MacReleaseExpectations,
): MacReleaseSetCheckReport => {
  const entries = index.entries ?? [];
  const entryByArch = new Map(entries.map((entry) => [entry.arch ?? "unknown", entry]));
  const presentArchitectures = requiredReleaseArchitectures.filter((arch) =>
    entries.some((entry) => entrySupportsArchitecture(entry, arch)),
  );
  const missingArchitectures = requiredReleaseArchitectures.filter((arch) => !presentArchitectures.includes(arch));
  const requiredEntries = requiredReleaseArchitectures
    .map((arch) => entries.find((entry) => entrySupportsArchitecture(entry, arch)))
    .filter((entry): entry is MacReleaseIndexEntry => Boolean(entry));
  const minimumMacOS = requiredEntries.find((entry) => entry.minimumMacOS)?.minimumMacOS ?? "14.0";
  const issues: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (expectations && index.version !== expectations.version) {
    issues.push(`릴리즈 인덱스 버전이 현재 package.json과 다릅니다: expected ${expectations.version}, got ${index.version ?? "missing"}`);
    nextSteps.push("현재 package.json 기준으로 macOS 릴리즈 세트를 다시 생성하세요.");
  }
  if (expectations) {
    const declaredNodeVersions = [
      { label: "Release index bundled Node version", version: index.bundledNodeVersion },
      ...requiredEntries.map((entry) => ({
        label: `${entry.arch ?? "unknown"} release entry bundled Node version`,
        version: entry.bundledNodeVersion ?? undefined,
      })),
    ];
    let nodeVersionMismatch = false;
    for (const declared of declaredNodeVersions) {
      try {
        assertMacNodeVersion(
          declared.version ?? "",
          expectations.nodeVersion,
          declared.label,
        );
      } catch (error) {
        nodeVersionMismatch = true;
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (nodeVersionMismatch) {
      nextSteps.push(".node-version 기준으로 arm64/x64 릴리즈 세트를 다시 생성하세요.");
    }
  }

  if (entries.length === 0) {
    issues.push("릴리즈 인덱스에 배포 항목이 없습니다.");
    nextSteps.push("npm run mac:package:all로 arm64/x64 릴리즈를 다시 생성하세요.");
  }
  if (missingArchitectures.includes("arm64")) {
    issues.push("Apple Silicon Mac용 arm64 릴리즈가 없습니다.");
    nextSteps.push("npm run mac:package:arm64를 실행하세요.");
  }
  if (missingArchitectures.includes("x64")) {
    issues.push("Intel Mac용 x64 릴리즈가 없습니다.");
    nextSteps.push("npm run mac:package:x64를 실행하세요.");
  }

  const filesForArchitecture = (arch: string) =>
    files.filter((file) => {
      const entry = entryByArch.get(file.arch);
      return entry ? entrySupportsArchitecture(entry, arch) : file.arch === arch;
    });

  for (const arch of presentArchitectures) {
    const label = arch === "arm64" ? "Apple Silicon Mac" : "Intel Mac";
    const archFiles = filesForArchitecture(arch);
    if (!archFiles.some((file) => file.kind === "dmg" && file.exists)) {
      issues.push(`${label} DMG 설치 파일이 없습니다.`);
      nextSteps.push(`npm run mac:package:${arch}를 실행하세요.`);
    }
    if (!archFiles.some((file) => file.kind === "zip" && file.exists)) {
      issues.push(`${label} ZIP 백업 파일이 없습니다.`);
      nextSteps.push(`npm run mac:package:${arch}를 실행하세요.`);
    }
  }

  for (const file of files.filter((file) => !file.exists)) {
    issues.push(`${file.label} 아티팩트를 찾지 못했습니다: ${file.path || file.fileName || "(경로 없음)"}`);
  }
  for (const file of files.filter((file) => file.exists && file.sha256Expected === null)) {
    issues.push(`${file.label} 아티팩트 checksum이 릴리즈 인덱스에 없습니다: ${file.path || file.fileName || "(경로 없음)"}`);
    nextSteps.push("npm run mac:package:all로 릴리즈 인덱스를 다시 생성하세요.");
  }
  for (const file of files.filter((file) => file.sha256Matches === false)) {
    issues.push(`${file.label} SHA-256 checksum이 릴리즈 인덱스와 다릅니다: ${file.path}`);
    nextSteps.push("릴리즈 폴더를 지우고 npm run mac:package:all을 다시 실행하세요.");
  }

  for (const arch of presentArchitectures) {
    const entry = entries.find((candidate) => entrySupportsArchitecture(candidate, arch));
    if (entry?.sidecarVerified !== true) {
      const label = arch === "arm64" ? "Apple Silicon Mac" : "Intel Mac";
      issues.push(`${label} sidecar health 검증 결과가 없습니다.`);
      nextSteps.push(`npm run mac:package:${arch}로 번들 Node와 local-engine health check를 통과시키세요.`);
    }
  }

  const sidecarVerified =
    missingArchitectures.length === 0 && requiredEntries.every((entry) => entry.sidecarVerified === true);
  const distributionDmgFiles = requiredReleaseArchitectures.flatMap((arch) =>
    filesForArchitecture(arch).filter((file) => file.kind === "dmg" && file.exists),
  );
  const distributionDmgChecksPassed =
    distributionDmgFiles.length >= requiredReleaseArchitectures.length &&
    distributionDmgFiles.every((file) => file.staplerValidated === true && file.gatekeeperAccepted === true);
  const developerIdReady =
    missingArchitectures.length === 0 &&
    requiredEntries.every((entry) => entry.readyForExternalDistribution === true) &&
    distributionDmgChecksPassed;
  if (!developerIdReady) {
    warnings.push("현재 release set은 Developer ID 서명/Apple 공증 완료 상태가 아닙니다. 다른 Mac에서 Gatekeeper 경고가 날 수 있습니다.");
    nextSteps.push("Developer ID 인증서와 notarytool credential을 설정한 뒤 npm run mac:package:all을 실행하세요.");
  }
  for (const file of distributionDmgFiles.filter((file) => file.staplerValidated !== true)) {
    const message = `${file.label} DMG 공증 티켓 stapler 검증이 통과하지 않았습니다: ${file.path}`;
    if (requiredEntries.some((entry) => entry.readyForExternalDistribution === true)) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
  }
  for (const file of distributionDmgFiles.filter((file) => file.gatekeeperAccepted !== true)) {
    const message = `${file.label} DMG Gatekeeper 평가가 통과하지 않았습니다: ${file.path}`;
    if (requiredEntries.some((entry) => entry.readyForExternalDistribution === true)) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
  }

  const ok = issues.length === 0 && sidecarVerified;
  const readyForExternalDistribution = ok && developerIdReady;
  const status = !ok
    ? "incomplete"
    : readyForExternalDistribution
      ? "external-ready"
      : "local-test";

  return {
    ok,
    readyForExternalDistribution,
    status,
    label: status === "external-ready" ? "외부 배포 준비" : status === "local-test" ? "로컬 테스트 빌드" : "배포물 불완전",
    app: index.app ?? "StockAnalysis",
    version: index.version ?? "0.0.0",
    buildNumber: index.buildNumber ?? "-",
    bundledNodeVersion: index.bundledNodeVersion ?? null,
    generatedAt: index.generatedAt ?? "-",
    releaseRoot: index.releaseRoot ?? defaultReleaseRoot,
    installGuide: index.installGuide ?? null,
    developerIdReady,
    sidecarVerified,
    gatekeeperRisk: readyForExternalDistribution ? "low" : "high",
    compatibility: {
      minimumMacOS,
      requiredArchitectures: requiredReleaseArchitectures,
      presentArchitectures,
      missingArchitectures,
      supportsAppleSilicon: presentArchitectures.includes("arm64"),
      supportsIntel: presentArchitectures.includes("x64"),
    },
    artifactCounts: {
      total: files.length,
      existing: files.filter((file) => file.exists).length,
      checksumVerified: files.filter((file) => file.sha256Matches === true).length,
    },
    issues,
    warnings,
    nextSteps: Array.from(new Set(nextSteps)),
    operatorChecklist: index.installChecklist?.length ? index.installChecklist : defaultReleaseSetChecklist,
    files,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  const checkReleaseSet = args.includes("--all");
  const requireExternal = args.includes("--require-external");
  const writeReport = args.includes("--write-report");
  const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
  const expectations: MacReleaseExpectations = {
    version: await readMacPackageVersion(repoRoot),
    nodeVersion: await readPinnedMacNodeVersion(repoRoot),
  };
  if (checkReleaseSet) {
    const explicitIndexPath = positionalArgs[0];
    const indexPath = explicitIndexPath ? resolve(explicitIndexPath) : await findLatestMacReleaseIndex();
    if (!indexPath) {
      throw new Error(`No StockAnalysis macOS release index found in ${defaultReleaseRoot}`);
    }
    const index = await readMacReleaseIndex(indexPath);
    const files = await checkMacReleaseIndexFiles(index);
    const report = assessMacReleaseSet(index, files, expectations);
    const signingReadiness = summarizeMacSigningReadiness(collectMacSigningReadinessReport());
    const output = { indexPath, ...report, signingReadiness };
    if (writeReport) {
      const reportPath = join(index.releaseRoot ?? defaultReleaseRoot, releaseSetCheckFileName(output.version));
      await writeFile(reportPath, `${JSON.stringify({ reportPath, ...output }, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ reportPath, ...output }, null, 2));
    } else {
      console.log(JSON.stringify(output, null, 2));
    }
    if (!report.ok || (requireExternal && !report.readyForExternalDistribution)) {
      process.exitCode = requireExternal && report.ok ? 2 : 1;
    }
    return;
  }
  const explicitManifestPath = positionalArgs[0];
  const manifestPath = explicitManifestPath ? resolve(explicitManifestPath) : await findLatestMacReleaseManifest();
  if (!manifestPath) {
    throw new Error(`No StockAnalysis macOS release manifest found in ${defaultReleaseRoot}`);
  }
  const manifest = await readMacReleaseManifest(manifestPath);
  const files = await checkMacReleaseFiles(manifest);
  const report = assessMacRelease(manifest, files, expectations);
  const signingReadiness = summarizeMacSigningReadiness(collectMacSigningReadinessReport());
  const output = { manifestPath, ...report, signingReadiness };
  if (writeReport) {
    const reportPath = join(dirname(manifestPath), releaseManifestCheckFileName(output.version, output.arch));
    await writeFile(reportPath, `${JSON.stringify({ reportPath, ...output }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ reportPath, ...output }, null, 2));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
  if (!report.ok || (requireExternal && !report.readyForExternalDistribution)) {
    process.exitCode = requireExternal && report.ok ? 2 : 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
