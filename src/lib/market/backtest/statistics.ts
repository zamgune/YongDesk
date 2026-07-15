export type BlockBootstrapAverageRResult = {
  sampleSize: number;
  blockSize: number;
  samples: number;
  seed: number;
  mean: number;
  lower95: number;
  upper95: number;
};

export type HolmComparisonInput = {
  id: string;
  pValue: number;
};

export type HolmComparisonResult = HolmComparisonInput & {
  rank: number;
  threshold: number;
  rejected: boolean;
};

export type HolmBonferroniResult = {
  alpha: number;
  comparisons: HolmComparisonResult[];
  rejectedIds: string[];
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (sorted: number[], quantile: number) => {
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

export const blockBootstrapAverageR95 = ({
  values,
  blockSize,
  samples = 5_000,
  seed = 20_260_715,
}: {
  values: number[];
  blockSize: number;
  samples?: number;
  seed?: number;
}): BlockBootstrapAverageRResult => {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("values must contain finite R multiples.");
  }
  if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize > values.length) {
    throw new Error("blockSize must be between 1 and the sample size.");
  }
  if (!Number.isInteger(samples) || samples < 100) {
    throw new Error("samples must be an integer of at least 100.");
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error("seed must be a safe integer.");
  }

  const random = mulberry32(seed);
  const sampleMeans: number[] = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const draw: number[] = [];
    while (draw.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize && draw.length < values.length; offset += 1) {
        draw.push(values[(start + offset) % values.length]);
      }
    }
    sampleMeans.push(mean(draw));
  }
  const sorted = sampleMeans.toSorted((left, right) => left - right);
  return {
    sampleSize: values.length,
    blockSize,
    samples,
    seed,
    mean: mean(values),
    lower95: percentile(sorted, 0.025),
    upper95: percentile(sorted, 0.975),
  };
};

export const applyHolmBonferroni = ({
  comparisons,
  alpha = 0.05,
}: {
  comparisons: HolmComparisonInput[];
  alpha?: number;
}): HolmBonferroniResult => {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error("alpha must be between 0 and 1.");
  }
  if (comparisons.length === 0) {
    throw new Error("At least one comparison is required.");
  }
  if (
    new Set(comparisons.map((comparison) => comparison.id)).size !== comparisons.length ||
    comparisons.some(
      (comparison) =>
        !comparison.id ||
        !Number.isFinite(comparison.pValue) ||
        comparison.pValue < 0 ||
        comparison.pValue > 1,
    )
  ) {
    throw new Error("Comparison IDs must be unique and p-values must be in [0, 1].");
  }

  let canReject = true;
  const ordered = comparisons.toSorted((left, right) =>
    left.pValue !== right.pValue
      ? left.pValue - right.pValue
      : left.id.localeCompare(right.id),
  );
  const results = ordered.map((comparison, index) => {
    const threshold = alpha / (ordered.length - index);
    const rejected = canReject && comparison.pValue <= threshold;
    if (!rejected) {
      canReject = false;
    }
    return {
      ...comparison,
      rank: index + 1,
      threshold,
      rejected,
    };
  });
  return {
    alpha,
    comparisons: results,
    rejectedIds: results.filter((result) => result.rejected).map((result) => result.id),
  };
};
