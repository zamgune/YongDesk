import { parseStrategyConfigPayload } from "@/lib/automation/http";
import { getStrategyConfigHash, validateStrategyConfig } from "@/lib/automation/simulation";
import { hasAutomationFeature, listStrategyConfigs, upsertStrategyConfig } from "@/lib/automation/store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

const requireAutomationBeta = async (request: Request) => {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const allowed = await hasAutomationFeature(auth.userContext.userId, "automation_beta");
  if (!allowed) {
    return Response.json({ error: "자동매매 베타 권한이 필요합니다." }, { status: 403 });
  }
  return auth;
};

export async function GET(request: Request) {
  const limited = checkRateLimit(request, "strategy-configs-read", { limit: 60, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireAutomationBeta(request);
  if (auth instanceof Response) {
    return auth;
  }

  const configs = await listStrategyConfigs(auth.userContext.userId);
  return Response.json({
    configs: configs.map((config) => ({
      ...config,
      currentConfigHash: getStrategyConfigHash(config),
    })),
  });
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "strategy-configs-write", { limit: 30, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireAutomationBeta(request);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = {
    ...parseStrategyConfigPayload(payload, auth.userContext.userId),
    status: "draft" as const,
    lastSimulation: undefined,
  };
  const errors = validateStrategyConfig(parsed);
  if (errors.length) {
    return Response.json({ error: errors.join(" "), errors }, { status: 400 });
  }

  const config = await upsertStrategyConfig(auth.userContext.userId, parsed);
  return Response.json({ config }, { status: 201 });
}
