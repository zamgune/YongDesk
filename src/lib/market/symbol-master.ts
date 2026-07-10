import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stockAnalysisStoragePath } from "../local-storage.ts";
import { LEADER_UNIVERSES, type LeaderMarket } from "./leader-universes.ts";
import {
  stripMarketSuffix,
  type SymbolMasterSource,
  type SymbolSearchItem,
  type SymbolSearchMarket,
} from "./symbol-search.ts";

type LoadOptions = {
  markets?: SymbolSearchMarket[];
  cacheDir?: string;
};

export type SymbolMasterLoadResult = {
  items: SymbolSearchItem[];
  sources: Record<SymbolSearchMarket, SymbolMasterSource>;
  warnings: string[];
};

const DEFAULT_CACHE_DIR = stockAnalysisStoragePath("symbol-master");

const COMMON_US_SEED: Array<Pick<SymbolSearchItem, "symbol" | "name" | "exchange" | "sector" | "aliases">> = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", sector: "Consumer Electronics", aliases: ["애플"] },
  { symbol: "APLD", name: "Applied Digital Corporation", exchange: "NASDAQ", sector: "Data Center", aliases: ["어플라이드디지털", "어플라이드 디지털"] },
  { symbol: "APP", name: "AppLovin Corporation", exchange: "NASDAQ", sector: "Software", aliases: ["앱러빈", "앱로빈"] },
  { symbol: "APO", name: "Apollo Global Management, Inc.", exchange: "NYSE", sector: "Asset Management", aliases: ["아폴로"] },
  { symbol: "APH", name: "Amphenol Corporation", exchange: "NYSE", sector: "Electronic Components", aliases: ["암페놀"] },
  { symbol: "APG", name: "APi Group Corporation", exchange: "NYSE", sector: "Industrial Services", aliases: ["api 그룹"] },
  { symbol: "APGE", name: "Apogee Therapeutics, Inc.", exchange: "NASDAQ", sector: "Biotechnology", aliases: ["아포지"] },
  { symbol: "APAM", name: "Artisan Partners Asset Management Inc.", exchange: "NYSE", sector: "Asset Management", aliases: ["아티산"] },
  { symbol: "APTV", name: "Aptiv PLC", exchange: "NYSE", sector: "Auto Parts", aliases: ["앱티브"] },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", sector: "Semiconductors", aliases: ["엔비디아", "엔비"] },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", sector: "Auto Manufacturers", aliases: ["테슬라", "테슬"] },
  { symbol: "SNDK", name: "SanDisk Corporation", exchange: "NASDAQ", sector: "Memory", aliases: ["샌디스크", "샌디"] },
];

const US_KOREAN_ALIAS_OVERLAY: Record<string, string[]> = {
  AAPL: ["애플"],
  ADBE: ["어도비"],
  AMD: ["에이엠디", "AMD"],
  AMZN: ["아마존"],
  AP: ["AP"],
  APLD: ["어플라이드디지털", "어플라이드 디지털"],
  APP: ["앱러빈", "앱로빈"],
  ARM: ["암", "ARM"],
  AVGO: ["브로드컴"],
  BKNG: ["부킹", "부킹닷컴"],
  COST: ["코스트코"],
  DELL: ["델"],
  ETN: ["이튼"],
  GEV: ["GE버노바", "지이 버노바"],
  GOOGL: ["구글", "알파벳"],
  IBM: ["아이비엠"],
  INTU: ["인튜이트"],
  META: ["메타", "페이스북"],
  MRVL: ["마벨", "마vell"],
  MSFT: ["마이크로소프트", "마이크로", "마소"],
  MU: ["마이크론"],
  NFLX: ["넷플릭스"],
  NVDA: ["엔비디아", "엔비"],
  QCOM: ["퀄컴"],
  SNDK: ["샌디스크", "샌디"],
  TSLA: ["테슬라", "테슬"],
  VRT: ["버티브"],
};

const KRX_ENGLISH_NAME_OVERLAY: Record<string, string> = {
  "005930": "Samsung Electronics",
  "000660": "SK hynix",
  "373220": "LG Energy Solution",
  "207940": "Samsung Biologics",
  "005380": "Hyundai Motor",
  "000270": "Kia",
  "068270": "Celltrion",
  "105560": "KB Financial Group",
  "055550": "Shinhan Financial Group",
  "035420": "NAVER",
  "035720": "Kakao",
  "012450": "Hanwha Aerospace",
  "009540": "HD Korea Shipbuilding & Offshore Engineering",
  "042660": "Hanwha Ocean",
  "028260": "Samsung C&T",
  "006400": "Samsung SDI",
  "051910": "LG Chem",
  "066570": "LG Electronics",
  "005490": "POSCO Holdings",
  "096770": "SK Innovation",
};

const firstKoreanAlias = (aliases: string[] | undefined) =>
  aliases?.find((alias) => /[가-힣]/.test(alias));

const CRYPTO_SEED: SymbolSearchItem[] = [
  {
    symbol: "BTC",
    displaySymbol: "BTC",
    market: "CRYPTO",
    exchange: "CRYPTO",
    name: "Bitcoin",
    currency: "USD",
    assetType: "crypto",
    source: "seed",
    sector: "Crypto",
    themes: ["크립토", "비트코인"],
    aliases: ["비트코인", "비트"],
  },
  {
    symbol: "ETH",
    displaySymbol: "ETH",
    market: "CRYPTO",
    exchange: "CRYPTO",
    name: "Ethereum",
    currency: "USD",
    assetType: "crypto",
    source: "seed",
    sector: "Crypto",
    themes: ["크립토", "이더리움"],
    aliases: ["이더리움", "이더"],
  },
  {
    symbol: "SOL",
    displaySymbol: "SOL",
    market: "CRYPTO",
    exchange: "CRYPTO",
    name: "Solana",
    currency: "USD",
    assetType: "crypto",
    source: "seed",
    sector: "Crypto",
    themes: ["크립토", "솔라나"],
    aliases: ["솔라나"],
  },
];

const getCurrency = (market: SymbolSearchMarket) => market === "US" || market === "CRYPTO" ? "USD" : "KRW";

const normalizeMasterItem = (
  item: Partial<SymbolSearchItem>,
  fallback: { market: SymbolSearchMarket; source: SymbolMasterSource },
): SymbolSearchItem | null => {
  const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!symbol || !name) {
    return null;
  }
  const market = item.market ?? fallback.market;
  return {
    symbol,
    displaySymbol: item.displaySymbol ?? stripMarketSuffix(symbol),
    market,
    exchange: item.exchange,
    name,
    nameKo: typeof item.nameKo === "string" && item.nameKo.trim() ? item.nameKo.trim() : undefined,
    nameEn: typeof item.nameEn === "string" && item.nameEn.trim() ? item.nameEn.trim() : undefined,
    currency: item.currency ?? getCurrency(market),
    assetType: item.assetType ?? (market === "CRYPTO" ? "crypto" : "stock"),
    source: item.source ?? fallback.source,
    sector: item.sector,
    themes: item.themes,
    aliases: item.aliases,
  };
};

const uniqueByMarketSymbol = (items: SymbolSearchItem[]) => {
  const byKey = new Map<string, SymbolSearchItem>();
  items.forEach((item) => {
    const key = `${item.market}:${item.symbol}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  });
  return [...byKey.values()];
};

const mergeAliases = (...groups: Array<string[] | undefined>) => [
  ...new Set(groups.flatMap((group) => group ?? []).map((alias) => alias.trim()).filter(Boolean)),
];

const applySymbolAliasOverlay = (items: SymbolSearchItem[]) => items.map((item) => {
  if (item.market === "KOSPI" || item.market === "KOSDAQ") {
    return {
      ...item,
      nameKo: item.nameKo ?? item.name,
      nameEn: item.nameEn ?? KRX_ENGLISH_NAME_OVERLAY[stripMarketSuffix(item.symbol)],
    };
  }
  if (item.market === "CRYPTO") {
    return {
      ...item,
      nameKo: item.nameKo ?? firstKoreanAlias(item.aliases),
      nameEn: item.nameEn ?? item.name,
    };
  }
  const aliases = US_KOREAN_ALIAS_OVERLAY[stripMarketSuffix(item.symbol).toUpperCase()];
  const mergedAliases = mergeAliases(item.aliases, aliases);
  return {
    ...item,
    nameKo: item.nameKo ?? firstKoreanAlias(mergedAliases),
    nameEn: item.nameEn ?? item.name,
    aliases: mergedAliases,
  };
});

const fromLeaderUniverse = (market: LeaderMarket): SymbolSearchItem[] =>
  LEADER_UNIVERSES[market].map((item) => ({
    symbol: item.symbol,
    displaySymbol: stripMarketSuffix(item.symbol),
    market,
    exchange: market,
    name: item.name,
    currency: "KRW",
    assetType: "stock",
    source: "fallback",
    sector: item.sector,
    themes: item.themes,
    aliases: [],
  }));

export const getSeedSymbolMaster = (): SymbolSearchItem[] => applySymbolAliasOverlay(uniqueByMarketSymbol([
  ...COMMON_US_SEED.map((item) => ({
    symbol: item.symbol,
    displaySymbol: item.symbol,
    market: "US" as const,
    exchange: item.exchange,
    name: item.name,
    currency: "USD" as const,
    assetType: "stock" as const,
    source: "seed" as const,
    sector: item.sector,
    aliases: item.aliases,
  })),
  ...fromLeaderUniverse("US").map((item) => ({ ...item, source: "fallback" as const, currency: "USD" as const })),
  ...fromLeaderUniverse("KOSPI"),
  ...fromLeaderUniverse("KOSDAQ"),
  ...CRYPTO_SEED,
]));

const cacheFile = (cacheDir: string, market: SymbolSearchMarket) => join(cacheDir, `${market}.json`);

const readCachedMarket = async (
  market: SymbolSearchMarket,
  cacheDir: string,
) => {
  const raw = await readFile(cacheFile(cacheDir, market), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Cache payload must be an array.");
  }
  return parsed
    .map((item) => normalizeMasterItem(item as Partial<SymbolSearchItem>, { market, source: "cache" }))
    .filter((item): item is SymbolSearchItem => item !== null);
};

export const loadSymbolMaster = async (
  options: LoadOptions = {},
): Promise<SymbolMasterLoadResult> => {
  const markets = options.markets ?? ["US", "KOSPI", "KOSDAQ", "CRYPTO"];
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const seed = getSeedSymbolMaster();
  const warnings: string[] = [];
  const sources = {} as Record<SymbolSearchMarket, SymbolMasterSource>;
  const items = await Promise.all(markets.map(async (market) => {
    try {
      const cached = await readCachedMarket(market, cacheDir);
      if (cached.length) {
        sources[market] = "cache";
        return cached;
      }
      warnings.push(`${market}: empty cache`);
    } catch (error) {
      warnings.push(`${market}: ${error instanceof Error ? error.message : String(error)}`);
    }
    sources[market] = market === "US" || market === "CRYPTO" ? "seed" : "fallback";
    return seed.filter((item) => item.market === market);
  }));

  return {
    items: applySymbolAliasOverlay(uniqueByMarketSymbol(items.flat())),
    sources,
    warnings,
  };
};
