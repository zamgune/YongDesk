import { getMarketDataProvider } from "@/lib/market-data";

type SentimentData = {
    market: string;
    value: number;
    rating: string;
    timestamp: number;
    formula?: string;
};

type MarketIndicator = {
    name: string;
    value: number;
    change?: number;
    timestamp: number;
};

type TreasuryAuction = {
    securityType: string;
    securityTerm: string;
    auctionDate: string;
    highRate: number;
    bidToCover: number;
};

type SentimentResponse = {
    fearGreed: {
        us: SentimentData | null;
        kr: SentimentData | null;
        crypto: SentimentData | null;
    };
    indicators: {
        vix: MarketIndicator | null;
        dxy: MarketIndicator | null;
        btcDominance: MarketIndicator | null;
        usdkrw: MarketIndicator | null;
        kosdaq: MarketIndicator | null;
    };
    treasury: TreasuryAuction[] | null;
};

const marketData = getMarketDataProvider();

const getRating = (value: number): string => {
    if (value <= 20) return "Extreme Fear";
    if (value <= 40) return "Fear";
    if (value <= 60) return "Neutral";
    if (value <= 80) return "Greed";
    return "Extreme Greed";
};

async function fetchUSFearGreed(): Promise<SentimentData | null> {
    try {
        const response = await fetch(
            "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    Accept: "application/json",
                    Referer: "https://www.cnn.com/markets/fear-and-greed",
                },
                next: { revalidate: 3600 },
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const fng = data?.fear_and_greed;

        if (fng && typeof fng.score === "number") {
            return {
                market: "US",
                value: Math.round(fng.score),
                rating: fng.rating || getRating(fng.score),
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchCryptoFearGreed(): Promise<SentimentData | null> {
    try {
        const response = await fetch("https://api.alternative.me/fng/?limit=1", {
            next: { revalidate: 3600 },
        });

        if (!response.ok) return null;

        const data = await response.json();
        const item = data?.data?.[0];

        if (item && typeof item.value === "string") {
            const value = parseInt(item.value, 10);
            return {
                market: "Crypto",
                value,
                rating: item.value_classification || getRating(value),
                timestamp: parseInt(item.timestamp, 10) * 1000,
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function calculateKRFearGreed(): Promise<SentimentData | null> {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 60);

        const chart = await marketData.getCandles("^KS11", {
            period1: startDate,
            period2: endDate,
            interval: "1d",
        });

        const candles = chart.candles;
        if (candles.length < 20) return null;

        const closes = candles.map((candle) => candle.close);
        const volumes = candles.map((candle) => candle.volume);
        const highs = candles.map((candle) => candle.high);

        const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
        const volatility =
            Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) *
            Math.sqrt(252) *
            100;
        const volatilityScore = Math.max(0, Math.min(100, 50 + (20 - volatility) * 2));

        const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volumeScore = Math.max(0, Math.min(100, (recentVolume / avgVolume) * 50));

        const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentPrice = closes[closes.length - 1];
        const momentumScore = Math.max(
            0,
            Math.min(100, 50 + ((currentPrice - sma20) / sma20) * 500)
        );

        const high52w = Math.max(...highs);
        const low52w = Math.min(...candles.map((candle) => candle.low));
        const rangeScore = ((currentPrice - low52w) / (high52w - low52w)) * 100;

        const finalScore = Math.round(
            (volatilityScore + volumeScore + momentumScore + rangeScore) / 4
        );

        return {
            market: "KR",
            value: finalScore,
            rating: getRating(finalScore),
            timestamp: Date.now(),
            formula: "계산식: (변동성 + 거래량 + 모멘텀 + 가격위치) / 4",
        };
    } catch {
        return null;
    }
}

async function fetchVIX(): Promise<MarketIndicator | null> {
    try {
        const quote = await marketData.getQuote("^VIX");

        if (quote) {
            return {
                name: "VIX",
                value: quote.price,
                change: quote.changePercent,
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchDXY(): Promise<MarketIndicator | null> {
    try {
        const quote = await marketData.getQuote("DX-Y.NYB");

        if (quote) {
            return {
                name: "Dollar Index",
                value: quote.price,
                change: quote.changePercent,
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchBTCDominance(): Promise<MarketIndicator | null> {
    try {
        const response = await fetch(
            "https://api.coingecko.com/api/v3/global",
            { next: { revalidate: 3600 } }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const btcDom = data?.data?.market_cap_percentage?.btc;

        if (typeof btcDom === "number") {
            return {
                name: "BTC Dominance",
                value: Math.round(btcDom * 10) / 10,
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchUSDKRW(): Promise<MarketIndicator | null> {
    try {
        const quote = await marketData.getQuote("USDKRW=X");

        if (quote) {
            return {
                name: "USD/KRW",
                value: quote.price,
                change: quote.changePercent,
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}
async function fetchKospiKosdaqRatio(): Promise<MarketIndicator | null> {
    try {
        const [kospiQuote, kosdaqQuote] = await Promise.all([
            marketData.getQuote("^KS11"),
            marketData.getQuote("^KQ11"),
        ]);

        if (
            kospiQuote &&
            kosdaqQuote
        ) {
            // Calculate ratio: KOSPI / KOSDAQ (higher = KOSPI stronger)
            const ratio = kospiQuote.price / kosdaqQuote.price;
            // Calculate relative change difference
            const kospiChange = kospiQuote.changePercent ?? 0;
            const kosdaqChange = kosdaqQuote.changePercent ?? 0;
            const relativeChange = kospiChange - kosdaqChange;

            return {
                name: "KOSPI/KOSDAQ",
                value: Math.round(ratio * 100) / 100,
                change: Math.round(relativeChange * 100) / 100,
                timestamp: Date.now(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchTreasuryAuctions(): Promise<TreasuryAuction[] | null> {
    try {
        // Filter for completed auctions only (where high_investment_rate is not null)
        const response = await fetch(
            "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?filter=high_investment_rate:gt:0&sort=-auction_date&page[size]=5",
            { next: { revalidate: 3600 } }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const records = data?.data;

        if (Array.isArray(records)) {
            return records.slice(0, 5).map((r: Record<string, unknown>) => ({
                securityType: String(r.security_type || ""),
                securityTerm: String(r.security_term || ""),
                auctionDate: String(r.auction_date || ""),
                highRate: parseFloat(String(r.high_investment_rate || "0")),
                bidToCover: parseFloat(String(r.bid_to_cover_ratio || "0")),
            }));
        }
        return null;
    } catch {
        return null;
    }
}

export async function GET(): Promise<Response> {
    const [us, kr, crypto, vix, dxy, btcDominance, usdkrw, kospiKosdaqRatio, treasury] = await Promise.all([
        fetchUSFearGreed(),
        calculateKRFearGreed(),
        fetchCryptoFearGreed(),
        fetchVIX(),
        fetchDXY(),
        fetchBTCDominance(),
        fetchUSDKRW(),
        fetchKospiKosdaqRatio(),
        fetchTreasuryAuctions(),
    ]);

    const response: SentimentResponse = {
        fearGreed: { us, kr, crypto },
        indicators: { vix, dxy, btcDominance, usdkrw, kosdaq: kospiKosdaqRatio },
        treasury,
    };

    return Response.json(response, {
        headers: {
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
    });
}
