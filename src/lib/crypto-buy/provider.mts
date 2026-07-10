import type { CryptoBar, CryptoInterval } from "./types.mts";

const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";
const BINANCE_LIMIT = 1000;

const intervalToMs: Record<CryptoInterval, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

const trimToNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeCryptoSymbol = (rawSymbol: string) => {
  const compact = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) {
    throw new Error("Crypto symbol is required.");
  }
  if (compact.endsWith("USDT") || compact.endsWith("USDC")) {
    return compact;
  }
  if (compact.endsWith("USD")) {
    return `${compact.slice(0, -3)}USDT`;
  }
  return `${compact}USDT`;
};

const toCryptoBar = (
  symbol: string,
  interval: CryptoInterval,
  raw: unknown,
): CryptoBar | null => {
  if (!Array.isArray(raw) || raw.length < 9) {
    return null;
  }

  const openTime = trimToNumber(raw[0]);
  const open = trimToNumber(raw[1]);
  const high = trimToNumber(raw[2]);
  const low = trimToNumber(raw[3]);
  const close = trimToNumber(raw[4]);
  const volume = trimToNumber(raw[5]);
  const closeTime = trimToNumber(raw[6]);
  const quoteVolume = trimToNumber(raw[7]);
  const tradeCount = trimToNumber(raw[8]);

  if (
    openTime === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    closeTime === null ||
    quoteVolume === null ||
    tradeCount === null
  ) {
    return null;
  }

  return {
    symbol,
    interval,
    openTime: Math.floor(openTime / 1000),
    closeTime: Math.floor(closeTime / 1000),
    time: Math.floor(openTime / 1000),
    open,
    high,
    low,
    close,
    volume,
    quoteVolume,
    tradeCount,
  };
};

export const fetchBinanceBars = async ({
  symbol,
  interval,
  startTimeMs,
  endTimeMs,
}: {
  symbol: string;
  interval: CryptoInterval;
  startTimeMs: number;
  endTimeMs: number;
}) => {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);
  const bars: CryptoBar[] = [];
  const seenOpenTimes = new Set<number>();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const stepMs = intervalToMs[interval];
  let cursorMs = startTimeMs;

  while (cursorMs < endTimeMs) {
    const params = new URLSearchParams({
      symbol: normalizedSymbol,
      interval,
      limit: String(BINANCE_LIMIT),
      startTime: String(cursorMs),
      endTime: String(endTimeMs),
    });
    const response = await fetch(`${BINANCE_KLINES_URL}?${params.toString()}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `Binance ${interval} request failed for ${normalizedSymbol}: HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body) || body.length === 0) {
      break;
    }

    let latestOpenTime = cursorMs;
    for (const rawBar of body) {
      const bar = toCryptoBar(normalizedSymbol, interval, rawBar);
      if (!bar) {
        continue;
      }
      if (bar.closeTime > nowSeconds || bar.openTime * 1000 >= endTimeMs) {
        continue;
      }
      if (seenOpenTimes.has(bar.openTime)) {
        latestOpenTime = Math.max(latestOpenTime, bar.openTime * 1000);
        continue;
      }
      seenOpenTimes.add(bar.openTime);
      latestOpenTime = Math.max(latestOpenTime, bar.openTime * 1000);
      bars.push(bar);
    }

    if (body.length < BINANCE_LIMIT) {
      break;
    }

    cursorMs = latestOpenTime + stepMs;
  }

  return bars.sort((left, right) => left.openTime - right.openTime);
};
