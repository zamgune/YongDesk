import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { getLiveTradingGate } from "@/lib/automation/live-trading";
import { recordOrderPreview } from "@/lib/automation/order-tracker";
import { hasAutomationFeature } from "@/lib/automation/store";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import { createOrderIntent } from "@/use-cases/trading/create-order-intent";
import { createOrderPrecheck, inferCurrency } from "@/use-cases/trading/precheck-order";
import type { TossCurrency } from "@/lib/toss/types";

type PrecheckPayload = {
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  currency?: unknown;
  accountSeq?: unknown;
};

/** 주문 전 잔고·매도가능수량 사전검증 (UI 미리보기용. 주문 전송 없음). */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "automation-orders-precheck", { limit: 30, windowMs: 60_000 });
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

  const payload = (await request.json().catch(() => ({}))) as PrecheckPayload;
  const symbol = typeof payload.symbol === "string" ? payload.symbol.trim().toUpperCase() : "";
  const side = payload.side === "sell" ? "sell" : "buy";
  const quantity = Number(payload.quantity);
  const price = Number(payload.price);
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
    return Response.json({ error: "symbol, quantity, price가 필요합니다." }, { status: 400 });
  }
  const currency: TossCurrency =
    payload.currency === "KRW" || payload.currency === "USD" ? payload.currency : inferCurrency(symbol);

  const liveTradingGate = await getLiveTradingGate(userId);
  const intentResult = createOrderIntent({
    userId,
    symbol,
    side,
    type: "limit",
    quantity,
    limitPrice: price,
    currency,
    rationale: ["차트 매매 화면 주문 미리보기"],
    riskPolicy: {
      allowLiveTrading: true,
      maxOrderValue: null,
      maxPositionValue: null,
    },
  });

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ error: "등록된 토스 자격증명이 없습니다." }, { status: 412 });
  }
  const client = createTossClient(credentials);

  try {
    let accountSeq: number;
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

    const precheck = createOrderPrecheck({
      accountSeq,
      getBuyingPower: (seq, cur) => client.getBuyingPower(seq, cur),
      getSellableQuantity: (seq, sym) => client.getSellableQuantity(seq, sym),
    });
    const result = await precheck({ side, symbol, quantity, price, currency });
    const blockers = [
      ...intentResult.riskCheck.blockers,
      ...(result.ok ? [] : [result.reason ?? "주문 사전검증을 통과하지 못했습니다."]),
      ...(liveTradingGate.effective ? [] : [liveTradingGate.reason ?? "실거래 게이트가 닫혀 있습니다."]),
    ];
    const warnings = [
      ...intentResult.riskCheck.warnings,
      ...(liveTradingGate.masterEnabled ? [] : ["서버 실거래 킬스위치가 OFF입니다."]),
    ];
    const preview = await recordOrderPreview({
      userId,
      input: {
        accountSeq,
        symbol,
        side,
        orderType: "limit",
        quantity,
        price,
        currency,
      },
      available: result.available ?? null,
      ok: blockers.length === 0,
      blockers,
      warnings,
      liveTradingEffective: liveTradingGate.effective,
      liveTradingBlockedReason: liveTradingGate.reason,
    });
    return Response.json({
      ...result,
      symbol,
      side,
      quantity,
      price,
      currency,
      accountSeq,
      intent: intentResult.intent,
      riskCheck: intentResult.riskCheck,
      liveTradingGate: {
        effective: liveTradingGate.effective,
        masterEnabled: liveTradingGate.masterEnabled,
        userEnabled: liveTradingGate.userEnabled,
        reason: liveTradingGate.reason,
      },
      preview,
      blockers,
      warnings,
      submitReady: preview.ok,
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "사전검증 실패"), { status: 502 });
    }
    return Response.json({ error: "사전검증 중 오류가 발생했습니다." }, { status: 502 });
  }
}
