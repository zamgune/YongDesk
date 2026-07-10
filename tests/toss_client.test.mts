import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTossTokenCache,
  createTossClient,
  formatTossApiError,
  TossApiError,
} from "../src/lib/toss/client.ts";

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });

const withMockFetch = async (
  responses: Response[],
  run: (calls: FetchCall[]) => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }
    return response;
  }) as typeof fetch;
  clearTossTokenCache();
  try {
    await run(calls);
  } finally {
    clearTossTokenCache();
    globalThis.fetch = originalFetch;
  }
};

const tokenResponse = () => jsonResponse({
  access_token: "test-access-token",
  token_type: "Bearer",
  expires_in: 3600,
});

test("toss client calls market data endpoints with bearer token", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ result: { timestamp: "2026-06-18T00:00:00Z", upperLimitPrice: "1000", lowerLimitPrice: "800", currency: "KRW" } }),
      jsonResponse({ result: [] }),
      jsonResponse({ result: { today: { date: "2026-06-18", integrated: null }, previousBusinessDay: { date: "2026-06-17", integrated: null }, nextBusinessDay: { date: "2026-06-19", integrated: null } } }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      await client.getPriceLimit("005930");
      await client.getStockWarnings("005930");
      await client.getKrMarketCalendar("2026-06-18");

      assert.equal(calls[0]?.url, "https://openapi.tossinvest.com/oauth2/token");
      assert.match(calls[1]?.url ?? "", /\/api\/v1\/price-limits\?symbol=005930$/);
      assert.match(calls[2]?.url ?? "", /\/api\/v1\/stocks\/005930\/warnings$/);
      assert.match(calls[3]?.url ?? "", /\/api\/v1\/market-calendar\/KR\?date=2026-06-18$/);
      assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, "Bearer test-access-token");
    },
  );
});

test("toss client sends account header for closed order history", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ result: { orders: [], nextCursor: null, hasNext: false } }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      await client.listOrders(7, { status: "CLOSED", from: "2026-06-01", to: "2026-06-18", limit: 20 });

      const url = new URL(calls[1]?.url ?? "");
      assert.equal(url.pathname, "/api/v1/orders");
      assert.equal(url.searchParams.get("status"), "CLOSED");
      assert.equal(url.searchParams.get("from"), "2026-06-01");
      assert.equal(url.searchParams.get("to"), "2026-06-18");
      assert.equal((calls[1]?.init?.headers as Record<string, string>)["X-Tossinvest-Account"], "7");
    },
  );
});

test("toss client retries 429 responses without reissuing token", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ error: { requestId: "r1", code: "rate-limit", message: "Too many requests" } }, {
        status: 429,
        headers: { "Retry-After": "0.001" },
      }),
      jsonResponse({ result: [{ symbol: "AAPL", timestamp: null, lastPrice: "200.00", currency: "USD" }] }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      const prices = await client.getPrices(["AAPL"]);

      assert.equal(prices[0]?.symbol, "AAPL");
      assert.equal(calls.length, 3);
      assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 1);
    },
  );
});

test("toss client preserves request id and rate-limit metadata after exhausted retries", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ error: { requestId: "r1", code: "rate-limit-exceeded", message: "Too many requests" } }, {
        status: 429,
        headers: {
          "Retry-After": "0.001",
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "1",
        },
      }),
      jsonResponse({ error: { requestId: "r2", code: "rate-limit-exceeded", message: "Still limited" } }, {
        status: 429,
        headers: {
          "Retry-After": "0.001",
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "1",
        },
      }),
      jsonResponse({ error: { requestId: "r3", code: "rate-limit-exceeded", message: "Retry later" } }, {
        status: 429,
        headers: {
          "Retry-After": "0.001",
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "1",
        },
      }),
    ],
    async () => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      try {
        await client.getPrices(["AAPL"]);
        assert.fail("expected rate-limit error");
      } catch (error) {
        assert.ok(error instanceof TossApiError);
        assert.equal(error.code, "rate-limit-exceeded");
        assert.equal(error.requestId, "r3");
        assert.equal(error.retryAfterMs, 1);
        assert.equal(error.rateLimit?.limit, 10);
        assert.equal(error.rateLimit?.remaining, 0);

        const payload = formatTossApiError(error, "현재가 조회 실패");
        assert.equal(payload.requestId, "r3");
        assert.match(payload.toss.guidance, /Retry-After/);
      }
    },
  );
});
