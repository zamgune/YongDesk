import { listAutomationOwners } from "@/lib/automation/store";
import { runUserAutomationCycle } from "@/use-cases/trading/run-automation-cycle";

/**
 * 스케줄러 진입점. 활성 전략 보유자 전원에 대해 자동매매 1사이클(틱+동기화)을
 * 실행합니다. Vercel Cron 또는 외부 스케줄러가 주기 호출하도록 설계했습니다.
 *
 * 인증: `CRON_SECRET` 환경변수와 `Authorization: Bearer <CRON_SECRET>` 헤더를
 * 비교합니다. (Vercel Cron 은 이 헤더를 자동 첨부)
 */

const isAuthorized = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false; // 시크릿 미설정 시 비활성 (사고 방지)
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
};

const handle = async (request: Request) => {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const owners = await listAutomationOwners();
  const startedAt = new Date().toISOString();
  const results = [];
  for (const userId of owners) {
    results.push(await runUserAutomationCycle(userId));
  }
  return Response.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    owners: owners.length,
    ran: results.filter((r) => r.status === "ran").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
};

export const GET = handle;
export const POST = handle;
