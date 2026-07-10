import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export type AutomationWorkerControlState = {
  paused: boolean;
  reason: string | null;
  updatedAt: string;
  updatedBy: string;
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "worker-control.json");

const defaultWorkerControlState = (): AutomationWorkerControlState => ({
  paused: false,
  reason: null,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
});

const normalizeState = (value: unknown): AutomationWorkerControlState => {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    paused: raw.paused === true,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : new Date(0).toISOString(),
    updatedBy: typeof raw.updatedBy === "string" && raw.updatedBy.trim() ? raw.updatedBy.trim() : "system",
  };
};

const readStore = async (): Promise<AutomationWorkerControlState> => {
  try {
    return normalizeState(JSON.parse(await readFile(STORE_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultWorkerControlState();
    }
    throw error;
  }
};

const writeStore = async (state: AutomationWorkerControlState) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STORE_PATH);
  return state;
};

export const getAutomationWorkerControlState = async () => readStore();

export const setAutomationWorkerControlState = async ({
  paused,
  reason,
  updatedBy = "local-engine",
}: {
  paused: boolean;
  reason?: string | null;
  updatedBy?: string;
}) => writeStore({
  paused,
  reason: paused ? reason?.trim() || "워커 일시중지" : null,
  updatedAt: new Date().toISOString(),
  updatedBy,
});
