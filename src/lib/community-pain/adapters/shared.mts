import { FETCH_MAX_BODY_BYTES, FETCH_TIMEOUT_MS, SOURCE_REQUEST_CONCURRENCY } from "../config.mts";
import { normalizeItems, stripTags } from "../normalize.mts";
import type {
  CommunityPainSourceResult,
  CommunitySourceConfig,
  RawCommunityItem,
  SourceFetchContext,
} from "../types.mts";

export const fetchWithTimeout = async (url: string, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchHtml = async (url: string) => {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 CommunityPainMeter/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 1800 },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return readBoundedText(response);
};

export const fetchJson = async (url: string, init: RequestInit = {}) => {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    next: { revalidate: 1800 },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return JSON.parse(await readBoundedText(response));
};

const readBoundedText = async (response: Response) => {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > FETCH_MAX_BODY_BYTES) {
    throw new Error(`response body exceeds ${FETCH_MAX_BODY_BYTES} bytes`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > FETCH_MAX_BODY_BYTES) {
    throw new Error(`response body exceeds ${FETCH_MAX_BODY_BYTES} bytes`);
  }
  return new TextDecoder().decode(buffer);
};

export const redactSensitiveUrl = (url?: string) => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    for (const key of ["access_token", "api_key", "apikey", "token", "key"]) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "REDACTED");
      }
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const mapWithConcurrency = async <T, R>(
  values: T[],
  mapper: (value: T, index: number) => Promise<R>,
  concurrency = SOURCE_REQUEST_CONCURRENCY,
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

export const uniqueByUrlTitle = (items: RawCommunityItem[]) => {
  const seen = new Map<string, RawCommunityItem>();
  for (const item of items) {
    const key = `${item.sourceId}|${item.url}|${item.kind ?? "post"}|${item.parentId ?? ""}|${item.title}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    seen.set(key, {
      ...existing,
      ...item,
      text:
        (item.text?.length ?? 0) > (existing.text?.length ?? 0)
          ? item.text
          : existing.text,
      commentCount: Math.max(existing.commentCount ?? 0, item.commentCount ?? 0),
      reactionCount: Math.max(existing.reactionCount ?? 0, item.reactionCount ?? 0),
      createdAt: existing.createdAt ?? item.createdAt,
    });
  }
  return [...seen.values()];
};

export const buildOkResult = ({
  config,
  context,
  url,
  items,
}: {
  config: CommunitySourceConfig;
  context: SourceFetchContext;
  url: string;
  items: RawCommunityItem[];
}): CommunityPainSourceResult => {
  const uniqueItems = uniqueByUrlTitle(items);
  const datedItems = uniqueItems
    .map((item) => ({ item, timestamp: item.createdAt ? Date.parse(item.createdAt) : Number.NaN }))
    .filter(({ timestamp }) => Number.isFinite(timestamp));
  const windowItems = datedItems
    .filter(({ timestamp }) => timestamp >= context.sinceTimestamp && timestamp <= context.nowTimestamp + 300_000)
    .map(({ item }) => item);
  const primaryRecentItems = datedItems
    .filter(({ timestamp }) => timestamp >= context.primarySinceTimestamp && timestamp <= context.nowTimestamp + 300_000)
    .map(({ item }) => item);
  const scoringItems = datedItems.length ? windowItems : uniqueItems;
  const sortedItems = [...scoringItems].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    return rightTime - leftTime;
  });
  const normalized = normalizeItems(sortedItems, context.queryTerms).slice(0, context.limit);
  const postCount = normalized.filter((item) => (item.kind ?? "post") === "post").length;
  const commentItemCount = normalized.filter((item) => item.kind === "comment").length;
  const replyCount = normalized.filter((item) => item.kind === "reply").length;
  const timestamps = datedItems.map(({ timestamp }) => timestamp);
  const oldestTimestamp = timestamps.length ? Math.min(...timestamps) : undefined;
  const newestTimestamp = timestamps.length ? Math.max(...timestamps) : undefined;
  return {
    id: config.id,
    label: config.label,
    policyStatus: config.policyStatus,
    status: normalized.length ? "ok" : "empty",
    url: redactSensitiveUrl(url),
    itemCount: normalized.length,
    postCount,
    commentItemCount,
    replyCount,
    candidateCount: uniqueItems.length,
    recentItemCount: primaryRecentItems.length,
    confidenceWeight: config.confidenceWeight,
    oldestItemAt: oldestTimestamp ? new Date(oldestTimestamp).toISOString() : undefined,
    newestItemAt: newestTimestamp ? new Date(newestTimestamp).toISOString() : undefined,
    dateParseCoverage: uniqueItems.length ? datedItems.length / uniqueItems.length : 0,
    items: normalized,
  };
};

export const buildSkippedResult = (
  config: CommunitySourceConfig,
  status: CommunityPainSourceResult["status"],
  reason: string,
): CommunityPainSourceResult => ({
  id: config.id,
  label: config.label,
  policyStatus: config.policyStatus,
  status,
  itemCount: 0,
  postCount: 0,
  commentItemCount: 0,
  replyCount: 0,
  candidateCount: 0,
  recentItemCount: 0,
  confidenceWeight: config.confidenceWeight,
  reason,
  dateParseCoverage: 0,
  items: [],
});

export const buildErrorResult = (
  config: CommunitySourceConfig,
  reason: string,
  url?: string,
): CommunityPainSourceResult => ({
  id: config.id,
  label: config.label,
  policyStatus: config.policyStatus,
  status: "error",
  url: redactSensitiveUrl(url),
  itemCount: 0,
  postCount: 0,
  commentItemCount: 0,
  replyCount: 0,
  candidateCount: 0,
  recentItemCount: 0,
  confidenceWeight: config.confidenceWeight,
  reason,
  dateParseCoverage: 0,
  timedOut: reason.toLowerCase().includes("timeout"),
  items: [],
});

export const cleanTitle = (value: string) => stripTags(value).replace(/\s+/g, " ").trim();

const englishMonths: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export const parsePaxnetDate = (value: string) => {
  const match = value.match(/^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+KST\s+(\d{4})$/);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  const month = englishMonths[match[1]];
  if (month === undefined) {
    return undefined;
  }
  const timestamp = Date.UTC(
    Number.parseInt(match[6], 10),
    month,
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10) - 9,
    Number.parseInt(match[4], 10),
    Number.parseInt(match[5], 10),
  );
  return new Date(timestamp).toISOString();
};

export const parseKoreanMonthDayDate = (value: string, nowTimestamp: number) => {
  const trimmed = value.trim();
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  const now = new Date(nowTimestamp);
  if (timeMatch) {
    const timestamp = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Number.parseInt(timeMatch[1], 10) - 9,
      Number.parseInt(timeMatch[2], 10),
    );
    return new Date(timestamp).toISOString();
  }
  const monthDayMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (!monthDayMatch) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  const month = Number.parseInt(monthDayMatch[1], 10) - 1;
  const day = Number.parseInt(monthDayMatch[2], 10);
  let timestamp = Date.UTC(now.getUTCFullYear(), month, day, -9, 0, 0);
  if (timestamp > nowTimestamp + 86_400_000) {
    timestamp = Date.UTC(now.getUTCFullYear() - 1, month, day, -9, 0, 0);
  }
  return new Date(timestamp).toISOString();
};

export const isOlderThanWindow = (createdAt: string | undefined, context: SourceFetchContext) => {
  if (!createdAt) {
    return false;
  }
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) && timestamp < context.sinceTimestamp;
};
