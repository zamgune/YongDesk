import { buildDailyMarketBriefing } from "@/use-cases/briefing/build-daily-market-briefing";
import { getRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  return Response.json(await buildDailyMarketBriefing(request, {
    userContext: getRequestUserContext(request),
  }));
}
