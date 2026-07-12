import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(process.argv[2] ?? join(repoRoot, "dist", "macos", "StockAnalysis.app"));
const contentsRoot = join(appRoot, "Contents");
const executablePath = join(contentsRoot, "MacOS", "StockAnalysisMac");
const resourcesRoot = join(contentsRoot, "Resources");
const sidecarRoot = join(resourcesRoot, "sidecar");

type JsonObject = Record<string, unknown>;
type AppExit = {
  code: number | null;
  signal: string | null;
};

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

const reservePort = async () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve localhost port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

const fetchJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Expected JSON object from ${url}`);
  }
  return payload as JsonObject;
};

const waitForHealth = async (port: number, timeoutMs = 18_000) => {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchJson(`http://127.0.0.1:${port}/health`);
      if (payload.ok === true && payload.engine === "stock-analysis-local-engine") {
        return payload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`App-launched sidecar health timed out: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
};

const terminatePid = (pid: number | null | undefined) => {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
};

const waitForProcessClose = async (child: ReturnType<typeof spawn>, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
};

const waitForSidecarClose = async (pid: number, port: number, timeoutMs = 5_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let pidAlive = true;
    try {
      process.kill(pid, 0);
    } catch {
      pidAlive = false;
    }
    let portAlive = true;
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) });
    } catch {
      portAlive = false;
    }
    if (!pidAlive && !portAlive) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Sidecar ${pid} or port ${port} survived forced app termination`);
};

const main = async () => {
  const requiredPaths = [
    appRoot,
    executablePath,
    join(contentsRoot, "Info.plist"),
    join(resourcesRoot, "node", "bin", "node"),
    join(sidecarRoot, "scripts", "local_engine.mts"),
  ];
  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`Missing required app launch path: ${path}`);
    }
  }

  run("plutil", ["-lint", join(contentsRoot, "Info.plist")]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appRoot]);

  const appSupportRoot = await mkdtemp(join(tmpdir(), "stockanalysis-app-launch-"));
  const port = await reservePort();
  const settingsPath = join(appSupportRoot, "settings.json");
  await writeFile(settingsPath, `${JSON.stringify({
    enginePort: port,
    repositoryPath: sidecarRoot,
    alertsEnabled: false,
    workerPaused: false,
    liveTradingOperatorEnabled: false,
  }, null, 2)}\n`, "utf8");

  const appProcess = spawn(executablePath, [], {
    cwd: dirname(appRoot),
    env: {
      ...process.env,
      STOCK_ANALYSIS_MAC_APP_SUPPORT_ROOT: appSupportRoot,
      STOCK_ANALYSIS_DISABLE_MARKET_SNAPSHOT: "1",
      STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS: "750",
      STOCK_ANALYSIS_SKIP_EGRESS_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!appProcess.pid) {
    throw new Error("Unable to launch StockAnalysisMac app executable");
  }
  let appOutput = "";
  let appExit: AppExit | null = null;
  appProcess.stdout.on("data", (chunk) => {
    appOutput += chunk.toString();
  });
  appProcess.stderr.on("data", (chunk) => {
    appOutput += chunk.toString();
  });
  appProcess.once("exit", (code, signal) => {
    appExit = { code, signal };
  });
  const assertAppStillRunning = () => {
    if (appExit) {
      throw new Error(`StockAnalysisMac exited during launch verification (code=${appExit.code ?? "null"} signal=${appExit.signal ?? "null"})`);
    }
  };

  let sidecarPid: number | null = null;
  let forcedShutdownVerified = false;
  try {
    const health = await waitForHealth(port);
    assertAppStillRunning();
    sidecarPid = typeof health.pid === "number" ? health.pid : null;
    const storageRoot = typeof health.storageRoot === "string" ? health.storageRoot : "";
    const workingDirectory = typeof health.workingDirectory === "string" ? health.workingDirectory : "";
    if (!storageRoot.startsWith(join(appSupportRoot, "sidecar"))) {
      throw new Error(`App-launched sidecar used unexpected storage root: ${storageRoot}`);
    }
    if (realpathSync(workingDirectory) !== realpathSync(sidecarRoot)) {
      throw new Error(`App-launched sidecar used unexpected working directory: ${workingDirectory}`);
    }

    const dashboard = await fetchJson(`http://127.0.0.1:${port}/api/dashboard/terminal?symbol=VERIFYLAUNCH&session=US`);
    if (dashboard.symbol !== "VERIFYLAUNCH" || !dashboard.orderIntent || !dashboard.riskCheck) {
      throw new Error("App-launched sidecar did not return terminal dashboard data");
    }
    const selfTest = await fetchJson(`http://127.0.0.1:${port}/api/local/self-test`);
    if (typeof selfTest.overall !== "string" || !Array.isArray(selfTest.checks)) {
      throw new Error("App-launched self-test returned an unexpected payload");
    }
    assertAppStillRunning();

    const sidecarLogPath = join(appSupportRoot, "logs", "sidecar.log");
    const sidecarLog = await readFile(sidecarLogPath, "utf8");
    if (!sidecarLog.includes("--- sidecar start") || !sidecarLog.includes("stock-analysis-local-engine listening")) {
      throw new Error("App launch did not write the expected sidecar log markers");
    }

    if (!sidecarPid) {
      throw new Error("App-launched sidecar did not report a process ID");
    }
    appProcess.kill("SIGKILL");
    await waitForProcessClose(appProcess);
    await waitForSidecarClose(sidecarPid, port);
    forcedShutdownVerified = true;

    console.log(JSON.stringify({
      ok: true,
      appRoot,
      appPid: appProcess.pid,
      sidecarPid,
      port,
      appSupportRoot,
      storageRoot,
      workingDirectory,
      health: {
        engine: health.engine,
        version: health.version,
        sidecarBuildId: health.sidecarBuildId,
      },
      endpointChecks: {
        appLaunch: true,
        appProcessAlive: true,
        sidecarAutostart: true,
        terminalDashboard: true,
        localSelfTest: true,
        sidecarLog: true,
        forcedAppTerminationCleanup: true,
        sidecarProcessClosed: true,
        sidecarPortClosed: true,
      },
    }, null, 2));
  } finally {
    if (!forcedShutdownVerified) {
      terminatePid(sidecarPid);
      appProcess.kill("SIGTERM");
    }
    await waitForProcessClose(appProcess);
    await rm(appSupportRoot, { recursive: true, force: true });
    if (appOutput.trim()) {
      console.error(appOutput.trim().split("\n").slice(-20).join("\n"));
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
