import type {
  MarketCandle,
  MarketDataProvider,
  MarketExtendedQuote,
} from "@/lib/market-data";

export type SectorStrengthMarket = "US" | "KR";
export type SectorStrengthPeriod = "oneDay" | "oneWeek" | "oneMonth";

export type SectorStrengthReturns = Record<SectorStrengthPeriod, number | null>;

export type SectorStrengthInstrument = {
  id: string;
  name: string;
  symbol: string;
};
export type SectorStrengthItem = SectorStrengthInstrument & {
  returns: SectorStrengthReturns;
  excessReturns: SectorStrengthReturns;
  quoteAt: string | null;
  status: "intraday" | "closed" | "fallback";
};

export type SectorStrengthError = {
  symbol: string;
  message: string;
};

export type SectorStrengthResponse = {
  market: SectorStrengthMarket;
  generatedAt: string;
  asOf: string;
  marketState: "intraday" | "closed";
  benchmark: SectorStrengthItem;
  sectors: SectorStrengthItem[];
  errors: SectorStrengthError[];
  stale: boolean;
  cacheAgeSeconds: number;
};

type SectorStrengthMarketConfig = {
  benchmark: SectorStrengthInstrument;
  sectors: SectorStrengthInstrument[];
};

export const SECTOR_STRENGTH_MARKETS: Record<SectorStrengthMarket, SectorStrengthMarketConfig> = {
  US: {
    benchmark: { id: "us-market", name: "S&P 500", symbol: "SPY" },
    sectors: [
      { id: "communication-services", name: "커뮤니케이션", symbol: "XLC" },
      { id: "consumer-discretionary", name: "경기소비재", symbol: "XLY" },
      { id: "consumer-staples", name: "필수소비재", symbol: "XLP" },
      { id: "energy", name: "에너지", symbol: "XLE" },
      { id: "financials", name: "금융", symbol: "XLF" },
      { id: "health-care", name: "헬스케어", symbol: "XLV" },
      { id: "industrials", name: "산업재", symbol: "XLI" },
      { id: "materials", name: "소재", symbol: "XLB" },
      { id: "real-estate", name: "부동산", symbol: "XLRE" },
      { id: "technology", name: "기술", symbol: "XLK" },
      { id: "utilities", name: "유틸리티", symbol: "XLU" },
    ],
  },
  KR: {
    benchmark: { id: "kr-market", name: "KODEX 200", symbol: "069500.KS" },
    sectors: [
      { id: "semiconductor", name: "반도체", symbol: "091160.KS" },
      { id: "auto", name: "자동차", symbol: "091180.KS" },
      { id: "bank", name: "은행", symbol: "091170.KS" },
      { id: "securities", name: "증권", symbol: "102970.KS" },
      { id: "health-care", name: "헬스케어", symbol: "266420.KS" },
      { id: "insurance", name: "보험", symbol: "140700.KS" },
      { id: "construction", name: "건설", symbol: "117700.KS" },
      { id: "information-technology", name: "IT", symbol: "266370.KS" },
      { id: "k-content", name: "K콘텐츠", symbol: "266360.KS" },
      { id: "energy-chemical", name: "에너지화학", symbol: "117460.KS" },
      { id: "steel", name: "철강", symbol: "117680.KS" },
      { id: "machinery", name: "기계장비", symbol: "102960.KS" },
      { id: "transportation", name: "운송", symbol: "140710.KS" },
      { id: "consumer-staples", name: "필수소비재", symbol: "266410.KS" },
      { id: "consumer-discretionary", name: "경기소비재", symbol: "266390.KS" },
      { id: "real-estate", name: "부동산리츠", symbol: "476800.KS" },
    ],
  },
};

const returnBetween = (latest: number | undefined, previous: number | undefined) =>
  typeof latest === "number" && Number.isFinite(latest) && latest > 0 &&
  typeof previous === "number" && Number.isFinite(previous) && previous > 0
    ? latest / previous - 1
    : null;

const localDateKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const confirmedCandles = (
  candles: MarketCandle[],
  quote: MarketExtendedQuote | null,
  timeZone: string | undefined,
  now: Date,
) => {
  const sorted = candles.toSorted((left, right) => left.time - right.time);
  const latest = sorted.at(-1);
  if (
    quote?.marketState?.toUpperCase() === "REGULAR" &&
    latest &&
    timeZone &&
    localDateKey(new Date(latest.time * 1_000), timeZone) === localDateKey(now, timeZone)
  ) {
    return sorted.slice(0, -1);
  }
  return sorted;
};

export const calculateSectorReturns = (
  candles: MarketCandle[],
  quote: MarketExtendedQuote | null,
  timeZone: string | undefined,
  now: Date,
): { returns: SectorStrengthReturns; quoteAt: string | null; status: SectorStrengthItem["status"] } => {
  const confirmed = confirmedCandles(candles, quote, timeZone, now);
  const latest = confirmed.at(-1);
  const regularPrice = quote?.regularMarketPrice;
  const previousClose = quote?.regularMarketPreviousClose;
  const intraday = quote?.marketState?.toUpperCase() === "REGULAR" &&
    typeof regularPrice === "number" && typeof previousClose === "number";
  const quoteReturn = returnBetween(regularPrice, previousClose);
  const oneDay = quoteReturn ?? returnBetween(latest?.close, confirmed.at(-2)?.close);
  const oneWeek = returnBetween(latest?.close, confirmed.at(-6)?.close);
  const oneMonth = returnBetween(latest?.close, confirmed.at(-22)?.close);
  const quoteAt = intraday
    ? now.toISOString()
    : latest ? new Date(latest.time * 1_000).toISOString() : null;

  return {
    returns: { oneDay, oneWeek, oneMonth },
    quoteAt,
    status: intraday ? "intraday" : quoteReturn !== null ? "closed" : "fallback",
  };
};

const subtractReturns = (
  value: SectorStrengthReturns,
  benchmark: SectorStrengthReturns,
): SectorStrengthReturns => ({
  oneDay: value.oneDay !== null && benchmark.oneDay !== null ? value.oneDay - benchmark.oneDay : null,
  oneWeek: value.oneWeek !== null && benchmark.oneWeek !== null ? value.oneWeek - benchmark.oneWeek : null,
  oneMonth: value.oneMonth !== null && benchmark.oneMonth !== null ? value.oneMonth - benchmark.oneMonth : null,
});

const emptyReturns = (): SectorStrengthReturns => ({ oneDay: null, oneWeek: null, oneMonth: null });

const loadInstrument = async (
  instrument: SectorStrengthInstrument,
  provider: MarketDataProvider,
  now: Date,
): Promise<SectorStrengthItem> => {
  const [quote, candleResponse] = await Promise.all([
    provider.getExtendedQuote(instrument.symbol),
    provider.getCandles(instrument.symbol, {
      period1: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1_000),
      period2: now,
      interval: "1d",
      includePrePost: false,
    }),
  ]);
  const calculated = calculateSectorReturns(candleResponse.candles, quote, candleResponse.timeZone, now);
  if (Object.values(calculated.returns).every((value) => value === null)) {
    throw new Error("수익률을 계산할 수 있는 시세가 없습니다.");
  }
  return {
    ...instrument,
    ...calculated,
    excessReturns: emptyReturns(),
  };
};

const loadInBatches = async <T, R>(
  values: T[],
  batchSize: number,
  loader: (value: T) => Promise<R>,
) => {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.allSettled(values.slice(index, index + batchSize).map(loader)));
  }
  return results;
};

export const buildSectorStrengthSnapshot = async (
  market: SectorStrengthMarket,
  provider: MarketDataProvider,
  now = new Date(),
): Promise<SectorStrengthResponse> => {
  const config = SECTOR_STRENGTH_MARKETS[market];
  const benchmark = await loadInstrument(config.benchmark, provider, now).catch((error) => {
    throw new Error(`시장 벤치마크 ${config.benchmark.symbol} 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
  });
  const settled = await loadInBatches(config.sectors, 4, (instrument) => loadInstrument(instrument, provider, now));
  const errors: SectorStrengthError[] = [];
  const sectors = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [{
        ...result.value,
        excessReturns: subtractReturns(result.value.returns, benchmark.returns),
      }];
    }
    errors.push({
      symbol: config.sectors[index].symbol,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return [];
  });
  const asOf = [benchmark, ...sectors]
    .map((item) => item.quoteAt)
    .filter((value): value is string => value !== null)
    .toSorted()
    .at(-1) ?? now.toISOString();

  return {
    market,
    generatedAt: now.toISOString(),
    asOf,
    marketState: [benchmark, ...sectors].some((item) => item.status === "intraday") ? "intraday" : "closed",
    benchmark,
    sectors,
    errors,
    stale: false,
    cacheAgeSeconds: 0,
  };
};
