import {
  COMMUNITY_CACHE_MAX_ENTRIES,
  COMMUNITY_CACHE_TTL_SECONDS,
} from "@/lib/community-pain/config.mts";
import { getCommunityPain } from "@/lib/community-pain/service.mts";
import type { CommunitySourceId } from "@/lib/community-pain/types.mts";
import { checkRateLimit } from "@/lib/security/rate-limit";

type RouteContext = {
  params: Promise<{ symbol: string }>;
};

const cache = new Map<string, { expiresAt: number; payload: unknown }>();
const validSources = new Set<CommunitySourceId>([
  "paxnet",
  "bobaedream",
  "reddit",
  "threads",
  "blind",
  "naver_finance",
  "clien",
]);

const parseBoolean = (value: string | null) =>
  value === "1" || value?.toLowerCase() === "true";

const parseSources = (value: string | null) => {
  if (!value) {
    return undefined;
  }
  const sources = value
    .split(",")
    .map((source) => source.trim() as CommunitySourceId)
    .filter((source) => validSources.has(source));
  return sources.length ? sources : undefined;
};

const sweepCache = (now: number) => {
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now || cache.size > COMMUNITY_CACHE_MAX_ENTRIES) {
      cache.delete(key);
    }
  }
};

const getCacheHeaders = (payload: Awaited<ReturnType<typeof getCommunityPain>>) => {
  const threadsRan = payload.sourceStats.some((source) =>
    source.id === "threads" && source.status !== "configuration-required" && source.status !== "skipped",
  );
  return threadsRan
    ? { "Cache-Control": "no-store" }
    : { "Cache-Control": `public, max-age=60, stale-while-revalidate=${COMMUNITY_CACHE_TTL_SECONDS}` };
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimit = checkRateLimit(request, "community-pain", {
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimit) {
    return rateLimit;
  }
  const { symbol } = await context.params;
  const trimmedSymbol = decodeURIComponent(symbol ?? "").trim();
  if (!trimmedSymbol || trimmedSymbol.length > 32) {
    return Response.json({ error: "유효한 종목 코드가 필요합니다." }, { status: 400 });
  }

  const url = new URL(request.url);
  const market = (url.searchParams.get("market") || "US").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,12}$/.test(market)) {
    return Response.json({ error: "유효한 market 값이 필요합니다." }, { status: 400 });
  }
  const includeBroad = parseBoolean(url.searchParams.get("broad"));
  const includeSpikeSources = parseBoolean(url.searchParams.get("spike"));
  const requestedSources = parseSources(url.searchParams.get("sources"));
  const cacheKey = JSON.stringify({
    symbol: trimmedSymbol.toUpperCase(),
    market,
    includeBroad,
    includeSpikeSources,
    requestedSources,
  });
  const now = Date.now();
  sweepCache(now);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return Response.json(cached.payload, {
      headers: getCacheHeaders(cached.payload as Awaited<ReturnType<typeof getCommunityPain>>),
    });
  }

  try {
    const payload = await getCommunityPain({
      symbol: trimmedSymbol,
      market,
      includeBroad,
      includeSpikeSources,
      requestedSources,
    });
    cache.set(cacheKey, {
      expiresAt: now + COMMUNITY_CACHE_TTL_SECONDS * 1000,
      payload,
    });
    return Response.json(payload, {
      headers: getCacheHeaders(payload),
    });
  } catch {
    return Response.json(
      { error: "커뮤니티 곡소리 데이터를 계산하지 못했습니다." },
      { status: 500 },
    );
  }
}
