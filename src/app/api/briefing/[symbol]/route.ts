import {
  buildChartBriefing,
  type BriefingMarketData,
} from "@/lib/market/briefing";
import { analyzeSymbol } from "@/use-cases/market/analyze-symbol";
import { getRequestUserContext } from "@/use-cases/security/request-context";

const normalizeSymbol = (rawSymbol: string, market: string) => {
  const trimmed = rawSymbol.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  if (market === "CRYPTO") {
    return /-USD$/i.test(trimmed) ? trimmed : `${trimmed}-USD`;
  }
  if (market === "US" || /\.(KS|KQ)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.${market === "KOSPI" ? "KS" : "KQ"}`;
};

export async function GET(
  request: Request,
  context?: { params?: { symbol?: string } | Promise<{ symbol?: string }> },
) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const symbolFromPath = pathParts[pathParts.length - 1] ?? "";
  const resolvedParams = context?.params ? await context.params : undefined;
  const rawSymbol =
    (typeof resolvedParams?.symbol === "string" && resolvedParams.symbol) ||
    symbolFromPath;
  const market = (url.searchParams.get("market") ?? "US").toUpperCase();
  const days = url.searchParams.get("days") ?? "365";
  const timeframe = url.searchParams.get("tf") ?? "1d";
  const name = url.searchParams.get("name") ?? undefined;
  const symbol = normalizeSymbol(decodeURIComponent(rawSymbol), market);

  if (!symbol) {
    return Response.json({ error: "Symbol is required." }, { status: 400 });
  }

  const marketResponse = await analyzeSymbol(
    new Request(
      `http://stockanalysis.internal/api/market/${encodeURIComponent(symbol)}?days=${encodeURIComponent(days)}&tf=${encodeURIComponent(timeframe)}`,
    ),
    { params: { symbol } },
    { userContext: getRequestUserContext(request) },
  );

  if (!marketResponse.ok) {
    return Response.json(
      { error: "Market data failed.", status: marketResponse.status },
      { status: 502 },
    );
  }

  const data = (await marketResponse.json()) as BriefingMarketData;
  const row = {
    symbol,
    normalizedSymbol: symbol,
    market,
    name,
    data,
  };
  const briefing = buildChartBriefing(row);

  return Response.json({
    symbol,
    market,
    name,
    generatedAt: new Date().toISOString(),
    sourceFrame: {
      style: "daily-report-inspired",
      rules: [
        "현재가와 5일선/20일선 거리로 추격 여부를 판단합니다.",
        "20일선 지지 여부를 주도주/관찰 후보의 핵심 기준으로 사용합니다.",
        "20일선 종가 이탈과 최근 저점 이탈을 손절 기준으로 제시합니다.",
      ],
    },
    briefing,
  });
}
