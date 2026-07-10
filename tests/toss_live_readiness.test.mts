import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTossLiveReadiness,
  resolveTossReadinessEnvironment,
  selectBrokerageAccount,
} from "../scripts/check_toss_live_readiness.mts";
import { TossApiError, type TossCredentials } from "../src/lib/toss/client.ts";
import type { Account } from "../src/lib/toss/types.ts";

const brokerageAccount: Account = {
  accountNo: "1234567890",
  accountSeq: 7,
  accountType: "BROKERAGE",
};

const pensionAccount: Account = {
  accountNo: "99990000",
  accountSeq: 9,
  accountType: "PENSION_SAVINGS",
};

test("toss readiness resolves common environment aliases", () => {
  const env = resolveTossReadinessEnvironment({
    TOSS_OPENAPI_CLIENT_ID: "client-id",
    TOSS_OPENAPI_CLIENT_SECRET: "client-secret",
    TOSS_OPENAPI_ACCOUNT_SEQ: "7",
    TOSS_READINESS_SYMBOL: "aapl",
    TOSS_READINESS_CURRENCY: "KRW",
  });

  assert.deepEqual(env.credentials, {
    clientId: "client-id",
    clientSecret: "client-secret",
  });
  assert.equal(env.credentialSources.clientId, "TOSS_OPENAPI_CLIENT_ID");
  assert.equal(env.credentialSources.clientSecret, "TOSS_OPENAPI_CLIENT_SECRET");
  assert.equal(env.requestedAccountSeq, 7);
  assert.equal(env.symbol, "AAPL");
  assert.equal(env.currency, "KRW");
});

test("toss readiness fails closed without credentials and skips client calls", async () => {
  const report = await checkTossLiveReadiness({}, () => {
    throw new Error("client factory must not be called without credentials");
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "credential-missing");
  assert.equal(report.orderSubmissionAttempted, false);
  assert.equal(report.credentials.present, false);
  assert.equal(report.readonlyChecks.token, false);
  assert.match(report.summary, /credential/);
});

test("toss readiness selects only brokerage accounts", () => {
  const selected = selectBrokerageAccount([pensionAccount, brokerageAccount], null);
  assert.equal(selected.account?.accountSeq, 7);
  assert.equal(selected.issue, null);

  const requestedPension = selectBrokerageAccount([pensionAccount, brokerageAccount], 9);
  assert.equal(requestedPension.account, null);
  assert.match(requestedPension.issue ?? "", /BROKERAGE/);

  const missing = selectBrokerageAccount([pensionAccount], null);
  assert.equal(missing.account, null);
  assert.match(missing.issue ?? "", /BROKERAGE/);
});

test("toss readiness verifies account header through read-only account calls", async () => {
  const calls: string[] = [];
  const report = await checkTossLiveReadiness(
    {
      TOSS_CLIENT_ID: "client-id",
      TOSS_CLIENT_SECRET: "client-secret",
      TOSS_ACCOUNT_SEQ: "7",
      TOSS_READINESS_SYMBOL: "NVDA",
    },
    (credentials: TossCredentials) => {
      assert.equal(credentials.clientId, "client-id");
      return {
        verifyToken: async () => {
          calls.push("verifyToken");
          return "access-token";
        },
        listAccounts: async () => {
          calls.push("listAccounts");
          return [brokerageAccount];
        },
        getHoldings: async (accountSeq: number, symbol?: string) => {
          calls.push(`getHoldings:${accountSeq}:${symbol ?? ""}`);
          return { items: [] };
        },
        getOpenOrders: async (accountSeq: number, symbol?: string) => {
          calls.push(`getOpenOrders:${accountSeq}:${symbol ?? ""}`);
          return { orders: [], nextCursor: null, hasNext: false };
        },
      };
    },
  );

  assert.equal(report.ok, true);
  assert.equal(report.status, "account-ready");
  assert.equal(report.orderSubmissionAttempted, false);
  assert.equal(report.accountHeaderVerified, true);
  assert.equal(report.selectedAccount?.accountNoMasked, "****-7890");
  assert.deepEqual(calls, [
    "verifyToken",
    "listAccounts",
    "getHoldings:7:NVDA",
    "getOpenOrders:7:NVDA",
  ]);
});

test("toss readiness API errors do not include client secret", async () => {
  const report = await checkTossLiveReadiness(
    {
      TOSS_CLIENT_ID: "client-id",
      TOSS_CLIENT_SECRET: "super-secret-value",
    },
    () => ({
      verifyToken: async () => {
        throw new TossApiError(401, "invalid-token", "invalid credential");
      },
      listAccounts: async () => [],
      getHoldings: async () => ({ items: [] }),
      getOpenOrders: async () => ({ orders: [], nextCursor: null, hasNext: false }),
    }),
  );

  const serialized = JSON.stringify(report);
  assert.equal(report.ok, false);
  assert.equal(report.status, "api-error");
  assert.equal(report.orderSubmissionAttempted, false);
  assert.doesNotMatch(serialized, /super-secret-value/);
  assert.match(serialized, /invalid-token/);
});
