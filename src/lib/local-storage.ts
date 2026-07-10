import { join } from "node:path";

export const getStockAnalysisStorageRoot = (): string => {
  const explicitRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT?.trim();
  if (explicitRoot) {
    return explicitRoot;
  }
  return join(/* turbopackIgnore: true */ process.cwd(), ".cache", "stock-analysis");
};

export const stockAnalysisStoragePath = (...segments: string[]): string => {
  const explicitRoot = process.env.STOCK_ANALYSIS_STORAGE_ROOT?.trim();
  if (explicitRoot) {
    return join(/* turbopackIgnore: true */ explicitRoot, ...segments);
  }
  return join(/* turbopackIgnore: true */ process.cwd(), ".cache", "stock-analysis", ...segments);
};
