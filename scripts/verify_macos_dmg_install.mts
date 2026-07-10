import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseIndexFile = {
  kind?: string;
  fileName?: string;
  path?: string;
  sha256?: string | null;
};

export type ReleaseIndexEntry = {
  files?: ReleaseIndexFile[];
};

export type ReleaseIndex = {
  app?: string;
  version?: string;
  platform?: string;
  entries?: ReleaseIndexEntry[];
};

export type SidecarEndpointChecks = {
  health?: boolean;
  tossOpenApiContract?: boolean;
  tossReadinessNoCredential?: boolean;
  localSelfTest?: boolean;
  brokerDiagnostics?: boolean;
  publicIpCheckSkipped?: boolean;
  brokerCredentials?: boolean;
  accountPreferenceNoCredential?: boolean;
  liveTradingNoCredential?: boolean;
  strategyConfigs?: boolean;
  strategyLifecycle?: boolean;
  strategyBackupImport?: boolean;
  newsEvents?: boolean;
  terminalDashboard?: boolean;
  dashboardPlaybook?: boolean;
  paperOrderIntent?: boolean;
  paperReset?: boolean;
  killSwitch?: boolean;
  workerControl?: boolean;
  automationScheduler?: boolean;
  symbolSearch?: boolean;
  cryptoExchangeSafety?: boolean;
  cryptoStrategyLifecycle?: boolean;
  automationDryRun?: boolean;
  orderSyncNoCredential?: boolean;
  holdingsNoCredential?: boolean;
  orderPrecheckNoCredential?: boolean;
};

export type AppLaunchEndpointChecks = {
  appLaunch?: boolean;
  appProcessAlive?: boolean;
  sidecarAutostart?: boolean;
  terminalDashboard?: boolean;
  localSelfTest?: boolean;
  sidecarLog?: boolean;
};

export type UiSmokeChecks = {
  beginnerFirstOnboarding?: boolean;
  samsungFixtureAnalysis?: boolean;
  sourceCurrencyTimeframeVisible?: boolean;
  horizonPlans?: boolean;
  signalAndNewsSentimentTabs?: boolean;
  paperOrderDrawerNoSubmit?: boolean;
  assetsWorkspace?: boolean;
  strategyWorkflowOrder?: boolean;
  strategyWorkspaceSmoke?: boolean;
  automationPaperOnly?: boolean;
  killSwitchReachable?: boolean;
  settingsApiReachable?: boolean;
  selfTestReachable?: boolean;
  sidecarLogReachable?: boolean;
  distributionReachable?: boolean;
  responsiveWindowSizes?: boolean;
};

export type InstalledAppVerificationResult = {
  ok: boolean;
  dmgPath: string;
  dmgSha256: string | null;
  fileName: string;
  installedAppPath: string;
  error: string | null;
  sidecarVerified: boolean;
  sidecarEndpointChecks: SidecarEndpointChecks | null;
  sidecarEndpointVerified: boolean;
  appLaunchVerified: boolean;
  appLaunchEndpointChecks: AppLaunchEndpointChecks | null;
  appLaunchOutputLines: string[];
  uiSmokeVerified: boolean;
  uiSmokeChecks: UiSmokeChecks | null;
  uiSmokeOutputLines: string[];
  nodeVersion: string | null;
  verificationOutputLines: string[];
};

export type DmgInstallVerificationReport = {
  ok: boolean;
  app: string;
  version: string;
  platform: string;
  generatedAt: string;
  releaseRoot: string;
  installMode: "dmg-copy-to-temporary-applications";
  checked: number;
  results: InstalledAppVerificationResult[];
  issues: string[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repoRoot, "dist", "macos", "release");

const run = (
  command: string,
  args: string[],
  options: { capture?: boolean; cwd?: string } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(options.capture && output ? output : `${command} ${args.join(" ")} failed`);
  }
  return output;
};

const checksum = (path: string) =>
  existsSync(path) ? run("shasum", ["-a", "256", path], { capture: true }).split(/\s+/)[0] ?? null : null;

const latestReleaseIndexPath = async () => {
  const files = await readdir(releaseRoot);
  const candidates = await Promise.all(
    files
      .filter((file) => file.startsWith("StockAnalysis-") && file.endsWith("-macos-release-index.json"))
      .map(async (file) => {
        const path = join(releaseRoot, file);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }),
  );
  candidates.sort((lhs, rhs) => rhs.mtimeMs - lhs.mtimeMs);
  return candidates[0]?.path ?? null;
};

const readReleaseIndex = async (path: string) => {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as ReleaseIndex;
};

export const dmgInstallVerificationFileName = (version: string) =>
  `StockAnalysis-${version}-macos-install-verification.json`;

const dmgPathsFromIndex = (index: ReleaseIndex) => {
  const paths: string[] = [];
  for (const entry of index.entries ?? []) {
    for (const file of entry.files ?? []) {
      if (file.kind !== "dmg") {
        continue;
      }
      const path = file.path ?? (file.fileName ? join(releaseRoot, file.fileName) : "");
      if (path) {
        paths.push(path);
      }
    }
  }
  return Array.from(new Set(paths));
};

const expectedDmgFilesFromIndex = (index: ReleaseIndex) => {
  const files: Array<{ fileName: string; path: string; sha256: string | null }> = [];
  const seen = new Set<string>();
  for (const entry of index.entries ?? []) {
    for (const file of entry.files ?? []) {
      if (file.kind !== "dmg" || !file.fileName) {
        continue;
      }
      const path = file.path ?? join(releaseRoot, file.fileName);
      if (seen.has(file.fileName)) {
        continue;
      }
      seen.add(file.fileName);
      files.push({
        fileName: file.fileName,
        path,
        sha256: file.sha256 ?? null,
      });
    }
  }
  return files;
};

const resolveDmgPaths = async (args: string[]) => {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 0) {
    return positional.map((arg) => resolve(arg));
  }

  const indexPath = await latestReleaseIndexPath();
  if (!indexPath) {
    throw new Error(`No StockAnalysis macOS release index found in ${releaseRoot}`);
  }
  const index = await readReleaseIndex(indexPath);
  const paths = dmgPathsFromIndex(index);
  if (paths.length === 0) {
    throw new Error(`No DMG artifacts listed in ${indexPath}`);
  }
  return paths;
};

const nodeVersionFromVerificationOutput = (output: string) => {
  const match = output.match(/"nodeVersion"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
};

const sidecarVerifiedFromVerificationOutput = (output: string) =>
  /"sidecar"\s*:\s*"verified"/.test(output);

const requiredSidecarEndpointChecks = [
  "health",
  "tossOpenApiContract",
  "tossReadinessNoCredential",
  "localSelfTest",
  "brokerDiagnostics",
  "publicIpCheckSkipped",
  "brokerCredentials",
  "accountPreferenceNoCredential",
  "liveTradingNoCredential",
  "strategyConfigs",
  "strategyLifecycle",
  "strategyBackupImport",
  "newsEvents",
  "terminalDashboard",
  "dashboardPlaybook",
  "paperOrderIntent",
  "paperReset",
  "killSwitch",
  "workerControl",
  "automationScheduler",
  "symbolSearch",
  "cryptoExchangeSafety",
  "cryptoStrategyLifecycle",
  "automationDryRun",
  "orderSyncNoCredential",
  "holdingsNoCredential",
  "orderPrecheckNoCredential",
] as const;

const requiredAppLaunchEndpointChecks = [
  "appLaunch",
  "appProcessAlive",
  "sidecarAutostart",
  "terminalDashboard",
  "localSelfTest",
  "sidecarLog",
] as const;

const requiredUiSmokeChecks = [
  "beginnerFirstOnboarding",
  "samsungFixtureAnalysis",
  "sourceCurrencyTimeframeVisible",
  "horizonPlans",
  "signalAndNewsSentimentTabs",
  "paperOrderDrawerNoSubmit",
  "assetsWorkspace",
  "strategyWorkflowOrder",
  "strategyWorkspaceSmoke",
  "automationPaperOnly",
  "killSwitchReachable",
  "settingsApiReachable",
  "selfTestReachable",
  "sidecarLogReachable",
  "distributionReachable",
  "responsiveWindowSizes",
] as const;

const verificationJsonFromOutput = (output: string) => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const sidecarEndpointChecksFromVerificationOutput = (output: string): SidecarEndpointChecks | null => {
  const payload = verificationJsonFromOutput(output);
  const checks = payload?.sidecarEndpointChecks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return null;
  }
  return checks as SidecarEndpointChecks;
};

export const sidecarEndpointChecksVerified = (checks: SidecarEndpointChecks | null) =>
  !!checks && requiredSidecarEndpointChecks.every((key) => checks[key] === true);

export const appLaunchEndpointChecksFromVerificationOutput = (output: string): AppLaunchEndpointChecks | null => {
  const payload = verificationJsonFromOutput(output);
  const checks = payload?.endpointChecks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return null;
  }
  return checks as AppLaunchEndpointChecks;
};

export const appLaunchEndpointChecksVerified = (checks: AppLaunchEndpointChecks | null) =>
  !!checks && requiredAppLaunchEndpointChecks.every((key) => checks[key] === true);

export const uiSmokeChecksFromVerificationOutput = (output: string): UiSmokeChecks | null => {
  const payload = verificationJsonFromOutput(output);
  const checks = payload?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return null;
  }
  return checks as UiSmokeChecks;
};

export const uiSmokeChecksVerified = (checks: UiSmokeChecks | null) =>
  !!checks && requiredUiSmokeChecks.every((key) => checks[key] === true);

const sidecarEndpointIssue = (result: InstalledAppVerificationResult) => {
  if (result.error) {
    return `${result.fileName} copied app verification failed: ${result.error}`;
  }
  if (!result.sidecarVerified) {
    return `${result.fileName} copied app sidecar verification failed`;
  }
  if (!result.sidecarEndpointVerified) {
    const missing = requiredSidecarEndpointChecks.filter((key) => result.sidecarEndpointChecks?.[key] !== true);
    return `${result.fileName} copied app sidecar endpoint checks failed: ${missing.join(", ")}`;
  }
  if (!result.appLaunchVerified) {
    const missing = requiredAppLaunchEndpointChecks.filter((key) => result.appLaunchEndpointChecks?.[key] !== true);
    return `${result.fileName} copied app launch checks failed: ${missing.join(", ")}`;
  }
  if (!result.uiSmokeVerified && result.uiSmokeChecks !== null) {
    const missing = requiredUiSmokeChecks.filter((key) => result.uiSmokeChecks?.[key] !== true);
    return `${result.fileName} copied app UI smoke checks failed: ${missing.join(", ")}`;
  }
  return null;
};

const verifyInstalledAppFromDmg = async (
  dmgPath: string,
  options: { uiSmoke: boolean },
): Promise<InstalledAppVerificationResult> => {
  if (!existsSync(dmgPath)) {
    throw new Error(`DMG 파일을 찾지 못했습니다: ${dmgPath}`);
  }

  const mountPoint = await mkdtemp(join(tmpdir(), "stockanalysis-dmg-install-mount-"));
  const installRoot = await mkdtemp(join(tmpdir(), "stockanalysis-dmg-install-target-"));
  const applicationsRoot = join(installRoot, "Applications");
  const mountedAppPath = join(mountPoint, "StockAnalysis.app");
  const installedAppPath = join(applicationsRoot, "StockAnalysis.app");
  let attached = false;

  try {
    run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath], { capture: true });
    attached = true;
    if (!existsSync(mountedAppPath)) {
      throw new Error(`${basename(dmgPath)} 안에서 StockAnalysis.app을 찾지 못했습니다.`);
    }
    await mkdir(applicationsRoot, { recursive: true });
    run("ditto", [mountedAppPath, installedAppPath], { capture: true });
    try {
      const verificationOutput = run(process.execPath, [
        "--experimental-strip-types",
        "scripts/verify_macos_app.mts",
        installedAppPath,
      ], { capture: true });
      const sidecarEndpointChecks = sidecarEndpointChecksFromVerificationOutput(verificationOutput);
      const launchOutput = run(process.execPath, [
        "--experimental-strip-types",
        "scripts/verify_macos_app_launch.mts",
        installedAppPath,
      ], { capture: true });
      const appLaunchEndpointChecks = appLaunchEndpointChecksFromVerificationOutput(launchOutput);
      const uiSmokeOutput = options.uiSmoke
        ? run(process.execPath, [
            "--experimental-strip-types",
            "scripts/verify_macos_ui_smoke.mts",
            installedAppPath,
            "--installed-copy",
          ], { capture: true })
        : "";
      const uiSmokeChecks = options.uiSmoke
        ? uiSmokeChecksFromVerificationOutput(uiSmokeOutput)
        : null;
      return {
        ok: true,
        dmgPath,
        dmgSha256: checksum(dmgPath),
        fileName: basename(dmgPath),
        installedAppPath,
        error: null,
        sidecarVerified: sidecarVerifiedFromVerificationOutput(verificationOutput),
        sidecarEndpointChecks,
        sidecarEndpointVerified: sidecarEndpointChecksVerified(sidecarEndpointChecks),
        appLaunchVerified: appLaunchEndpointChecksVerified(appLaunchEndpointChecks),
        appLaunchEndpointChecks,
        appLaunchOutputLines: launchOutput.split("\n").filter(Boolean).slice(0, 20),
        uiSmokeVerified: options.uiSmoke ? uiSmokeChecksVerified(uiSmokeChecks) : true,
        uiSmokeChecks,
        uiSmokeOutputLines: uiSmokeOutput.split("\n").filter(Boolean).slice(0, 20),
        nodeVersion: nodeVersionFromVerificationOutput(verificationOutput),
        verificationOutputLines: verificationOutput.split("\n").filter(Boolean).slice(0, 20),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        dmgPath,
        dmgSha256: checksum(dmgPath),
        fileName: basename(dmgPath),
        installedAppPath,
        error: message.split("\n").find((line) => line.trim().length > 0)?.trim() ?? message,
        sidecarVerified: false,
        sidecarEndpointChecks: null,
        sidecarEndpointVerified: false,
        appLaunchVerified: false,
        appLaunchEndpointChecks: null,
        appLaunchOutputLines: [],
        uiSmokeVerified: false,
        uiSmokeChecks: null,
        uiSmokeOutputLines: [],
        nodeVersion: nodeVersionFromVerificationOutput(message),
        verificationOutputLines: message.split("\n").filter(Boolean).slice(0, 20),
      };
    }
  } finally {
    if (attached) {
      try {
        run("hdiutil", ["detach", mountPoint], { capture: true });
      } catch {
        run("hdiutil", ["detach", "-force", mountPoint], { capture: true });
      }
    }
    await rm(mountPoint, { recursive: true, force: true });
    await rm(installRoot, { recursive: true, force: true });
  }
};

export const mergeDmgInstallVerificationResults = (
  index: ReleaseIndex,
  incomingResults: InstalledAppVerificationResult[],
  existingResults: InstalledAppVerificationResult[] = [],
) => {
  const expectedFiles = expectedDmgFilesFromIndex(index);
  if (expectedFiles.length === 0) {
    return {
      checked: incomingResults.length,
      results: incomingResults,
      missingIssues: [] as string[],
    };
  }

  const incomingByFileName = new Map(incomingResults.map((result) => [result.fileName, result]));
  const existingByFileName = new Map(existingResults.map((result) => [result.fileName, result]));
  const missingIssues: string[] = [];
  const results = expectedFiles
    .map((file) => {
      const incoming = incomingByFileName.get(file.fileName);
      if (incoming) {
        return incoming;
      }

      const existing = existingByFileName.get(file.fileName);
      const expectedChecksum = file.sha256 ?? checksum(file.path);
      if (existing?.dmgSha256 && expectedChecksum && existing.dmgSha256 === expectedChecksum) {
        return existing;
      }

      missingIssues.push(`${file.fileName} copied app verification is missing for the current DMG checksum`);
      return null;
    })
    .filter((result): result is InstalledAppVerificationResult => result !== null);

  return {
    checked: expectedFiles.length,
    results,
    missingIssues,
  };
};

export const writeDmgInstallVerificationReport = async (
  index: ReleaseIndex,
  results: InstalledAppVerificationResult[],
) => {
  const version = index.version ?? "0.0.0";
  const reportPath = join(releaseRoot, dmgInstallVerificationFileName(version));
  const existingReport = existsSync(reportPath)
    ? JSON.parse(await readFile(reportPath, "utf8")) as Partial<DmgInstallVerificationReport>
    : null;
  const merged = mergeDmgInstallVerificationResults(index, results, existingReport?.results ?? []);
  const issues = [
    ...merged.results
      .map(sidecarEndpointIssue)
      .filter((issue): issue is string => !!issue),
    ...merged.missingIssues,
  ];
  const report: DmgInstallVerificationReport = {
    ok: merged.results.length === merged.checked && issues.length === 0 && merged.results.every((result) =>
      result.ok &&
      result.sidecarVerified &&
      result.sidecarEndpointVerified &&
      result.appLaunchVerified &&
      result.uiSmokeVerified
    ),
    app: index.app ?? "StockAnalysis",
    version,
    platform: index.platform ?? "macos",
    generatedAt: new Date().toISOString(),
    releaseRoot,
    installMode: "dmg-copy-to-temporary-applications",
    checked: merged.checked,
    results: merged.results,
    issues,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, report };
};

const main = async () => {
  if (process.platform !== "darwin") {
    throw new Error("DMG install verification requires macOS hdiutil.");
  }

  const args = process.argv.slice(2);
  const writeReport = args.includes("--write-report");
  const uiSmoke = args.includes("--ui-smoke");
  const dmgPaths = await resolveDmgPaths(args);
  const results: InstalledAppVerificationResult[] = [];
  for (const dmgPath of dmgPaths) {
    results.push(await verifyInstalledAppFromDmg(dmgPath, { uiSmoke }));
  }
  const ok = results.every((result) =>
    result.ok &&
    result.sidecarVerified &&
    result.sidecarEndpointVerified &&
    result.appLaunchVerified &&
    result.uiSmokeVerified
  );
  const issues = results
    .map(sidecarEndpointIssue)
    .filter((issue): issue is string => !!issue);
  const indexPath = await latestReleaseIndexPath();
  const index = indexPath ? await readReleaseIndex(indexPath) : {};
  const reportResult = writeReport ? await writeDmgInstallVerificationReport(index, results) : null;
  const finalOk = reportResult?.report.ok ?? ok;
  const finalIssues = reportResult?.report.issues ?? issues;
  console.log(JSON.stringify({
    ok: finalOk,
    checked: reportResult?.report.checked ?? results.length,
    results: reportResult?.report.results ?? results,
    reportPath: reportResult?.reportPath,
    issues: finalIssues,
  }, null, 2));
  if (!finalOk) {
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
