import type { UnixSeconds } from "./types.ts";

// Large enough for long-lived fixtures, but low enough to reject millisecond timestamps.
export const MAX_UNIX_SECONDS = 20_000_000_000;

export const isUnixSeconds = (value: number): value is UnixSeconds =>
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNIX_SECONDS;

export const assertUnixSeconds = (label: string, value: number) => {
  if (!isUnixSeconds(value)) {
    throw new Error(`${label} must be a UNIX timestamp in seconds.`);
  }
};

export const utcYearFromUnixSeconds = (value: UnixSeconds) => {
  assertUnixSeconds("timestamp", value);
  return new Date(value * 1_000).getUTCFullYear();
};

export const addUtcMonths = (value: UnixSeconds, months: number): UnixSeconds => {
  assertUnixSeconds("timestamp", value);
  if (!Number.isInteger(months) || months < 0) {
    throw new Error("months must be a non-negative integer.");
  }
  const source = new Date(value * 1_000);
  const targetMonthIndex =
    source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const result = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(source.getUTCDate(), lastTargetDay),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
    ),
  );
  return Math.floor(result.getTime() / 1_000);
};

export const completeUtcMonthsBetween = (
  start: UnixSeconds,
  end: UnixSeconds,
) => {
  assertUnixSeconds("start", start);
  assertUnixSeconds("end", end);
  if (end < start) {
    throw new Error("end must not precede start.");
  }
  const startDate = new Date(start * 1_000);
  const endDate = new Date(end * 1_000);
  let months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    endDate.getUTCMonth() -
    startDate.getUTCMonth();
  if (addUtcMonths(start, months) > end) {
    months -= 1;
  }
  return Math.max(months, 0);
};
