import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  stripMarketSuffix,
  type SymbolSearchItem,
  type SymbolSearchMarket,
} from "../src/lib/market/symbol-search.ts";
import { getSeedSymbolMaster } from "../src/lib/market/symbol-master.ts";
import { stockAnalysisStoragePath } from "../src/lib/local-storage.ts";

const cacheDir = stockAnalysisStoragePath("symbol-master");

const getCurrency = (market: SymbolSearchMarket) => market === "US" || market === "CRYPTO" ? "USD" : "KRW";

const shouldExcludeUsSymbol = (symbol: string, securityName: string) => {
  const upperSymbol = symbol.toUpperCase();
  const upperName = securityName.toUpperCase();
  return (
    upperSymbol.includes("$") ||
    upperSymbol.includes("^") ||
    upperName.includes(" WARRANT") ||
    upperName.includes(" RIGHT") ||
    upperName.includes(" UNIT") ||
    upperName.includes(" PREFERRED") ||
    upperName.includes(" TEST ")
  );
};

const parsePipeFile = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("File Creation Time"))
    .map((line) => line.split("|"));

const parseNasdaqListed = (text: string): SymbolSearchItem[] => {
  const rows = parsePipeFile(text);
  const header = rows.shift();
  if (!header?.includes("Symbol")) {
    return [];
  }
  const symbolIndex = header.indexOf("Symbol");
  const nameIndex = header.indexOf("Security Name");
  const etfIndex = header.indexOf("ETF");
  return rows.flatMap((row) => {
    const symbol = row[symbolIndex]?.trim();
    const name = row[nameIndex]?.trim();
    if (!symbol || !name || shouldExcludeUsSymbol(symbol, name)) {
      return [];
    }
    return [{
      symbol,
      displaySymbol: stripMarketSuffix(symbol),
      market: "US",
      exchange: "NASDAQ",
      name,
      currency: "USD",
      assetType: row[etfIndex] === "Y" ? "etf" : "stock",
      source: "nasdaq",
    } satisfies SymbolSearchItem];
  });
};

const parseOtherListed = (text: string): SymbolSearchItem[] => {
  const rows = parsePipeFile(text);
  const header = rows.shift();
  if (!header?.includes("ACT Symbol")) {
    return [];
  }
  const symbolIndex = header.indexOf("ACT Symbol");
  const nameIndex = header.indexOf("Security Name");
  const exchangeIndex = header.indexOf("Exchange");
  const etfIndex = header.indexOf("ETF");
  const exchangeLabel: Record<string, string> = {
    A: "NYSE American",
    N: "NYSE",
    P: "NYSE Arca",
    Z: "BATS",
    V: "IEXG",
  };
  return rows.flatMap((row) => {
    const symbol = row[symbolIndex]?.trim();
    const name = row[nameIndex]?.trim();
    if (!symbol || !name || shouldExcludeUsSymbol(symbol, name)) {
      return [];
    }
    return [{
      symbol,
      displaySymbol: stripMarketSuffix(symbol),
      market: "US",
      exchange: exchangeLabel[row[exchangeIndex]] ?? row[exchangeIndex] ?? "US",
      name,
      currency: "USD",
      assetType: row[etfIndex] === "Y" ? "etf" : "stock",
      source: "nasdaq",
    } satisfies SymbolSearchItem];
  });
};

const fetchText = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.text();
};

const fetchUsMaster = async () => {
  const [nasdaqListed, otherListed] = await Promise.all([
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"),
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"),
  ]);
  return [...parseNasdaqListed(nasdaqListed), ...parseOtherListed(otherListed)];
};

const fetchKrxMaster = async (market: "KOSPI" | "KOSDAQ") => {
  const serviceKey = process.env.SYMBOL_MASTER_KRX_SERVICE_KEY;
  if (!serviceKey) {
    return [];
  }
  const url = new URL("https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("numOfRows", "5000");
  url.searchParams.set("mrktCtg", market === "KOSPI" ? "KOSPI" : "KOSDAQ");
  const json = await fetchText(url.toString()).then((text) => JSON.parse(text) as {
    response?: { body?: { items?: { item?: Array<Record<string, unknown>> } } };
  });
  return (json.response?.body?.items?.item ?? []).flatMap((item) => {
    const code = typeof item.srtnCd === "string" ? item.srtnCd : "";
    const name = typeof item.itmsNm === "string" ? item.itmsNm : "";
    const englishName = typeof item.engItmsNm === "string" ? item.engItmsNm.trim() : "";
    if (!code || !name) {
      return [];
    }
    const suffix = market === "KOSPI" ? "KS" : "KQ";
    return [{
      symbol: `${code}.${suffix}`,
      displaySymbol: code,
      market,
      exchange: market,
      name,
      nameKo: name,
      nameEn: englishName || undefined,
      currency: getCurrency(market),
      assetType: "stock",
      source: "krx",
    } satisfies SymbolSearchItem];
  });
};

const unique = (items: SymbolSearchItem[]) => {
  const byKey = new Map<string, SymbolSearchItem>();
  items.forEach((item) => byKey.set(`${item.market}:${item.symbol}`, item));
  return [...byKey.values()].toSorted((left, right) =>
    left.displaySymbol.localeCompare(right.displaySymbol),
  );
};

const writeMarket = async (market: SymbolSearchMarket, items: SymbolSearchItem[]) => {
  await writeFile(
    join(cacheDir, `${market}.json`),
    `${JSON.stringify(unique(items), null, 2)}\n`,
    "utf8",
  );
};

const main = async () => {
  await mkdir(cacheDir, { recursive: true });
  const seed = getSeedSymbolMaster();
  const [us, kospi, kosdaq] = await Promise.all([
    fetchUsMaster().catch((error) => {
      console.warn(`US refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return seed.filter((item) => item.market === "US");
    }),
    fetchKrxMaster("KOSPI").catch((error) => {
      console.warn(`KOSPI refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
    fetchKrxMaster("KOSDAQ").catch((error) => {
      console.warn(`KOSDAQ refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }),
  ]);

  await Promise.all([
    writeMarket("US", us.length ? us : seed.filter((item) => item.market === "US")),
    writeMarket("KOSPI", kospi.length ? kospi : seed.filter((item) => item.market === "KOSPI")),
    writeMarket("KOSDAQ", kosdaq.length ? kosdaq : seed.filter((item) => item.market === "KOSDAQ")),
    writeMarket("CRYPTO", seed.filter((item) => item.market === "CRYPTO")),
  ]);

  console.log(`Symbol master refreshed in ${cacheDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
