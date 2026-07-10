import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  decryptSecret,
  encryptSecret,
  maskIdentifier,
  type EncryptedSecret,
} from "@/lib/security/crypto";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import type { TossCredentials } from "@/lib/toss/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

/**
 * 회원별 브로커 및 거래소 자격증명 저장소.
 *
 * 평문 시크릿은 저장하지 않습니다. client_id / client_secret 은 AES-256-GCM 으로
 * 암호화한 뒤 암호문만 보관하고, 사용 직전 메모리에서만 복호화합니다.
 * Supabase 설정 시 broker_credentials 테이블을, 아니면 .cache 파일을 사용합니다.
 */

export type BrokerName = "toss" | "upbit" | "bithumb";
export type CredentialStatus = "pending" | "verified" | "failed" | "disabled";

export type BrokerCredentialView = {
  broker: BrokerName;
  maskedIdentifier: string;
  status: CredentialStatus;
  lastVerifiedAt: string | null;
  updatedAt: string;
};

// === 파일 백엔드 ===

type StoredCredential = {
  userId: string;
  broker: BrokerName;
  maskedIdentifier: string;
  encryptedClientId: EncryptedSecret;
  encryptedClientSecret: EncryptedSecret;
  status: CredentialStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CredentialStore = { credentials: StoredCredential[] };

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "broker-credentials.json");

const readFileStore = async (): Promise<CredentialStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CredentialStore>;
    return { credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
  } catch {
    return { credentials: [] };
  }
};

const writeFileStore = async (store: CredentialStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

const toView = (entry: {
  broker: BrokerName;
  maskedIdentifier: string;
  status: CredentialStatus;
  lastVerifiedAt: string | null;
  updatedAt: string;
}): BrokerCredentialView => ({
  broker: entry.broker,
  maskedIdentifier: entry.maskedIdentifier,
  status: entry.status,
  lastVerifiedAt: entry.lastVerifiedAt,
  updatedAt: entry.updatedAt,
});

// === Supabase 백엔드 (broker_credentials) ===

const shouldUseSupabaseStore = () => getSupabaseAdminConfig() !== null;
const supabase = () => createSupabaseAdminClient();
const throwIfSupabaseError = (error: { message?: string } | null, operation: string) => {
  if (error) {
    throw new Error(`${operation}: ${error.message ?? "Supabase request failed"}`);
  }
};

const getViewSupabase = async (userId: string, broker: BrokerName) => {
  const { data, error } = await supabase()
    .from("broker_credentials")
    .select("masked_identifier, status, last_verified_at, updated_at")
    .eq("user_id", userId)
    .eq("broker", broker)
    .maybeSingle();
  throwIfSupabaseError(error, "read broker credentials");
  if (!data) {
    return null;
  }
  return toView({
    broker,
    maskedIdentifier: data.masked_identifier ?? "****",
    status: (data.status as CredentialStatus) ?? "pending",
    lastVerifiedAt: data.last_verified_at ?? null,
    updatedAt: data.updated_at ?? new Date().toISOString(),
  });
};

const saveSupabase = async (
  userId: string,
  broker: BrokerName,
  clientId: string,
  clientSecret: string,
  status: CredentialStatus,
) => {
  const idCipher = encryptSecret(clientId);
  const secretCipher = encryptSecret(clientSecret);
  const now = new Date().toISOString();
  const { error } = await supabase()
    .from("broker_credentials")
    .upsert(
      {
        user_id: userId,
        broker,
        masked_identifier: maskIdentifier(clientId),
        encrypted_access_key: idCipher.payload,
        encrypted_secret_key: secretCipher.payload,
        encryption_key_id: idCipher.keyId,
        status,
        last_verified_at: status === "verified" ? now : null,
      },
      { onConflict: "user_id,broker" },
    );
  throwIfSupabaseError(error, "save broker credentials");
  return (await getViewSupabase(userId, broker)) as BrokerCredentialView;
};

const loadSupabase = async (userId: string, broker: BrokerName): Promise<TossCredentials | null> => {
  const { data, error } = await supabase()
    .from("broker_credentials")
    .select("encrypted_access_key, encrypted_secret_key, encryption_key_id")
    .eq("user_id", userId)
    .eq("broker", broker)
    .maybeSingle();
  throwIfSupabaseError(error, "load broker credentials");
  if (!data || !data.encrypted_access_key || !data.encrypted_secret_key) {
    return null;
  }
  return {
    clientId: decryptSecret({ keyId: data.encryption_key_id, payload: data.encrypted_access_key }),
    clientSecret: decryptSecret({ keyId: data.encryption_key_id, payload: data.encrypted_secret_key }),
  };
};

// === 공개 API (디스패치) ===

export const getBrokerCredentialView = async (
  userId: string,
  broker: BrokerName = "toss",
): Promise<BrokerCredentialView | null> => {
  if (shouldUseSupabaseStore()) {
    return getViewSupabase(userId, broker);
  }
  const store = await readFileStore();
  const entry = store.credentials.find((c) => c.userId === userId && c.broker === broker);
  return entry ? toView(entry) : null;
};

export const saveBrokerCredentials = async ({
  userId,
  broker = "toss",
  clientId,
  clientSecret,
  status = "pending",
}: {
  userId: string;
  broker?: BrokerName;
  clientId: string;
  clientSecret: string;
  status?: CredentialStatus;
}): Promise<BrokerCredentialView> => {
  if (shouldUseSupabaseStore()) {
    return saveSupabase(userId, broker, clientId, clientSecret, status);
  }
  const now = new Date().toISOString();
  const store = await readFileStore();
  const existing = store.credentials.find((c) => c.userId === userId && c.broker === broker);
  const entry: StoredCredential = {
    userId,
    broker,
    maskedIdentifier: maskIdentifier(clientId),
    encryptedClientId: encryptSecret(clientId),
    encryptedClientSecret: encryptSecret(clientSecret),
    status,
    lastVerifiedAt: status === "verified" ? now : (existing?.lastVerifiedAt ?? null),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFileStore({
    credentials: [
      ...store.credentials.filter((c) => !(c.userId === userId && c.broker === broker)),
      entry,
    ],
  });
  return toView(entry);
};

export const updateCredentialStatus = async (
  userId: string,
  broker: BrokerName,
  status: CredentialStatus,
): Promise<void> => {
  const now = new Date().toISOString();
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase()
      .from("broker_credentials")
      .update({ status, last_verified_at: status === "verified" ? now : null })
      .eq("user_id", userId)
      .eq("broker", broker);
    throwIfSupabaseError(error, "update broker credential status");
    return;
  }
  const store = await readFileStore();
  const next = store.credentials.map((c) =>
    c.userId === userId && c.broker === broker
      ? { ...c, status, lastVerifiedAt: status === "verified" ? now : c.lastVerifiedAt, updatedAt: now }
      : c,
  );
  await writeFileStore({ credentials: next });
};

/**
 * 복호화된 자격증명을 반환합니다. 주문/검증 직전에만 호출하세요.
 * 반환값(평문 시크릿)은 로그/응답에 절대 포함하지 않습니다.
 */
export const loadDecryptedCredentials = async (
  userId: string,
  broker: BrokerName = "toss",
): Promise<TossCredentials | null> => {
  if (shouldUseSupabaseStore()) {
    return loadSupabase(userId, broker);
  }
  const store = await readFileStore();
  const entry = store.credentials.find((c) => c.userId === userId && c.broker === broker);
  if (!entry) {
    return null;
  }
  return {
    clientId: decryptSecret(entry.encryptedClientId),
    clientSecret: decryptSecret(entry.encryptedClientSecret),
  };
};

export const deleteBrokerCredentials = async (
  userId: string,
  broker: BrokerName = "toss",
): Promise<void> => {
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase().from("broker_credentials").delete().eq("user_id", userId).eq("broker", broker);
    throwIfSupabaseError(error, "delete broker credentials");
    return;
  }
  const store = await readFileStore();
  await writeFileStore({
    credentials: store.credentials.filter((c) => !(c.userId === userId && c.broker === broker)),
  });
};
