import { loadSymbolMaster } from "./symbol-master.ts";
import { stripMarketSuffix, type SymbolSearchMarket } from "./symbol-search.ts";

export type InstrumentDisplayMarket = "KR" | "US" | "CRYPTO";

export type InstrumentDisplay = {
  primaryName: string;
  code: string;
  market: InstrumentDisplayMarket;
  source: "symbol-master" | "stored-name" | "symbol";
};

type ResolveInstrumentDisplayInput = {
  symbol: string;
  market: InstrumentDisplayMarket;
  storedName?: string | null;
};

type CachedMaster = {
  expiresAt: number;
  items: Awaited<ReturnType<typeof loadSymbolMaster>>["items"];
};

const MASTER_CACHE_TTL_MS = 5 * 60 * 1_000;
let masterCache: CachedMaster | null = null;

const masterMarkets = (market: InstrumentDisplayMarket): SymbolSearchMarket[] => {
  if (market === "KR") return ["KOSPI", "KOSDAQ"];
  return [market];
};

const normalizedCode = (symbol: string) => stripMarketSuffix(symbol.trim().toUpperCase());

const hasKorean = (value: string | null | undefined) => Boolean(value && /[가-힣]/.test(value));

const loadMasterItems = async () => {
  if (masterCache && masterCache.expiresAt > Date.now()) return masterCache.items;
  const result = await loadSymbolMaster();
  masterCache = {
    expiresAt: Date.now() + MASTER_CACHE_TTL_MS,
    items: result.items,
  };
  return result.items;
};

export const resolveInstrumentDisplay = async ({
  symbol,
  market,
  storedName,
}: ResolveInstrumentDisplayInput): Promise<InstrumentDisplay> => {
  const code = normalizedCode(symbol);
  const normalizedStoredName = storedName?.trim() || null;
  try {
    const item = (await loadMasterItems()).find((candidate) =>
      masterMarkets(market).includes(candidate.market) && normalizedCode(candidate.symbol) === code,
    );
    if (item) {
      const primaryName = item.nameKo
        ?? (hasKorean(normalizedStoredName) ? normalizedStoredName : null)
        ?? item.nameEn
        ?? item.name
        ?? normalizedStoredName
        ?? code;
      return {
        primaryName,
        code: item.displaySymbol || code,
        market,
        source: "symbol-master",
      };
    }
  } catch {
    // Name lookup must never prevent quote, strategy, or automation rendering.
  }
  if (normalizedStoredName) {
    return {
      primaryName: normalizedStoredName,
      code,
      market,
      source: "stored-name",
    };
  }
  return { primaryName: code, code, market, source: "symbol" };
};

export const clearInstrumentDisplayCache = () => {
  masterCache = null;
};
