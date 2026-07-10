import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

/**
 * 자동매매 워커의 실행 상태(멱등성 원장).
 *
 * 폴링 워커는 같은 사다리 단계를 매 틱마다 재발동하면 안 됩니다. 하루 단위로
 * "이미 발동한 stepKey"와 누적 매수/매도 횟수를 추적해 중복 주문을 막습니다.
 * Supabase 설정 시 automation_worker_state 테이블을, 아니면 .cache 파일을 사용합니다.
 */

export type StrategyWorkerState = {
  userId: string;
  strategyId: string;
  date: string; // YYYY-MM-DD (KST 기준은 호출부에서 결정)
  executedStepKeys: string[];
  buys: number;
  sells: number;
  updatedAt: string;
};

const emptyState = (userId: string, strategyId: string, date: string): StrategyWorkerState => ({
  userId,
  strategyId,
  date,
  executedStepKeys: [],
  buys: 0,
  sells: 0,
  updatedAt: new Date().toISOString(),
});

/** 발동 처리된 단계를 원장에 기록합니다. (순수) */
export const recordExecutedStep = (
  state: StrategyWorkerState,
  stepKey: string,
  side: "buy" | "sell",
): StrategyWorkerState => ({
  ...state,
  executedStepKeys: [...new Set([...state.executedStepKeys, stepKey])],
  buys: side === "buy" ? state.buys + 1 : state.buys,
  sells: side === "sell" ? state.sells + 1 : state.sells,
});

// === 파일 백엔드 ===

type WorkerStore = { strategies: Record<string, StrategyWorkerState> };

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "worker-state.json");

const fileKey = (userId: string, strategyId: string) => `${userId}:${strategyId}`;

const readFileStore = async (): Promise<WorkerStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkerStore>;
    return { strategies: parsed.strategies ?? {} };
  } catch {
    return { strategies: {} };
  }
};

const writeFileStore = async (store: WorkerStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

const getWorkerStateFile = async (userId: string, strategyId: string, date: string) => {
  const store = await readFileStore();
  const existing = store.strategies[fileKey(userId, strategyId)];
  if (!existing || existing.date !== date) {
    return emptyState(userId, strategyId, date);
  }
  return existing;
};

const saveWorkerStateFile = async (state: StrategyWorkerState) => {
  const store = await readFileStore();
  store.strategies[fileKey(state.userId, state.strategyId)] = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFileStore(store);
};

// === Supabase 백엔드 ===

const throwIfSupabaseError = (error: { message?: string } | null, operation: string) => {
  if (error) {
    throw new Error(`${operation}: ${error.message ?? "Supabase request failed"}`);
  }
};

const getWorkerStateSupabase = async (userId: string, strategyId: string, date: string) => {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("automation_worker_state")
    .select("executed_step_keys, buys, sells, updated_at")
    .eq("user_id", userId)
    .eq("strategy_key", strategyId)
    .eq("trade_date", date)
    .maybeSingle();
  throwIfSupabaseError(error, "read worker state");
  if (!data) {
    return emptyState(userId, strategyId, date);
  }
  return {
    userId,
    strategyId,
    date,
    executedStepKeys: (data.executed_step_keys as string[]) ?? [],
    buys: data.buys ?? 0,
    sells: data.sells ?? 0,
    updatedAt: data.updated_at ?? new Date().toISOString(),
  } satisfies StrategyWorkerState;
};

const saveWorkerStateSupabase = async (state: StrategyWorkerState) => {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("automation_worker_state").upsert(
    {
      user_id: state.userId,
      strategy_key: state.strategyId,
      trade_date: state.date,
      executed_step_keys: state.executedStepKeys,
      buys: state.buys,
      sells: state.sells,
    },
    { onConflict: "user_id,strategy_key,trade_date" },
  );
  throwIfSupabaseError(error, "save worker state");
};

// === 디스패치 ===

const shouldUseSupabaseStore = () => getSupabaseAdminConfig() !== null;

export const getWorkerState = (
  userId: string,
  strategyId: string,
  date: string,
): Promise<StrategyWorkerState> =>
  shouldUseSupabaseStore()
    ? getWorkerStateSupabase(userId, strategyId, date)
    : getWorkerStateFile(userId, strategyId, date);

export const saveWorkerState = (state: StrategyWorkerState): Promise<void> =>
  shouldUseSupabaseStore() ? saveWorkerStateSupabase(state) : saveWorkerStateFile(state);
