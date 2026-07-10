import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const previousStorageRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT;
const storageRoot = await mkdtemp(join(tmpdir(), "stock-analysis-news-poll-"));
process.env.STOCK_ANALYSIS_STORAGE_ROOT = storageRoot;

const {
  DEFAULT_OFFICIAL_NEWS_SOURCES,
  pollOfficialNews,
} = await import("../src/lib/local-engine/news.ts");

after(async () => {
  await rm(storageRoot, { recursive: true, force: true });
  if (previousStorageRoot === undefined) {
    delete process.env.STOCK_ANALYSIS_STORAGE_ROOT;
  } else {
    process.env.STOCK_ANALYSIS_STORAGE_ROOT = previousStorageRoot;
  }
});

const rssFor = (sourceId: string) => `
  <rss><channel><item>
    <title>${sourceId} policy update</title>
    <link>https://example.com/${sourceId}</link>
    <pubDate>Tue, 07 Jul 2026 19:00:00 GMT</pubDate>
    <description>Official policy update.</description>
  </item></channel></rss>
`;

test("official news polling shares one in-flight fetch and store write", async () => {
  const originalFetch = globalThis.fetch;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    await gate;
    const source = DEFAULT_OFFICIAL_NEWS_SOURCES.find((candidate) => candidate.url === url);
    assert.ok(source);
    return new Response(rssFor(source.id), { status: 200 });
  }) as typeof fetch;

  try {
    const first = pollOfficialNews();
    const second = pollOfficialNews();
    assert.strictEqual(second, first);
    releaseGate();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.strictEqual(secondResult, firstResult);
    assert.equal(calls.length, DEFAULT_OFFICIAL_NEWS_SOURCES.length);
    assert.equal(firstResult.events.length, DEFAULT_OFFICIAL_NEWS_SOURCES.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("official news polling backs off only failed sources exponentially and resets after recovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalBaseMs = process.env.STOCK_ANALYSIS_NEWS_BACKOFF_BASE_MS;
  const originalMaxMs = process.env.STOCK_ANALYSIS_NEWS_BACKOFF_MAX_MS;
  process.env.STOCK_ANALYSIS_NEWS_BACKOFF_BASE_MS = "1000";
  process.env.STOCK_ANALYSIS_NEWS_BACKOFF_MAX_MS = "8000";
  let now = 1_000_000;
  Date.now = () => now;

  const failedSource = DEFAULT_OFFICIAL_NEWS_SOURCES[0];
  const callCounts = new Map<string, number>();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const callCount = (callCounts.get(url) ?? 0) + 1;
    callCounts.set(url, callCount);
    if (url === failedSource.url && callCount <= 2) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    const source = DEFAULT_OFFICIAL_NEWS_SOURCES.find((candidate) => candidate.url === url);
    assert.ok(source);
    return new Response(rssFor(source.id), { status: 200 });
  }) as typeof fetch;

  try {
    const first = await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 1);
    assert.match(first.errors.find((error) => error.sourceId === failedSource.id)?.message ?? "", /HTTP 503/);

    const immediateRetry = await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 1);
    assert.match(
      immediateRetry.errors.find((error) => error.sourceId === failedSource.id)?.message ?? "",
      /backoff until/,
    );
    for (const source of DEFAULT_OFFICIAL_NEWS_SOURCES.slice(1)) {
      assert.equal(callCounts.get(source.url), 2);
    }

    now += 1_000;
    await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 2);

    now += 1_000;
    await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 2);

    now += 1_000;
    const recovered = await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 3);
    assert.equal(recovered.errors.some((error) => error.sourceId === failedSource.id), false);

    await pollOfficialNews();
    assert.equal(callCounts.get(failedSource.url), 4);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalBaseMs === undefined) {
      delete process.env.STOCK_ANALYSIS_NEWS_BACKOFF_BASE_MS;
    } else {
      process.env.STOCK_ANALYSIS_NEWS_BACKOFF_BASE_MS = originalBaseMs;
    }
    if (originalMaxMs === undefined) {
      delete process.env.STOCK_ANALYSIS_NEWS_BACKOFF_MAX_MS;
    } else {
      process.env.STOCK_ANALYSIS_NEWS_BACKOFF_MAX_MS = originalMaxMs;
    }
  }
});
