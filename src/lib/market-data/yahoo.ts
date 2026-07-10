import YahooFinance from "yahoo-finance2";
import type { ChartOptionsWithReturnArray } from "yahoo-finance2/modules/chart";
import type { PredefinedScreenerModules } from "yahoo-finance2/modules/screener";
import type {
  GetCandlesOptions,
  GetScreenerCandidatesOptions,
  MarketCandleResponse,
  MarketAssetProfile,
  MarketCandle,
  MarketDataProvider,
  MarketExtendedQuote,
  MarketQuote,
  MarketScreenerQuote,
} from "./types";

type YahooScreenerQuoteLike = {
  symbol?: unknown;
  shortName?: unknown;
  longName?: unknown;
  sector?: unknown;
  industry?: unknown;
  regularMarketVolume?: unknown;
  averageDailyVolume3Month?: unknown;
  marketCap?: unknown;
  regularMarketChangePercent?: unknown;
  exchange?: unknown;
};

type YahooExtendedQuoteLike = {
  regularMarketPrice?: unknown;
  regularMarketPreviousClose?: unknown;
  preMarketPrice?: unknown;
  preMarketChangePercent?: unknown;
  postMarketPrice?: unknown;
  postMarketChangePercent?: unknown;
  marketState?: unknown;
};

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const toUnix = (value: Date) => Math.floor(value.getTime() / 1000);

const getScreenerQuotes = (result: unknown): YahooScreenerQuoteLike[] => {
  if (
    typeof result === "object" &&
    result !== null &&
    "quotes" in result &&
    Array.isArray(result.quotes)
  ) {
    return result.quotes as YahooScreenerQuoteLike[];
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "finance" in result &&
    typeof result.finance === "object" &&
    result.finance !== null &&
    "result" in result.finance &&
    Array.isArray(result.finance.result)
  ) {
    return result.finance.result.flatMap((item) =>
      typeof item === "object" &&
      item !== null &&
      "quotes" in item &&
      Array.isArray(item.quotes)
        ? item.quotes as YahooScreenerQuoteLike[]
        : [],
    );
  }
  return [];
};

const getText = (value: unknown) => (isString(value) ? value : undefined);
const getNumber = (value: unknown) => (isFiniteNumber(value) ? value : undefined);

const normalizeScreenerQuote = (quote: YahooScreenerQuoteLike): MarketScreenerQuote | null => {
  const symbol = getText(quote.symbol);
  if (!symbol) {
    return null;
  }

  return {
    symbol,
    shortName: getText(quote.shortName),
    longName: getText(quote.longName),
    sector: getText(quote.sector),
    industry: getText(quote.industry),
    volume: getNumber(quote.regularMarketVolume),
    averageVolume: getNumber(quote.averageDailyVolume3Month),
    marketCap: getNumber(quote.marketCap),
    changePercent: getNumber(quote.regularMarketChangePercent),
    exchange: getText(quote.exchange),
  };
};

const normalizeCandles = (quotes: Array<Record<string, unknown>>): MarketCandle[] =>
  quotes
    .filter((quote) =>
      [quote.open, quote.high, quote.low, quote.close, quote.volume].every(isFiniteNumber) &&
      quote.date instanceof Date,
    )
    .map((quote) => ({
      time: toUnix(quote.date as Date),
      open: quote.open as number,
      high: quote.high as number,
      low: quote.low as number,
      close: quote.close as number,
      volume: quote.volume as number,
    }))
    .sort((a, b) => a.time - b.time);

export class YahooMarketDataProvider implements MarketDataProvider {
  async getCandles(symbol: string, options: GetCandlesOptions): Promise<MarketCandleResponse> {
    const chartOptions: ChartOptionsWithReturnArray = {
      period1: options.period1,
      period2: options.period2,
      interval: options.interval,
      return: "array",
    };

    if (typeof options.includePrePost === "boolean") {
      chartOptions.includePrePost = options.includePrePost;
    }

    const chart = await yahooFinance.chart(symbol, chartOptions);
    const quotes = "quotes" in chart && Array.isArray(chart.quotes) ? chart.quotes : [];
    const meta = "meta" in chart ? chart.meta : undefined;
    const timeZone =
      typeof meta?.exchangeTimezoneName === "string"
        ? meta.exchangeTimezoneName
        : typeof meta?.timezone === "string"
          ? meta.timezone
          : undefined;

    return {
      candles: normalizeCandles(quotes as Array<Record<string, unknown>>),
      timeZone,
    };
  }

  async getQuote(symbol: string): Promise<MarketQuote | null> {
    const quote = await yahooFinance.quote(symbol);
    if (!quote || !isFiniteNumber(quote.regularMarketPrice)) {
      return null;
    }

    return {
      symbol,
      price: quote.regularMarketPrice,
      changePercent: getNumber(quote.regularMarketChangePercent),
    };
  }

  async getQuotes(symbols: string[]): Promise<Array<MarketQuote | null>> {
    return Promise.all(symbols.map((symbol) => this.getQuote(symbol)));
  }

  async getExtendedQuote(symbol: string): Promise<MarketExtendedQuote | null> {
    const quote = await yahooFinance.quote(symbol) as YahooExtendedQuoteLike | null;
    if (!quote) {
      return null;
    }

    return {
      symbol,
      regularMarketPrice: getNumber(quote.regularMarketPrice),
      regularMarketPreviousClose: getNumber(quote.regularMarketPreviousClose),
      preMarketPrice: getNumber(quote.preMarketPrice),
      preMarketChangePercent: getNumber(quote.preMarketChangePercent),
      postMarketPrice: getNumber(quote.postMarketPrice),
      postMarketChangePercent: getNumber(quote.postMarketChangePercent),
      marketState: getText(quote.marketState),
    };
  }

  async getExtendedQuotes(symbols: string[]): Promise<Array<MarketExtendedQuote | null>> {
    return Promise.all(symbols.map((symbol) => this.getExtendedQuote(symbol)));
  }

  async getScreenerCandidates(options: GetScreenerCandidatesOptions): Promise<MarketScreenerQuote[]> {
    const result = await yahooFinance.screener(
      {
        scrIds: options.screenerId as PredefinedScreenerModules,
        count: options.count,
        region: options.region,
        lang: options.lang,
      },
      undefined,
      { validateResult: false },
    );

    return getScreenerQuotes(result)
      .map(normalizeScreenerQuote)
      .filter((quote): quote is MarketScreenerQuote => quote !== null);
  }

  async getAssetProfile(symbol: string): Promise<MarketAssetProfile | null> {
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: ["assetProfile"],
    });

    if (
      typeof result !== "object" ||
      result === null ||
      !("assetProfile" in result) ||
      typeof result.assetProfile !== "object" ||
      result.assetProfile === null
    ) {
      return null;
    }

    const profile = result.assetProfile as Record<string, unknown>;
    const sector = getText(profile.sector);
    const industry = getText(profile.industry);
    return sector || industry ? { sector, industry } : null;
  }
}
