import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderPreviewPayloadHash,
  createOrderPreviewClientOrderId,
  markOrderPreviewSubmitted,
  recordOrderPreview,
  verifyOrderPreview,
  type OrderPreviewInput,
} from "../src/lib/automation/order-tracker.ts";

const withLocalPreviewStore = async (run: () => Promise<void>) => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await run();
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.key);
    restore("SUPABASE_SECRET_KEY", previous.secret);
    restore("SUPABASE_SERVICE_ROLE_KEY", previous.serviceRole);
  }
};

const previewInput = (): OrderPreviewInput => ({
  accountSeq: 7,
  symbol: "005930",
  side: "buy",
  orderType: "limit",
  quantity: 2,
  price: 71500,
  currency: "KRW",
});

test("order preview hash is stable after symbol normalization", () => {
  const input = previewInput();
  assert.equal(
    buildOrderPreviewPayloadHash(input),
    buildOrderPreviewPayloadHash({ ...input, symbol: "005930 " }),
  );
  assert.equal(createOrderPreviewClientOrderId("12345678-1234-1234-1234-123456789abc").length, 32);
});

test("order preview rejects mismatched or reused submit payloads", async () => {
  await withLocalPreviewStore(async () => {
    const userId = `preview-test-${crypto.randomUUID()}`;
    const input = previewInput();
    const preview = await recordOrderPreview({
      userId,
      input,
      available: 200000,
      ok: true,
      blockers: [],
      warnings: [],
      liveTradingEffective: true,
      liveTradingBlockedReason: null,
    });

    const accepted = await verifyOrderPreview({ userId, previewId: preview.id, input });
    assert.equal(accepted.ok, true);

    const mismatched = await verifyOrderPreview({
      userId,
      previewId: preview.id,
      input: { ...input, price: 71600 },
    });
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) {
      assert.equal(mismatched.status, 409);
      assert.match(mismatched.reason, /미리보기와 다릅니다/);
    }

    await markOrderPreviewSubmitted(userId, preview.id, "2026-06-27T00:00:00.000Z");
    const reused = await verifyOrderPreview({ userId, previewId: preview.id, input });
    assert.equal(reused.ok, false);
    if (!reused.ok) {
      assert.equal(reused.status, 409);
      assert.match(reused.reason, /이미 제출/);
    }
  });
});
