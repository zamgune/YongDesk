import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getSeedSymbolMaster, loadSymbolMaster } from "../src/lib/market/symbol-master.ts";
import { searchSymbolItems } from "../src/lib/market/symbol-search.ts";

test("searchSymbolItems finds APLD and AAPL from AP query", () => {
  const matches = searchSymbolItems(getSeedSymbolMaster(), "AP", { markets: ["US"], limit: 12 });
  const symbols = matches.map((match) => match.item.symbol);

  assert.equal(symbols.includes("APLD"), true);
  assert.equal(symbols.includes("AAPL"), true);
  assert.equal(symbols.includes("APP"), true);
});

test("searchSymbolItems ranks exact ticker first", () => {
  const matches = searchSymbolItems(getSeedSymbolMaster(), "AAPL", { markets: ["US"], limit: 12 });

  assert.equal(matches[0]?.item.symbol, "AAPL");
});

test("Korean leaders expose bilingual display names", () => {
  const samsung = getSeedSymbolMaster().find((item) => item.symbol === "005930.KS");
  assert.equal(samsung?.nameKo, "삼성전자");
  assert.equal(samsung?.nameEn, "Samsung Electronics");
  assert.equal(searchSymbolItems(getSeedSymbolMaster(), "Samsung Electronics")[0]?.item.symbol, "005930.KS");
});

test("searchSymbolItems finds SanDisk by Korean query", () => {
  const matches = searchSymbolItems(getSeedSymbolMaster(), "샌디", { markets: ["US"], limit: 12 });

  assert.equal(matches[0]?.item.symbol, "SNDK");
});

test("searchSymbolItems finds major US stocks by Korean aliases", () => {
  const cases = [
    ["마이크로소프트", "MSFT"],
    ["마소", "MSFT"],
    ["구글", "GOOGL"],
    ["아마존", "AMZN"],
    ["브로드컴", "AVGO"],
    ["넷플릭스", "NFLX"],
  ] as const;

  cases.forEach(([query, symbol]) => {
    const matches = searchSymbolItems(getSeedSymbolMaster(), query, { markets: ["US"], limit: 12 });

    assert.equal(matches[0]?.item.symbol, symbol, `${query} should find ${symbol}`);
  });
});

test("searchSymbolItems finds Korean stocks by partial name", () => {
  const matches = searchSymbolItems(getSeedSymbolMaster(), "삼성", { markets: ["KOSPI", "KOSDAQ"], limit: 12 });
  const names = matches.map((match) => match.item.name);

  assert.equal(names.includes("삼성전자"), true);
  assert.equal(names.includes("삼성전기"), true);
});

test("searchSymbolItems finds Samsung Electronics by code", () => {
  const matches = searchSymbolItems(getSeedSymbolMaster(), "005930", { markets: ["KOSPI"], limit: 12 });

  assert.equal(matches[0]?.item.symbol, "005930.KS");
});

test("loadSymbolMaster falls back without KRX cache or key", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "symbol-master-empty-"));
  const result = await loadSymbolMaster({ markets: ["KOSPI"], cacheDir: tempDir });
  const symbols = result.items.map((item) => item.symbol);

  assert.equal(symbols.includes("005930.KS"), true);
  assert.equal(result.sources.KOSPI, "fallback");
});

test("loadSymbolMaster uses seed fallback when cache is corrupt", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "symbol-master-corrupt-"));
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, "US.json"), "{not json", "utf8");
  const result = await loadSymbolMaster({ markets: ["US"], cacheDir: tempDir });
  const matches = searchSymbolItems(result.items, "AP", { markets: ["US"], limit: 12 });

  assert.equal(matches.some((match) => match.item.symbol === "APLD"), true);
  assert.equal(result.sources.US, "seed");
});

test("loadSymbolMaster merges Korean aliases into cached US items", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "symbol-master-cache-"));
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, "US.json"), JSON.stringify([
    {
      symbol: "MSFT",
      displaySymbol: "MSFT",
      market: "US",
      exchange: "NASDAQ",
      name: "Microsoft Corporation",
      currency: "USD",
      assetType: "stock",
      source: "cache",
    },
  ]), "utf8");

  const result = await loadSymbolMaster({ markets: ["US"], cacheDir: tempDir });
  const matches = searchSymbolItems(result.items, "마소", { markets: ["US"], limit: 12 });

  assert.equal(matches[0]?.item.symbol, "MSFT");
  assert.equal(result.sources.US, "cache");
});
