import { getLiveTradingGate } from "@/lib/automation/live-trading";
import { listAutomationFeatures } from "@/lib/automation/store";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const features = await listAutomationFeatures(auth.userContext.userId).catch(() => null);
  if (features === null) {
    return Response.json({ error: "자동매매 권한 저장소를 확인할 수 없습니다." }, { status: 503 });
  }
  const liveTradingGate = await getLiveTradingGate(auth.userContext.userId, features.includes("live_trading"));
  return Response.json({
    features,
    automationBeta: features.includes("automation_beta"),
    brokerCredentials: features.includes("broker_credentials"),
    liveTrading: features.includes("live_trading"),
    liveTradingMasterEnabled: liveTradingGate.masterEnabled,
    liveTradingEffective: liveTradingGate.effective,
    liveTradingBlockedReason: liveTradingGate.reason,
  });
}
