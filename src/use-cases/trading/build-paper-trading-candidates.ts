import type { UserContext } from "@/domain/user";
import {
  buildMarketReport,
  getDailyBriefingMarkets,
  type DailyBriefingSession,
  type LeaderResponse,
} from "@/lib/market/market-briefing-report";
import { scanLeaders } from "@/use-cases/market/scan-leaders";
import type { PaperTradingCandidate } from "./run-paper-trading-daily.ts";

const getScanUrl = (market: string) =>
  `http://paper-trading.local/api/market/leaders?market=${market}&top=4&days=430`;

export const buildPaperTradingCandidates = async (
  session: DailyBriefingSession,
  options?: { userContext?: UserContext },
): Promise<PaperTradingCandidate[]> => {
  const markets = getDailyBriefingMarkets(session);
  const reports = await Promise.all(
    markets.map(async (market) => {
      const response = await scanLeaders(new Request(getScanUrl(market)), {
        userContext: options?.userContext,
      });
      if (!response.ok) {
        throw new Error(`${market} paper candidate scan failed with ${response.status}`);
      }
      return buildMarketReport((await response.json()) as LeaderResponse);
    }),
  );

  return reports.flatMap((report) =>
    report.entryCandidates.map((candidate) => ({
      ...candidate,
      market: report.market,
    })),
  );
};
