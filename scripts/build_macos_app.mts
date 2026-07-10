import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type TargetArch = "arm64" | "x64";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(repoRoot, "apps", "macos", "StockAnalysisMac");
const distRoot = join(repoRoot, "dist", "macos");
const appRoot = join(distRoot, "StockAnalysis.app");
const contentsRoot = join(appRoot, "Contents");
const macOSRoot = join(contentsRoot, "MacOS");
const resourcesRoot = join(contentsRoot, "Resources");
const sidecarRoot = join(resourcesRoot, "sidecar");
const nodeRoot = join(resourcesRoot, "node", "bin");
const nodeLibRoot = join(resourcesRoot, "node", "lib");
const nodeRuntimeCacheRoot = join(repoRoot, ".cache", "macos-node-runtimes");
const signingIdentity = process.env.MACOS_CODESIGN_IDENTITY?.trim() || "-";
const usesDistributionSigning = signingIdentity !== "-";
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
const swiftArch = targetArch === "x64" ? "x86_64" : "arm64";
const machOArch = swiftArch;
const nodeVersion = process.env.MACOS_NODE_VERSION?.trim() || process.version;
let sourceNodeForDependencyResolution = process.execPath;

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

const copyRequired = async (from: string, to: string) => {
  if (!existsSync(from)) {
    throw new Error(`Required path is missing: ${from}`);
  }
  await cp(from, to, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
};

const copyIfExists = async (from: string, to: string) => {
  if (existsSync(from)) {
    await cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
};

const writeInfoPlist = async () => {
  await writeFile(join(contentsRoot, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>ko</string>
  <key>CFBundleDisplayName</key>
  <string>StockAnalysis</string>
  <key>CFBundleExecutable</key>
  <string>StockAnalysisMac</string>
  <key>CFBundleIdentifier</key>
  <string>com.stockanalysis.mac</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>StockAnalysis</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`, "utf8");
  await writeFile(join(contentsRoot, "PkgInfo"), "APPL????", "utf8");
};

const copySidecar = async () => {
  await mkdir(sidecarRoot, { recursive: true });
  const sidecarEntries = [
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "scripts",
    "src",
    "public",
    "node_modules",
  ];
  for (const entry of sidecarEntries) {
    await copyRequired(join(repoRoot, entry), join(sidecarRoot, entry));
  }
  await markSidecarAsModule();
  await copyIfExists(join(repoRoot, "package-lock.json"), join(sidecarRoot, "package-lock.json"));
  await copyIfExists(join(repoRoot, "yarn.lock"), join(sidecarRoot, "yarn.lock"));
  await writeFile(join(resourcesRoot, "repository-path.txt"), `${repoRoot}\n`, "utf8");
  await writeFile(join(resourcesRoot, "sidecar-build.json"), `${JSON.stringify({
    builtAt: new Date().toISOString(),
    repoRoot,
    node: nodeVersion,
    platform: process.platform,
    arch: targetArch,
    buildHostArch: process.arch,
    mode: "portable-local-sidecar",
  }, null, 2)}\n`, "utf8");
};

const markSidecarAsModule = async () => {
  const packageJsonPath = join(sidecarRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  if (packageJson.type === "module") {
    return;
  }
  packageJson.type = "module";
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
};

const writeReleaseStatusIfProvided = async () => {
  const value = process.env.STOCK_ANALYSIS_RELEASE_STATUS_JSON?.trim();
  if (!value) {
    return;
  }
  JSON.parse(value);
  await writeFile(join(resourcesRoot, "release-status.json"), `${value}\n`, "utf8");
};

const normalizedNodeVersion = () => nodeVersion.startsWith("v") ? nodeVersion : `v${nodeVersion}`;

const downloadedNodeRuntimeRoot = async () => {
  const version = normalizedNodeVersion();
  const folderName = `node-${version}-darwin-${targetArch}`;
  const runtimeRoot = join(nodeRuntimeCacheRoot, folderName);
  const nodeBinary = join(runtimeRoot, "bin", "node");
  if (existsSync(nodeBinary)) {
    return runtimeRoot;
  }

  await mkdir(nodeRuntimeCacheRoot, { recursive: true });
  const archivePath = join(nodeRuntimeCacheRoot, `${folderName}.tar.gz`);
  if (!existsSync(archivePath)) {
    run("curl", ["-fsSL", "-o", archivePath, `https://nodejs.org/dist/${version}/${folderName}.tar.gz`]);
  }
  await rm(runtimeRoot, { recursive: true, force: true });
  run("tar", ["-xzf", archivePath, "-C", nodeRuntimeCacheRoot]);
  if (!existsSync(nodeBinary)) {
    throw new Error(`Downloaded Node runtime is missing bin/node: ${nodeBinary}`);
  }
  return runtimeRoot;
};

const sourceNodeBinary = async () => {
  const explicitRuntimeRoot = process.env.MACOS_NODE_RUNTIME_ROOT?.trim();
  if (explicitRuntimeRoot) {
    const nodeBinary = resolve(explicitRuntimeRoot, "bin", "node");
    if (!existsSync(nodeBinary)) {
      throw new Error(`MACOS_NODE_RUNTIME_ROOT does not contain bin/node: ${nodeBinary}`);
    }
    return realpath(nodeBinary);
  }
  if (targetArch === process.arch) {
    return realpath(process.execPath);
  }
  const runtimeRoot = await downloadedNodeRuntimeRoot();
  return realpath(join(runtimeRoot, "bin", "node"));
};

const assertMachOArch = (path: string, label: string) => {
  const archs = run("lipo", ["-archs", path], { capture: true })
    .split(/\s+/)
    .filter(Boolean);
  if (!archs.includes(machOArch)) {
    throw new Error(`${label} architecture mismatch. Expected ${machOArch}, got ${archs.join(", ") || "unknown"}: ${path}`);
  }
};

const copyNode = async () => {
  await mkdir(nodeRoot, { recursive: true });
  await mkdir(nodeLibRoot, { recursive: true });
  const sourceNode = await sourceNodeBinary();
  sourceNodeForDependencyResolution = sourceNode;
  const destinationNode = join(nodeRoot, "node");
  const copied = new Map<string, string>([[sourceNode, destinationNode]]);
  const queue = [sourceNode];

  await copyRequired(sourceNode, destinationNode);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const dependency of readPortableDependencies(current)) {
      const resolved = resolveDependency(dependency, current);
      if (!resolved || copied.has(resolved)) {
        continue;
      }
      const destination = join(nodeLibRoot, basename(resolved));
      copied.set(resolved, destination);
      await copyRequired(resolved, destination);
      queue.push(resolved);
    }
  }

  for (const [source, destination] of copied) {
    for (const dependency of readPortableDependencies(source)) {
      const resolved = resolveDependency(dependency, source);
      if (!resolved) {
        continue;
      }
      const copiedDependency = copied.get(resolved);
      if (!copiedDependency) {
        continue;
      }
      const replacement = destination === destinationNode
        ? `@executable_path/../lib/${basename(copiedDependency)}`
        : `@loader_path/${basename(copiedDependency)}`;
      run("install_name_tool", ["-change", dependency, replacement, destination]);
    }
    if (destination !== destinationNode) {
      run("install_name_tool", ["-id", `@rpath/${basename(destination)}`, destination]);
    }
  }
  assertMachOArch(destinationNode, "Bundled Node");
};

const codesignArgs = (target: string, options: { deep?: boolean } = {}) => [
  "--force",
  ...(options.deep ? ["--deep"] : []),
  "--sign",
  signingIdentity,
  ...(usesDistributionSigning ? ["--options", "runtime", "--timestamp"] : []),
  target,
];

const signAppBundle = () => {
  const nodeBinary = join(nodeRoot, "node");
  run("codesign", codesignArgs(nodeBinary));
  const dylibs = run("find", [nodeLibRoot, "-type", "f", "-name", "*.dylib"], { capture: true })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const dylib of dylibs) {
    run("codesign", codesignArgs(dylib));
  }
  run("codesign", codesignArgs(join(macOSRoot, "StockAnalysisMac")));
  run("codesign", codesignArgs(appRoot, { deep: true }));
};

const readPortableDependencies = (binaryPath: string) =>
  run("otool", ["-L", binaryPath], { capture: true })
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter((dependency) =>
      dependency &&
      dependency !== binaryPath &&
      !dependency.startsWith("/usr/lib/") &&
      !dependency.startsWith("/System/Library/Frameworks/"),
    );

const resolveDependency = (dependency: string, originPath: string) => {
  if (dependency.startsWith("@rpath/")) {
    const name = dependency.slice("@rpath/".length);
    const candidates = [
      join(dirname(originPath), "..", "lib", name),
      join(dirname(sourceNodePath()), "..", "lib", name),
      join("/opt/homebrew/lib", name),
    ];
    const candidate = candidates.find((item) => existsSync(item));
    return candidate ? realpathSync(candidate) : null;
  }
  if (dependency.startsWith("@loader_path/")) {
    const name = dependency.slice("@loader_path/".length);
    const candidate = join(dirname(originPath), name);
    return existsSync(candidate) ? realpathSync(candidate) : null;
  }
  return existsSync(dependency) ? realpathSync(dependency) : null;
};

const sourceNodePath = () => sourceNodeForDependencyResolution;

const main = async () => {
  run("swift", ["build", "--configuration", "release", "--package-path", packagePath, "--arch", swiftArch]);
  const binPath = run("swift", [
    "build",
    "--configuration",
    "release",
    "--package-path",
    packagePath,
    "--arch",
    swiftArch,
    "--show-bin-path",
  ], { capture: true });
  const executablePath = join(binPath, "StockAnalysisMac");

  await rm(appRoot, { recursive: true, force: true });
  await mkdir(macOSRoot, { recursive: true });
  await mkdir(resourcesRoot, { recursive: true });
  await copyRequired(executablePath, join(macOSRoot, "StockAnalysisMac"));
  assertMachOArch(join(macOSRoot, "StockAnalysisMac"), "StockAnalysisMac");
  await writeInfoPlist();
  await copyNode();
  await copySidecar();
  await writeReleaseStatusIfProvided();
  run("chmod", ["755", join(macOSRoot, "StockAnalysisMac"), join(nodeRoot, "node")]);
  signAppBundle();
  console.log(`Created ${appRoot} (${targetArch})`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
