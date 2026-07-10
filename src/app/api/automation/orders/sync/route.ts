import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { hasAutomationFeature } from "@/lib/automation/store";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import {
  applySyncUpdates,
  listOpenTrackedOrders,
  listTrackedOrders,
  listFills,
} from "@/lib/automation/order-tracker";
import { syncOrderFills } from "@/use-cases/trading/sync-order-fills";

type SyncPayload = { accountSeq?: unknown };

/** 추적 주문의 체결/상태를 토스에서 동기화합니다. (조회+갱신, 신규 주문 전송 없음) */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "automation-orders-sync", { limit: 30, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userId = auth.userContext.userId;
  if (!(await hasAutomationFeature(userId, "automation_beta"))) {
    return Response.json({ error: "자동매매 베타 권한이 필요합니다." }, { status: 403 });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ error: "등록된 토스 자격증명이 없습니다." }, { status: 412 });
  }
  const client = createTossClient(credentials);

  const payload = (await request.json().catch(() => ({}))) as SyncPayload;
  let accountSeq: number;
  try {
    if (typeof payload.accountSeq === "number") {
      accountSeq = payload.accountSeq;
    } else {
      const accounts = await client.listAccounts();
      const brokerage = accounts.find((a) => a.accountType === "BROKERAGE") ?? accounts[0];
      if (!brokerage) {
        return Response.json({ error: "사용 가능한 계좌가 없습니다." }, { status: 412 });
      }
      accountSeq = brokerage.accountSeq;
    }
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "계좌 조회 실패"), { status: 502 });
    }
    return Response.json({ error: "계좌 조회 중 오류가 발생했습니다." }, { status: 502 });
  }

  const trackedOrders = await listOpenTrackedOrders(userId, accountSeq);
  const result = await syncOrderFills({
    userId,
    accountSeq,
    trackedOrders,
    fetcher: {
      getOpenOrders: (seq, symbol) => client.getOpenOrders(seq, symbol),
      getOrder: (seq, orderId) => client.getOrder(seq, orderId),
    },
  });

  await applySyncUpdates({ orderUpdates: result.orderUpdates, newFills: result.newFills });

  return Response.json({
    accountSeq,
    synced: trackedOrders.length,
    updates: result.orderUpdates.length,
    newFills: result.newFills.length,
    logs: result.logs,
    orders: await listTrackedOrders(userId),
    fills: (await listFills(userId)).slice(0, 50),
  });
}

/** 추적 주문/체결 현황 조회 (동기화 없이) */
export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userId = auth.userContext.userId;
  return Response.json({
    orders: await listTrackedOrders(userId),
    fills: (await listFills(userId)).slice(0, 50),
  });
}
