import path from "node:path";

export const stockBacktestDatasetRoot = (repoPath: string) =>
  path.resolve(repoPath, ".cache", "stock-analysis", "backtests", "datasets");

export const resolvePinnedStockDatasetPath = ({
  repoPath,
  requestedPath,
  datasetId,
}: {
  repoPath: string;
  requestedPath: string;
  datasetId: string;
}) => {
  if (!datasetId.trim() || datasetId.includes("/") || datasetId.includes("\\")) {
    throw new Error("Dataset ID is not a valid cache directory name.");
  }
  const absolute = path.resolve(repoPath, requestedPath);
  const expectedDirectory = path.join(stockBacktestDatasetRoot(repoPath), datasetId);
  if (path.dirname(absolute) !== expectedDirectory) {
    throw new Error(
      `Dataset must be pinned below ${expectedDirectory} and match manifest.datasetId.`,
    );
  }
  return absolute;
};
