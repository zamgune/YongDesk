import { LEADER_UNIVERSES, type LeaderMarket } from "@/lib/market/leader-universes";
import {
  buildMarketReport,
  type LeaderResponse,
} from "@/lib/market/market-briefing-report";
import { scanLeaders } from "@/use-cases/market/scan-leaders";
import { getRequestUserContext } from "@/use-cases/security/request-context";

const DEFAULT_MARKETS: LeaderMarket[] = ["US", "KOSPI"];

const parseMarkets = (rawMarkets: string | null) => {
  if (!rawMarkets) {
    return DEFAULT_MARKETS;
  }
  const markets = rawMarkets
    .split(",")
    .map((market) => market.trim().toUpperCase())
    .filter((market): market is LeaderMarket =>
      market === "US" || market === "KOSPI" || market === "KOSDAQ",
    );
  return markets.length ? [...new Set(markets)] : DEFAULT_MARKETS;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const markets = parseMarkets(url.searchParams.get("markets"));
  const top = Number(url.searchParams.get("top") ?? 6);
  const days = Number(url.searchParams.get("days") ?? 430);

  const reports = await Promise.all(
    markets.map(async (market) => {
      const symbols = LEADER_UNIVERSES[market].map((item) => item.symbol).join(",");
      const response = await scanLeaders(
        new Request(
          `http://stockanalysis.internal/api/market/leaders?market=${market}&top=${top}&days=${days}&symbols=${encodeURIComponent(symbols)}`,
        ),
        { userContext: getRequestUserContext(request) },
      );
      if (!response.ok) {
        throw new Error(`${market} briefing failed with ${response.status}`);
      }
      return buildMarketReport((await response.json()) as LeaderResponse);
    }),
  );

  return Response.json({
    generatedAt: new Date().toISOString(),
    markets,
    sourceFrame: {
      style: "theme-leadership-report",
      rules: [
        "시장별 5일 강도와 50일 상대강도 상위 종목을 먼저 확인합니다.",
        "같은 테마에서 강한 종목이 여럿이면 오늘의 주도테마로 봅니다.",
        "신규 진입은 현재가 추격이 아니라 5일선 또는 20일선 지지 구간 기준으로 판단합니다.",
      ],
    },
    reports,
  });
}
