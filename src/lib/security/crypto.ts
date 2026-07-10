import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 브로커 자격증명(토스 client_id / client_secret) 암호화 레이어.
 *
 * AES-256-GCM 으로 봉투 암호화합니다. 마스터 키는 환경변수에서 읽으며,
 * `encryption_key_id` 로 키 회전을 지원합니다. 평문 시크릿은 절대 DB/로그에
 * 남기지 않고, 복호화는 실제 주문/검증 직전에만 메모리에서 수행합니다.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 권장 nonce 길이
const AUTH_TAG_LENGTH = 16;

export type EncryptedSecret = {
  /** 사용한 마스터 키 식별자. broker_credentials.encryption_key_id 에 저장 */
  keyId: string;
  /** base64(iv):base64(authTag):base64(ciphertext) */
  payload: string;
};

type MasterKey = {
  id: string;
  key: Buffer;
};

/**
 * 환경변수에서 활성 마스터 키와 (회전 중이라면) 과거 키들을 읽습니다.
 *
 * - BROKER_CREDENTIAL_ENC_KEY: `keyId:base64key` (활성 키, 32바이트)
 * - BROKER_CREDENTIAL_ENC_KEYS: `keyId:base64key,keyId2:base64key2` (복호화용 과거 키, 선택)
 */
const parseKeyEntry = (raw: string): MasterKey | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const id = trimmed.slice(0, separator).trim();
  const keyMaterial = trimmed.slice(separator + 1).trim();
  let key: Buffer;
  try {
    key = Buffer.from(keyMaterial, "base64");
  } catch {
    return null;
  }
  if (id.length === 0 || key.length !== 32) {
    return null;
  }
  return { id, key };
};

const getActiveKey = (): MasterKey => {
  const active = process.env.BROKER_CREDENTIAL_ENC_KEY;
  const parsed = active ? parseKeyEntry(active) : null;
  if (!parsed) {
    throw new Error(
      "BROKER_CREDENTIAL_ENC_KEY 가 설정되지 않았거나 형식이 올바르지 않습니다. `keyId:base64(32바이트)` 형식이어야 합니다.",
    );
  }
  return parsed;
};

const getKeyById = (keyId: string): MasterKey => {
  const active = getActiveKey();
  if (active.id === keyId) {
    return active;
  }
  const previous = process.env.BROKER_CREDENTIAL_ENC_KEYS ?? "";
  for (const entry of previous.split(",")) {
    const parsed = parseKeyEntry(entry);
    if (parsed && parsed.id === keyId) {
      return parsed;
    }
  }
  throw new Error(`암호화 키 '${keyId}' 를 찾을 수 없습니다. 키 회전 설정을 확인하세요.`);
};

export const isCredentialEncryptionConfigured = (): boolean => {
  try {
    getActiveKey();
    return true;
  } catch {
    return false;
  }
};

export const encryptSecret = (plaintext: string): EncryptedSecret => {
  const { id, key } = getActiveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
  return { keyId: id, payload };
};

export const decryptSecret = (encrypted: EncryptedSecret): string => {
  const { key } = getKeyById(encrypted.keyId);
  const [ivB64, authTagB64, ciphertextB64] = encrypted.payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
};

/** 화면 표시용 마스킹: 앞 4자리만 노출 */
export const maskIdentifier = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `${trimmed.slice(0, 4)}${"*".repeat(Math.min(trimmed.length - 4, 12))}`;
};
