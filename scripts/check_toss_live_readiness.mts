import {
  createTossClient,
  getTossErrorGuidance,
  TossApiError,
  type TossClient,
  type TossCredentials,
} from "../src/lib/toss/client.ts";
import type { Account, TossCurrency } from "../src/lib/toss/types.ts";

const CLIENT_ID_KEYS = [
  "TOSS_CLIENT_ID",
  "TOSS_OPENAPI_CLIENT_ID",
  "TOSS_INVEST_CLIENT_ID",
  "TOSSINVEST_CLIENT_ID",
] as const;
const CLIENT_SECRET_KEYS = [
  "TOSS_CLIENT_SECRET",
  "TOSS_OPENAPI_CLIENT_SECRET",
  "TOSS_INVEST_CLIENT_SECRET",
  "TOSSINVEST_CLIENT_SECRET",
] as const;
const ACCOUNT_SEQ_KEYS = [
  "TOSS_ACCOUNT_SEQ",
  "TOSS_OPENAPI_ACCOUNT_SEQ",
  "TOSS_INVEST_ACCOUNT_SEQ",
] as const;

type EnvLike = Record<string, string | undefined>;

export type TossReadinessStatus =
  | "credential-missing"
  | "account-ready"
  | "account-missing"
  | "invalid-env"
  | "api-error"
  | "unexpected-error";

export type TossReadinessEnvironment = {
  credentials: TossCredentials | null;
  credentialSources: {
    clientId?: string;
    clientSecret?: string;
  };
  requestedAccountSeq: number | null;
  symbol: string;
  currency: TossCurrency;
};

export type TossReadinessReport = {
  ok: boolean;
  status: TossReadinessStatus;
  checkedAt: string;
  orderSubmissionAttempted: false;
  credentials: {
    present: boolean;
    clientIdMasked?: string;
    sources?: TossReadinessEnvironment["credentialSources"];
  };
  selectedAccount?: {
    accountSeq: number;
    accountType: string;
    accountNoMasked: string;
  };
  accountHeaderVerified: boolean;
  readonlyChecks: {
    token: boolean;
    accounts: boolean;
    holdings: boolean;
    openOrders: boolean;
  };
  summary: string;
  guidance: string[];
  toss?: {
    status?: number;
    code?: string;
    requestId?: string;
    guidance?: string;
  };
};

type TossReadinessClient = Pick<TossClient, "verifyToken" | "listAccounts" | "getHoldings" | "getOpenOrders">;
type TossReadinessClientFactory = (credentials: TossCredentials) => TossReadinessClient;

const firstEnvValue = (env: EnvLike, keys: readonly string[]) => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return { key, value };
    }
  }
  return null;
};

export const maskSecret = (value: string) => {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 3)}...${value.slice(-2)}`;
};

export const maskAccountNo = (accountNo: string) => {
  const digits = accountNo.replace(/\D/g, "");
  if (digits.length <= 4) {
    return accountNo ? "****" : "";
  }
  return `****-${digits.slice(-4)}`;
};

const parseAccountSeq = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
};

const parseCurrency = (value: string | undefined): TossCurrency => value === "KRW" ? "KRW" : "USD";

export const resolveTossReadinessEnvironment = (
  env: EnvLike = process.env,
): TossReadinessEnvironment => {
  const clientId = firstEnvValue(env, CLIENT_ID_KEYS);
  const clientSecret = firstEnvValue(env, CLIENT_SECRET_KEYS);
  const accountSeqValue = firstEnvValue(env, ACCOUNT_SEQ_KEYS);
  const requestedAccountSeq = parseAccountSeq(accountSeqValue?.value);

  return {
    credentials: clientId && clientSecret
      ? { clientId: clientId.value, clientSecret: clientSecret.value }
      : null,
    credentialSources: {
      clientId: clientId?.key,
      clientSecret: clientSecret?.key,
    },
    requestedAccountSeq,
    symbol: env.TOSS_READINESS_SYMBOL?.trim().toUpperCase() || "NVDA",
    currency: parseCurrency(env.TOSS_READINESS_CURRENCY?.trim().toUpperCase()),
  };
};

export const selectBrokerageAccount = (
  accounts: readonly Account[],
  requestedAccountSeq: number | null,
) => {
  if (requestedAccountSeq !== null) {
    if (!Number.isFinite(requestedAccountSeq)) {
      return { account: null, issue: "TOSS_ACCOUNT_SEQ는 양의 정수여야 합니다." };
    }
    const requested = accounts.find((account) => account.accountSeq === requestedAccountSeq);
    if (!requested) {
      return { account: null, issue: `요청한 Toss 계좌 seq ${requestedAccountSeq}를 찾지 못했습니다.` };
    }
    if (requested.accountType !== "BROKERAGE") {
      return { account: null, issue: `요청한 Toss 계좌는 BROKERAGE가 아닙니다: ${requested.accountType}` };
    }
    return { account: requested, issue: null };
  }

  const brokerage = accounts.find((account) => account.accountType === "BROKERAGE");
  return brokerage
    ? { account: brokerage, issue: null }
    : { account: null, issue: "Toss BROKERAGE 계좌를 찾지 못했습니다." };
};

const baseReport = (
  status: TossReadinessStatus,
  env: TossReadinessEnvironment,
): TossReadinessReport => ({
  ok: false,
  status,
  checkedAt: new Date().toISOString(),
  orderSubmissionAttempted: false,
  credentials: {
    present: !!env.credentials,
    clientIdMasked: env.credentials ? maskSecret(env.credentials.clientId) : undefined,
    sources: env.credentialSources,
  },
  accountHeaderVerified: false,
  readonlyChecks: {
    token: false,
    accounts: false,
    holdings: false,
    openOrders: false,
  },
  summary: "",
  guidance: [],
});

export const buildMissingCredentialReport = (
  env: TossReadinessEnvironment,
): TossReadinessReport => ({
  ...baseReport("credential-missing", env),
  summary: "Toss API credential이 설정되지 않아 외부 네트워크 호출을 생략했습니다.",
  guidance: [
    "TOSS_CLIENT_ID/TOSS_CLIENT_SECRET 또는 TOSS_OPENAPI_CLIENT_ID/TOSS_OPENAPI_CLIENT_SECRET을 설정하세요.",
    "앱에서는 Toss 시트에서 Keychain credential을 등록한 뒤 계좌 선택을 진행하세요.",
    "이 체크는 주문 생성/정정/취소 API를 호출하지 않습니다.",
  ],
});

export const checkTossLiveReadiness = async (
  envInput: EnvLike = process.env,
  clientFactory: TossReadinessClientFactory = createTossClient,
): Promise<TossReadinessReport> => {
  const env = resolveTossReadinessEnvironment(envInput);
  if (!env.credentials) {
    return buildMissingCredentialReport(env);
  }
  if (Number.isNaN(env.requestedAccountSeq)) {
    return {
      ...baseReport("invalid-env", env),
      summary: "TOSS_ACCOUNT_SEQ 값이 유효하지 않습니다.",
      guidance: ["TOSS_ACCOUNT_SEQ는 Toss 계좌 seq 숫자만 입력하세요."],
    };
  }

  const report = baseReport("api-error", env);
  const client = clientFactory(env.credentials);
  try {
    await client.verifyToken();
    report.readonlyChecks.token = true;

    const accounts = await client.listAccounts();
    report.readonlyChecks.accounts = true;

    const selected = selectBrokerageAccount(accounts, env.requestedAccountSeq);
    if (!selected.account) {
      return {
        ...report,
        status: "account-missing",
        summary: selected.issue ?? "Toss 계좌를 선택할 수 없습니다.",
        guidance: [
          "Toss 개발자 콘솔/API 권한과 계좌 연결 상태를 확인하세요.",
          "여러 계좌가 있으면 TOSS_ACCOUNT_SEQ로 BROKERAGE 계좌를 명시하세요.",
          "이 체크는 주문 생성/정정/취소 API를 호출하지 않습니다.",
        ],
      };
    }

    await client.getHoldings(selected.account.accountSeq, env.symbol);
    report.readonlyChecks.holdings = true;
    await client.getOpenOrders(selected.account.accountSeq, env.symbol);
    report.readonlyChecks.openOrders = true;

    return {
      ...report,
      ok: true,
      status: "account-ready",
      selectedAccount: {
        accountSeq: selected.account.accountSeq,
        accountType: selected.account.accountType,
        accountNoMasked: maskAccountNo(selected.account.accountNo),
      },
      accountHeaderVerified: true,
      summary: `Toss 토큰, 계좌 목록, 보유 조회, 미체결 조회가 주문 없이 통과했습니다. 기준 종목: ${env.symbol}`,
      guidance: [
        "앱의 실거래 버튼은 별도 ENABLE_LIVE_TRADING/live_trading 권한/kill switch를 계속 통과해야 합니다.",
        "공개 배포용 앱은 Developer ID 서명과 Apple 공증을 별도로 완료해야 합니다.",
      ],
    };
  } catch (error) {
    if (error instanceof TossApiError) {
      return {
        ...report,
        status: "api-error",
        summary: `Toss API 요청 실패: ${error.message}`,
        guidance: [
          getTossErrorGuidance(error.code),
          "client_id/client_secret, 허용 IP, 계좌 연결, Toss API 권한 범위를 확인하세요.",
          "이 체크는 주문 생성/정정/취소 API를 호출하지 않습니다.",
        ],
        toss: {
          status: error.status,
          code: error.code,
          requestId: error.requestId,
          guidance: getTossErrorGuidance(error.code),
        },
      };
    }

    return {
      ...report,
      status: "unexpected-error",
      summary: error instanceof Error ? error.message : String(error),
      guidance: [
        "네트워크, Node 런타임, 환경 변수 값을 확인하세요.",
        "이 체크는 주문 생성/정정/취소 API를 호출하지 않습니다.",
      ],
    };
  }
};

const exitCodeForReport = (report: TossReadinessReport) => {
  if (report.ok) {
    return 0;
  }
  return report.status === "api-error" || report.status === "unexpected-error" ? 1 : 2;
};

const main = async () => {
  const report = await checkTossLiveReadiness();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCodeForReport(report);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
