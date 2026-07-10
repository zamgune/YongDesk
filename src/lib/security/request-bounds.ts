export const GENERAL_ANALYSIS_MAX_DAYS = 365 * 3;
export const LEADER_SCAN_MAX_DAYS = 365 * 2;
export const CRYPTO_BACKTEST_MAX_DAYS = 365;

export const parseBoundedDays = (
  rawValue: string | null,
  {
    fallback,
    max,
    label = "days",
  }: {
    fallback: number;
    max: number;
    label?: string;
  },
) => {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    return {
      ok: false as const,
      response: Response.json(
        { error: `${label}는 1 이상 ${max} 이하의 정수여야 합니다.` },
        { status: 400 },
      ),
    };
  }
  return { ok: true as const, value: parsed };
};

export const parseBoundedDateRange = ({
  startRaw,
  endRaw,
  fallbackDays,
  maxDays,
}: {
  startRaw: string | null;
  endRaw: string | null;
  fallbackDays: number;
  maxDays: number;
}) => {
  const now = Date.now();
  const end = endRaw ? Date.parse(endRaw) + 24 * 60 * 60 * 1000 : now;
  const start = startRaw ? Date.parse(startRaw) : now - fallbackDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "start/end 날짜 범위가 유효하지 않습니다." },
        { status: 400 },
      ),
    };
  }
  const rangeDays = Math.ceil((end - start) / (24 * 60 * 60 * 1000));
  if (rangeDays > maxDays) {
    return {
      ok: false as const,
      response: Response.json(
        { error: `날짜 범위는 최대 ${maxDays}일까지만 허용됩니다.` },
        { status: 400 },
      ),
    };
  }
  return { ok: true as const, startMs: start, endMs: end };
};

export const mapWithBoundedConcurrency = async <T, R>(
  values: T[],
  mapper: (value: T, index: number) => Promise<R>,
  concurrency: number,
) => {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};
