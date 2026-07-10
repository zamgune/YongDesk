import type { LeaderMarket } from "./leader-universes.ts";

export type SymbolSearchMarket = LeaderMarket | "CRYPTO";
export type SymbolAssetType = "stock" | "etf" | "crypto";
export type SymbolMasterSource = "cache" | "seed" | "fallback" | "nasdaq" | "krx";

export type SymbolSearchItem = {
  symbol: string;
  displaySymbol: string;
  market: SymbolSearchMarket;
  exchange?: string;
  name: string;
  nameKo?: string;
  nameEn?: string;
  currency: "USD" | "KRW";
  assetType: SymbolAssetType;
  source: SymbolMasterSource;
  sector?: string;
  themes?: string[];
  aliases?: string[];
};

export type SymbolSearchMatch = {
  item: SymbolSearchItem;
  score: number;
  matchedBy: string;
};

export type SymbolSearchResponseItem = SymbolSearchItem & {
  score: number;
  matchedBy: string;
};

export type SymbolSearchOptions = {
  markets?: SymbolSearchMarket[];
  limit?: number;
};

const DEFAULT_LIMIT = 12;

export const stripMarketSuffix = (symbol: string) =>
  symbol.replace(/\.(KS|KQ)$/i, "").replace(/-USD$/i, "");

const normalizeSearchText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, "");

const buildSearchFields = (item: SymbolSearchItem) => [
  { label: "symbol", value: item.symbol, baseScore: 220 },
  { label: "displaySymbol", value: item.displaySymbol, baseScore: 220 },
  { label: "name", value: item.name, baseScore: 150 },
  { label: "nameKo", value: item.nameKo ?? "", baseScore: 165 },
  { label: "nameEn", value: item.nameEn ?? "", baseScore: 155 },
  { label: "exchange", value: item.exchange ?? "", baseScore: 40 },
  { label: "sector", value: item.sector ?? "", baseScore: 35 },
  ...(item.themes ?? []).map((value) => ({ label: "theme", value, baseScore: 30 })),
  ...(item.aliases ?? []).map((value) => ({ label: "alias", value, baseScore: 80 })),
];

const isSubsequence = (query: string, value: string) => {
  let queryIndex = 0;
  for (const character of value) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
    }
    if (queryIndex === query.length) {
      return true;
    }
  }
  return false;
};

const scoreField = (field: ReturnType<typeof buildSearchFields>[number], query: string) => {
  const value = normalizeSearchText(field.value);
  if (!value || !query) {
    return 0;
  }
  if (value === query) {
    return field.baseScore + 80;
  }
  if (value.startsWith(query)) {
    return field.baseScore + 45;
  }
  if (value.includes(query)) {
    return field.baseScore;
  }
  if (
    query.length >= 2 &&
    (field.label === "symbol" || field.label === "displaySymbol") &&
    isSubsequence(query, value)
  ) {
    return field.baseScore - 10;
  }
  return 0;
};

const getAssetWeight = (item: SymbolSearchItem) => {
  if (item.assetType === "stock") {
    return 12;
  }
  if (item.assetType === "crypto") {
    return 8;
  }
  return 0;
};

export const searchSymbolItems = (
  items: SymbolSearchItem[],
  query: string,
  options: SymbolSearchOptions = {},
): SymbolSearchMatch[] => {
  const normalizedQuery = normalizeSearchText(query);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const marketSet = options.markets ? new Set(options.markets) : null;

  if (!normalizedQuery) {
    return [];
  }

  return items
    .filter((item) => !marketSet || marketSet.has(item.market))
    .map((item, index) => {
      const best = buildSearchFields(item)
        .map((field) => ({
          field,
          score: scoreField(field, normalizedQuery),
        }))
        .filter((match) => match.score > 0)
        .toSorted((left, right) => right.score - left.score)[0];
      return best
        ? {
          item,
          score: best.score + getAssetWeight(item) - index / 100_000,
          matchedBy: best.field.value,
        }
        : null;
    })
    .filter((match): match is SymbolSearchMatch => match !== null)
    .toSorted((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.displaySymbol.localeCompare(right.item.displaySymbol);
    })
    .slice(0, limit);
};
