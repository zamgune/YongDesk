import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  TOSS_OPENAPI_BASE_URL,
  TOSS_OPENAPI_SPEC_VERSION,
} from "../src/lib/toss/contract.ts";
import {
  assertMacNodeVersion,
  parseMacPackageVersion,
  readMacPackageVersion,
  readPinnedMacNodeVersion,
} from "./macos_release_config.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(process.argv[2] ?? join(repoRoot, "dist", "macos", "StockAnalysis.app"));
const contentsRoot = join(appRoot, "Contents");
const resourcesRoot = join(contentsRoot, "Resources");
const nodeBinary = join(resourcesRoot, "node", "bin", "node");
const sidecarRoot = join(resourcesRoot, "sidecar");
const sidecarLoaderImport = "data:text/javascript,import { register } from \"node:module\"; import { pathToFileURL } from \"node:url\"; register(\"./scripts/ts_path_loader.mjs\", pathToFileURL(\"./\"));";

export type MacAppVersionConsistency = {
  rootPackageVersion: string;
  infoPlistVersion: string;
  bundledPackageVersion: string;
  verified: true;
};

export const assertMacAppVersionConsistency = ({
  rootPackageVersion,
  infoPlistVersion,
  bundledPackageVersion,
}: Omit<MacAppVersionConsistency, "verified">): MacAppVersionConsistency => {
  const versions = new Set([rootPackageVersion, infoPlistVersion, bundledPackageVersion]);
  if (versions.size !== 1) {
    throw new Error(
      `App version mismatch: root package=${rootPackageVersion}, Info.plist=${infoPlistVersion}, bundled package=${bundledPackageVersion}`,
    );
  }
  return {
    rootPackageVersion,
    infoPlistVersion,
    bundledPackageVersion,
    verified: true,
  };
};

const run = (command: string, args: string[], options: { cwd?: string; capture?: boolean } = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
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

type JsonObject = Record<string, unknown>;

type JsonResponseResult = {
  status: number;
  payload: JsonObject;
};

type SidecarEndpointChecks = {
  health: true;
  tossOpenApiContract: true;
  tossReadinessNoCredential: true;
  localSelfTest: true;
  brokerDiagnostics: true;
  publicIpCheckSkipped: true;
  brokerCredentials: true;
  accountPreferenceNoCredential: true;
  liveTradingNoCredential: true;
  strategyConfigs: true;
  strategyLifecycle: true;
  strategyBackupImport: true;
  newsEvents: true;
  terminalDashboard: true;
  dashboardPlaybook: true;
  paperOrderIntent: true;
  paperReset: true;
  killSwitch: true;
  workerControl: true;
  automationScheduler: true;
  symbolSearch: true;
  cryptoExchangeSafety: true;
  cryptoStrategyLifecycle: true;
  automationDryRun: true;
  orderSyncNoCredential: true;
  holdingsNoCredential: true;
  orderPrecheckNoCredential: true;
};

const readJsonPayload = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Expected JSON object from ${response.url}`);
  }
  return payload as JsonObject;
};

const fetchJsonResponse = async (url: string, init?: RequestInit): Promise<JsonResponseResult> => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    payload: await readJsonPayload(response),
  };
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return readJsonPayload(response);
};

const jsonObjectField = (payload: JsonObject, field: string) => {
  const value = payload[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected JSON object field: ${field}`);
  }
  return value as JsonObject;
};

const jsonArrayField = (payload: JsonObject, field: string) => {
  const value = payload[field];
  if (!Array.isArray(value)) {
    throw new Error(`Expected JSON array field: ${field}`);
  }
  return value;
};

const verifyStrategyLifecycle = async (baseUrl: string) => {
  const strategyPayload = {
    name: "Verify 순환분할 3차",
    symbol: "VERIFY",
    market: "US",
    preset: "magic-split",
    mode: "percent-grid",
    currentPrice: 100,
    grid: {
      basePrice: 100,
      rungs: [
        { index: 1, buyDropPct: 1, sellRisePct: 1.2, notional: 500 },
        { index: 2, buyDropPct: 3, sellRisePct: 1.6, notional: 700 },
        { index: 3, buyDropPct: 5, sellRisePct: 2, notional: 900 },
      ],
    },
    priceAnchor: {
      source: "manual",
      price: 100,
    },
    riskLimits: {
      maxDailyBuys: 3,
      maxDailySells: 3,
      maxPositionValue: 2500,
      maxLossPct: 12,
      maxHoldHours: 8760,
    },
    exitRules: {
      takeProfitPct: 4,
      stopLossPct: 8,
      rescueMode: "disable-only",
    },
  };
  const createState = await fetchJson(`${baseUrl}/api/local/strategy-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(strategyPayload),
  });
  const createdConfig = jsonObjectField(createState, "config");
  const strategyId = typeof createdConfig.id === "string" ? createdConfig.id : "";
  if (!strategyId || createdConfig.status !== "draft" || createdConfig.preset !== "magic-split") {
    throw new Error("Strategy create endpoint returned an unexpected magic-split payload");
  }
  const encodedId = encodeURIComponent(strategyId);

  const blockedEnable = await fetchJsonResponse(`${baseUrl}/api/local/strategy-configs/${encodedId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  });
  if (blockedEnable.status !== 428) {
    throw new Error(`Strategy activation should require simulation before enabling, got HTTP ${blockedEnable.status}`);
  }

  const simulationState = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}/simulate`, {
    method: "POST",
  });
  const simulationResult = jsonObjectField(simulationState, "result");
  const simulationRiskCheck = jsonObjectField(simulationResult, "riskCheck");
  const simulationConfig = jsonObjectField(simulationState, "config");
  const lastSimulation = jsonObjectField(simulationConfig, "lastSimulation");
  if (simulationRiskCheck.passed !== true || lastSimulation.passed !== true) {
    throw new Error("Strategy simulation did not pass for packaged magic-split lifecycle verification");
  }

  const currentPreview = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}/tick-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "current" }),
  });
  if (currentPreview.dryRun !== true || currentPreview.scenario !== "current") {
    throw new Error("Strategy current tick preview did not return dry-run output");
  }

  const triggerPreview = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}/tick-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: "entry-trigger" }),
  });
  const triggerSummary = jsonObjectField(triggerPreview, "summary");
  if (triggerPreview.dryRun !== true || triggerPreview.scenario !== "entry-trigger" || triggerSummary.safety !== "dry-run: broker 제출 없음") {
    throw new Error("Strategy trigger tick preview did not prove dry-run broker safety");
  }

  const enableState = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  });
  const enabledConfig = jsonObjectField(enableState, "config");
  if (enabledConfig.status !== "enabled") {
    throw new Error("Strategy enable endpoint did not enable the simulated strategy");
  }

  const deleteState = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}`, {
    method: "DELETE",
  });
  if (deleteState.ok !== true) {
    throw new Error("Strategy delete endpoint did not confirm deletion");
  }
};

const verifyCryptoStrategyLifecycle = async (baseUrl: string) => {
  const createState = await fetchJson(`${baseUrl}/api/local/strategy-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Verify KRW-BTC Upbit paper",
      symbol: "KRW-BTC",
      market: "CRYPTO",
      executionVenue: "upbit",
      preset: "magic-split",
      mode: "percent-grid",
      currentPrice: 98_000_000,
      grid: {
        basePrice: 100_000_000,
        rungs: [{ index: 1, buyDropPct: 1, sellRisePct: 1, notional: 10_000 }],
      },
      riskLimits: { maxDailyBuys: 3, maxDailySells: 3, maxPositionValue: 100_000, maxLossPct: 20, maxHoldHours: 8760 },
      exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
    }),
  });
  const config = jsonObjectField(createState, "config");
  const id = typeof config.id === "string" ? config.id : "";
  if (!id || config.market !== "CRYPTO" || config.executionVenue !== "upbit") {
    throw new Error("Crypto strategy did not preserve market and execution venue");
  }
  const encodedId = encodeURIComponent(id);
  const simulation = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}/simulate`, { method: "POST" });
  if (jsonObjectField(jsonObjectField(simulation, "result"), "riskCheck").passed !== true) {
    throw new Error("Crypto strategy simulation did not pass");
  }
  const enabled = await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "enabled" }),
  });
  const readiness = jsonObjectField(jsonObjectField(enabled, "config"), "automationReadiness");
  if (readiness.paperAutomationReady !== true || readiness.liveSubmissionReady !== false) {
    throw new Error("Crypto strategy must be paper-ready and live-submit blocked");
  }
  const cycle = await fetchJson(`${baseUrl}/api/automation/cycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = jsonObjectField(cycle, "result");
  const evaluations = jsonArrayField(result, "evaluations") as JsonObject[];
  if (!evaluations.some((evaluation) => evaluation.strategyId === id)) {
    throw new Error("Crypto strategy was not evaluated by the shared automation cycle");
  }
  await fetchJson(`${baseUrl}/api/local/strategy-configs/${encodedId}`, { method: "DELETE" });
};

const verifyStrategyBackupImport = async (baseUrl: string) => {
  const createdIds: string[] = [];
  const strategyPayload = {
    name: "Verify 백업 순환분할",
    symbol: "VERIFYBACKUP",
    market: "US",
    preset: "magic-split",
    mode: "percent-grid",
    currentPrice: 100,
    grid: {
      basePrice: 100,
      rungs: [
        { index: 1, buyDropPct: 1, sellRisePct: 1.2, notional: 500 },
        { index: 2, buyDropPct: 3, sellRisePct: 1.6, notional: 700 },
      ],
    },
    priceAnchor: {
      source: "manual",
      price: 100,
    },
    riskLimits: {
      maxDailyBuys: 2,
      maxDailySells: 2,
      maxPositionValue: 2_000,
      maxLossPct: 10,
      maxHoldHours: 720,
    },
    exitRules: {
      takeProfitPct: 4,
      stopLossPct: 8,
      rescueMode: "disable-only",
    },
  };

  try {
    const createState = await fetchJson(`${baseUrl}/api/local/strategy-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(strategyPayload),
    });
    const createdConfig = jsonObjectField(createState, "config");
    const strategyId = typeof createdConfig.id === "string" ? createdConfig.id : "";
    if (!strategyId) {
      throw new Error("Strategy backup verification could not create a source strategy");
    }
    createdIds.push(strategyId);

    const exportState = await fetchJson(`${baseUrl}/api/local/strategy-configs/export`);
    const exportSafety = jsonObjectField(exportState, "safety");
    const exportedConfigs = jsonArrayField(exportState, "configs") as JsonObject[];
    const exportedConfig = exportedConfigs.find((config) => config.sourceId === strategyId);
    if (
      exportState.schemaVersion !== 2 ||
      exportSafety.credentialsIncluded !== false ||
      exportSafety.accountPreferenceIncluded !== false ||
      exportSafety.importedStatus !== "draft" ||
      exportSafety.importedSimulation !== "discarded" ||
      !exportedConfig ||
      "status" in exportedConfig ||
      "lastSimulation" in exportedConfig
    ) {
      throw new Error("Strategy export endpoint did not return a safe backup bundle");
    }

    const importState = await fetchJson(`${baseUrl}/api/local/strategy-configs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...exportState,
        configs: [{
          ...exportedConfig,
          id: "unsafe-import-id",
          status: "enabled",
          lastSimulation: {
            configHash: "unsafe",
            passed: true,
            blockers: [],
            warnings: [],
            expectedReturnPct: 999,
            expectedLossPct: 0,
            summary: "unsafe imported simulation",
            simulatedAt: "2026-07-09T00:00:00.000Z",
          },
        }],
      }),
    });
    const importSafety = jsonObjectField(importState, "safety");
    const importedConfigs = jsonArrayField(importState, "configs") as JsonObject[];
    const importedConfig = importedConfigs[0];
    const importedId = typeof importedConfig?.id === "string" ? importedConfig.id : "";
    if (importedId) {
      createdIds.push(importedId);
    }
    if (
      importState.imported !== 1 ||
      importState.status !== "draft" ||
      importSafety.enabledStrategiesImported !== 0 ||
      importSafety.lastSimulationDiscarded !== true ||
      importSafety.liveTradingChanged !== false ||
      !importedId.startsWith("imported-") ||
      importedId === "unsafe-import-id" ||
      importedConfig?.status !== "draft" ||
      "lastSimulation" in (importedConfig ?? {})
    ) {
      throw new Error("Strategy import endpoint did not force a safe draft-only restore");
    }
  } finally {
    await Promise.all(createdIds.map((id) =>
      fetch(`${baseUrl}/api/local/strategy-configs/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
    ));
  }
};

const verifyWorkspaceActions = async (baseUrl: string) => {
  const newsState = await fetchJson(`${baseUrl}/api/news/events?limit=5`);
  jsonArrayField(newsState, "events");
  jsonArrayField(newsState, "errors");
  jsonArrayField(newsState, "alertCandidates");

  const dashboardState = await fetchJson(`${baseUrl}/api/dashboard/terminal?symbol=VERIFYAPP&session=US`);
  const orderIntent = jsonObjectField(dashboardState, "orderIntent");
  const riskCheck = jsonObjectField(dashboardState, "riskCheck");
  jsonArrayField(dashboardState, "auditTrail");
  jsonArrayField(dashboardState, "riskScenarios");
  jsonArrayField(dashboardState, "preTradeChecklist");
  jsonArrayField(dashboardState, "replayEvents");
  if (dashboardState.symbol !== "VERIFYAPP" || orderIntent.symbol !== "VERIFYAPP" || !("passed" in riskCheck)) {
    throw new Error("Terminal dashboard endpoint returned an unexpected snapshot");
  }

  const savedPlaybook = await fetchJson(`${baseUrl}/api/dashboard/playbook?symbol=VERIFYAPP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thesis: "패키징 검증 플레이북",
      entryRule: "OrderIntent 사전검증 통과 후 진입",
      invalidationRule: "RiskCheck 차단 시 무효화",
      addRule: "모의 자동화 통과 후 추가",
      trimRule: "뉴스 리스크 발생 시 축소",
      target: "paper-only 검증",
      workerMode: "manual-approval",
    }),
  });
  if (savedPlaybook.symbol !== "VERIFYAPP" || savedPlaybook.workerMode !== "manual-approval") {
    throw new Error("Playbook save endpoint did not persist the requested worker mode");
  }
  const dashboardAfterPlaybook = await fetchJson(`${baseUrl}/api/dashboard/terminal?symbol=VERIFYAPP&session=US`);
  const playbook = jsonObjectField(dashboardAfterPlaybook, "playbook");
  if (playbook.thesis !== "패키징 검증 플레이북" || playbook.workerMode !== "manual-approval") {
    throw new Error("Terminal dashboard did not read back the saved playbook");
  }

  const paperOrder = await fetchJson(`${baseUrl}/api/paper-trading/order-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: "US",
      orderIntent,
    }),
  });
  jsonObjectField(paperOrder, "run");
  if (jsonArrayField(paperOrder, "orders").length < 1 || jsonArrayField(paperOrder, "executions").length < 1) {
    throw new Error("Paper OrderIntent endpoint did not record an order and execution");
  }
  const auditEntry = jsonObjectField(paperOrder, "auditEntry");
  if (auditEntry.title !== "모의 주문 실행") {
    throw new Error("Paper OrderIntent endpoint did not record the expected dashboard audit entry");
  }

  const paperReset = await fetchJson(`${baseUrl}/api/paper-trading/reset`, {
    method: "POST",
  });
  if (paperReset.reset !== true || !paperReset.state || typeof paperReset.state !== "object") {
    throw new Error("Paper reset endpoint did not return reset state");
  }

  const killSwitchOn = await fetchJson(`${baseUrl}/api/local/kill-switch`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engaged: true, reason: "packaged app verification" }),
  });
  if (jsonObjectField(killSwitchOn, "killSwitch").engaged !== true) {
    throw new Error("Kill switch endpoint did not engage");
  }
  const killSwitchBlock = await fetchJsonResponse(`${baseUrl}/api/paper-trading/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: "US", source: "manual" }),
  });
  if (killSwitchBlock.status !== 423) {
    throw new Error(`Paper run should be blocked by kill switch, got HTTP ${killSwitchBlock.status}`);
  }
  const killSwitchOff = await fetchJson(`${baseUrl}/api/local/kill-switch`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engaged: false, reason: "packaged app verification complete" }),
  });
  if (jsonObjectField(killSwitchOff, "killSwitch").engaged !== false) {
    throw new Error("Kill switch endpoint did not release");
  }

  const workerPaused = await fetchJson(`${baseUrl}/api/local/worker-control`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: true, reason: "packaged app verification" }),
  });
  if (jsonObjectField(workerPaused, "workerControl").paused !== true) {
    throw new Error("Worker control endpoint did not pause");
  }
  const workerBlock = await fetchJsonResponse(`${baseUrl}/api/automation/cycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (workerBlock.status !== 423) {
    throw new Error(`Automation cycle should be blocked by worker pause, got HTTP ${workerBlock.status}`);
  }
  const workerResumed = await fetchJson(`${baseUrl}/api/local/worker-control`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: false, reason: "packaged app verification complete" }),
  });
  if (jsonObjectField(workerResumed, "workerControl").paused !== false) {
    throw new Error("Worker control endpoint did not resume");
  }

  const schedulerInitial = await fetchJson(`${baseUrl}/api/local/automation/scheduler`);
  if (jsonObjectField(schedulerInitial, "scheduler").enabled !== false) {
    throw new Error("Continuous automation scheduler should default to disabled");
  }
  const schedulerEnabled = await fetchJson(`${baseUrl}/api/local/automation/scheduler`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, intervalSeconds: 60 }),
  });
  const enabledSchedulerState = jsonObjectField(schedulerEnabled, "scheduler");
  if (enabledSchedulerState.enabled !== true || enabledSchedulerState.intervalSeconds !== 60 || typeof enabledSchedulerState.nextRunAt !== "string") {
    throw new Error("Continuous automation scheduler did not persist an enabled 60-second schedule");
  }
  const schedulerDisabled = await fetchJson(`${baseUrl}/api/local/automation/scheduler`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, intervalSeconds: 60 }),
  });
  if (jsonObjectField(schedulerDisabled, "scheduler").enabled !== false) {
    throw new Error("Continuous automation scheduler did not stop");
  }

  const automationDryRun = await fetchJson(`${baseUrl}/api/automation/cycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true }),
  });
  const automationResult = jsonObjectField(automationDryRun, "result");
  if (automationDryRun.dryRun !== true || typeof automationResult.status !== "string") {
    throw new Error("Automation dry-run endpoint did not return a dry-run result");
  }
};

const waitForHealth = async (port: number) => {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 10_000) {
    try {
      const payload = await fetchJson(`http://127.0.0.1:${port}/health`);
      if (payload.ok === true && payload.engine === "stock-analysis-local-engine") {
        return payload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Sidecar health check timed out: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
};

const verifySidecar = async (expectedVersion: string) => {
  const storageRoot = await mkdtemp(join(tmpdir(), "stockanalysis-macos-verify-"));
  const port = await reservePort();
  const sidecarProcess = spawn(nodeBinary, [
    "--import",
    sidecarLoaderImport,
    "--experimental-strip-types",
    "scripts/local_engine.mts",
    `--port=${port}`,
  ], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      BROKER_CREDENTIAL_ENC_KEY: `verify:${Buffer.alloc(32, 11).toString("base64")}`,
      STOCK_ANALYSIS_DISABLE_MARKET_SNAPSHOT: "1",
      STOCK_ANALYSIS_LOCAL_ENGINE_PORT: `${port}`,
      STOCK_ANALYSIS_SKIP_EGRESS_CHECK: "1",
      STOCK_ANALYSIS_STORAGE_ROOT: storageRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  sidecarProcess.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  sidecarProcess.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  let endpointChecks: SidecarEndpointChecks | null = null;
  try {
    const health = await waitForHealth(port);
    if (health.version !== expectedVersion) {
      throw new Error(`Sidecar health version mismatch: expected ${expectedVersion}, got ${String(health.version)}`);
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    const tossContractState = await fetchJson(`${baseUrl}/api/local/toss/openapi-contract`);
    const tossReadinessState = await fetchJson(`${baseUrl}/api/local/toss/readiness?symbol=NVDA`);
    const selfTestState = await fetchJson(`${baseUrl}/api/local/self-test`);
    const brokerDiagnosticsState = await fetchJson(`${baseUrl}/api/local/broker/diagnostics`);
    const publicIpDiagnosticsState = await fetchJson(`${baseUrl}/api/local/broker/diagnostics?includeEgress=1`);
    const credentialState = await fetchJson(`${baseUrl}/api/local/broker/credentials`);
    const strategyState = await fetchJson(`${baseUrl}/api/local/strategy-configs`);
    const symbolSearchState = await fetchJson(`${baseUrl}/api/local/symbol-search?q=${encodeURIComponent("삼성")}&markets=KOSPI,KOSDAQ`);
    const cryptoExchangeState = await fetchJson(`${baseUrl}/api/local/crypto-exchanges`);
    const cryptoReadinessState = await fetchJsonResponse(`${baseUrl}/api/local/crypto-exchanges/upbit/readiness?market=KRW-BTC`);
    const cryptoPrecheckState = await fetchJsonResponse(`${baseUrl}/api/local/crypto-exchanges/bithumb/orders/precheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: "KRW-BTC", side: "buy", volume: 0.001, price: 100_000_000 }),
    });
    await verifyStrategyLifecycle(baseUrl);
    await verifyCryptoStrategyLifecycle(baseUrl);
    await verifyStrategyBackupImport(baseUrl);
    await verifyWorkspaceActions(baseUrl);
    const holdingsState = await fetchJson(`${baseUrl}/api/local/holdings?symbol=NVDA`);
    const accountPreferenceState = await fetchJsonResponse(`${baseUrl}/api/local/broker/account-preference`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountSeq: 1 }),
    });
    const liveTradingState = await fetchJsonResponse(`${baseUrl}/api/local/live-trading`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    const precheckState = await fetchJsonResponse(`${baseUrl}/api/local/orders/precheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "NVDA", side: "buy", quantity: 1, price: 100, currency: "USD" }),
    });
    const orderSyncState = await fetchJson(`${baseUrl}/api/local/orders/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const selfTestSummary = jsonObjectField(selfTestState, "summary");
    if (
      selfTestState.overall === "fail" ||
      Number(selfTestSummary.blockingFailures ?? 0) > 0 ||
      Number(selfTestSummary.total ?? 0) < 10
    ) {
      throw new Error("Local self-test endpoint did not return a usable app check report");
    }
    const diagnosticsLiveGate = jsonObjectField(brokerDiagnosticsState, "liveGate");
    const diagnosticsEgress = jsonObjectField(brokerDiagnosticsState, "egress");
    if (
      diagnosticsLiveGate.automationQueueReady !== false ||
      diagnosticsLiveGate.accountPreferenceSelected !== false ||
      diagnosticsEgress.status !== "not-requested"
    ) {
      throw new Error("Broker diagnostics endpoint did not return the expected no-credential safety state");
    }
    const publicIpEgress = jsonObjectField(publicIpDiagnosticsState, "egress");
    if (
      publicIpEgress.status !== "skipped" ||
      publicIpEgress.ip !== null ||
      typeof publicIpEgress.message !== "string" ||
      !publicIpEgress.message.includes("건너")
    ) {
      throw new Error("Broker diagnostics public IP check did not expose the expected safe skip state");
    }
    if (!("credential" in credentialState)) {
      throw new Error("Broker credential endpoint returned an unexpected payload");
    }
    if (!Array.isArray(strategyState.configs)) {
      throw new Error("Strategy config endpoint returned an unexpected payload");
    }
    const symbolMatches = Array.isArray(symbolSearchState.matches) ? symbolSearchState.matches : [];
    const samsung = symbolMatches[0] && typeof symbolMatches[0] === "object"
      ? symbolMatches[0] as JsonObject
      : null;
    if (samsung?.symbol !== "005930.KS" || samsung.nameKo !== "삼성전자" || samsung.nameEn !== "Samsung Electronics") {
      throw new Error("Symbol search endpoint did not return the expected bilingual Korean result");
    }
    const cryptoExchanges = Array.isArray(cryptoExchangeState.exchanges) ? cryptoExchangeState.exchanges : [];
    if (
      cryptoExchanges.length !== 2 ||
      cryptoReadinessState.status !== 200 ||
      cryptoReadinessState.payload.ready !== false ||
      cryptoReadinessState.payload.orderSubmissionAttempted !== false ||
      cryptoPrecheckState.status !== 412 ||
      cryptoPrecheckState.payload.orderSubmissionAttempted !== false
    ) {
      throw new Error("Crypto exchange endpoints did not preserve no-credential and no-order safety");
    }
    if (
      tossContractState.specVersion !== TOSS_OPENAPI_SPEC_VERSION ||
      tossContractState.baseUrl !== TOSS_OPENAPI_BASE_URL ||
      Number(tossContractState.requiredOperationCount ?? 0) < 20 ||
      Number(tossContractState.accountHeaderOperationCount ?? 0) < 8
    ) {
      throw new Error("Toss OpenAPI contract endpoint returned an unexpected payload");
    }
    if (
      tossReadinessState.ok !== false ||
      tossReadinessState.status !== "credential-missing" ||
      tossReadinessState.orderSubmissionAttempted !== false
    ) {
      throw new Error("Toss readiness endpoint did not fail closed without credentials");
    }
    if (holdingsState.linked !== false || holdingsState.held !== false || holdingsState.symbol !== "NVDA") {
      throw new Error("Holdings endpoint did not return the expected no-credential safe payload");
    }
    if (
      accountPreferenceState.status !== 412 ||
      typeof accountPreferenceState.payload.error !== "string" ||
      !accountPreferenceState.payload.error.includes("Toss API")
    ) {
      throw new Error("Account preference endpoint did not fail closed without Toss credentials");
    }
    if (
      liveTradingState.status !== 501 ||
      liveTradingState.payload.orderSubmissionAttempted !== false ||
      typeof liveTradingState.payload.error !== "string" ||
      !liveTradingState.payload.error.includes("1.0.0")
    ) {
      throw new Error("Live trading toggle endpoint did not preserve the desktop 1.0.0 paper-only boundary");
    }
    if (
      precheckState.status !== 412 ||
      typeof precheckState.payload.error !== "string" ||
      !precheckState.payload.error.includes("Toss credential")
    ) {
      throw new Error("Order precheck endpoint did not fail closed without Toss credentials");
    }
    if (
      orderSyncState.status !== "skipped" ||
      orderSyncState.reason !== "no-credentials" ||
      orderSyncState.synced !== 0 ||
      orderSyncState.newFills !== 0
    ) {
      throw new Error("Order sync endpoint did not fail closed without Toss credentials");
    }
    endpointChecks = {
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
      strategyLifecycle: true,
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
  } finally {
    sidecarProcess.kill("SIGTERM");
    await new Promise((resolve) => sidecarProcess.once("close", resolve));
    await rm(storageRoot, { recursive: true, force: true });
  }
  if (!endpointChecks) {
    throw new Error("Sidecar endpoint checks did not complete");
  }
  return { output, endpointChecks };
};

const main = async () => {
  const infoPlistPath = join(contentsRoot, "Info.plist");
  const bundledPackagePath = join(sidecarRoot, "package.json");
  const requiredPaths = [
    appRoot,
    infoPlistPath,
    join(contentsRoot, "MacOS", "StockAnalysisMac"),
    nodeBinary,
    bundledPackagePath,
    join(sidecarRoot, "scripts", "local_engine.mts"),
    join(sidecarRoot, "src"),
  ];
  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`Missing required app bundle path: ${path}`);
    }
  }

  run("plutil", ["-lint", infoPlistPath]);
  const versionChecks = assertMacAppVersionConsistency({
    rootPackageVersion: await readMacPackageVersion(repoRoot),
    infoPlistVersion: run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlistPath], { capture: true }),
    bundledPackageVersion: parseMacPackageVersion(
      await readFile(bundledPackagePath, "utf8"),
      "bundled package.json",
    ),
  });
  const buildNumber = run("plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", infoPlistPath], { capture: true });
  if (!/^[1-9]\d*$/.test(buildNumber)) {
    throw new Error(`Info.plist CFBundleVersion must be a positive integer, got: ${buildNumber || "(empty)"}`);
  }
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appRoot]);
  const pinnedNodeVersion = await readPinnedMacNodeVersion(repoRoot);
  const nodeVersion = assertMacNodeVersion(
    run(nodeBinary, ["-v"], { capture: true }),
    pinnedNodeVersion,
    "Bundled Node runtime",
  );
  const sidecarVerification = await verifySidecar(versionChecks.rootPackageVersion);

  console.log(JSON.stringify({
    ok: true,
    appRoot,
    version: versionChecks.rootPackageVersion,
    buildNumber,
    versionChecks,
    nodeVersion,
    pinnedNodeVersion,
    sidecar: "verified",
    sidecarEndpointChecks: sidecarVerification.endpointChecks,
    sidecarOutputLines: sidecarVerification.output.trim().split("\n").filter(Boolean).slice(0, 16),
  }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
