import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { hasAutomationFeature, listStrategyConfigs, findStrategyConfig } from "@/lib/automation/store";
import { getLiveTradingGate } from "@/lib/automation/live-trading";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import { createTossBroker } from "@/adapters/toss/toss-broker";
import { runAutomationWorkerTick } from "@/use-cases/trading/run-automation-worker";
import { recordSubmittedOrder } from "@/lib/automation/order-tracker";
import { createOrderPrecheck } from "@/use-cases/trading/precheck-order";

type TickPayload = {
  strategyId?: unknown;
  accountSeq?: unknown;
};

/** Asia/Seoul 기준 YYYY-MM-DD (영업일 카운트 리셋 기준) */
const seoulToday = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "automation-worker-tick", { limit: 30, windowMs: 60_000 });
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

  // 실거래 게이트: 권한, 서버 킬스위치, 영속 저장소, 암호화 키, 검증된 자격증명까지 모두 필요.
  const liveTradingGate = await getLiveTradingGate(userId);
  const liveTradingEnabled = liveTradingGate.effective;

  const payload = (await request.json().catch(() => ({}))) as TickPayload;
  const strategyId = typeof payload.strategyId === "string" ? payload.strategyId : null;

  // 대상 전략 로드 (특정 전략 또는 활성 전체)
  const configs = strategyId
    ? [await findStrategyConfig(userId, strategyId)].filter((c): c is NonNullable<typeof c> => c !== null)
    : (await listStrategyConfigs(userId)).filter((c) => c.status === "enabled");
  if (configs.length === 0) {
    return Response.json({ error: "실행할 활성 전략이 없습니다." }, { status: 404 });
  }
  if (configs.some((config) => config.status !== "enabled")) {
    return Response.json({ error: "활성화된 전략만 워커 실행 대상입니다." }, { status: 409 });
  }

  // 자격증명 복호화 → 토스 클라이언트
  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ error: "등록된 토스 자격증명이 없습니다." }, { status: 412 });
  }
  const client = createTossClient(credentials);

  // accountSeq 결정: body 우선, 없으면 첫 BROKERAGE 계좌
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

  const broker = createTossBroker({ client, liveTradingEnabled });
  const precheck = createOrderPrecheck({
    accountSeq,
    getBuyingPower: (seq, currency) => client.getBuyingPower(seq, currency),
    getSellableQuantity: (seq, symbol) => client.getSellableQuantity(seq, symbol),
  });
  const today = seoulToday();

  // 심볼별 현재가 일괄 조회 (최대 200개)
  const symbols = [...new Set(configs.map((c) => c.symbol.trim().toUpperCase()))];
  let priceBySymbol = new Map<string, number>();
  try {
    const prices = await client.getPrices(symbols);
    priceBySymbol = new Map(prices.map((p) => [p.symbol.toUpperCase(), Number(p.lastPrice)]));
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "현재가 조회 실패"), { status: 502 });
    }
    return Response.json({ error: "현재가 조회 중 오류가 발생했습니다." }, { status: 502 });
  }

  const results = [];
  for (const config of configs) {
    const marketPrice = priceBySymbol.get(config.symbol.trim().toUpperCase());
    if (marketPrice === undefined || !Number.isFinite(marketPrice)) {
      results.push({
        strategyId: config.id,
        symbol: config.symbol,
        error: "현재가를 확인할 수 없습니다.",
      });
      continue;
    }
    const tick = await runAutomationWorkerTick({
      userId,
      config,
      marketPrice,
      broker,
      liveTradingEnabled,
      accountSeq,
      today,
      precheck,
      resolveExitQuantity: async (symbol) => {
        const res = await client.getSellableQuantity(accountSeq, symbol);
        const qty = Number(res.sellableQuantity);
        return Number.isFinite(qty) ? qty : 0;
      },
      resolveEntryPrice: async (symbol) => {
        const holdings = await client.getHoldings(accountSeq, symbol);
        const item = holdings.items.find((h) => h.symbol.toUpperCase() === symbol);
        const avg = item ? Number(item.averagePurchasePrice) : NaN;
        return Number.isFinite(avg) ? avg : null;
      },
      resolveOpenOrderIds: async (symbol) => {
        const open = await client.getOpenOrders(accountSeq, symbol);
        return open.orders.map((o) => o.orderId);
      },
    });
    // 실제 전송된 주문만 체결 동기화 대상으로 추적 원장에 적재
    for (const order of tick.orders) {
      if (order.status === "submitted" && order.brokerOrderId) {
        await recordSubmittedOrder({
          userId,
          brokerOrderId: order.brokerOrderId,
          clientOrderId: order.clientOrderId,
          accountSeq,
          strategyId: config.id,
          stepId: order.stepId,
          symbol: config.symbol.trim().toUpperCase(),
          side: order.side,
          quantity: order.quantity,
          limitPrice: order.limitPrice,
          submittedAt: tick.evaluatedAt,
        });
      }
    }
    results.push(tick);
  }

  return Response.json({
    liveTradingEnabled,
    liveTradingBlockedReason: liveTradingGate.reason,
    accountSeq,
    today,
    results,
  });
}
