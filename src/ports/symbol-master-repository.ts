import type { SymbolSearchItem, SymbolSearchMarket } from "@/lib/market/symbol-search";

export type SymbolMasterSearchInput = {
  query: string;
  markets?: SymbolSearchMarket[];
  limit?: number;
};

export type SymbolMasterSearchResult = {
  matches: SymbolSearchItem[];
  sources: Partial<Record<SymbolSearchMarket, SymbolSearchItem["source"]>>;
  warnings: string[];
};

export type SymbolMasterRepository = {
  load(markets?: SymbolSearchMarket[]): Promise<SymbolSearchItem[]>;
  search(input: SymbolMasterSearchInput): Promise<SymbolMasterSearchResult>;
};
