import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export type AutomationKillSwitchState = {
  engaged: boolean;
  reason: string | null;
  updatedAt: string;
  updatedBy: string;
  blocks: Array<"paper-trading" | "automation-cycle">;
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "kill-switch.json");

const defaultKillSwitchState = (): AutomationKillSwitchState => ({
  engaged: false,
  reason: null,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
  blocks: ["paper-trading", "automation-cycle"],
});

const normalizeState = (value: unknown): AutomationKillSwitchState => {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    engaged: raw.engaged === true,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt
      : new Date(0).toISOString(),
    updatedBy: typeof raw.updatedBy === "string" && raw.updatedBy.trim() ? raw.updatedBy.trim() : "system",
    blocks: ["paper-trading", "automation-cycle"],
  };
};

const readStore = async (): Promise<AutomationKillSwitchState> => {
  try {
    return normalizeState(JSON.parse(await readFile(STORE_PATH, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultKillSwitchState();
    }
    throw error;
  }
};

const writeStore = async (state: AutomationKillSwitchState) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, STORE_PATH);
  return state;
};

export const getAutomationKillSwitchState = async () => readStore();

export const setAutomationKillSwitchState = async ({
  engaged,
  reason,
  updatedBy = "local-engine",
}: {
  engaged: boolean;
  reason?: string | null;
  updatedBy?: string;
}) => writeStore({
  engaged,
  reason: engaged ? reason?.trim() || "긴급 중지" : null,
  updatedAt: new Date().toISOString(),
  updatedBy,
  blocks: ["paper-trading", "automation-cycle"],
});

export const isAutomationKillSwitchEngaged = async () =>
  (await getAutomationKillSwitchState()).engaged;
