import { getLiveTradingGate } from "@/lib/automation/live-trading";
import { grantAutomationFeature, hasAutomationFeature, revokeAutomationFeature } from "@/lib/automation/store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type LiveTradingPayload = {
  enabled?: unknown;
};

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "live-trading-toggle", { limit: 10, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const userId = auth.userContext.userId;
  const automationBeta = await hasAutomationFeature(userId, "automation_beta").catch(() => null);
  if (automationBeta === null) {
    return Response.json({ error: "자동매매 권한 저장소를 확인할 수 없습니다." }, { status: 503 });
  }
  if (!automationBeta) {
    return Response.json({ error: "자동매매 베타 권한이 필요합니다." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as LiveTradingPayload;
  const enabled = payload.enabled === true;
  if (enabled) {
    const gate = await getLiveTradingGate(userId, true);
    if (!gate.effective) {
      return Response.json({
        error: gate.reason,
        liveTrading: false,
        liveTradingMasterEnabled: gate.masterEnabled,
        liveTradingEffective: false,
      }, { status: gate.status });
    }
  }

  if (enabled) {
    await grantAutomationFeature(userId, "live_trading");
  } else {
    await revokeAutomationFeature(userId, "live_trading");
  }

  const gate = await getLiveTradingGate(userId, enabled);
  return Response.json({
    liveTrading: enabled,
    liveTradingMasterEnabled: gate.masterEnabled,
    liveTradingEffective: gate.effective,
    liveTradingBlockedReason: gate.reason,
  });
}
