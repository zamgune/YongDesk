import { parseStrategyConfigPayload } from "@/lib/automation/http";
import { getStrategyConfigHash, validateStrategyConfig } from "@/lib/automation/simulation";
import {
  deleteStrategyConfig,
  findStrategyConfig,
  hasAutomationFeature,
  listStrategyConfigs,
  upsertStrategyConfig,
} from "@/lib/automation/store";
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

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const findActivationBlocker = async (
  userId: string,
  config: ReturnType<typeof parseStrategyConfigPayload>,
) => {
  const currentHash = getStrategyConfigHash(config);
  const simulation = config.lastSimulation;
  if (!simulation) {
    return {
      status: 428,
      error: "전략을 활성화하려면 먼저 시뮬레이션을 실행하세요.",
    };
  }
  if (simulation.configHash !== currentHash) {
    return {
      status: 409,
      error: "전략 설정이 마지막 시뮬레이션 이후 변경되었습니다. 다시 시뮬레이션하세요.",
    };
  }
  if (!simulation.passed) {
    return {
      status: 428,
      error: simulation.blockers[0] ?? "시뮬레이션이 통과되지 않아 전략을 활성화할 수 없습니다.",
      errors: simulation.blockers,
    };
  }

  const configs = await listStrategyConfigs(userId);
  const duplicate = configs.find(
    (entry) =>
      entry.id !== config.id &&
      entry.status === "enabled" &&
      entry.market === config.market &&
      normalizeSymbol(entry.symbol) === normalizeSymbol(config.symbol),
  );
  if (duplicate) {
    return {
      status: 409,
      error: `이미 활성화된 동일 종목 전략이 있습니다: ${duplicate.name}`,
    };
  }
  return null;
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const limited = checkRateLimit(request, "strategy-configs-write", { limit: 30, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireAutomationBeta(request);
  if (auth instanceof Response) {
    return auth;
  }
  const { id } = await context.params;
  const existing = await findStrategyConfig(auth.userContext.userId, id);
  if (!existing) {
    return Response.json({ error: "전략을 찾을 수 없습니다." }, { status: 404 });
  }
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const existingHash = getStrategyConfigHash(existing);
  const parsed = parseStrategyConfigPayload({ ...existing, ...payload, id }, auth.userContext.userId, id);
  const changedTradingConfig = getStrategyConfigHash(parsed) !== existingHash;
  const nextConfig = changedTradingConfig
    ? {
      ...parsed,
      status: payload.status === "enabled" ? "enabled" as const : payload.status === "disabled" ? "disabled" as const : "draft" as const,
      lastSimulation: undefined,
    }
    : parsed;
  const errors = validateStrategyConfig(nextConfig);
  if (errors.length) {
    return Response.json({ error: errors.join(" "), errors }, { status: 400 });
  }
  if (nextConfig.status === "enabled") {
    const blocker = await findActivationBlocker(auth.userContext.userId, nextConfig);
    if (blocker) {
      return Response.json(blocker, { status: blocker.status });
    }
  }

  const config = await upsertStrategyConfig(auth.userContext.userId, nextConfig);
  return Response.json({ config });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAutomationBeta(request);
  if (auth instanceof Response) {
    return auth;
  }
  const { id } = await context.params;
  await deleteStrategyConfig(auth.userContext.userId, id);
  return Response.json({ ok: true });
}
