import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildCryptoQueryHashString,
  buildCryptoQueryString,
  cancelCryptoOrder,
  createCryptoLimitOrder,
  createCryptoMarketSellOrder,
  createCryptoExchangeJwt,
  cryptoExchangeContract,
  getCryptoAccounts,
  getCryptoOrderConstraints,
  getCryptoOrderChance,
  getCryptoTicker,
  getUpbitCandles,
  getUpbitOrderbookInstrument,
  previewCryptoLimitOrder,
} from "../src/lib/crypto-exchange/client.ts";

const credentials = { accessKey: "access-key", secretKey: "secret-key" };

const decodeJwtPart = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

test("Upbit JWT uses HS512 and query hash without timestamp", () => {
  const query = buildCryptoQueryString({ market: "KRW-BTC" });
  const token = createCryptoExchangeJwt({
    exchange: "upbit",
    credentials,
    queryString: query,
    nonce: "nonce-1",
    timestamp: 123,
  });
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const header = decodeJwtPart(headerPart);
  const payload = decodeJwtPart(payloadPart);
  assert.equal(header.alg, "HS512");
  assert.equal(payload.access_key, "access-key");
  assert.equal(payload.nonce, "nonce-1");
  assert.equal(payload.timestamp, undefined);
  assert.equal(typeof payload.query_hash, "string");
  assert.equal(String(payload.query_hash).length, 128);
  assert.ok(signaturePart.length > 80);
});

test("Bithumb JWT uses HS256 and millisecond timestamp", () => {
  const token = createCryptoExchangeJwt({
    exchange: "bithumb",
    credentials,
    nonce: "nonce-2",
    timestamp: 1_712_230_310_689,
  });
  const [headerPart, payloadPart] = token.split(".");
  assert.equal(decodeJwtPart(headerPart).alg, "HS256");
  assert.equal(decodeJwtPart(payloadPart).timestamp, 1_712_230_310_689);
});

test("read-only account and order chance requests use official paths", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(calls.length === 1 ? [{ currency: "KRW", balance: "100000", locked: "0" }] : { market: { id: "KRW-BTC" } });
  }) as typeof fetch;
  const accounts = await getCryptoAccounts("upbit", credentials, fetchImpl);
  const chance = await getCryptoOrderChance("bithumb", credentials, "KRW-BTC", fetchImpl);
  assert.equal(accounts[0]?.currency, "KRW");
  assert.deepEqual(chance, { market: { id: "KRW-BTC" } });
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/accounts");
  assert.equal(calls[1]?.url, "https://api.bithumb.com/v1/orders/chance?market=KRW-BTC");
  assert.match(String(new Headers(calls[0]?.init?.headers).get("Authorization")), /^Bearer /);
});

test("public ticker and order constraints expose fresh precheck inputs", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json([{
      market: "KRW-BTC",
      trade_price: 101_000_000,
      timestamp: 1_720_000_000_123,
      trade_timestamp: 1_720_000_000_100,
    }]);
  }) as typeof fetch;
  const ticker = await getCryptoTicker("bithumb", "KRW-BTC", fetchImpl);
  assert.equal(calls[0], "https://api.bithumb.com/v1/ticker?markets=KRW-BTC");
  assert.equal(ticker.tradePrice, 101_000_000);
  assert.equal(ticker.tradeTimestamp, 1_720_000_000_100);

  const constraints = getCryptoOrderConstraints({
    bid_fee: "0.0005",
    market: {
      max_total: "1000000000",
      bid: { min_total: "5000", price_unit: "1000" },
    },
  }, "bid");
  assert.deepEqual(constraints, {
    minTotal: 5000,
    maxTotal: 1_000_000_000,
    priceUnit: 1000,
    feeRate: 0.0005,
  });
});

test("Upbit orderbook instrument exposes the official tick size", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json([{
      market: "KRW-BTC",
      quote_currency: "KRW",
      tick_size: "1000",
      supported_levels: ["0", "10000", "100000"],
    }]);
  }) as typeof fetch;
  const instrument = await getUpbitOrderbookInstrument("KRW-BTC", fetchImpl);
  assert.equal(calls[0], "https://api.upbit.com/v1/orderbook/instruments?markets=KRW-BTC");
  assert.deepEqual(instrument, {
    market: "KRW-BTC",
    quoteCurrency: "KRW",
    tickSize: 1000,
    supportedLevels: [0, 10000, 100000],
  });
});

test("Upbit candle client maps 60m and 240m REST candles in chronological order", async () => {
  const calls: string[] = [];
  const fixture = [
    {
      market: "KRW-BTC",
      candle_date_time_utc: "2026-07-10T02:00:00",
      opening_price: 151_000_000,
      high_price: 152_000_000,
      low_price: 150_500_000,
      trade_price: 151_500_000,
      candle_acc_trade_volume: 10,
      candle_acc_trade_price: 1_515_000_000,
    },
    {
      market: "KRW-BTC",
      candle_date_time_utc: "2026-07-10T01:00:00",
      opening_price: 150_000_000,
      high_price: 151_500_000,
      low_price: 149_500_000,
      trade_price: 151_000_000,
      candle_acc_trade_volume: 8,
      candle_acc_trade_price: 1_204_000_000,
    },
  ];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json(fixture);
  }) as typeof fetch;

  const hourly = await getUpbitCandles("krw-btc", {
    interval: "1h",
    count: 500,
    to: "2026-07-10T03:00:00Z",
    nowMs: Date.parse("2026-07-10T03:30:00Z"),
  }, fetchImpl);
  const fourHourly = await getUpbitCandles("KRW-BTC", {
    interval: "4h",
    count: 2,
    nowMs: Date.parse("2026-07-10T03:30:00Z"),
  }, fetchImpl);

  const firstUrl = new URL(calls[0] ?? "");
  assert.equal(firstUrl.pathname, "/v1/candles/minutes/60");
  assert.equal(firstUrl.searchParams.get("market"), "KRW-BTC");
  assert.equal(firstUrl.searchParams.get("count"), "200");
  assert.equal(firstUrl.searchParams.get("to"), "2026-07-10T03:00:00Z");
  assert.ok(hourly[0]!.time < hourly[1]!.time);
  assert.equal(hourly[0]?.close, 151_000_000);
  assert.equal(hourly.every((candle) => candle.isClosed), true);

  assert.equal(new URL(calls[1] ?? "").pathname, "/v1/candles/minutes/240");
  assert.equal(fourHourly.every((candle) => candle.isClosed), false);
});

test("order preview never submits and follows exchange contract", () => {
  const preview = previewCryptoLimitOrder({
    exchange: "bithumb",
    market: "KRW-BTC",
    side: "bid",
    volume: "0.001",
    price: "100000000",
    identifier: "test-order-1",
  });
  assert.equal(preview.url, "https://api.bithumb.com/v2/orders");
  assert.equal(preview.orderSubmissionAttempted, false);
  assert.equal(preview.exchange, "bithumb");
  if (preview.exchange !== "bithumb") {
    assert.fail("Bithumb preview must use the Bithumb body contract");
  }
  assert.equal(preview.body.order_type, "limit");
  assert.equal(preview.body.client_order_id, "test-order-1");
  assert.equal("ord_type" in preview.body, false);
  assert.equal("identifier" in preview.body, false);
  assert.equal(cryptoExchangeContract("upbit").createOrderPath, "/v1/orders");
});

test("Upbit limit order signs the JSON body and uses official field names", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ uuid: "upbit-order-1", identifier: "client-1" }, { status: 201 });
  }) as typeof fetch;
  const result = await createCryptoLimitOrder("upbit", credentials, {
    market: "KRW-BTC",
    side: "bid",
    volume: "0.001",
    price: "100000000",
    clientOrderId: "client-1",
  }, fetchImpl);
  const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, string>;
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/orders");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(body.ord_type, "limit");
  assert.equal(body.identifier, "client-1");
  assert.equal(body.order_type, undefined);
  assert.match(String(new Headers(calls[0]?.init?.headers).get("Authorization")), /^Bearer /);
  assert.equal(result.orderId, "upbit-order-1");
});

test("Bithumb orders use v2 order_type and client_order_id fields", async () => {
  const bodies: Array<Record<string, string>> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, string>);
    return Response.json({ order_id: `bithumb-order-${bodies.length}`, client_order_id: "client-2" }, { status: 201 });
  }) as typeof fetch;
  await createCryptoLimitOrder("bithumb", credentials, {
    market: "KRW-ETH",
    side: "ask",
    volume: "0.01",
    price: "5000000",
    clientOrderId: "client-2",
  }, fetchImpl);
  await createCryptoMarketSellOrder("bithumb", credentials, {
    market: "KRW-ETH",
    side: "ask",
    volume: "0.01",
    clientOrderId: "client-2",
  }, fetchImpl);
  assert.equal(bodies[0]?.order_type, "limit");
  assert.equal(bodies[0]?.client_order_id, "client-2");
  assert.equal(bodies[0]?.ord_type, undefined);
  assert.equal(bodies[1]?.order_type, "market");
  assert.equal(bodies[1]?.price, undefined);
});

test("cancel requests use exchange-specific authenticated endpoints", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const isUpbit = String(input).includes("api.upbit.com");
    return Response.json(isUpbit ? { uuid: "order-1" } : { order_id: "order-2" });
  }) as typeof fetch;
  await cancelCryptoOrder("upbit", credentials, "order-1", fetchImpl);
  await cancelCryptoOrder("bithumb", credentials, "order-2", fetchImpl);
  assert.equal(calls[0]?.url, "https://api.upbit.com/v1/order?uuid=order-1");
  assert.equal(calls[0]?.init?.method, "DELETE");
  assert.equal(calls[1]?.url, "https://api.bithumb.com/v2/order?order_id=order-2");
  assert.equal(calls[1]?.init?.method, "DELETE");

  for (const call of calls) {
    const queryString = new URL(call.url).search.slice(1);
    const authorization = new Headers(call.init?.headers).get("Authorization") ?? "";
    const payloadPart = authorization.replace(/^Bearer\s+/, "").split(".")[1];
    assert.ok(payloadPart);
    const payload = decodeJwtPart(payloadPart);
    const expectedQueryHash = createHash("sha512").update(queryString, "utf8").digest("hex");
    assert.equal(payload.query_hash_alg, "SHA512");
    assert.equal(payload.query_hash, expectedQueryHash);
  }
});

test("Upbit hashes the raw query while encoding reserved characters on the wire", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ uuid: "order/reserved ?value=1" });
  }) as typeof fetch;
  const brokerOrderId = "order/reserved ?value=1";
  await cancelCryptoOrder("upbit", credentials, brokerOrderId, fetchImpl);

  const call = calls[0];
  assert.ok(call);
  const wireQuery = new URL(call.url).search.slice(1);
  assert.equal(wireQuery, "uuid=order%2Freserved%20%3Fvalue%3D1");
  const authorization = new Headers(call.init?.headers).get("Authorization") ?? "";
  const payloadPart = authorization.replace(/^Bearer\s+/, "").split(".")[1];
  assert.ok(payloadPart);
  const payload = decodeJwtPart(payloadPart);
  const rawQuery = buildCryptoQueryHashString({ uuid: brokerOrderId });
  assert.equal(rawQuery, "uuid=order/reserved ?value=1");
  assert.equal(
    payload.query_hash,
    createHash("sha512").update(rawQuery, "utf8").digest("hex"),
  );
  assert.notEqual(
    payload.query_hash,
    createHash("sha512").update(wireQuery, "utf8").digest("hex"),
  );
});
