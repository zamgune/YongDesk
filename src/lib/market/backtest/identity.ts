import { createHash } from "node:crypto";

import type {
  StockBacktestBar,
  StockBacktestConfig,
  StockBacktestConfigSeed,
  StockBacktestDataset,
  StockDatasetContentCheck,
  StockDatasetContentValidation,
  StockDatasetManifest,
  StockDatasetManifestSeed,
  StockDatasetSymbolEvidence,
  UnixSeconds,
} from "./types.ts";
import { assertUnixSeconds, isUnixSeconds } from "./time.ts";

const normalizeForJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForJson(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Identity payload contains a non-finite number.");
  }
  return value;
};

export const stableSerialize = (value: unknown) =>
  JSON.stringify(normalizeForJson(value));

export const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "dataset";

const sameUniqueValues = (declared: string[], actual: string[]) => {
  const declaredSet = new Set(declared);
  const actualSet = new Set(actual);
  return (
    declared.length > 0 &&
    declaredSet.size === declared.length &&
    actualSet.size === actual.length &&
    declaredSet.size === actualSet.size &&
    [...declaredSet].every((value) => actualSet.has(value))
  );
};

const isIsoInstant = (value: string) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  Number.isFinite(Date.parse(value));

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

const maximumBarDuration: Record<StockBacktestBar["timeframe"], number> = {
  "5m": 5 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
};

const evidenceKey = ({ symbol, market }: Pick<StockDatasetSymbolEvidence, "symbol" | "market">) =>
  `${market}:${symbol}`;

const intervalEvidenceIsValid = (evidence: StockDatasetSymbolEvidence) => {
  let previousTo: UnixSeconds | null = null;
  for (const [index, interval] of evidence.universeMemberships.entries()) {
    if (
      interval === null ||
      typeof interval !== "object" ||
      !isUnixSeconds(interval.from) ||
      (interval.to !== null &&
        (!isUnixSeconds(interval.to) || interval.to < interval.from)) ||
      (index > 0 && (previousTo === null || interval.from <= previousTo))
    ) {
      return false;
    }
    previousTo = interval.to;
  }
  return true;
};

export const validateDatasetContents = ({
  manifest,
  bars,
}: {
  manifest: StockDatasetManifestSeed;
  bars: StockBacktestBar[];
}): StockDatasetContentValidation => {
  let timestampsValid = true;
  let actualStartTime: UnixSeconds | null = null;
  let actualEndTime: UnixSeconds | null = null;
  const actualSymbolSet = new Set<string>();
  const actualMarketSet = new Set<string>();
  const expectedEvidenceKeySet = new Set<string>();
  for (const bar of bars) {
    if (!isUnixSeconds(bar.openTime) || !isUnixSeconds(bar.closeTime)) {
      timestampsValid = false;
    } else {
      actualStartTime =
        actualStartTime === null
          ? bar.openTime
          : Math.min(actualStartTime, bar.openTime);
      actualEndTime =
        actualEndTime === null
          ? bar.closeTime
          : Math.max(actualEndTime, bar.closeTime);
    }
    actualSymbolSet.add(bar.symbol);
    actualMarketSet.add(bar.market);
    const key = `${bar.market}:${bar.symbol}`;
    expectedEvidenceKeySet.add(key);
  }
  if (!timestampsValid) {
    actualStartTime = null;
    actualEndTime = null;
  }
  const declaredSymbols = manifest.symbols;
  const actualSymbols = [...actualSymbolSet];
  const declaredMarkets = manifest.markets;
  const actualMarkets = [...actualMarketSet];

  let chronological = timestampsValid;
  const previousBySymbol = new Map<string, StockBacktestBar>();
  for (const [index, current] of bars.entries()) {
    if (index > 0 && current.openTime < bars[index - 1].openTime) {
      chronological = false;
    }
    const previous = previousBySymbol.get(current.symbol);
    if (
      previous &&
      (current.openTime <= previous.openTime || current.openTime < previous.closeTime)
    ) {
      chronological = false;
    }
    previousBySymbol.set(current.symbol, current);
  }

  const barKeys = new Set<string>();
  let duplicateBars = false;
  for (const bar of bars) {
    const key = `${bar.symbol}|${bar.market}|${bar.timeframe}|${bar.openTime}`;
    if (barKeys.has(key)) {
      duplicateBars = true;
    }
    barKeys.add(key);
  }
  const priceShape = bars.every(
    (bar) =>
      [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) &&
      bar.open > 0 &&
      bar.high > 0 &&
      bar.low > 0 &&
      bar.close > 0 &&
      bar.volume >= 0 &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= bar.high,
  );
  const lastIndexBySymbolSession = new Map<string, number>();
  for (const [index, bar] of bars.entries()) {
    lastIndexBySymbolSession.set(`${bar.symbol}|${bar.sessionDate}`, index);
  }
  const previousSessionBarBySymbol = new Map<string, StockBacktestBar>();
  let sessionShape = true;
  for (const [index, bar] of bars.entries()) {
    if (
      !isUnixSeconds(bar.openTime) ||
      !isUnixSeconds(bar.closeTime) ||
      bar.closeTime <= bar.openTime ||
      bar.closeTime - bar.openTime > maximumBarDuration[bar.timeframe] ||
      !isCalendarDate(bar.sessionDate)
    ) {
      sessionShape = false;
    }
    const previous = previousSessionBarBySymbol.get(bar.symbol);
    if (previous && previous.sessionDate > bar.sessionDate) {
      sessionShape = false;
    }
    if (
      bar.isSessionEnd &&
      lastIndexBySymbolSession.get(`${bar.symbol}|${bar.sessionDate}`) !== index
    ) {
      sessionShape = false;
    }
    previousSessionBarBySymbol.set(bar.symbol, bar);
  }

  const evidence = Array.isArray(manifest.symbolEvidence)
    ? manifest.symbolEvidence
    : [];
  const evidenceShape = evidence.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      typeof item.symbol === "string" &&
      item.symbol.length > 0 &&
      (item.market === "KR" || item.market === "US") &&
      isUnixSeconds(item.validFrom) &&
      (item.validTo === null ||
        (isUnixSeconds(item.validTo) && item.validTo >= item.validFrom)) &&
      Array.isArray(item.universeMemberships) &&
      item.delisting !== null &&
      typeof item.delisting === "object" &&
      (item.delisting.status === "active" || item.delisting.status === "delisted") &&
      typeof item.source === "string" &&
      item.source.trim().length > 0 &&
      typeof item.recordedAt === "string" &&
      isIsoInstant(item.recordedAt),
  );
  const evidenceKeys = evidenceShape ? evidence.map(evidenceKey) : [];
  const expectedEvidenceKeys = [...expectedEvidenceKeySet];
  const symbolEvidence =
    evidenceShape && sameUniqueValues(evidenceKeys, expectedEvidenceKeys);
  const evidenceByKey = new Map(
    evidenceShape ? evidence.map((item) => [evidenceKey(item), item]) : [],
  );
  const symbolValidity =
    symbolEvidence &&
    bars.every((bar) => {
      const item = evidenceByKey.get(`${bar.market}:${bar.symbol}`);
      return (
        item !== undefined &&
        bar.openTime >= item.validFrom &&
        (item.validTo === null || bar.closeTime <= item.validTo)
      );
    });
  const pointInTimeEvidence =
    !manifest.pointInTimeUniverse ||
    (symbolEvidence &&
      evidence.every(
        (item) =>
          item.universeMemberships.length > 0 &&
          intervalEvidenceIsValid(item),
      ) &&
      bars.every((bar) => {
        const item = evidenceByKey.get(`${bar.market}:${bar.symbol}`);
        return item?.universeMemberships.some(
          (interval) =>
            interval.from <= bar.openTime &&
            (interval.to === null || interval.to >= bar.closeTime),
        );
      }));
  const delistingEvidence =
    !manifest.delistingsIncluded ||
    (symbolEvidence &&
      evidence.every((item) =>
        item.delisting.status === "active"
          ? item.delisting.effectiveTime === null && item.validTo === null
          : item.delisting.effectiveTime !== null &&
            isUnixSeconds(item.delisting.effectiveTime) &&
            item.validTo === item.delisting.effectiveTime,
      ));

  const checks: StockDatasetContentCheck[] = [
    {
      id: "non-empty",
      passed: bars.length > 0,
      detail: `${bars.length} bar(s) recorded.`,
    },
    {
      id: "declared-extents",
      passed:
        actualStartTime !== null &&
        actualEndTime !== null &&
        manifest.startTime === actualStartTime &&
        manifest.endTime === actualEndTime,
      detail: `declared=${manifest.startTime}..${manifest.endTime}, actual=${actualStartTime ?? "none"}..${actualEndTime ?? "none"}`,
    },
    {
      id: "symbols",
      passed: sameUniqueValues(declaredSymbols, actualSymbols),
      detail: `declared=${declaredSymbols.join(",")}, actual=${actualSymbols.join(",")}`,
    },
    {
      id: "markets",
      passed: sameUniqueValues(declaredMarkets, actualMarkets),
      detail: `declared=${declaredMarkets.join(",")}, actual=${actualMarkets.join(",")}`,
    },
    {
      id: "timeframe",
      passed: bars.every((bar) => bar.timeframe === manifest.timeframe),
      detail: `expected ${manifest.timeframe}.`,
    },
    {
      id: "chronological",
      passed: chronological,
      detail: "Bars must be globally chronological and non-overlapping per symbol.",
    },
    {
      id: "duplicate-bars",
      passed: !duplicateBars,
      detail: "Symbol/market/timeframe/openTime keys must be unique.",
    },
    {
      id: "price-shape",
      passed: priceShape,
      detail: "OHLC must be positive and ordered; volume must be non-negative.",
    },
    {
      id: "session-shape",
      passed: sessionShape,
      detail: "Session dates, candle durations, and session-end markers must be coherent.",
    },
    {
      id: "symbol-evidence",
      passed: symbolEvidence,
      detail: "Every symbol/market pair needs one sourced, timestamped evidence record.",
    },
    {
      id: "symbol-validity",
      passed: symbolValidity,
      detail: "Every bar must be within its symbol validity interval.",
    },
    {
      id: "point-in-time-universe-evidence",
      passed: pointInTimeEvidence,
      detail: "Point-in-time datasets need valid membership intervals intersecting the dataset.",
    },
    {
      id: "delisting-evidence",
      passed: delistingEvidence,
      detail: "Delisting coverage needs a coherent active/delisted status per symbol.",
    },
  ];
  const blockers = checks.filter((check) => !check.passed).map((check) => check.id);
  return {
    valid: blockers.length === 0,
    actualStartTime,
    actualEndTime,
    checks,
    blockers,
  };
};

const buildDatasetManifest = ({
  seed,
  bars,
}: {
  seed: StockDatasetManifestSeed;
  bars: StockBacktestBar[];
}): StockDatasetManifest => {
  const contentChecksum = sha256Hex(stableSerialize(bars));
  const identityChecksum = sha256Hex(
    stableSerialize({ seed, contentChecksum, recordCount: bars.length }),
  );
  return {
    ...seed,
    datasetId: `${slug(seed.provider)}-${seed.timeframe}-${identityChecksum.slice(0, 16)}`,
    contentChecksum,
    recordCount: bars.length,
  };
};

export const createDatasetManifest = ({
  seed,
  bars,
}: {
  seed: StockDatasetManifestSeed;
  bars: StockBacktestBar[];
}): StockDatasetManifest => {
  assertUnixSeconds("manifest.startTime", seed.startTime);
  assertUnixSeconds("manifest.endTime", seed.endTime);
  if (seed.endTime < seed.startTime) {
    throw new Error("manifest.endTime must not precede startTime.");
  }
  const validation = validateDatasetContents({ manifest: seed, bars });
  if (!validation.valid) {
    throw new Error(
      `Dataset content validation failed: ${validation.blockers.join(", ")}.`,
    );
  }
  return buildDatasetManifest({ seed, bars });
};

export const createBacktestConfig = (
  seed: StockBacktestConfigSeed,
): StockBacktestConfig => ({
  ...seed,
  configId: `stock-config-${sha256Hex(stableSerialize(seed)).slice(0, 16)}`,
});

export const verifyDatasetIdentity = (dataset: StockBacktestDataset) => {
  const seed: StockDatasetManifestSeed = {
    schemaVersion: dataset.manifest.schemaVersion,
    provider: dataset.manifest.provider,
    retrievedAt: dataset.manifest.retrievedAt,
    timeframe: dataset.manifest.timeframe,
    markets: dataset.manifest.markets,
    symbols: dataset.manifest.symbols,
    startTime: dataset.manifest.startTime,
    endTime: dataset.manifest.endTime,
    priceAdjustment: dataset.manifest.priceAdjustment,
    sessionPolicy: dataset.manifest.sessionPolicy,
    missingBarPolicy: dataset.manifest.missingBarPolicy,
    pointInTimeUniverse: dataset.manifest.pointInTimeUniverse,
    delistingsIncluded: dataset.manifest.delistingsIncluded,
    symbolEvidence: dataset.manifest.symbolEvidence,
  };
  const expected = buildDatasetManifest({ seed, bars: dataset.bars });
  const contentValidation = validateDatasetContents({
    manifest: dataset.manifest,
    bars: dataset.bars,
  });
  const identityValid =
    expected.datasetId === dataset.manifest.datasetId &&
    expected.contentChecksum === dataset.manifest.contentChecksum &&
    expected.recordCount === dataset.manifest.recordCount;
  return {
    valid: identityValid && contentValidation.valid,
    identityValid,
    contentValidation,
    expected,
  };
};
