import { simulateAutomationStrategy, toAutomationLastSimulation } from "@/lib/automation/simulation";
import { findStrategyConfig, hasAutomationFeature, saveAutomationSimulation, upsertStrategyConfig } from "@/lib/automation/store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const limited = checkRateLimit(request, "strategy-simulate", { limit: 20, windowMs: 60_000 });
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

  const { id } = await context.params;
  const config = await findStrategyConfig(auth.userContext.userId, id);
  if (!config) {
    return Response.json({ error: "전략을 찾을 수 없습니다." }, { status: 404 });
  }

  const result = simulateAutomationStrategy({
    userId: auth.userContext.userId,
    config,
  });
  await saveAutomationSimulation(auth.userContext.userId, result);
  const configPatch = {
    ...config,
    lastSimulation: toAutomationLastSimulation(result),
  };
  await upsertStrategyConfig(auth.userContext.userId, {
    ...configPatch,
  });
  return Response.json({ result });
}
