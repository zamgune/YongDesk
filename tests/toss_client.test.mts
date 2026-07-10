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

const tokenResponse = (accessToken = "test-access-token") => jsonResponse({
  access_token: accessToken,
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

test("toss client reads Toss Securities rankings without an account header", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({
        result: {
          rankedAt: "2026-07-11T09:30:00+09:00",
          rankings: [{
            rank: 4,
            symbol: "005930",
            currency: "KRW",
            price: { lastPrice: "88000", basePrice: "87000", changeRate: "0.0115" },
            tradingVolume: "1000",
            tradingAmount: "88000000",
          }],
        },
      }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      const response = await client.getRankings({
        type: "TOSS_SECURITIES_TRADING_AMOUNT",
        marketCountry: "KR",
        duration: "1d",
        count: 100,
      });

      const url = new URL(calls[1]?.url ?? "");
      assert.equal(url.pathname, "/api/v1/rankings");
      assert.equal(url.searchParams.get("type"), "TOSS_SECURITIES_TRADING_AMOUNT");
      assert.equal(url.searchParams.get("marketCountry"), "KR");
      assert.equal((calls[1]?.init?.headers as Record<string, string>)["X-Tossinvest-Account"], undefined);
      assert.equal(response.rankings[0]?.rank, 4);
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

test("toss client separates cached tokens when the client secret changes", async () => {
  await withMockFetch(
    [
      tokenResponse("first-access-token"),
      tokenResponse("rotated-access-token"),
    ],
    async (calls) => {
      const firstClient = createTossClient({ clientId: "same-client-id", clientSecret: "first-secret" });
      const rotatedClient = createTossClient({ clientId: "same-client-id", clientSecret: "rotated-secret" });

      assert.equal(await firstClient.verifyToken(), "first-access-token");
      assert.equal(await rotatedClient.verifyToken(), "rotated-access-token");
      assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 2);
    },
  );
});

test("toss client shares an in-flight token request across parallel market reads", async () => {
  await withMockFetch(
    [
      tokenResponse("shared-access-token"),
      jsonResponse({ result: [{ symbol: "AAPL", timestamp: null, lastPrice: "200.00", currency: "USD" }] }),
      jsonResponse({ result: [{ symbol: "NVDA", timestamp: null, lastPrice: "180.00", currency: "USD" }] }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "parallel-client-id", clientSecret: "parallel-secret" });
      const [apple, nvidia] = await Promise.all([
        client.getPrices(["AAPL"]),
        client.getPrices(["NVDA"]),
      ]);

      assert.equal(apple[0]?.symbol, "AAPL");
      assert.equal(nvidia[0]?.symbol, "NVDA");
      assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 1);
      assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, "Bearer shared-access-token");
      assert.equal((calls[2]?.init?.headers as Record<string, string>).Authorization, "Bearer shared-access-token");
    },
  );
});

test("toss client applies timeout signals to token and API requests", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ result: [] }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      await client.getPrices(["AAPL"]);

      assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
      assert.ok(calls[1]?.init?.signal instanceof AbortSignal);
      assert.equal(calls[0]?.init?.signal?.aborted, false);
      assert.equal(calls[1]?.init?.signal?.aborted, false);
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

test("toss client refreshes a revoked token once for read-only requests", async () => {
  await withMockFetch(
    [
      tokenResponse("revoked-access-token"),
      jsonResponse({ error: { code: "unauthorized", message: "Token revoked" } }, { status: 401 }),
      tokenResponse("fresh-access-token"),
      jsonResponse({ result: [{ symbol: "AAPL", timestamp: null, lastPrice: "200.00", currency: "USD" }] }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });
      const prices = await client.getPrices(["AAPL"]);

      assert.equal(prices[0]?.symbol, "AAPL");
      assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 2);
      assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, "Bearer revoked-access-token");
      assert.equal((calls[3]?.init?.headers as Record<string, string>).Authorization, "Bearer fresh-access-token");
    },
  );
});

test("toss client does not retry order POST requests after a 429 response", async () => {
  await withMockFetch(
    [
      tokenResponse(),
      jsonResponse({ error: { requestId: "order-r1", code: "rate-limit-exceeded", message: "Too many orders" } }, {
        status: 429,
        headers: { "Retry-After": "1" },
      }),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });

      await assert.rejects(
        client.createOrder(7, {
          clientOrderId: "order-1",
          symbol: "AAPL",
          side: "BUY",
          orderType: "LIMIT",
          quantity: "1",
          price: "100",
          timeInForce: "DAY",
          confirmHighValueOrder: false,
        }),
        (error: unknown) => {
          assert.ok(error instanceof TossApiError);
          assert.equal(error.status, 429);
          assert.equal(error.requestId, "order-r1");
          return true;
        },
      );

      assert.equal(calls.length, 2);
      assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/orders")).length, 1);
    },
  );
});

test("toss client invalidates but never retries a 401 order POST", async () => {
  await withMockFetch(
    [
      tokenResponse("revoked-order-token"),
      jsonResponse({ error: { requestId: "order-401", code: "unauthorized", message: "Token revoked" } }, { status: 401 }),
      tokenResponse("fresh-order-token"),
    ],
    async (calls) => {
      const client = createTossClient({ clientId: "client-id", clientSecret: "client-secret" });

      await assert.rejects(
        client.createOrder(7, {
          clientOrderId: "order-401",
          symbol: "AAPL",
          side: "BUY",
          orderType: "LIMIT",
          quantity: "1",
          price: "100",
          timeInForce: "DAY",
          confirmHighValueOrder: false,
        }),
        (error: unknown) => {
          assert.ok(error instanceof TossApiError);
          assert.equal(error.status, 401);
          return true;
        },
      );

      assert.equal(calls.filter((call) => call.url.endsWith("/api/v1/orders")).length, 1);
      assert.equal(await client.verifyToken(), "fresh-order-token");
      assert.equal(calls.filter((call) => call.url.endsWith("/oauth2/token")).length, 2);
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
