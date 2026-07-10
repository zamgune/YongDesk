import assert from "node:assert/strict";
import test from "node:test";

import { getAutomationReadinessSnapshot } from "../src/lib/automation/readiness.ts";

const withoutSupabaseEnv = async (run: () => Promise<void>) => {
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

test("readiness hides operator details for regular users", async () => {
  await withoutSupabaseEnv(async () => {
    const snapshot = await getAutomationReadinessSnapshot(`regular-${crypto.randomUUID()}`);

    assert.equal(snapshot.operatorVisible, false);
    assert.equal(snapshot.storageMode, "hidden");
    assert.equal(snapshot.env, undefined);
    assert.equal(snapshot.items.some((item) => item.owner === "operator"), false);
    assert.ok(snapshot.items.every((item) => !item.summary.includes("SUPABASE_SERVICE_ROLE_KEY")));
  });
});

test("readiness includes operator details only when requested", async () => {
  await withoutSupabaseEnv(async () => {
    const snapshot = await getAutomationReadinessSnapshot(`admin-${crypto.randomUUID()}`, {
      includeOperator: true,
    });

    assert.equal(snapshot.operatorVisible, true);
    assert.notEqual(snapshot.storageMode, "hidden");
    assert.ok(snapshot.env);
    assert.equal(snapshot.items.some((item) => item.owner === "operator"), true);
  });
});
