import { createOrderIntent } from "@/use-cases/trading/create-order-intent";
import { hasAutomationFeature } from "@/lib/automation/store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type DraftPayload = {
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  limitPrice?: unknown;
  rationale?: unknown;
};

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "order-intent-draft", { limit: 20, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const allowed = await hasAutomationFeature(auth.userContext.userId, "automation_beta");
  if (!allowed) {
    return Response.json({ error: "자동매매 베타 권한이 필요합니다." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as DraftPayload;
  const symbol = typeof payload.symbol === "string" ? payload.symbol : "";
  const side = payload.side === "sell" ? "sell" : "buy";
  const quantity = Number(payload.quantity);
  const limitPrice = Number(payload.limitPrice);
  if (!symbol.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    return Response.json({ error: "symbol, quantity, limitPrice가 필요합니다." }, { status: 400 });
  }

  const rationale = Array.isArray(payload.rationale)
    ? payload.rationale.filter((item): item is string => typeof item === "string")
    : ["설정형 자동매매 모의 주문의도"];
  const result = createOrderIntent({
    userId: auth.userContext.userId,
    symbol,
    side,
    type: "limit",
    quantity,
    limitPrice,
    currency: "USD",
    rationale,
  });

  return Response.json({
    intent: result.intent,
    riskCheck: result.riskCheck,
    liveTradingEnabled: false,
  });
}
