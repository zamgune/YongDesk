import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  AutomationFeature,
  AutomationOrderIntentDraft,
  AutomationSimulationResult,
  AutomationStrategyConfig,
} from "@/domain/automation";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

import { parseStrategyConfigPayload } from "./http";

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "store.json");

type UserFeatureAccess = {
  userId: string;
  feature: AutomationFeature;
  status: "active" | "revoked";
  grantedAt: string;
  revokedAt?: string;
};

type AutomationStore = {
  featureAccess: UserFeatureAccess[];
  strategyConfigs: AutomationStrategyConfig[];
  orderIntents: AutomationOrderIntentDraft[];
  simulationRuns: AutomationSimulationResult[];
};

const emptyStore = (): AutomationStore => ({
  featureAccess: [],
  strategyConfigs: [],
  orderIntents: [],
  simulationRuns: [],
});

const readStore = async (): Promise<AutomationStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutomationStore>;
    return {
      featureAccess: Array.isArray(parsed.featureAccess) ? parsed.featureAccess : [],
      strategyConfigs: Array.isArray(parsed.strategyConfigs) ? parsed.strategyConfigs : [],
      orderIntents: Array.isArray(parsed.orderIntents) ? parsed.orderIntents : [],
      simulationRuns: Array.isArray(parsed.simulationRuns) ? parsed.simulationRuns : [],
    };
  } catch {
    return emptyStore();
  }
};

const writeStore = async (store: AutomationStore) => {
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

const rowToStrategyConfig = (row: Record<string, unknown>): AutomationStrategyConfig => {
  const id = row.id as string;
  const userId = row.user_id as string;
  const rawConfig = typeof row.config === "object" && row.config !== null
    ? row.config as Record<string, unknown>
    : {};
  const parsed = parseStrategyConfigPayload(rawConfig, userId, id);
  const createdAt = typeof row.created_at === "string" ? row.created_at : parsed.createdAt;
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : parsed.updatedAt;
  return {
    ...parsed,
    id,
    userId,
    status: row.enabled === true ? "enabled" : parsed.status === "draft" ? "draft" : "disabled",
    createdAt,
    updatedAt,
  };
};

export const listAutomationFeatures = async (userId: string) => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("automation_feature_access")
      .select("feature")
      .eq("user_id", userId)
      .eq("status", "active");
    throwIfSupabaseError(error, "list automation features");
    return (data ?? [])
      .map((entry) => entry.feature)
      .filter((feature): feature is AutomationFeature =>
        feature === "automation_beta" || feature === "live_trading" || feature === "broker_credentials",
      );
  }
  const store = await readStore();
  return store.featureAccess
    .filter((entry) => entry.userId === userId && entry.status === "active")
    .map((entry) => entry.feature);
};

export const hasAutomationFeature = async (userId: string, feature: AutomationFeature) => {
  const features = await listAutomationFeatures(userId);
  return features.includes(feature);
};

export const grantAutomationFeature = async (userId: string, feature: AutomationFeature) => {
  const now = new Date().toISOString();
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase()
      .from("automation_feature_access")
      .upsert({
        user_id: userId,
        feature,
        status: "active",
        granted_at: now,
        revoked_at: null,
      }, { onConflict: "user_id,feature" });
    throwIfSupabaseError(error, "grant automation feature");
    return;
  }
  const store = await readStore();
  const nextAccess = store.featureAccess.filter(
    (entry) => !(entry.userId === userId && entry.feature === feature),
  );
  nextAccess.push({
    userId,
    feature,
    status: "active",
    grantedAt: now,
  });
  await writeStore({
    ...store,
    featureAccess: nextAccess,
  });
};

export const revokeAutomationFeature = async (userId: string, feature: AutomationFeature) => {
  const now = new Date().toISOString();
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase()
      .from("automation_feature_access")
      .upsert({
        user_id: userId,
        feature,
        status: "revoked",
        granted_at: now,
        revoked_at: now,
      }, { onConflict: "user_id,feature" });
    throwIfSupabaseError(error, "revoke automation feature");
    return;
  }
  const store = await readStore();
  await writeStore({
    ...store,
    featureAccess: store.featureAccess.map((entry) =>
      entry.userId === userId && entry.feature === feature
        ? { ...entry, status: "revoked", revokedAt: now }
        : entry,
    ),
  });
};

export const countActiveFeatureUsers = async (feature: AutomationFeature) => {
  if (shouldUseSupabaseStore()) {
    const { count, error } = await supabase()
      .from("automation_feature_access")
      .select("user_id", { count: "exact", head: true })
      .eq("feature", feature)
      .eq("status", "active");
    throwIfSupabaseError(error, "count automation feature users");
    return count ?? 0;
  }
  const store = await readStore();
  return new Set(
    store.featureAccess
      .filter((entry) => entry.feature === feature && entry.status === "active")
      .map((entry) => entry.userId),
  ).size;
};

/** 활성(enabled) 전략을 1개 이상 보유한 사용자 ID 목록. 스케줄러가 순회 대상으로 사용. */
export const listAutomationOwners = async (): Promise<string[]> => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("strategy_configs")
      .select("user_id")
      .eq("enabled", true);
    throwIfSupabaseError(error, "list automation owners");
    return [...new Set((data ?? []).map((entry) => entry.user_id as string).filter(Boolean))];
  }
  const store = await readStore();
  const owners = new Set<string>();
  for (const config of store.strategyConfigs) {
    if (config.status === "enabled") {
      owners.add(config.userId);
    }
  }
  return [...owners];
};

export const listStrategyConfigs = async (userId: string) => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("strategy_configs")
      .select("id, user_id, name, config, enabled, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    throwIfSupabaseError(error, "list strategy configs");
    return (data ?? []).map((row) => rowToStrategyConfig(row as Record<string, unknown>));
  }
  const store = await readStore();
  return store.strategyConfigs
    .filter((config) => config.userId === userId)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const upsertStrategyConfig = async (
  userId: string,
  config: Omit<AutomationStrategyConfig, "id" | "userId" | "createdAt" | "updatedAt"> & { id?: string },
  options: { preserveNewId?: boolean } = {},
) => {
  if (shouldUseSupabaseStore()) {
    const now = new Date().toISOString();
    const existing = config.id ? await findStrategyConfig(userId, config.id) : null;
    const nextConfig: AutomationStrategyConfig = {
      ...config,
      id: existing?.id ?? (options.preserveNewId && config.id ? config.id : randomUUID()),
      userId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const { error } = await supabase().from("strategy_configs").upsert({
      id: nextConfig.id,
      user_id: userId,
      strategy_type: nextConfig.mode ?? "ladder",
      market: nextConfig.market,
      name: nextConfig.name,
      config: nextConfig,
      enabled: nextConfig.status === "enabled",
    }, { onConflict: "id" });
    throwIfSupabaseError(error, "upsert strategy config");
    return nextConfig;
  }
  const store = await readStore();
  const now = new Date().toISOString();
  const existing = config.id
    ? store.strategyConfigs.find((entry) => entry.userId === userId && entry.id === config.id)
    : undefined;
  const nextConfig: AutomationStrategyConfig = {
    ...config,
    id: existing?.id ?? (options.preserveNewId && config.id ? config.id : randomUUID()),
    userId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await writeStore({
    ...store,
    strategyConfigs: [
      ...store.strategyConfigs.filter((entry) => !(entry.userId === userId && entry.id === nextConfig.id)),
      nextConfig,
    ],
  });

  return nextConfig;
};

export const findStrategyConfig = async (userId: string, strategyConfigId: string) => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("strategy_configs")
      .select("id, user_id, name, config, enabled, created_at, updated_at")
      .eq("user_id", userId)
      .eq("id", strategyConfigId)
      .maybeSingle();
    throwIfSupabaseError(error, "find strategy config");
    return data ? rowToStrategyConfig(data as Record<string, unknown>) : null;
  }
  const store = await readStore();
  return store.strategyConfigs.find(
    (config) => config.userId === userId && config.id === strategyConfigId,
  ) ?? null;
};

export const deleteStrategyConfig = async (userId: string, strategyConfigId: string) => {
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase()
      .from("strategy_configs")
      .delete()
      .eq("user_id", userId)
      .eq("id", strategyConfigId);
    throwIfSupabaseError(error, "delete strategy config");
    return;
  }
  const store = await readStore();
  await writeStore({
    ...store,
    strategyConfigs: store.strategyConfigs.filter(
      (config) => !(config.userId === userId && config.id === strategyConfigId),
    ),
  });
};

export const saveAutomationSimulation = async (
  userId: string,
  result: AutomationSimulationResult,
) => {
  const store = await readStore();
  const nextOrderIntents = [
    ...store.orderIntents,
    ...result.orderIntents,
  ].filter((intent) => intent.userId === userId || !result.orderIntents.some((newIntent) => newIntent.id === intent.id));
  await writeStore({
    ...store,
    orderIntents: nextOrderIntents,
    simulationRuns: [result, ...store.simulationRuns].slice(0, 100),
  });
};
