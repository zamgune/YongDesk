import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { ManagedTradePlan, ManagedTradePlanStatus, RiskCheckResult } from "@/domain/trading";
import { stockAnalysisStoragePath } from "@/lib/local-storage";

export type ManagedTradePlanRecord = {
  plan: ManagedTradePlan;
  session: "KR" | "US";
  market: "CRYPTO" | "KOSDAQ" | "KOSPI" | "US";
  status: ManagedTradePlanStatus;
  riskCheck: RiskCheckResult;
  previewHash: string;
  previewExpiresAt: string;
  submittedAt: string | null;
  lastPrice: number | null;
  lastQuoteAt: string | null;
  executedExit: "stop-loss" | "take-profit" | null;
  conditionalOrderId: string | null;
  liveAttemptId: string | null;
  trackedBrokerOrderIds: string[];
  clientOrderId: string;
  error: string | null;
};

type ManagedTradePlanStore = { records: ManagedTradePlanRecord[] };

const STORE_PATH = stockAnalysisStoragePath("trade-plans", "managed-trade-plans.json");

const readStore = async (): Promise<ManagedTradePlanStore> => {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as Partial<ManagedTradePlanStore>;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
};

const writeStore = async (store: ManagedTradePlanStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

export const listManagedTradePlans = async (userId: string) =>
  (await readStore()).records
    .filter((record) => record.plan.userId === userId)
    .toSorted((a, b) => b.plan.updatedAt.localeCompare(a.plan.updatedAt));

export const getManagedTradePlan = async (userId: string, id: string) =>
  (await readStore()).records.find((record) => record.plan.userId === userId && record.plan.id === id) ?? null;

export const saveManagedTradePlan = async (record: ManagedTradePlanRecord) => {
  const store = await readStore();
  const records = [record, ...store.records.filter((item) => item.plan.id !== record.plan.id)].slice(0, 300);
  await writeStore({ records });
  return record;
};

export const updateManagedTradePlan = async (
  userId: string,
  id: string,
  update: (record: ManagedTradePlanRecord) => ManagedTradePlanRecord,
) => {
  const store = await readStore();
  const index = store.records.findIndex((record) => record.plan.userId === userId && record.plan.id === id);
  if (index < 0) return null;
  const next = update(store.records[index]);
  store.records[index] = next;
  await writeStore(store);
  return next;
};
