import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, readlink, rm, stat, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ReleaseIndexFile = {
  kind?: string;
  fileName?: string;
  path?: string;
  exists?: boolean;
};

type ReleaseIndexEntry = {
  arch?: string;
  label?: string;
  files?: ReleaseIndexFile[];
};

type ReleaseIndex = {
  entries?: ReleaseIndexEntry[];
};

export type DmgMountedLayoutCheck = {
  ok: boolean;
  mountPoint: string;
  entries: {
    app: boolean;
    infoPlist: boolean;
    applicationsSymlink: boolean;
    readme: boolean;
  };
  issues: string[];
};

export type DmgVerificationResult = DmgMountedLayoutCheck & {
  dmgPath: string;
  fileName: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repoRoot, "dist", "macos", "release");
const readmeFileName = "StockAnalysis 설치 안내.txt";
const readmeRequiredSnippets = [
  "StockAnalysis.app",
  "Applications",
  "설치 후 점검",
  "Toss API",
  "OrderIntent",
  "RiskCheck",
  "Gatekeeper",
];

const run = (command: string, args: string[], options: { capture?: boolean } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
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

export const verifyMountedDmgLayout = async (mountPoint: string): Promise<DmgMountedLayoutCheck> => {
  const issues: string[] = [];
  const appPath = join(mountPoint, "StockAnalysis.app");
  const applicationsPath = join(mountPoint, "Applications");
  const readmePath = join(mountPoint, readmeFileName);
  const infoPlistPath = join(appPath, "Contents", "Info.plist");

  const appInfo = await stat(appPath).catch(() => null);
  const app = appInfo?.isDirectory() === true;
  if (!app) {
    issues.push("DMG 루트에 StockAnalysis.app 디렉터리가 없습니다.");
  }

  const infoPlistInfo = await stat(infoPlistPath).catch(() => null);
  const infoPlist = infoPlistInfo?.isFile() === true;
  if (!infoPlist) {
    issues.push("StockAnalysis.app/Contents/Info.plist를 찾지 못했습니다.");
  }

  const applicationsInfo = await lstat(applicationsPath).catch(() => null);
  const applicationsTarget = applicationsInfo?.isSymbolicLink()
    ? await readlink(applicationsPath).catch(() => "")
    : "";
  const applicationsSymlink = applicationsInfo?.isSymbolicLink() === true && applicationsTarget === "/Applications";
  if (!applicationsSymlink) {
    issues.push("DMG 루트의 Applications 항목이 /Applications symlink가 아닙니다.");
  }

  const readme = existsSync(readmePath) ? await readFile(readmePath, "utf8").catch(() => "") : "";
  const readmeContainsRequiredSnippets = readmeRequiredSnippets.every((snippet) => readme.includes(snippet));
  if (!readmeContainsRequiredSnippets) {
    issues.push(`${readmeFileName}에 설치/실거래 안전 안내 문구가 부족합니다.`);
  }

  return {
    ok: issues.length === 0,
    mountPoint,
    entries: {
      app,
      infoPlist,
      applicationsSymlink,
      readme: readmeContainsRequiredSnippets,
    },
    issues,
  };
};

const verifyDmg = async (dmgPath: string): Promise<DmgVerificationResult> => {
  if (!existsSync(dmgPath)) {
    throw new Error(`DMG 파일을 찾지 못했습니다: ${dmgPath}`);
  }
  const mountPoint = await mkdtemp(join(tmpdir(), "stockanalysis-dmg-verify-"));
  let attached = false;
  try {
    run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath], { capture: true });
    attached = true;
    const check = await verifyMountedDmgLayout(mountPoint);
    return {
      ...check,
      dmgPath,
      fileName: basename(dmgPath),
    };
  } finally {
    if (attached) {
      try {
        run("hdiutil", ["detach", mountPoint], { capture: true });
      } catch {
        run("hdiutil", ["detach", "-force", mountPoint], { capture: true });
      }
    }
    await rm(mountPoint, { recursive: true, force: true });
  }
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

const main = async () => {
  if (process.platform !== "darwin") {
    throw new Error("DMG layout verification requires macOS hdiutil.");
  }

  const dmgPaths = await resolveDmgPaths(process.argv.slice(2));
  const results: DmgVerificationResult[] = [];
  for (const dmgPath of dmgPaths) {
    results.push(await verifyDmg(dmgPath));
  }
  const issues = results.flatMap((result) =>
    result.issues.map((issue) => `${result.fileName}: ${issue}`),
  );
  console.log(JSON.stringify({
    ok: issues.length === 0,
    checked: results.length,
    results,
    issues,
  }, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
