import { getBrokerCredentialView } from "@/lib/broker/credential-store";
import { getBrokerAccountPreference } from "@/lib/broker/account-preferences";
import { isCredentialEncryptionConfigured } from "@/lib/security/crypto";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

import { hasAutomationFeature } from "./store";

export type LiveTradingGate = {
  userEnabled: boolean;
  masterEnabled: boolean;
  effective: boolean;
  status: number;
  reason: string | null;
};

export const getLiveTradingGate = async (
  userId: string,
  userEnabledOverride?: boolean,
): Promise<LiveTradingGate> => {
  const masterEnabled = process.env.ENABLE_LIVE_TRADING === "true";
  const localMacRuntime = process.env.STOCK_ANALYSIS_RUNTIME === "macos-local";
  const localStorageRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT?.trim();
  const durableStorageConfigured = getSupabaseAdminConfig() !== null || (localMacRuntime && !!localStorageRoot);
  const readFeature = (feature: "automation_beta" | "live_trading" | "broker_credentials") =>
    hasAutomationFeature(userId, feature).catch(() => undefined);
  const userEnabled = userEnabledOverride ?? (await readFeature("live_trading"));
  if (userEnabled === undefined) {
    return {
      userEnabled: false,
      masterEnabled,
      effective: false,
      status: 503,
      reason: "자동매매 권한 저장소를 확인할 수 없습니다.",
    };
  }
  const closed = (reason: string, status = 423): LiveTradingGate => ({
    userEnabled,
    masterEnabled,
    effective: false,
    status,
    reason,
  });

  if (!masterEnabled) {
    return closed("실거래 마스터 게이트가 꺼져 있습니다.");
  }
  if (!durableStorageConfigured) {
    return closed("실거래에는 Supabase service role 또는 macOS 로컬 sidecar 저장소 설정이 필요합니다.", 503);
  }
  if (!isCredentialEncryptionConfigured()) {
    return closed("실거래에는 BROKER_CREDENTIAL_ENC_KEY 설정이 필요합니다.", 503);
  }
  const automationBeta = await readFeature("automation_beta");
  if (automationBeta === undefined) {
    return closed("자동매매 권한 저장소를 확인할 수 없습니다.", 503);
  }
  if (!automationBeta) {
    return closed("자동매매 베타 권한이 필요합니다.", 403);
  }
  const brokerCredentials = await readFeature("broker_credentials");
  if (brokerCredentials === undefined) {
    return closed("자동매매 권한 저장소를 확인할 수 없습니다.", 503);
  }
  if (!brokerCredentials) {
    return closed("토스 API 키 등록 후 실거래를 켤 수 있습니다.", 412);
  }
  const credential = await getBrokerCredentialView(userId, "toss").catch(() => undefined);
  if (credential === undefined) {
    return closed("토스 자격증명 저장소를 확인할 수 없습니다.", 503);
  }
  if (credential?.status !== "verified") {
    return closed("검증 완료된 토스 API 키가 필요합니다.", 412);
  }
  const accountPreference = await getBrokerAccountPreference(userId, "toss").catch(() => undefined);
  if (accountPreference === undefined) {
    return closed("토스 계좌 선택 저장소를 확인할 수 없습니다.", 503);
  }
  if (!accountPreference) {
    return closed("실거래에는 앱에서 선택한 Toss 자동거래 계좌가 필요합니다.", 412);
  }
  if (!userEnabled) {
    return closed("사용자 실거래 토글이 꺼져 있습니다.");
  }

  return {
    userEnabled,
    masterEnabled,
    effective: true,
    status: 200,
    reason: null,
  };
};
