import { getMarketDataProvider, type MarketDataProvider } from "@/lib/market-data";
import {
  buildSectorStrengthSnapshot,
  type SectorStrengthMarket,
  type SectorStrengthResponse,
} from "@/lib/market/sector-strength";

const CACHE_TTL_MS = 5 * 60 * 1_000;
const MANUAL_REFRESH_THROTTLE_MS = 5_000;

type CacheEntry = {
  storedAt: number;
  response: SectorStrengthResponse;
};

export const createSectorStrengthService = (
  provider: MarketDataProvider = getMarketDataProvider(),
  now: () => Date = () => new Date(),
) => {
  const cache = new Map<SectorStrengthMarket, CacheEntry>();
  const inFlight = new Map<SectorStrengthMarket, Promise<SectorStrengthResponse>>();
  const lastManualRefresh = new Map<SectorStrengthMarket, number>();

  const withCacheAge = (entry: CacheEntry, current: number, stale = false): SectorStrengthResponse => ({
    ...entry.response,
    stale,
    cacheAgeSeconds: Math.max(0, Math.floor((current - entry.storedAt) / 1_000)),
  });

  return async (market: SectorStrengthMarket, force = false): Promise<SectorStrengthResponse> => {
    const currentDate = now();
    const current = currentDate.getTime();
    const cached = cache.get(market);
    if (!force && cached && current - cached.storedAt < CACHE_TTL_MS) {
      return withCacheAge(cached, current);
    }
    const lastRefreshAt = Math.max(lastManualRefresh.get(market) ?? 0, cached?.storedAt ?? 0);
    if (force && cached && current - lastRefreshAt < MANUAL_REFRESH_THROTTLE_MS) {
      return withCacheAge(cached, current);
    }
    if (force) {
      lastManualRefresh.set(market, current);
    }
    const pending = inFlight.get(market);
    if (pending) return pending;

    const request = buildSectorStrengthSnapshot(market, provider, currentDate)
      .then((response) => {
        cache.set(market, { storedAt: current, response });
        return response;
      })
      .catch((error) => {
        if (!cached) throw error;
        return {
          ...withCacheAge(cached, current, true),
          errors: [
            ...cached.response.errors,
            { symbol: "benchmark", message: error instanceof Error ? error.message : String(error) },
          ],
        };
      })
      .finally(() => {
        inFlight.delete(market);
      });
    inFlight.set(market, request);
    return request;
  };
};

export const getSectorStrength = createSectorStrengthService();
