import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type {
  PaperAccount,
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PaperRun,
  PaperTradingLog,
  PaperTradingSession,
  PaperTradingState,
} from "@/domain/paper-trading";
import {
  createDefaultPaperAccount,
  type RunPaperTradingDailyResult,
} from "@/use-cases/trading/run-paper-trading-daily";
import { stockAnalysisStoragePath } from "@/lib/local-storage";

export const PAPER_TRADING_STORAGE_ROOT = stockAnalysisStoragePath("paper-trading");
export const PAPER_TRADING_STATE_PATH = join(PAPER_TRADING_STORAGE_ROOT, "state.json");
export const PAPER_TRADING_RUNS_DIR = join(PAPER_TRADING_STORAGE_ROOT, "runs");

const STATE_VERSION = 1;
const MAX_RUNS = 120;
const MAX_ORDERS = 500;
const MAX_EXECUTIONS = 500;
const MAX_LOGS = 800;

type StoredPaperTradingState = PaperTradingState & {
  version?: number;
};

type StorePaths = {
  readonly storageRoot: string;
  readonly statePath: string;
  readonly runsDir: string;
};

export type PaperTradingStateReadResult = {
  state: PaperTradingState;
  storagePath: string;
  repaired: boolean;
  backupPath?: string;
};

const getStorePaths = (storageRoot = PAPER_TRADING_STORAGE_ROOT): StorePaths => ({
  storageRoot,
  statePath: join(storageRoot, "state.json"),
  runsDir: join(storageRoot, "runs"),
});

const safeUserStorageSegment = (userId: string) =>
  userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);

export const getPaperTradingStorageRootForUser = (userId: string) =>
  join(PAPER_TRADING_STORAGE_ROOT, "users", safeUserStorageSegment(userId));

const assertSafeRunDate = (today: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("페이퍼 실행일은 YYYY-MM-DD 형식이어야 합니다.");
  }
  return today;
};

const assertContainedPath = (root: string, target: string) => {
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\")) {
    throw new Error("페이퍼 실행 스냅샷 경로가 허용된 디렉터리를 벗어났습니다.");
  }
};

export const createDefaultPaperTradingState = (now = new Date().toISOString()): PaperTradingState => ({
  accounts: {
    US: createDefaultPaperAccount("US", now),
    KR: createDefaultPaperAccount("KR", now),
  },
  positions: [],
  runs: [],
  orders: [],
  executions: [],
  logs: [],
  updatedAt: now,
});

const isPaperAccount = (value: unknown, session: PaperTradingSession): value is PaperAccount =>
  typeof value === "object" &&
  value !== null &&
  "session" in value &&
  value.session === session &&
  "cash" in value &&
  typeof value.cash === "number";

const toArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

export const normalizePaperTradingState = (
  rawState: Partial<StoredPaperTradingState> | null | undefined,
  now = new Date().toISOString(),
): PaperTradingState => {
  const defaults = createDefaultPaperTradingState(now);
  const accounts = rawState?.accounts as Partial<Record<PaperTradingSession, PaperAccount>> | undefined;
  return {
    accounts: {
      US: isPaperAccount(accounts?.US, "US") ? accounts.US : defaults.accounts.US,
      KR: isPaperAccount(accounts?.KR, "KR") ? accounts.KR : defaults.accounts.KR,
    },
    positions: toArray<PaperPosition>(rawState?.positions),
    runs: toArray<PaperRun>(rawState?.runs),
    orders: toArray<PaperOrder>(rawState?.orders),
    executions: toArray<PaperExecution>(rawState?.executions),
    logs: toArray<PaperTradingLog>(rawState?.logs),
    updatedAt: typeof rawState?.updatedAt === "string" ? rawState.updatedAt : now,
  };
};

export const readPaperTradingState = async (
  storageRoot = PAPER_TRADING_STORAGE_ROOT,
): Promise<PaperTradingStateReadResult> => {
  const paths = getStorePaths(storageRoot);
  await mkdir(paths.storageRoot, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(paths.statePath, "utf8")) as StoredPaperTradingState;
    return {
      state: normalizePaperTradingState(parsed),
      storagePath: paths.statePath,
      repaired: false,
    };
  } catch (error) {
    const now = new Date().toISOString();
    if (error instanceof SyntaxError) {
      const backupPath = join(
        paths.storageRoot,
        `state.corrupt-${now.replace(/[:.]/g, "-")}.json`,
      );
      await rename(paths.statePath, backupPath).catch(() => undefined);
      const state = createDefaultPaperTradingState(now);
      await writePaperTradingState(state, storageRoot);
      return {
        state,
        storagePath: paths.statePath,
        repaired: true,
        backupPath,
      };
    }
    const state = createDefaultPaperTradingState(now);
    await writePaperTradingState(state, storageRoot);
    return {
      state,
      storagePath: paths.statePath,
      repaired: true,
    };
  }
};

export const writePaperTradingState = async (
  state: PaperTradingState,
  storageRoot = PAPER_TRADING_STORAGE_ROOT,
) => {
  const paths = getStorePaths(storageRoot);
  await mkdir(dirname(paths.statePath), { recursive: true });
  const nextState: StoredPaperTradingState = {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(paths.statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
};

export const resetPaperTradingState = async (storageRoot = PAPER_TRADING_STORAGE_ROOT) => {
  const state = createDefaultPaperTradingState();
  await writePaperTradingState(state, storageRoot);
  return {
    state,
    storagePath: getStorePaths(storageRoot).statePath,
  };
};

export const applyPaperTradingRunResult = (
  state: PaperTradingState,
  session: PaperTradingSession,
  result: RunPaperTradingDailyResult,
): PaperTradingState => ({
  accounts: {
    ...state.accounts,
    [session]: result.nextAccount,
  },
  positions: [
    ...state.positions.filter((position) => position.session !== session),
    ...result.nextPositions,
  ],
  runs: [result.run, ...state.runs].slice(0, MAX_RUNS),
  orders: [...result.orders, ...state.orders].slice(0, MAX_ORDERS),
  executions: [...result.executions, ...state.executions].slice(0, MAX_EXECUTIONS),
  logs: [...result.logs, ...state.logs].slice(0, MAX_LOGS),
  updatedAt: new Date().toISOString(),
});

export const writePaperTradingRunSnapshot = async (
  result: RunPaperTradingDailyResult,
  storageRoot = PAPER_TRADING_STORAGE_ROOT,
) => {
  const paths = getStorePaths(storageRoot);
  await mkdir(paths.runsDir, { recursive: true });
  const safeToday = assertSafeRunDate(result.run.today);
  const snapshotPath = join(paths.runsDir, `${safeToday}-${result.run.session}-${result.run.id}.json`);
  assertContainedPath(paths.runsDir, snapshotPath);
  await writeFile(snapshotPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return snapshotPath;
};
