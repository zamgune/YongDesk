import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stockAnalysisStoragePath } from "@/lib/local-storage";

export type OfficialNewsSource = {
  id: string;
  name: string;
  url: string;
  category: "macro" | "regulatory" | "policy";
  enabled: boolean;
};

export type LocalNewsEvent = {
  id: string;
  sourceId: string;
  sourceName: string;
  category: OfficialNewsSource["category"];
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
  tags: string[];
  tickers: string[];
  importance: "low" | "medium" | "high";
  dedupeKey: string;
};

type NewsStore = {
  seen: Record<string, string>;
  events: LocalNewsEvent[];
};

const NEWS_STORE_PATH = stockAnalysisStoragePath("news", "events.json");
const MAX_STORED_EVENTS = 300;
const DEFAULT_NEWS_FETCH_TIMEOUT_MS = 4_000;

export const DEFAULT_OFFICIAL_NEWS_SOURCES: OfficialNewsSource[] = [
  {
    id: "federal-reserve-press",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    category: "macro",
    enabled: true,
  },
  {
    id: "sec-press",
    name: "SEC",
    url: "https://www.sec.gov/news/pressreleases.rss",
    category: "regulatory",
    enabled: true,
  },
  {
    id: "bea-releases",
    name: "BEA",
    url: "https://apps.bea.gov/rss/rss.xml",
    category: "macro",
    enabled: true,
  },
];

const KEYWORD_TAGS: Array<{ tag: string; pattern: RegExp; importance: LocalNewsEvent["importance"]; tickers?: string[] }> = [
  { tag: "rate-policy", pattern: /rate|fomc|monetary|inflation|treasury|yield/i, importance: "high" },
  { tag: "employment", pattern: /employment|payroll|jobless|labor|wage/i, importance: "high" },
  { tag: "gdp", pattern: /gdp|gross domestic product|corporate profits|personal income/i, importance: "high" },
  { tag: "trade", pattern: /trade|tariff|import|export|sanction/i, importance: "medium" },
  { tag: "banking", pattern: /bank|capital|liquidity|financial stability/i, importance: "medium", tickers: ["XLF"] },
  { tag: "crypto", pattern: /crypto|bitcoin|digital asset|token/i, importance: "medium", tickers: ["BTC-USD", "COIN"] },
  { tag: "semiconductor", pattern: /semiconductor|chip|ai/i, importance: "medium", tickers: ["NVDA", "AMD", "AVGO"] },
  { tag: "ipo", pattern: /ipo|initial public offering|listing/i, importance: "medium" },
];

const htmlDecode = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const firstMatch = (xml: string, patterns: RegExp[]): string => {
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match?.[1]) {
      return htmlDecode(match[1]);
    }
  }
  return "";
};

const dedupeKeyFor = (sourceId: string, title: string, url: string) =>
  createHash("sha256")
    .update(`${sourceId}:${title.trim().toLowerCase()}:${url.trim().toLowerCase()}`)
    .digest("hex");

const classify = (text: string) => {
  const tags = new Set<string>();
  const tickers = new Set<string>();
  let score = 0;
  let highSignal = false;
  for (const rule of KEYWORD_TAGS) {
    if (!rule.pattern.test(text)) {
      continue;
    }
    tags.add(rule.tag);
    for (const ticker of rule.tickers ?? []) {
      tickers.add(ticker);
    }
    highSignal = highSignal || rule.importance === "high";
    score += rule.importance === "high" ? 2 : 1;
  }
  return {
    tags: [...tags],
    tickers: [...tickers],
    importance: highSignal || score >= 3 ? "high" as const : score >= 1 ? "medium" as const : "low" as const,
  };
};

export const parseOfficialRss = (source: OfficialNewsSource, xml: string): LocalNewsEvent[] => {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block) => {
    const title = firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
    const atomHref = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
    const url = firstMatch(block, [
      /<link[^>]*>([\s\S]*?)<\/link>/i,
      /<guid[^>]*>(https?:\/\/[\s\S]*?)<\/guid>/i,
    ]) || htmlDecode(atomHref);
    const publishedRaw = firstMatch(block, [
      /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
      /<published[^>]*>([\s\S]*?)<\/published>/i,
      /<updated[^>]*>([\s\S]*?)<\/updated>/i,
    ]);
    const summary = firstMatch(block, [
      /<description[^>]*>([\s\S]*?)<\/description>/i,
      /<summary[^>]*>([\s\S]*?)<\/summary>/i,
      /<content[^>]*>([\s\S]*?)<\/content>/i,
    ]);
    const publishedAtMs = publishedRaw ? Date.parse(publishedRaw) : NaN;
    const classification = classify(`${title} ${summary}`);
    const dedupeKey = dedupeKeyFor(source.id, title, url);
    return {
      id: dedupeKey.slice(0, 24),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url,
      publishedAt: Number.isFinite(publishedAtMs) ? new Date(publishedAtMs).toISOString() : null,
      summary,
      tags: classification.tags,
      tickers: classification.tickers,
      importance: classification.importance,
      dedupeKey,
    };
  }).filter((event) => event.title && event.url);
};

const readNewsStore = async (): Promise<NewsStore> => {
  try {
    const parsed = JSON.parse(await readFile(NEWS_STORE_PATH, "utf8")) as Partial<NewsStore>;
    return {
      seen: typeof parsed.seen === "object" && parsed.seen !== null ? parsed.seen as Record<string, string> : {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { seen: {}, events: [] };
  }
};

export const readStoredNewsEvents = async (): Promise<LocalNewsEvent[]> =>
  (await readNewsStore()).events;

const writeNewsStore = async (store: NewsStore) => {
  await mkdir(dirname(NEWS_STORE_PATH), { recursive: true });
  const tempPath = `${NEWS_STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, NEWS_STORE_PATH);
};

export const fetchOfficialNewsEvents = async (
  sources = DEFAULT_OFFICIAL_NEWS_SOURCES,
): Promise<{ events: LocalNewsEvent[]; errors: Array<{ sourceId: string; message: string }> }> => {
  const timeoutMs = Number(process.env.STOCK_ANALYSIS_NEWS_FETCH_TIMEOUT_MS ?? DEFAULT_NEWS_FETCH_TIMEOUT_MS);
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_NEWS_FETCH_TIMEOUT_MS;
  const results = await Promise.all(sources.filter((source) => source.enabled).map(async (source) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "User-Agent": "StockAnalysisMac/0.1 official-rss-reader",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { source, events: parseOfficialRss(source, await response.text()) };
    } catch (error) {
      return {
        source,
        error: error instanceof Error && error.name === "AbortError"
          ? `RSS fetch timeout after ${effectiveTimeoutMs}ms`
          : error instanceof Error ? error.message : String(error),
        events: [] as LocalNewsEvent[],
      };
    } finally {
      clearTimeout(timeout);
    }
  }));

  return {
    events: results.flatMap((result) => result.events),
    errors: results
      .filter((result): result is typeof result & { error: string } => "error" in result)
      .map((result) => ({ sourceId: result.source.id, message: result.error })),
  };
};

export const pollOfficialNews = async () => {
  const [{ events, errors }, store] = await Promise.all([
    fetchOfficialNewsEvents(),
    readNewsStore(),
  ]);
  const now = new Date().toISOString();
  const sorted = events.toSorted((left, right) =>
    (Date.parse(right.publishedAt ?? "") || 0) - (Date.parse(left.publishedAt ?? "") || 0),
  );
  const newEvents = sorted.filter((event) => !store.seen[event.dedupeKey]);
  const nextSeen = { ...store.seen };
  for (const event of sorted) {
    nextSeen[event.dedupeKey] = event.publishedAt ?? now;
  }
  const nextEvents = [...newEvents, ...store.events]
    .filter((event, index, all) => all.findIndex((candidate) => candidate.dedupeKey === event.dedupeKey) === index)
    .slice(0, MAX_STORED_EVENTS);
  await writeNewsStore({ seen: nextSeen, events: nextEvents });
  return {
    generatedAt: now,
    newEvents,
    events: nextEvents,
    errors,
    alertCandidates: newEvents.filter((event) => event.importance !== "low"),
  };
};
