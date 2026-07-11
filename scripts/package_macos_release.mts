import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertMacNodeVersionOverride,
  normalizeMacBuildNumber,
  readMacPackageVersion,
  readPinnedMacNodeVersion,
} from "./macos_release_config.mts";

export type TargetArch = "arm64" | "x64";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(repoRoot, "dist", "macos");
const appRoot = join(distRoot, "StockAnalysis.app");
const releaseRoot = join(distRoot, "release");
const dmgStageRoot = join(distRoot, "dmg-stage");
const minimumMacOS = "14.0";
const normalizeTargetArch = (value: string): TargetArch => {
  if (value === "arm64" || value === "aarch64") {
    return "arm64";
  }
  if (value === "x64" || value === "x86_64") {
    return "x64";
  }
  throw new Error(`Unsupported MACOS_TARGET_ARCH: ${value}. Use arm64 or x64.`);
};
const targetArch = normalizeTargetArch(process.env.MACOS_TARGET_ARCH?.trim() || process.arch);
let nodeVersion = "";

const run = (command: string, args: string[], options: { capture?: boolean; env?: NodeJS.ProcessEnv } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const message = options.capture
      ? `${result.stderr}\n${result.stdout}`.trim()
      : `${command} ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return (result.stdout ?? "").trim();
};

const checksum = (path: string) =>
  run("shasum", ["-a", "256", path], { capture: true }).split(/\s+/)[0];

const releaseCompatibility = (options: { arch: string; sidecarVerified: boolean }) => ({
  minimumMacOS,
  targetArch: options.arch,
  supportedArchitectures: options.arch === "universal" ? ["arm64", "x64"] : [options.arch],
  supportsAppleSilicon: options.arch === "arm64" || options.arch === "universal",
  supportsIntel: options.arch === "x64" || options.arch === "universal",
  bundledNodeVersion: nodeVersion,
  sidecarVerified: options.sidecarVerified,
});

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

const compatibilityArchLabel = (arch: string) =>
  arch === "universal" ? "Apple Silicon/Intel" : arch;

export type MacReleaseHandoffArtifact = {
  kind: "dmg" | "zip" | "manifest";
  fileName: string;
  path: string;
  exists: boolean;
  sha256: string | null;
};

export type MacReleaseHandoffEntry = {
  arch: TargetArch;
  label: string;
  buildNumber: string | null;
  bundledNodeVersion: string | null;
  readyForExternalDistribution: boolean | null;
  status: string | null;
  sidecarVerified: boolean | null;
  minimumMacOS: string | null;
  supportedArchitectures: string[];
  files: MacReleaseHandoffArtifact[];
};

const installGuideFileName = (version: string) => `StockAnalysis-${version}-macos-install.md`;
const releaseIndexFileName = (version: string) => `StockAnalysis-${version}-macos-release-index.json`;
const installVerificationFileName = (version: string) => `StockAnalysis-${version}-macos-install-verification.json`;
const releaseCheckFileName = (version: string) => `StockAnalysis-${version}-macos-release-check.json`;
const dmgInstallReadmeFileName = "StockAnalysis 설치 안내.txt";

const releaseStatusFiles = (version: string, artifactBase: string) => [
  {
    kind: "zip",
    fileName: `${artifactBase}.zip`,
  },
  {
    kind: "dmg",
    fileName: `${artifactBase}.dmg`,
  },
  {
    kind: "manifest",
    fileName: `${artifactBase}.manifest.json`,
  },
  {
    kind: "install-guide",
    fileName: installGuideFileName(version),
  },
  {
    kind: "release-index",
    fileName: releaseIndexFileName(version),
  },
  {
    kind: "release-check",
    fileName: releaseCheckFileName(version),
  },
  {
    kind: "install-verification",
    fileName: installVerificationFileName(version),
  },
];

const codesignDetails = () => {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appRoot], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      line.startsWith("Authority=") ||
      line.startsWith("TeamIdentifier=") ||
      line.startsWith("Signature=") ||
      line.startsWith("Runtime Version="),
    );
};

const readJsonIfExists = async (path: string) => {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
};

const handoffArtifact = (kind: MacReleaseHandoffArtifact["kind"], fileName: string): MacReleaseHandoffArtifact => {
  const path = join(releaseRoot, fileName);
  const exists = existsSync(path);
  return {
    kind,
    fileName,
    path,
    exists,
    sha256: exists ? checksum(path) : null,
  };
};

const collectHandoffEntry = async (version: string, arch: TargetArch): Promise<MacReleaseHandoffEntry> => {
  const artifactBase = `StockAnalysis-${version}-macos-${arch}`;
  const manifestPath = join(releaseRoot, `${artifactBase}.manifest.json`);
  const manifest = await readJsonIfExists(manifestPath);
  const distribution = manifest?.distribution as Record<string, unknown> | undefined;
  const compatibility = manifest?.compatibility as Record<string, unknown> | undefined;
  const supportedArchitectures = Array.isArray(compatibility?.supportedArchitectures)
    ? compatibility.supportedArchitectures.filter((value): value is string => typeof value === "string")
    : [arch];
  return {
    arch,
    label: arch === "arm64" ? "Apple Silicon Mac" : "Intel Mac",
    buildNumber: typeof manifest?.buildNumber === "string" ? manifest.buildNumber : null,
    bundledNodeVersion: typeof compatibility?.bundledNodeVersion === "string"
      ? compatibility.bundledNodeVersion
      : null,
    readyForExternalDistribution: typeof distribution?.readyForExternalDistribution === "boolean"
      ? distribution.readyForExternalDistribution
      : null,
    status: typeof distribution?.status === "string" ? distribution.status : null,
    sidecarVerified: typeof compatibility?.sidecarVerified === "boolean" ? compatibility.sidecarVerified : null,
    minimumMacOS: typeof compatibility?.minimumMacOS === "string" ? compatibility.minimumMacOS : null,
    supportedArchitectures,
    files: [
      handoffArtifact("dmg", `${artifactBase}.dmg`),
      handoffArtifact("zip", `${artifactBase}.zip`),
      handoffArtifact("manifest", `${artifactBase}.manifest.json`),
    ],
  };
};

const artifactTableRows = (entries: MacReleaseHandoffEntry[]) =>
  entries
    .flatMap((entry) =>
      entry.files.map((file) =>
        `| ${entry.label} | ${file.kind.toUpperCase()} | ${file.fileName} | ${file.exists ? "있음" : "없음"} | ${file.sha256 ?? "-"} |`,
      ),
    )
    .join("\n");

export const buildMacReleaseInstallGuide = ({
  version,
  generatedAt,
  entries,
}: {
  version: string;
  generatedAt: string;
  entries: MacReleaseHandoffEntry[];
}) => {
  const arm64 = entries.find((entry) => entry.arch === "arm64");
  const x64 = entries.find((entry) => entry.arch === "x64");
  const minimumMacOSLabel = arm64?.minimumMacOS ?? x64?.minimumMacOS ?? minimumMacOS;
  return `# StockAnalysis macOS 설치 안내

- 버전: ${version}
- 생성 시각: ${generatedAt}
- 최소 macOS: ${minimumMacOSLabel} 이상

## 어떤 파일을 전달할까

- Apple Silicon Mac(M1/M2/M3/M4 계열): \`${arm64?.files.find((file) => file.kind === "dmg")?.fileName ?? `StockAnalysis-${version}-macos-arm64.dmg`}\`
- Intel Mac: \`${x64?.files.find((file) => file.kind === "dmg")?.fileName ?? `StockAnalysis-${version}-macos-x64.dmg`}\`
- ZIP은 DMG가 막힐 때 쓰는 백업 파일입니다.
- 같은 버전의 \`.manifest.json\`은 SHA-256, 서명, 공증, sidecar 검증 상태를 확인하는 명세입니다.
- \`${releaseCheckFileName(version)}\`은 실제 DMG 파일의 stapler/Gatekeeper 평가와 SHA-256 검증 결과를 포함합니다.
- \`${installVerificationFileName(version)}\`은 DMG에서 복사한 앱의 sidecar, Toss/전략/전략백업/체결동기화 endpoint, 앱 실행, UI 버튼 smoke 검증 리포트입니다.

## 설치 순서

1. 대상 Mac CPU에 맞는 DMG를 전달합니다.
2. DMG를 열고 \`StockAnalysis.app\`을 \`Applications\` 아이콘으로 드래그합니다.
3. Finder의 Applications에서 \`StockAnalysis.app\`을 더블클릭합니다. 사용자는 별도 터미널이나 sidecar 명령을 실행하지 않습니다.
4. 앱을 실행한 뒤 상단 \`배포\`를 열고 \`설치 후 점검\`을 실행합니다.
5. \`첫 실행 설정\`에서 \`Toss API 키\`, \`자동매매 전략\`, \`앱 점검\`, \`앱 배포\` 시트를 순서대로 열어 기본 상태를 확인합니다.
6. \`점검\`에서 Sidecar, 뉴스/RSS, 분석, 브리핑, 전략 저장/시뮬레이션, 자동화 dry-run 실패가 0인지 확인합니다.
7. 실계좌 조회가 필요할 때만 \`Toss\`에서 API 키를 검증 후 sidecar 저장소와 macOS Keychain에 저장하고 사용할 BROKERAGE 계좌를 선택합니다.
8. Toss 개발자 콘솔 허용 IP가 앱의 Toss 연결 진단 공인 IP와 같은지 확인합니다.
9. Toss 실거래는 이 Mac의 선택 계좌 QA, 수동/자동화 별도 토글, 지정가·한도를 모두 통과한 경우에만 허용합니다. Upbit는 KRW 마켓의 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장가는 paper 전용입니다.

## 패키징 검증 근거

- \`npm run mac:verify:install:all -- --write-report --ui-smoke\`가 arm64/x64 DMG를 마운트하고 임시 Applications 경로에 복사한 앱을 검증합니다.
- 리포트에서 \`sidecarVerified\`, \`sidecarEndpointVerified\`, \`appLaunchVerified\`, \`uiSmokeVerified\`가 모두 true여야 합니다.
- \`npm run mac:release-check:all -- --write-report\`가 \`${releaseCheckFileName(version)}\`에 실제 DMG 파일의 \`staplerValidated\`와 \`gatekeeperAccepted\` 증거를 남깁니다.
- \`npm run mac:release-check:public\`은 실제 DMG 파일의 \`staplerValidated=true\`와 \`gatekeeperAccepted=true\` 증거가 없으면 외부 배포 준비로 통과하지 않습니다.
- 설치본 UI smoke는 Beginner-first 온보딩, 삼성전자 fixture 분석, 출처·통화·봉 주기, 단타·스윙·장기 손절·익절, 신호·뉴스·민심, 모의 주문 drawer, 자산, 기존 전략 순서, PAPER 자동화와 설정 진입을 AXIdentifier로 확인합니다.
- \`uiSmokeChecks.samsungFixtureAnalysis=true\`이면 API 키 없이 삼성전자 예제 분석 흐름이 완료된 것입니다.
- \`uiSmokeChecks.horizonPlans=true\`이면 단타·스윙·장기 탭에서 손절·1차·2차 익절 정보가 표시된 것입니다.
- \`uiSmokeChecks.paperOrderDrawerNoSubmit=true\`이면 기존 paper 주문 drawer를 열고 실제 broker 제출 없이 닫은 것입니다.
- \`uiSmokeChecks.strategyWorkflowOrder=true\`이면 Beginner-first 전략 workspace의 \`초안 저장 → 조건 확인 → 시뮬레이션 → 활성화\` 순서를 확인한 것입니다.
- \`uiSmokeChecks.responsiveWindowSizes=true\`이면 1440×900과 최소 1024×720 콘텐츠 영역에서 주요 workspace가 창 밖으로 잘리지 않은 것입니다.
- \`sidecarEndpointChecks.strategyBackupImport=true\`이면 번들 sidecar가 전략 백업 JSON을 안전하게 export하고, import 시 활성 상태와 시뮬레이션 증거를 버린 draft-only 전략으로 복구하는 endpoint 경로를 통과한 것입니다.
- DMG SHA-256은 앱 바깥의 release index와 release-check 리포트에서 검증합니다. 설치된 앱은 원본 DMG 파일과 분리되므로 자기 DMG 체크섬 복사를 UI smoke 필수 조건으로 삼지 않습니다.

## 주문 안전 조건

- SwiftUI 앱은 broker를 직접 호출하지 않습니다.
- 모든 주문은 TypeScript sidecar의 \`OrderIntent\`와 \`RiskCheck\` 경계를 통과해야 합니다.
- Upbit 수동 주문은 1회 10만원, KST 일일 30만원 한도이며, 실패 원인을 표시하고 timeout·429·5xx 결과는 자동 재시도하지 않고 잠급니다.
- Developer ID 서명과 Apple 공증 전에는 다른 Mac에서 Gatekeeper 경고가 날 수 있습니다.
- \`IP address not allowed\`가 나오면 앱 문제가 아니라 Toss 허용 IP 불일치일 가능성이 높습니다. 앱의 연결 진단 공인 IP를 Toss Open API 콘솔에 등록한 뒤 다시 검증하세요.

## 파일 체크섬

| 대상 | 종류 | 파일 | 상태 | SHA-256 |
| --- | --- | --- | --- | --- |
${artifactTableRows(entries)}
`;
};

export const buildDmgInstallReadme = ({
  version,
  arch,
}: {
  version: string;
  arch: TargetArch;
}) => `StockAnalysis macOS ${version} (${arch}) 설치 안내

1. StockAnalysis.app을 Applications 아이콘으로 드래그합니다.
2. Applications에서 StockAnalysis.app을 더블클릭합니다. 별도 터미널 명령은 필요 없습니다.
3. 앱 상단의 배포 > 설치 후 점검을 실행합니다.
4. 첫 실행 설정에서 Toss API 키, 자동매매 전략, 앱 점검, 앱 배포 시트를 확인합니다.
5. Toss 실계좌 조회가 필요하면 API 키를 이 Mac에서 다시 검증하고 사용할 계좌를 선택합니다.
6. Toss 개발자 콘솔 허용 IP와 앱의 공인 IP 진단 결과가 일치해야 합니다.
7. Toss 실거래는 이 Mac의 선택 계좌 QA, 수동/자동화 별도 토글, 지정가·한도를 모두 통과한 경우에만 허용합니다. Upbit는 KRW 마켓 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장은 paper 전용입니다.

모든 실제 주문은 TypeScript sidecar의 OrderIntent와 RiskCheck 경계를 통과합니다. Upbit 수동 주문은 1회 10만원, KST 일일 30만원 한도이며 timeout·429·5xx 결과는 자동 재시도하지 않고 잠급니다.

Developer ID 서명과 Apple 공증이 없는 로컬 테스트 빌드는 Gatekeeper 경고가 날 수 있습니다.
`;

const prepareDmgStage = async (version: string, arch: TargetArch) => {
  const stageRoot = join(dmgStageRoot, `StockAnalysis-${version}-macos-${arch}`);
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  await cp(appRoot, join(stageRoot, "StockAnalysis.app"), {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await symlink("/Applications", join(stageRoot, "Applications"));
  await writeFile(join(stageRoot, dmgInstallReadmeFileName), buildDmgInstallReadme({ version, arch }), "utf8");
  return stageRoot;
};

const writeMacReleaseHandoffFiles = async (version: string, buildNumber: string) => {
  const generatedAt = new Date().toISOString();
  const entries = await Promise.all([
    collectHandoffEntry(version, "arm64"),
    collectHandoffEntry(version, "x64"),
  ]);
  const indexPath = join(releaseRoot, releaseIndexFileName(version));
  const installGuidePath = join(releaseRoot, installGuideFileName(version));
  await writeFile(indexPath, `${JSON.stringify({
    app: "StockAnalysis",
    version,
    buildNumber,
    bundledNodeVersion: nodeVersion,
    platform: "macos",
    generatedAt,
    releaseRoot,
    installGuide: installGuideFileName(version),
    entries,
    installChecklist: [
      "대상 Mac CPU에 맞는 DMG를 전달합니다.",
      "DMG에서 StockAnalysis.app을 Applications 아이콘으로 드래그한 뒤 Finder에서 앱을 더블클릭합니다.",
      "사용자는 별도 터미널 sidecar 명령 없이 앱 상단 배포 > 설치 후 점검을 실행합니다.",
      "StockAnalysis-<version>-macos-release-check.json에서 각 DMG의 staplerValidated/gatekeeperAccepted 값을 확인합니다.",
      "StockAnalysis-<version>-macos-install-verification.json에서 sidecarEndpointChecks.strategyBackupImport/automationScheduler, appLaunchVerified/uiSmokeVerified, uiSmokeChecks.samsungFixtureAnalysis/horizonPlans/paperOrderDrawerNoSubmit/strategyWorkflowOrder/responsiveWindowSizes가 true인지 확인합니다.",
      "Toss API 키는 Mac마다 다시 검증해 sidecar 저장소와 macOS Keychain에 저장하고 자동거래 계좌를 다시 선택합니다.",
      "Toss 허용 IP와 앱 연결 진단 공인 IP가 일치해야 합니다.",
      "Toss 실거래는 이 Mac의 선택 계좌 QA, 수동/자동화 별도 토글, 지정가·한도를 모두 통과한 경우에만 허용합니다. Upbit는 KRW 마켓 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장은 paper 전용입니다.",
    ],
  }, null, 2)}\n`, "utf8");
  await writeFile(installGuidePath, buildMacReleaseInstallGuide({ version, generatedAt, entries }), "utf8");
  return { indexPath, installGuidePath };
};

const notarizationArgs = (artifactPath: string) => {
  const profile = process.env.MACOS_NOTARYTOOL_PROFILE?.trim();
  if (profile) {
    return ["notarytool", "submit", artifactPath, "--keychain-profile", profile, "--wait"];
  }
  const appleId = process.env.APPLE_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const password = process.env.APPLE_APP_PASSWORD?.trim();
  if (!appleId || !teamId || !password) {
    throw new Error("MACOS_NOTARIZE=1 requires MACOS_NOTARYTOOL_PROFILE or APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD.");
  }
  return ["notarytool", "submit", artifactPath, "--apple-id", appleId, "--team-id", teamId, "--password", password, "--wait"];
};

const maybeNotarize = (dmgPath: string) => {
  if (process.env.MACOS_NOTARIZE !== "1") {
    return {
      requested: false,
      stapled: false,
    };
  }
  if (!process.env.MACOS_CODESIGN_IDENTITY?.trim()) {
    throw new Error("MACOS_NOTARIZE=1 requires MACOS_CODESIGN_IDENTITY for Developer ID signing.");
  }
  run("xcrun", notarizationArgs(dmgPath));
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "validate", dmgPath]);
  return {
    requested: true,
    stapled: true,
  };
};

const distributionReadiness = (options: { arch: string; signingIdentity: string; notarizationStapled: boolean }) => {
  const developerIdSigned = options.signingIdentity.startsWith("Developer ID Application:");
  const readyForExternalDistribution = developerIdSigned && options.notarizationStapled;
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (!developerIdSigned) {
    warnings.push("현재 앱은 ad-hoc 또는 비 Developer ID 서명입니다. 다른 Mac에서 Gatekeeper 경고가 날 수 있습니다.");
    nextSteps.push("MACOS_CODESIGN_IDENTITY=\"Developer ID Application: ...\" 환경변수로 다시 패키징하세요.");
  }
  if (!options.notarizationStapled) {
    warnings.push("Apple 공증 티켓이 stapled 상태가 아닙니다. 외부 배포 전 공증이 필요합니다.");
    nextSteps.push("MACOS_NOTARIZE=1과 notarytool credential을 설정한 뒤 npm run mac:package를 실행하세요.");
  }
  const archWarning = architectureWarning(options.arch);
  if (archWarning) {
    warnings.push(archWarning);
  }

  return {
    status: readyForExternalDistribution ? "external-ready" : "local-test",
    label: readyForExternalDistribution ? "외부 배포 준비" : "로컬 테스트 빌드",
    readyForExternalDistribution,
    developerIdSigned,
    notarizationStapled: options.notarizationStapled,
    gatekeeperRisk: readyForExternalDistribution ? "low" : "high",
    architecture: options.arch,
    warnings,
    nextSteps: Array.from(new Set(nextSteps)),
    operatorChecklist: [
      "DMG에서 StockAnalysis.app을 Applications로 옮긴 뒤 실행하세요.",
      "앱 배포 시트의 설치 후 점검을 실행해 sidecar, App Support 저장소, 뉴스/RSS, 전략 저장소 상태를 확인하세요.",
      "install-verification 리포트에서 sidecarEndpointVerified/appLaunchVerified/uiSmokeVerified와 Beginner-first 핵심 UI checks가 true인지 확인하세요.",
      "새 Mac에서는 Toss API 키를 앱 설정에서 다시 검증해 sidecar 저장소와 macOS Keychain에 저장하고 자동거래 계좌를 선택해야 합니다.",
      "Toss 개발자 콘솔의 허용 IP와 앱의 연결 진단 공인 IP가 일치해야 합니다.",
      "Toss 실거래는 이 Mac의 선택 계좌 QA, 수동/자동화 별도 토글, 지정가·한도를 모두 통과한 경우에만 허용합니다. Upbit는 KRW 마켓 수동 지정가만 별도 QA 승인, 재입력 수동 토글, 사전·직전 검증을 모두 통과한 경우에만 허용합니다. Bithumb과 코인 자동화·시장은 paper 전용입니다.",
    ],
  };
};

const main = async () => {
  const version = await readMacPackageVersion(repoRoot);
  nodeVersion = await readPinnedMacNodeVersion(repoRoot);
  assertMacNodeVersionOverride(process.env.MACOS_NODE_VERSION, nodeVersion);
  const buildNumber = normalizeMacBuildNumber(process.env.MACOS_BUILD_NUMBER);
  const arch = targetArch;
  const artifactBase = `StockAnalysis-${version}-macos-${arch}`;
  const zipPath = join(releaseRoot, `${artifactBase}.zip`);
  const dmgPath = join(releaseRoot, `${artifactBase}.dmg`);
  const manifestPath = join(releaseRoot, `${artifactBase}.manifest.json`);
  const signingIdentity = process.env.MACOS_CODESIGN_IDENTITY?.trim() || "ad-hoc";
  const notarizationExpected = process.env.MACOS_NOTARIZE === "1";
  const builtAt = new Date().toISOString();
  const expectedDistribution = distributionReadiness({
    arch,
    signingIdentity,
    notarizationStapled: notarizationExpected,
  });
  const releaseStatus = {
    app: "StockAnalysis",
    bundleIdentifier: "com.stockanalysis.mac",
    version,
    buildNumber,
    platform: "macos",
    arch,
    builtAt,
    signingIdentity,
    notarization: {
      requested: notarizationExpected,
      stapled: notarizationExpected,
    },
    compatibility: releaseCompatibility({ arch, sidecarVerified: true }),
    distribution: expectedDistribution,
    files: releaseStatusFiles(version, artifactBase),
  };

  run(process.execPath, ["--experimental-strip-types", "scripts/build_macos_app.mts"], {
    env: {
      ...process.env,
      MACOS_TARGET_ARCH: arch,
      STOCK_ANALYSIS_RELEASE_STATUS_JSON: JSON.stringify(releaseStatus),
    },
  });
  run(process.execPath, ["--experimental-strip-types", "scripts/verify_macos_app.mts", appRoot]);

  await mkdir(releaseRoot, { recursive: true });
  await rm(zipPath, { force: true });
  await rm(dmgPath, { force: true });
  await rm(manifestPath, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", appRoot, zipPath]);
  const dmgStage = await prepareDmgStage(version, arch);
  run("hdiutil", ["create", "-volname", "StockAnalysis", "-srcfolder", dmgStage, "-ov", "-format", "UDZO", dmgPath]);

  const notarization = maybeNotarize(dmgPath);
  const distribution = distributionReadiness({
    arch,
    signingIdentity,
    notarizationStapled: notarization.stapled,
  });
  const files = [
    {
      kind: "zip",
      fileName: `${artifactBase}.zip`,
      path: zipPath,
      sha256: checksum(zipPath),
    },
    {
      kind: "dmg",
      fileName: `${artifactBase}.dmg`,
      path: dmgPath,
      sha256: checksum(dmgPath),
    },
  ];
  await writeFile(manifestPath, `${JSON.stringify({
    app: "StockAnalysis",
    bundleIdentifier: "com.stockanalysis.mac",
    version,
    buildNumber,
    platform: "macos",
    arch,
    builtAt,
    signingIdentity,
    codesign: codesignDetails(),
    notarization,
    compatibility: releaseCompatibility({ arch, sidecarVerified: true }),
    distribution,
    files,
    install: {
      dmg: "DMG를 열고 StockAnalysis.app을 Applications 아이콘으로 드래그한 뒤 Applications에서 실행하세요.",
      zip: "ZIP을 풀고 StockAnalysis.app을 Applications로 옮긴 뒤 실행하세요.",
      firstRun: "앱 상단 배포 > 설치 후 점검을 실행한 뒤 분석 모드, 선택적인 Toss 연결, Upbit 읽기 전용 QA와 수동 지정가 보호 설정을 확인하세요.",
      compatibility: `macOS ${minimumMacOS} 이상, ${compatibilityArchLabel(arch)} Mac 대상 빌드입니다.`,
      dmgLayout: {
        app: "StockAnalysis.app",
        applicationsSymlink: true,
        readme: dmgInstallReadmeFileName,
      },
    },
    verification: [
      "codesign --verify --deep --strict --verbose=2 StockAnalysis.app",
      "spctl --assess --type execute --verbose StockAnalysis.app",
    ],
  }, null, 2)}\n`, "utf8");
  const handoff = await writeMacReleaseHandoffFiles(version, buildNumber);

  if (!existsSync(zipPath) || !existsSync(dmgPath)) {
    throw new Error("Release artifacts were not created.");
  }

  console.log(JSON.stringify({
    ok: true,
    releaseRoot,
    zipPath,
    dmgPath,
    manifestPath,
    installGuidePath: handoff.installGuidePath,
    releaseIndexPath: handoff.indexPath,
    notarization,
  }, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
