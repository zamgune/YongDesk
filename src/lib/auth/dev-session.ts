import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export const DEV_AUTH_COOKIE = "stock_analysis_dev_session";

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "dev-auth.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type DevUser = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

type DevSession = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

type DevAuthStore = {
  users: DevUser[];
  sessions: DevSession[];
};

export type DevSessionUser = {
  id: string;
  email: string;
};

const emptyStore = (): DevAuthStore => ({
  users: [],
  sessions: [],
});

const hashValue = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const readStore = async (): Promise<DevAuthStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DevAuthStore>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return emptyStore();
  }
};

const writeStore = async (store: DevAuthStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

const compactSessions = (sessions: DevSession[]) => {
  const now = Date.now();
  return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
};

export const createDevAuthSession = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || password.length < 8) {
    return { error: "이메일과 8자 이상 비밀번호가 필요합니다." };
  }

  const now = new Date().toISOString();
  const store = await readStore();
  if (store.users.some((user) => user.email === safeEmail)) {
    return { error: "이미 가입된 이메일입니다." };
  }

  const user: DevUser = {
    id: randomUUID(),
    email: safeEmail,
    passwordHash: hashValue(password),
    createdAt: now,
  };
  const token = randomUUID();
  const session: DevSession = {
    tokenHash: hashValue(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: now,
  };

  await writeStore({
    users: [...store.users, user],
    sessions: [...compactSessions(store.sessions), session],
  });

  return {
    token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
    },
  };
};

export const signInDevAuthSession = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const safeEmail = normalizeEmail(email);
  const store = await readStore();
  const user = store.users.find((entry) => entry.email === safeEmail);
  if (!user || user.passwordHash !== hashValue(password)) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  const token = randomUUID();
  const session: DevSession = {
    tokenHash: hashValue(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await writeStore({
    ...store,
    sessions: [...compactSessions(store.sessions), session],
  });

  return {
    token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      email: user.email,
    },
  };
};

export const getDevSessionUserByToken = async (token: string | undefined | null): Promise<DevSessionUser | null> => {
  if (!token) {
    return null;
  }
  const store = await readStore();
  const tokenHash = hashValue(token);
  const session = compactSessions(store.sessions).find((entry) => entry.tokenHash === tokenHash);
  if (!session) {
    return null;
  }
  const user = store.users.find((entry) => entry.id === session.userId);
  return user
    ? {
      id: user.id,
      email: user.email,
    }
    : null;
};

export const deleteDevSession = async (token: string | undefined | null) => {
  if (!token) {
    return;
  }
  const tokenHash = hashValue(token);
  const store = await readStore();
  await writeStore({
    ...store,
    sessions: compactSessions(store.sessions).filter((session) => session.tokenHash !== tokenHash),
  });
};

export const getDevAuthCookieOptions = (expiresAt?: string) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires: expiresAt ? new Date(expiresAt) : undefined,
});
