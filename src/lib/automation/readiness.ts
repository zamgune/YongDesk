import { getBrokerCredentialView } from "@/lib/broker/credential-store";
import { getBrokerAccountPreference } from "@/lib/broker/account-preferences";
import { isCredentialEncryptionConfigured } from "@/lib/security/crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig, getSupabaseServerConfig } from "@/lib/supabase/config";

import { getLiveTradingGate } from "./live-trading";
import { listAutomationFeatures } from "./store";

export type ReadinessOwner = "operator" | "user" | "system";
export type ReadinessStatus = "pass" | "warn" | "fail";

export type ReadinessItem = {
  id: string;
  owner: ReadinessOwner;
  status: ReadinessStatus;
  label: string;
  summary: string;
  action: string;
  blocking: boolean;
};

export type AutomationHealthSnapshot = {
  generatedAt: string;
  overall: "healthy" | "degraded" | "blocked";
  storageMode: "supabase" | "local-file";
  env: {
    nodeEnv: string;
    supabasePublicConfigured: boolean;
    supabaseAdminConfigured: boolean;
    credentialEncryptionConfigured: boolean;
    liveTradingMasterEnabled: boolean;
  };
  items: ReadinessItem[];
};

export type AutomationReadinessSnapshot = Omit<AutomationHealthSnapshot, "overall" | "storageMode" | "env"> & {
  overall: "ready" | "limited" | "blocked";
  operatorVisible: boolean;
  storageMode: "supabase" | "local-file" | "hidden";
  env?: AutomationHealthSnapshot["env"];
  user: {
    automationBeta: boolean;
    brokerCredentials: boolean;
    liveTrading: boolean;
    liveTradingEffective: boolean;
  };
};

type MigrationGroup = {
  id: string;
  label: string;
  tables: readonly string[];
};

const MIGRATION_GROUPS: readonly MigrationGroup[] = [
  {
    id: "migration-security-foundation",
    label: "security_foundation migration",
    tables: ["broker_credentials", "strategy_configs", "order_intents", "execution_logs", "paper_trading_states"],
  },
  {
    id: "migration-automation-execution",
    label: "automation_execution migration",
    tables: ["automation_worker_state"],
  },
  {
    id: "migration-live-trading-safety",
    label: "live_trading_safety migration",
    tables: ["automation_feature_access", "automation_strategy_state"],
  },
];

const tableCheck = async (table: string): Promise<string | null> => {
  const { error } = await createSupabaseAdminClient()
    .from(table)
    .select("id", { count: "exact", head: true })
    .limit(1);
  return error?.message ?? null;
};

const makeItem = (item: ReadinessItem): ReadinessItem => item;

const userSafeLiveTradingReason = ({
  effective,
  userEnabled,
  automationBeta,
  brokerCredentials,
  brokerAccountPreference,
}: {
  effective: boolean;
  userEnabled: boolean;
  automationBeta: boolean;
  brokerCredentials: boolean;
  brokerAccountPreference: boolean;
}) => {
  if (effective) {
    return "실주문 제출 조건이 모두 충족되었습니다.";
  }
  if (!automationBeta) {
    return "전략 실행 베타 권한이 필요합니다.";
  }
  if (!brokerCredentials) {
    return "검증 완료된 토스 API 키가 필요합니다.";
  }
  if (!brokerAccountPreference) {
    return "자동거래에 사용할 Toss 계좌 선택이 필요합니다.";
  }
  if (!userEnabled) {
    return "사용자 실거래 토글이 OFF입니다.";
  }
  return "운영자 설정 확인이 필요한 상태입니다.";
};

export const getAutomationHealthSnapshot = async (): Promise<AutomationHealthSnapshot> => {
  const generatedAt = new Date().toISOString();
  const supabasePublicConfigured = getSupabaseServerConfig() !== null;
  const supabaseAdminConfigured = getSupabaseAdminConfig() !== null;
  const credentialEncryptionConfigured = isCredentialEncryptionConfigured();
  const liveTradingMasterEnabled = process.env.ENABLE_LIVE_TRADING === "true";
  const localMacRuntime = process.env.STOCK_ANALYSIS_RUNTIME === "macos-local";
  const production = process.env.NODE_ENV === "production";

  const items: ReadinessItem[] = [
    makeItem({
      id: "supabase-public-env",
      owner: "operator",
      status: supabasePublicConfigured ? "pass" : production ? "fail" : "warn",
      label: "Supabase public env",
      summary: supabasePublicConfigured
        ? "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 설정됨"
        : localMacRuntime ? "macOS 로컬 앱에서는 Supabase 공개 인증 환경 변수가 선택 사항입니다." : "Supabase 공개 인증 환경 변수가 없습니다.",
      action: localMacRuntime
        ? "웹 fallback/admin 동기화가 필요할 때만 Supabase URL과 publishable key를 설정하세요."
        : "Vercel Project Settings > Environment Variables에 Supabase URL과 publishable key를 설정하세요.",
      blocking: production,
    }),
    makeItem({
      id: "supabase-admin-env",
      owner: "operator",
      status: supabaseAdminConfigured ? "pass" : production ? "fail" : "warn",
      label: "Supabase service role",
      summary: supabaseAdminConfigured
        ? "서버 전용 Supabase secret/service role 설정됨"
        : localMacRuntime ? "macOS 로컬 앱은 App Support 로컬 저장소를 사용하므로 service role은 선택 사항입니다." : "서버 영속 저장소 확인에 필요한 Supabase secret/service role이 없습니다.",
      action: localMacRuntime
        ? "원격 동기화나 웹 fallback 운영이 필요할 때 SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY를 설정하세요."
        : "SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY를 서버 환경 변수로 설정하세요.",
      blocking: production,
    }),
    makeItem({
      id: "broker-credential-encryption",
      owner: "operator",
      status: credentialEncryptionConfigured ? "pass" : "fail",
      label: "Broker credential encryption",
      summary: credentialEncryptionConfigured
        ? "BROKER_CREDENTIAL_ENC_KEY 형식이 유효합니다."
        : "토스 키 암호화용 BROKER_CREDENTIAL_ENC_KEY가 없거나 형식이 올바르지 않습니다.",
      action: "`keyId:base64(32바이트)` 형식으로 BROKER_CREDENTIAL_ENC_KEY를 설정하세요.",
      blocking: true,
    }),
    makeItem({
      id: "live-trading-master-switch",
      owner: "operator",
      status: liveTradingMasterEnabled ? "pass" : "warn",
      label: "Live trading master switch",
      summary: liveTradingMasterEnabled
        ? "ENABLE_LIVE_TRADING=true"
        : localMacRuntime ? "앱의 로컬 운영자 게이트가 OFF입니다." : "실거래 마스터 게이트가 OFF입니다.",
      action: localMacRuntime
        ? "Toss 시트에서 로컬 운영자 게이트를 켜면 sidecar가 ENABLE_LIVE_TRADING=true로 재시작됩니다."
        : "실주문 테스트 전 서버 환경 변수 ENABLE_LIVE_TRADING=true를 명시적으로 설정하세요.",
      blocking: false,
    }),
  ];

  if (!supabaseAdminConfigured) {
    items.push(
      ...MIGRATION_GROUPS.map((group) =>
        makeItem({
          id: group.id,
          owner: "operator",
          status: production ? "fail" : "warn",
          label: group.label,
          summary: localMacRuntime
            ? "macOS 로컬 앱에서는 원격 DB migration 확인이 선택 사항입니다."
            : "Supabase service role이 없어 원격 DB migration 적용 여부를 확인하지 못했습니다.",
          action: localMacRuntime
            ? "웹 fallback/admin 동기화가 필요할 때만 service role 설정 후 migration 체인을 확인하세요."
            : "service role 설정 후 migration 체인을 다시 확인하세요.",
          blocking: production,
        }),
      ),
    );
  } else {
    const groupChecks = await Promise.all(
      MIGRATION_GROUPS.map(async (group) => {
        const failures = (
          await Promise.all(group.tables.map(async (table) => ({ table, error: await tableCheck(table) })))
        ).filter((result) => result.error);
        return { group, failures };
      }),
    );
    items.push(
      ...groupChecks.map(({ group, failures }) =>
        makeItem({
          id: group.id,
          owner: "operator",
          status: failures.length === 0 ? "pass" : "fail",
          label: group.label,
          summary: failures.length === 0
            ? `${group.tables.length}개 필수 테이블 확인됨`
            : `누락/오류: ${failures.map((failure) => `${failure.table}(${failure.error})`).join(", ")}`,
          action: "Supabase SQL Editor 또는 CLI에서 migrations 체인을 순서대로 적용하세요.",
          blocking: failures.length > 0,
        }),
      ),
    );
  }

  const blockingFailures = items.filter((item) => item.blocking && item.status === "fail");
  return {
    generatedAt,
    overall: blockingFailures.length ? "blocked" : items.some((item) => item.status !== "pass") ? "degraded" : "healthy",
    storageMode: supabaseAdminConfigured ? "supabase" : "local-file",
    env: {
      nodeEnv: process.env.NODE_ENV ?? "development",
      supabasePublicConfigured,
      supabaseAdminConfigured,
      credentialEncryptionConfigured,
      liveTradingMasterEnabled,
    },
    items,
  };
};

export const getAutomationReadinessSnapshot = async (
  userId: string,
  options: { includeOperator?: boolean } = {},
): Promise<AutomationReadinessSnapshot> => {
  const includeOperator = options.includeOperator === true;
  const health = includeOperator ? await getAutomationHealthSnapshot() : null;
  const generatedAt = health?.generatedAt ?? new Date().toISOString();
  const features = await listAutomationFeatures(userId).catch(() => null);
  const credential = await getBrokerCredentialView(userId, "toss").catch(() => undefined);
  const accountPreference = await getBrokerAccountPreference(userId, "toss").catch(() => undefined);
  const liveTradingGate = await getLiveTradingGate(userId, features?.includes("live_trading")).catch(() => null);
  const automationBeta = features?.includes("automation_beta") ?? false;
  const brokerCredentials = credential?.status === "verified";
  const brokerAccountPreference = !!accountPreference;
  const liveTrading = features?.includes("live_trading") ?? false;
  const liveTradingEffective = liveTradingGate?.effective ?? false;

  const userItems: ReadinessItem[] = [];
  if (features === null) {
    userItems.push(makeItem({
      id: "automation-feature-store",
      owner: "user",
      status: "fail",
      label: "Automation feature store",
      summary: "자동매매 권한 저장소를 읽지 못했습니다.",
      action: "operator readiness에서 migration/service role 상태를 먼저 확인하세요.",
      blocking: true,
    }));
  } else {
    userItems.push(
      makeItem({
        id: "automation-beta-access",
        owner: "user",
        status: features.includes("automation_beta") ? "pass" : "fail",
        label: "Automation beta access",
        summary: features.includes("automation_beta")
          ? "전략 실행 베타 권한이 활성화되어 있습니다."
          : "전략 실행 베타 권한이 없습니다.",
        action: "베타 코드를 등록하거나 operator가 automation_beta 권한을 부여해야 합니다.",
        blocking: true,
      }),
      makeItem({
        id: "broker-credential-status",
        owner: "user",
        status: credential?.status === "verified" ? "pass" : credential ? "warn" : "fail",
        label: "Toss credential",
        summary: credential
          ? `토스 credential 상태: ${credential.status}`
          : "등록된 토스 credential이 없습니다.",
        action: "토스 Open API client_id/client_secret을 등록하고 계좌 조회 검증을 통과하세요.",
        blocking: true,
      }),
      makeItem({
        id: "broker-account-preference",
        owner: "user",
        status: brokerAccountPreference ? "pass" : "fail",
        label: "Toss automation account",
        summary: brokerAccountPreference
          ? `자동거래 계좌 #${accountPreference.accountSeq} 선택됨`
          : accountPreference === undefined
            ? "Toss 자동거래 계좌 선택 저장소를 읽지 못했습니다."
            : "자동거래에 사용할 Toss 계좌가 선택되지 않았습니다.",
        action: brokerAccountPreference
          ? "계좌를 바꾸려면 macOS Toss 시트에서 계좌 새로고침 후 다시 선택하세요."
          : "macOS Toss 시트에서 계좌 새로고침 후 자동거래 계좌를 선택하세요.",
        blocking: true,
      }),
      makeItem({
        id: "user-live-trading-toggle",
        owner: "user",
        status: features.includes("live_trading") ? "pass" : "warn",
        label: "User live trading toggle",
        summary: features.includes("live_trading")
          ? "사용자 실거래 토글이 ON입니다."
          : "사용자 실거래 토글이 OFF입니다.",
        action: "실주문 전 readiness가 모두 통과된 상태에서 실거래 토글을 켜세요.",
        blocking: false,
      }),
    );
  }

  userItems.push(makeItem({
    id: "live-trading-effective",
    owner: "system",
    status: liveTradingGate?.effective ? "pass" : "fail",
    label: "Effective live trading gate",
    summary: liveTradingGate?.effective
      ? "실주문 제출 조건이 모두 충족되었습니다."
      : includeOperator
        ? liveTradingGate?.reason ?? "실거래 게이트 상태를 확인하지 못했습니다."
        : userSafeLiveTradingReason({
          effective: liveTradingEffective,
          userEnabled: liveTradingGate?.userEnabled ?? liveTrading,
          automationBeta,
          brokerCredentials,
          brokerAccountPreference,
        }),
    action: includeOperator
      ? "operator 설정, beta 권한, 토스 credential, 사용자 토글을 순서대로 확인하세요."
      : "내 계정 단계가 모두 완료됐는데도 차단되면 관리자에게 운영 설정 확인을 요청하세요.",
    blocking: true,
  }));

  const items = [...(health?.items ?? []), ...userItems];
  const blockingFailures = items.filter((item) => item.blocking && item.status === "fail");
  return {
    generatedAt,
    operatorVisible: includeOperator,
    storageMode: health?.storageMode ?? "hidden",
    env: health?.env,
    overall: liveTradingGate?.effective ? "ready" : blockingFailures.length ? "blocked" : "limited",
    items,
    user: {
      automationBeta,
      brokerCredentials,
      liveTrading,
      liveTradingEffective,
    },
  };
};
