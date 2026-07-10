import type { PaperAccount, PaperPosition, PaperTradingRunSource, PaperTradingSession } from "@/domain/paper-trading";
import {
  applyPaperTradingRunResult,
  getPaperTradingStorageRootForUser,
  readPaperTradingState,
  writePaperTradingRunSnapshot,
  writePaperTradingState,
} from "@/lib/paper-trading/state-store";
import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { buildPaperTradingCandidates } from "@/use-cases/trading/build-paper-trading-candidates";
import {
  PAPER_STRATEGY_VERSION,
  runPaperTradingDaily,
  type RunPaperTradingDailyResult,
} from "@/use-cases/trading/run-paper-trading-daily";

type PaperRunRequest = {
  session?: PaperTradingSession;
  source?: PaperTradingRunSource;
};

const isPaperSession = (value: unknown): value is PaperTradingSession =>
  value === "US" || value === "KR";

const isPaperRunSource = (value: unknown): value is PaperTradingRunSource =>
  value === "manual" || value === "script" || value === "codex-automation";

const createScanFailureResult = ({
  session,
  source,
  account,
  positions,
  today,
  error,
}: {
  session: PaperTradingSession;
  source: PaperTradingRunSource;
  account: PaperAccount | null;
  positions: PaperPosition[];
  today?: string;
  error: unknown;
}): RunPaperTradingDailyResult => {
  const now = new Date().toISOString();
  const result = runPaperTradingDaily({
    session,
    account,
    positions,
    entryCandidates: [],
    today,
    now,
    source,
  });
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...result,
    run: {
      ...result.run,
      summary: `${session} 후보 스캔 실패: 주문 없이 로그만 저장했습니다.`,
    },
    logs: [
      {
        id: `paper-log-${crypto.randomUUID()}`,
        runId: result.run.id,
        session,
        source,
        level: "error",
        message: `후보 스캔 실패로 페이퍼 주문을 만들지 않았습니다. ${message}`,
        strategyVersion: PAPER_STRATEGY_VERSION,
        createdAt: now,
      },
      ...result.logs,
    ],
  };
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as PaperRunRequest;
  const session = isPaperSession(payload.session) ? payload.session : "US";
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userContext = auth.userContext;
  const source = isPaperRunSource(payload.source) ? payload.source : "manual";
  const storageRoot = getPaperTradingStorageRootForUser(userContext.userId);
  const { state } = await readPaperTradingState(storageRoot);
  const account = state.accounts[session] ?? null;
  const positions = state.positions.filter((position) => position.session === session);
  const today = new Date().toISOString().slice(0, 10);
  let result: RunPaperTradingDailyResult;
  try {
    const entryCandidates = await buildPaperTradingCandidates(session, {
      userContext,
    });
    result = runPaperTradingDaily({
      session,
      account,
      positions,
      entryCandidates,
      today,
      source,
    });
  } catch (error) {
    result = createScanFailureResult({
      session,
      source,
      account,
      positions,
      today,
      error,
    });
  }
  const nextState = applyPaperTradingRunResult(state, session, result);
  await writePaperTradingState(nextState, storageRoot);
  await writePaperTradingRunSnapshot(result, storageRoot);

  return Response.json({
    ...result,
    state: nextState,
  });
}
