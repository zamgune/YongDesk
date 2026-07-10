import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { GridLot } from "@/domain/automation";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

/**
 * 순환분할 그리드의 보유 차수(lot) 상태.
 *
 * 차수별 개별 매도를 위해 각 매수 차수의 체결가·수량을 추적합니다. 매수가
 * 전송되면 lot 을 열고, 그 차수가 매도 전송되면 lot 을 닫습니다.
 * Supabase admin 설정 시 durable store 를, 아니면 개발용 .cache 파일을 사용합니다.
 */

type GridStore = { lots: Record<string, GridLot[]> }; // key: `${userId}:${strategyId}`

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "grid-state.json");

const keyOf = (userId: string, strategyId: string) => `${userId}:${strategyId}`;

const readStore = async (): Promise<GridStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<GridStore>;
    return { lots: parsed.lots ?? {} };
  } catch {
    return { lots: {} };
  }
};

const writeStore = async (store: GridStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

const shouldUseSupabaseStore = () => getSupabaseAdminConfig() !== null;
const supabase = () => createSupabaseAdminClient();
const throwIfSupabaseError = (error: { message?: string } | null, operation: string) => {
  if (error) {
    throw new Error(`${operation}: ${error.message ?? "Supabase request failed"}`);
  }
};

const parseLots = (value: unknown): GridLot[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((lot): lot is GridLot =>
    typeof lot === "object" &&
    lot !== null &&
    typeof (lot as GridLot).lotId === "string" &&
    typeof (lot as GridLot).rungIndex === "number" &&
    typeof (lot as GridLot).entryPrice === "number" &&
    typeof (lot as GridLot).quantity === "number" &&
    typeof (lot as GridLot).openedAt === "string",
  );
};

const getGridLotsSupabase = async (userId: string, strategyId: string): Promise<GridLot[]> => {
  const { data, error } = await supabase()
    .from("automation_strategy_state")
    .select("state")
    .eq("user_id", userId)
    .eq("strategy_key", strategyId)
    .eq("state_type", "grid")
    .maybeSingle();
  throwIfSupabaseError(error, "read grid state");
  const state = data?.state as { lots?: unknown } | null | undefined;
  return parseLots(state?.lots);
};

const saveGridLotsSupabase = async (
  userId: string,
  strategyId: string,
  lots: GridLot[],
): Promise<void> => {
  const { error } = await supabase()
    .from("automation_strategy_state")
    .upsert({
      user_id: userId,
      strategy_key: strategyId,
      state_type: "grid",
      state: { lots },
    }, { onConflict: "user_id,strategy_key,state_type" });
  throwIfSupabaseError(error, "save grid state");
};

export const getGridLots = async (userId: string, strategyId: string): Promise<GridLot[]> => {
  if (shouldUseSupabaseStore()) {
    return getGridLotsSupabase(userId, strategyId);
  }
  const store = await readStore();
  return store.lots[keyOf(userId, strategyId)] ?? [];
};

export const openGridLot = async (
  userId: string,
  strategyId: string,
  lot: Omit<GridLot, "lotId" | "openedAt"> & { lotId?: string; openedAt?: string },
): Promise<GridLot> => {
  if (shouldUseSupabaseStore()) {
    const entry: GridLot = {
      lotId: lot.lotId ?? randomUUID(),
      rungIndex: lot.rungIndex,
      entryPrice: lot.entryPrice,
      quantity: lot.quantity,
      openedAt: lot.openedAt ?? new Date().toISOString(),
    };
    await saveGridLotsSupabase(userId, strategyId, [...await getGridLotsSupabase(userId, strategyId), entry]);
    return entry;
  }
  const store = await readStore();
  const key = keyOf(userId, strategyId);
  const entry: GridLot = {
    lotId: lot.lotId ?? randomUUID(),
    rungIndex: lot.rungIndex,
    entryPrice: lot.entryPrice,
    quantity: lot.quantity,
    openedAt: lot.openedAt ?? new Date().toISOString(),
  };
  store.lots[key] = [...(store.lots[key] ?? []), entry];
  await writeStore(store);
  return entry;
};

export const closeGridLot = async (
  userId: string,
  strategyId: string,
  lotId: string,
): Promise<void> => {
  if (shouldUseSupabaseStore()) {
    const lots = (await getGridLotsSupabase(userId, strategyId)).filter((lot) => lot.lotId !== lotId);
    await saveGridLotsSupabase(userId, strategyId, lots);
    return;
  }
  const store = await readStore();
  const key = keyOf(userId, strategyId);
  store.lots[key] = (store.lots[key] ?? []).filter((lot) => lot.lotId !== lotId);
  await writeStore(store);
};

export const clearGridLots = async (
  userId: string,
  strategyId: string,
): Promise<void> => {
  if (shouldUseSupabaseStore()) {
    await saveGridLotsSupabase(userId, strategyId, []);
    return;
  }
  const store = await readStore();
  store.lots[keyOf(userId, strategyId)] = [];
  await writeStore(store);
};
