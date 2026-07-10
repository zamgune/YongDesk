import { createTossBroker, LiveTradingDisabledError } from "@/adapters/toss/toss-broker";
import { getLiveTradingGate } from "@/lib/automation/live-trading";
import {
  markOrderPreviewSubmitted,
  recordSubmittedOrder,
  verifyOrderPreview,
} from "@/lib/automation/order-tracker";
import { hasAutomationFeature } from "@/lib/automation/store";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import type { TossCurrency } from "@/lib/toss/types";
import { createOrderIntent } from "@/use-cases/trading/create-order-intent";
import { createOrderPrecheck, inferCurrency } from "@/use-cases/trading/precheck-order";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type ManualOrderPayload = {
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  orderType?: unknown;
  currency?: unknown;
  accountSeq?: unknown;
  previewId?: unknown;
};

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "manual-chart-order", { limit: 10, windowMs: 60_000 });
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

  const payload = (await request.json().catch(() => ({}))) as ManualOrderPayload;
  const symbol = typeof payload.symbol === "string" ? payload.symbol.trim().toUpperCase() : "";
  const side = payload.side === "sell" ? "sell" : "buy";
  const orderType = payload.orderType === "market" ? "market" : "limit";
  const quantity = Number(payload.quantity);
  const price = Number(payload.price);
  const previewId = typeof payload.previewId === "string" ? payload.previewId.trim() : "";
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    return Response.json({ error: "symbol, quantity, price가 필요합니다." }, { status: 400 });
  }
  if (!previewId) {
    return Response.json({ error: "주문 제출 전 미리보기를 먼저 실행하세요." }, { status: 428 });
  }

  const liveTradingGate = await getLiveTradingGate(userId);
  if (!liveTradingGate.effective) {
    return Response.json({
      error: liveTradingGate.reason,
      liveTradingEnabled: false,
    }, { status: liveTradingGate.status });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ error: "등록된 토스 자격증명이 없습니다." }, { status: 412 });
  }

  const currency: TossCurrency =
    payload.currency === "KRW" || payload.currency === "USD" ? payload.currency : inferCurrency(symbol);
  const intentResult = createOrderIntent({
    userId,
    symbol,
    side,
    type: orderType,
    quantity,
    limitPrice: orderType === "limit" ? price : null,
    currency,
    rationale: ["차트 매매 화면 수동 주문"],
    riskPolicy: {
      allowLiveTrading: true,
      maxOrderValue: null,
      maxPositionValue: null,
    },
  });
  if (!intentResult.riskCheck.passed) {
    return Response.json({ intent: intentResult.intent, riskCheck: intentResult.riskCheck }, { status: 422 });
  }

  const client = createTossClient(credentials);
  try {
    let accountSeq = typeof payload.accountSeq === "number" ? payload.accountSeq : null;
    if (accountSeq === null) {
      const accounts = await client.listAccounts();
      const account = accounts.find((a) => a.accountType === "BROKERAGE") ?? accounts[0];
      if (!account) {
        return Response.json({ error: "사용 가능한 계좌가 없습니다." }, { status: 412 });
      }
      accountSeq = account.accountSeq;
    }

    const previewCheck = await verifyOrderPreview({
      userId,
      previewId,
      input: {
        accountSeq,
        symbol,
        side,
        orderType,
        quantity,
        price,
        currency,
      },
    });
    if (!previewCheck.ok) {
      return Response.json({
        error: previewCheck.reason,
        preview: previewCheck.preview,
      }, { status: previewCheck.status });
    }

    const precheck = createOrderPrecheck({
      accountSeq,
      getBuyingPower: (seq, cur) => client.getBuyingPower(seq, cur),
      getSellableQuantity: (seq, sym) => client.getSellableQuantity(seq, sym),
    });
    const precheckResult = await precheck({ side, symbol, quantity, price, currency });
    if (!precheckResult.ok) {
      return Response.json({ intent: intentResult.intent, precheck: precheckResult }, { status: 422 });
    }

    const liveTradingEnabled = liveTradingGate.effective;
    const broker = createTossBroker({ client, liveTradingEnabled });
    const clientOrderId = previewCheck.preview.clientOrderId;
    const order = await broker.submitOrder({
      orderIntentId: intentResult.intent.id,
      accountSeq,
      symbol,
      side,
      type: orderType,
      quantity,
      limitPrice: orderType === "limit" ? price : null,
      stopPrice: null,
      clientOrderId,
    });
    await recordSubmittedOrder({
      userId,
      brokerOrderId: order.brokerOrderId,
      clientOrderId,
      accountSeq,
      strategyId: "manual-chart",
      stepId: "manual",
      symbol,
      side,
      quantity,
      limitPrice: orderType === "limit" ? price : null,
      submittedAt: order.submittedAt,
    });
    await markOrderPreviewSubmitted(userId, previewId, order.submittedAt);
    return Response.json({ intent: intentResult.intent, precheck: precheckResult, order, liveTradingEnabled });
  } catch (error) {
    if (error instanceof LiveTradingDisabledError) {
      return Response.json({
        intent: intentResult.intent,
        liveTradingEnabled: false,
        error: error.message,
      }, { status: 423 });
    }
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "토스 주문 실패"), { status: 502 });
    }
    return Response.json({ error: "수동 주문 처리 중 오류가 발생했습니다." }, { status: 502 });
  }
}
