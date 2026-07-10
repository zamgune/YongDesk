import type { PaperTradingRunSource, PaperTradingSession } from "../src/domain/paper-trading.ts";
import {
  applyPaperTradingRunResult,
  readPaperTradingState,
  writePaperTradingRunSnapshot,
  writePaperTradingState,
} from "../src/lib/paper-trading/state-store.ts";
import { buildPaperTradingCandidates } from "../src/use-cases/trading/build-paper-trading-candidates.ts";
import {
  PAPER_STRATEGY_VERSION,
  runPaperTradingDaily,
  type RunPaperTradingDailyResult,
} from "../src/use-cases/trading/run-paper-trading-daily.ts";

type RunSession = PaperTradingSession | "ALL";

const isPaperSession = (value: string): value is PaperTradingSession =>
  value === "KR" || value === "US";

const isRunSession = (value: string): value is RunSession =>
  value === "ALL" || isPaperSession(value);

const isRunSource = (value: string): value is PaperTradingRunSource =>
  value === "manual" || value === "script" || value === "codex-automation";

const getArgValue = (name: string) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const createScanFailureResult = ({
  session,
  error,
  state,
  today,
  source,
}: {
  session: PaperTradingSession;
  error: unknown;
  state: Awaited<ReturnType<typeof readPaperTradingState>>["state"];
  today: string;
  source: PaperTradingRunSource;
}): RunPaperTradingDailyResult => {
  const now = new Date().toISOString();
  const result = runPaperTradingDaily({
    session,
    account: state.accounts[session],
    positions: state.positions.filter((position) => position.session === session),
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

const runSession = async (
  session: PaperTradingSession,
  source: PaperTradingRunSource,
) => {
  const today = getTodayKey();
  const readResult = await readPaperTradingState();
  const { state, storagePath } = readResult;
  let result: RunPaperTradingDailyResult;
  try {
    const entryCandidates = await buildPaperTradingCandidates(session);
    result = runPaperTradingDaily({
      session,
      account: state.accounts[session],
      positions: state.positions.filter((position) => position.session === session),
      entryCandidates,
      today,
      source,
    });
  } catch (error) {
    result = createScanFailureResult({
      session,
      error,
      state,
      today,
      source,
    });
  }

  const nextState = applyPaperTradingRunResult(state, session, result);
  await writePaperTradingState(nextState);
  const snapshotPath = await writePaperTradingRunSnapshot(result);
  const excluded = result.logs.filter((log) =>
    /제외|체결하지|실패|부족|제한/.test(log.message),
  ).length;

  return {
    session,
    storagePath,
    snapshotPath,
    summary: result.run.summary,
    ordersCount: result.orders.length,
    executionsCount: result.executions.length,
    probeCount: result.run.probeCount,
    excluded,
  };
};

const main = async () => {
  const rawSession = getArgValue("session") ?? "ALL";
  const rawSource = getArgValue("source") ?? process.env.PAPER_TRADING_RUN_SOURCE ?? "script";
  if (!isRunSession(rawSession)) {
    throw new Error("--session은 KR, US, ALL 중 하나여야 합니다.");
  }
  if (!isRunSource(rawSource)) {
    throw new Error("--source는 manual, script, codex-automation 중 하나여야 합니다.");
  }

  const sessions: PaperTradingSession[] = rawSession === "ALL" ? ["KR", "US"] : [rawSession];
  const results = [];
  for (const session of sessions) {
    results.push(await runSession(session, rawSource));
  }

  console.log(JSON.stringify({
    strategyVersion: PAPER_STRATEGY_VERSION,
    source: rawSource,
    results,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
