import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export const LOCAL_AUTOMATION_MIN_INTERVAL_SECONDS = 30;
export const LOCAL_AUTOMATION_MAX_INTERVAL_SECONDS = 3_600;
export const LOCAL_AUTOMATION_DEFAULT_INTERVAL_SECONDS = 60;

export type LocalAutomationSchedulerStatus = "never" | "running" | "success" | "blocked" | "error";

export type LocalAutomationSchedulerState = {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: LocalAutomationSchedulerStatus;
  lastMessage: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  updatedAt: string;
  updatedBy: string;
};

export type LocalAutomationCycleResult = {
  status: "success" | "blocked";
  message: string;
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "local-scheduler.json");

const nowIso = () => new Date().toISOString();

const defaultState = (): LocalAutomationSchedulerState => ({
  enabled: false,
  intervalSeconds: LOCAL_AUTOMATION_DEFAULT_INTERVAL_SECONDS,
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastStatus: "never",
  lastMessage: null,
  nextRunAt: null,
  consecutiveFailures: 0,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
});

const validStatus = (value: unknown): value is LocalAutomationSchedulerStatus =>
  value === "never" || value === "running" || value === "success" || value === "blocked" || value === "error";

const normalizedInterval = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return LOCAL_AUTOMATION_DEFAULT_INTERVAL_SECONDS;
  }
  return Math.min(
    LOCAL_AUTOMATION_MAX_INTERVAL_SECONDS,
    Math.max(LOCAL_AUTOMATION_MIN_INTERVAL_SECONDS, Math.round(numeric)),
  );
};

const normalizeState = (value: unknown): LocalAutomationSchedulerState => {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: raw.enabled === true,
    intervalSeconds: normalizedInterval(raw.intervalSeconds),
    running: false,
    lastStartedAt: typeof raw.lastStartedAt === "string" ? raw.lastStartedAt : null,
    lastCompletedAt: typeof raw.lastCompletedAt === "string" ? raw.lastCompletedAt : null,
    lastStatus: validStatus(raw.lastStatus) && raw.lastStatus !== "running" ? raw.lastStatus : "never",
    lastMessage: typeof raw.lastMessage === "string" && raw.lastMessage.trim() ? raw.lastMessage.trim() : null,
    nextRunAt: typeof raw.nextRunAt === "string" ? raw.nextRunAt : null,
    consecutiveFailures: Number.isInteger(raw.consecutiveFailures) && Number(raw.consecutiveFailures) >= 0
      ? Number(raw.consecutiveFailures)
      : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof raw.updatedBy === "string" && raw.updatedBy.trim() ? raw.updatedBy.trim() : "system",
  };
};

export const getLocalAutomationSchedulerState = async (): Promise<LocalAutomationSchedulerState> => {
  try {
    return normalizeState(JSON.parse(await readFile(STORE_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultState();
    }
    throw error;
  }
};

export const saveLocalAutomationSchedulerState = async (state: LocalAutomationSchedulerState) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STORE_PATH);
  return state;
};

export const configureLocalAutomationScheduler = async ({
  enabled,
  intervalSeconds,
  updatedBy = "local-engine",
}: {
  enabled: boolean;
  intervalSeconds: number;
  updatedBy?: string;
}) => {
  const current = await getLocalAutomationSchedulerState();
  return saveLocalAutomationSchedulerState({
    ...current,
    enabled,
    intervalSeconds: normalizedInterval(intervalSeconds),
    running: false,
    nextRunAt: null,
    updatedAt: nowIso(),
    updatedBy,
  });
};

export class LocalAutomationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly runCycle: () => Promise<LocalAutomationCycleResult>;

  constructor(runCycle: () => Promise<LocalAutomationCycleResult>) {
    this.runCycle = runCycle;
  }

  async start() {
    const state = await getLocalAutomationSchedulerState();
    if (state.enabled) {
      await this.scheduleNext(state, Math.min(5, state.intervalSeconds));
    }
    return this.getState();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async getState() {
    const state = await getLocalAutomationSchedulerState();
    return { ...state, running: this.running };
  }

  async configure(enabled: boolean, intervalSeconds: number) {
    this.stop();
    const state = await configureLocalAutomationScheduler({ enabled, intervalSeconds });
    if (state.enabled) {
      await this.scheduleNext(state, state.intervalSeconds);
    }
    return this.getState();
  }

  async runNow(trigger: "manual" | "scheduled" = "manual") {
    if (this.running) {
      const state = await this.getState();
      return {
        ...state,
        lastMessage: "이전 자동화 cycle이 아직 실행 중입니다.",
      };
    }

    this.stop();
    this.running = true;
    const startedAt = nowIso();
    const before = await getLocalAutomationSchedulerState();
    await saveLocalAutomationSchedulerState({
      ...before,
      running: false,
      lastStartedAt: startedAt,
      lastStatus: "running",
      lastMessage: `${trigger} cycle 실행 중`,
      nextRunAt: null,
      updatedAt: startedAt,
      updatedBy: "local-engine",
    });

    try {
      const result = await this.runCycle();
      const completedAt = nowIso();
      const current = await getLocalAutomationSchedulerState();
      await saveLocalAutomationSchedulerState({
        ...current,
        running: false,
        lastCompletedAt: completedAt,
        lastStatus: result.status,
        lastMessage: result.message,
        nextRunAt: null,
        consecutiveFailures: result.status === "success" ? 0 : current.consecutiveFailures,
        updatedAt: completedAt,
        updatedBy: "local-engine",
      });
    } catch (error) {
      const completedAt = nowIso();
      const current = await getLocalAutomationSchedulerState();
      await saveLocalAutomationSchedulerState({
        ...current,
        running: false,
        lastCompletedAt: completedAt,
        lastStatus: "error",
        lastMessage: error instanceof Error ? error.message : String(error),
        nextRunAt: null,
        consecutiveFailures: current.consecutiveFailures + 1,
        updatedAt: completedAt,
        updatedBy: "local-engine",
      });
    } finally {
      this.running = false;
      const current = await getLocalAutomationSchedulerState();
      if (current.enabled) {
        await this.scheduleNext(current, current.intervalSeconds);
      }
    }

    return this.getState();
  }

  private async scheduleNext(state: LocalAutomationSchedulerState, delaySeconds: number) {
    this.stop();
    const delayMs = Math.max(1, delaySeconds) * 1_000;
    const nextRunAt = new Date(Date.now() + delayMs).toISOString();
    await saveLocalAutomationSchedulerState({
      ...state,
      running: false,
      nextRunAt,
      updatedAt: nowIso(),
      updatedBy: "local-engine",
    });
    this.timer = setTimeout(() => {
      void this.runNow("scheduled");
    }, delayMs);
  }
}
