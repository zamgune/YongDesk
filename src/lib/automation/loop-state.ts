import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { LoopGridPlan, LoopGridState } from "@/domain/automation";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

type LoopStore = { loops: Record<string, LoopGridState> };

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "loop-state.json");

const keyOf = (userId: string, strategyId: string) => `${userId}:${strategyId}`;

const readStore = async (): Promise<LoopStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<LoopStore>;
    return { loops: parsed.loops ?? {} };
  } catch {
    return { loops: {} };
  }
};

const writeStore = async (store: LoopStore) => {
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

const createInitialState = (plan: LoopGridPlan): LoopGridState => ({
  anchorPrice: plan.anchorPrice,
  positionState: "empty",
  entryPrice: null,
  quantity: 0,
  lastCycleAt: null,
  cycleCount: 0,
  updatedAt: new Date().toISOString(),
});

const normalizeState = (state: Partial<LoopGridState> | undefined, plan: LoopGridPlan): LoopGridState => ({
  anchorPrice: Number.isFinite(state?.anchorPrice) && Number(state?.anchorPrice) > 0
    ? Number(state?.anchorPrice)
    : plan.anchorPrice,
  positionState: state?.positionState === "holding" ? "holding" : "empty",
  entryPrice: typeof state?.entryPrice === "number" ? state.entryPrice : null,
  quantity: typeof state?.quantity === "number" ? state.quantity : 0,
  lastCycleAt: typeof state?.lastCycleAt === "string" ? state.lastCycleAt : null,
  cycleCount: typeof state?.cycleCount === "number" ? state.cycleCount : 0,
  updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
});

const getLoopGridStateSupabase = async (
  userId: string,
  strategyId: string,
  plan: LoopGridPlan,
): Promise<LoopGridState> => {
  const { data, error } = await supabase()
    .from("automation_strategy_state")
    .select("state")
    .eq("user_id", userId)
    .eq("strategy_key", strategyId)
    .eq("state_type", "loop")
    .maybeSingle();
  throwIfSupabaseError(error, "read loop-grid state");
  if (!data?.state || typeof data.state !== "object") {
    return createInitialState(plan);
  }
  return normalizeState(data.state as Partial<LoopGridState>, plan);
};

const saveLoopGridStateSupabase = async (
  userId: string,
  strategyId: string,
  state: LoopGridState,
): Promise<void> => {
  const { error } = await supabase()
    .from("automation_strategy_state")
    .upsert({
      user_id: userId,
      strategy_key: strategyId,
      state_type: "loop",
      state,
    }, { onConflict: "user_id,strategy_key,state_type" });
  throwIfSupabaseError(error, "save loop-grid state");
};

export const getLoopGridState = async (
  userId: string,
  strategyId: string,
  plan: LoopGridPlan,
): Promise<LoopGridState> => {
  if (shouldUseSupabaseStore()) {
    return getLoopGridStateSupabase(userId, strategyId, plan);
  }
  const store = await readStore();
  const existing = store.loops[keyOf(userId, strategyId)];
  if (!existing) {
    return createInitialState(plan);
  }
  return normalizeState(existing, plan);
};

export const recordLoopGridBuy = async (
  userId: string,
  strategyId: string,
  input: {
    anchorPrice: number;
    entryPrice: number;
    quantity: number;
    executedAt: string;
  },
): Promise<LoopGridState> => {
  if (shouldUseSupabaseStore()) {
    const previous = await getLoopGridStateSupabase(userId, strategyId, {
      anchorPrice: input.anchorPrice,
      buyDropPct: 1,
      sellRisePct: 1,
      notional: input.entryPrice * input.quantity,
      cooldownMinutes: 0,
    });
    const next: LoopGridState = {
      anchorPrice: input.anchorPrice,
      positionState: "holding",
      entryPrice: input.entryPrice,
      quantity: input.quantity,
      lastCycleAt: input.executedAt,
      cycleCount: previous.cycleCount,
      updatedAt: new Date().toISOString(),
    };
    await saveLoopGridStateSupabase(userId, strategyId, next);
    return next;
  }
  const store = await readStore();
  const key = keyOf(userId, strategyId);
  const previous = store.loops[key];
  const next: LoopGridState = {
    anchorPrice: input.anchorPrice,
    positionState: "holding",
    entryPrice: input.entryPrice,
    quantity: input.quantity,
    lastCycleAt: input.executedAt,
    cycleCount: previous?.cycleCount ?? 0,
    updatedAt: new Date().toISOString(),
  };
  store.loops[key] = next;
  await writeStore(store);
  return next;
};

export const recordLoopGridSell = async (
  userId: string,
  strategyId: string,
  input: {
    sellPrice: number;
    executedAt: string;
  },
): Promise<LoopGridState> => {
  if (shouldUseSupabaseStore()) {
    const previous = await getLoopGridStateSupabase(userId, strategyId, {
      anchorPrice: input.sellPrice,
      buyDropPct: 1,
      sellRisePct: 1,
      notional: 0,
      cooldownMinutes: 0,
    });
    const next: LoopGridState = {
      anchorPrice: input.sellPrice,
      positionState: "empty",
      entryPrice: null,
      quantity: 0,
      lastCycleAt: input.executedAt,
      cycleCount: previous.cycleCount + 1,
      updatedAt: new Date().toISOString(),
    };
    await saveLoopGridStateSupabase(userId, strategyId, next);
    return next;
  }
  const store = await readStore();
  const key = keyOf(userId, strategyId);
  const previous = store.loops[key];
  const next: LoopGridState = {
    anchorPrice: input.sellPrice,
    positionState: "empty",
    entryPrice: null,
    quantity: 0,
    lastCycleAt: input.executedAt,
    cycleCount: (previous?.cycleCount ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  store.loops[key] = next;
  await writeStore(store);
  return next;
};
