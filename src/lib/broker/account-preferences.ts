import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

import type { BrokerName } from "./credential-store";

export type BrokerAccountPreference = {
  userId: string;
  broker: BrokerName;
  accountSeq: number;
  accountNo: string;
  accountType: string;
  updatedAt: string;
};

type BrokerAccountPreferenceStore = {
  preferences: BrokerAccountPreference[];
};

const STORE_PATH = stockAnalysisStoragePath(
  "automation-platform",
  "broker-account-preferences.json",
);

const readStore = async (): Promise<BrokerAccountPreferenceStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BrokerAccountPreferenceStore>;
    return { preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [] };
  } catch {
    return { preferences: [] };
  }
};

const writeStore = async (store: BrokerAccountPreferenceStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

export const getBrokerAccountPreference = async (
  userId: string,
  broker: BrokerName = "toss",
): Promise<BrokerAccountPreference | null> => {
  const store = await readStore();
  return store.preferences.find((entry) => entry.userId === userId && entry.broker === broker) ?? null;
};

export const saveBrokerAccountPreference = async ({
  userId,
  broker = "toss",
  accountSeq,
  accountNo,
  accountType,
}: {
  userId: string;
  broker?: BrokerName;
  accountSeq: number;
  accountNo: string;
  accountType: string;
}): Promise<BrokerAccountPreference> => {
  if (!Number.isInteger(accountSeq) || accountSeq <= 0) {
    throw new Error("accountSeq는 양의 정수여야 합니다.");
  }
  const entry: BrokerAccountPreference = {
    userId,
    broker,
    accountSeq,
    accountNo,
    accountType,
    updatedAt: new Date().toISOString(),
  };
  const store = await readStore();
  await writeStore({
    preferences: [
      ...store.preferences.filter((existing) => !(existing.userId === userId && existing.broker === broker)),
      entry,
    ],
  });
  return entry;
};

export const deleteBrokerAccountPreference = async (
  userId: string,
  broker: BrokerName = "toss",
): Promise<void> => {
  const store = await readStore();
  await writeStore({
    preferences: store.preferences.filter((entry) => !(entry.userId === userId && entry.broker === broker)),
  });
};
