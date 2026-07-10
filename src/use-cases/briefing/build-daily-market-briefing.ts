import {
  buildMarketReport,
  getDailyBriefingMarkets,
  getDailyBriefingSessionLabel,
  getSessionSchedule,
  parseDailyBriefingSession,
  type LeaderResponse,
} from "@/lib/market/market-briefing-report";
import { buildExtendedSessionReport } from "@/lib/market/extended-session";
import { getMarketDataProvider } from "@/lib/market-data";
import { GET as getAutoLeaders } from "@/app/api/market/auto-leaders/route";
import type { UserContext } from "@/domain/user";

const marketData = getMarketDataProvider();

export async function buildDailyMarketBriefing(
  request: Request,
  options?: { userContext?: UserContext },
) {
  void options;
  const url = new URL(request.url);
  const session = parseDailyBriefingSession(url.searchParams.get("session"));
  const force = url.searchParams.get("force") === "1" ? "1" : "0";
  const markets = getDailyBriefingMarkets(session);
  const schedule = getSessionSchedule(session);
  // HTTP self-fetch 대신 라우트 핸들러 직접 호출 — INTERNAL_APP_ORIGIN·배포 보호 벽·이중 함수 호출 제거
  const reports = await Promise.all(
    markets.map(async (market) => {
      const response = await getAutoLeaders(
        new Request(`http://stockanalysis.internal/api/market/auto-leaders?market=${market}&limit=50&force=${force}`),
      );
      if (!response.ok) {
        throw new Error(`${market} daily briefing failed with ${response.status}`);
      }
      return buildMarketReport((await response.json()) as LeaderResponse);
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    session,
    sessionLabel: getDailyBriefingSessionLabel(session),
    markets,
    tradingDate: schedule.tradingDate,
    nextRefreshAt: schedule.nextRefreshAt,
    scanStatus: schedule.status,
    sourceFrame: {
      style: "daily-market-auto-scan-report",
      rules: [
        "시장별 자동 후보 50개를 기준으로 주도테마와 대장주를 선별합니다.",
        "신규 진입은 현재가 추격이 아니라 5일선 또는 20일선 지지 구간 기준으로 판단합니다.",
        "다음 분석 시각 전에는 직전 거래일 스냅샷을 우선 참고합니다.",
      ],
    },
    reports,
    extendedSession: session === "US"
      ? await buildUsExtendedSession(reports)
      : undefined,
  };
}

const buildUsExtendedSession = async (
  reports: Array<ReturnType<typeof buildMarketReport>>,
) => {
  const candidates = reports
    .flatMap((report) => report.strongestStocks.slice(0, 8))
    .filter((candidate, index, all) =>
      all.findIndex((item) => item.symbol === candidate.symbol) === index,
    );

  if (!candidates.length) {
    return buildExtendedSessionReport([], []);
  }

  const quotes = await marketData.getExtendedQuotes(candidates.map((candidate) => candidate.symbol));
  return buildExtendedSessionReport(candidates, quotes);
};
