import { listFills } from "@/lib/automation/order-tracker";
import { hasAutomationFeature } from "@/lib/automation/store";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";
import type { TossCandleInterval, TossCurrency } from "@/lib/toss/types";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

const intervalOr = (value: string | null): TossCandleInterval => value === "1m" ? "1m" : "1d";
const currencyFor = (symbol: string): TossCurrency => /^\d{6}$/.test(symbol) ? "KRW" : "USD";

export async function GET(request: Request) {
  const limited = checkRateLimit(request, "toss-chart-trading", { limit: 30, windowMs: 60_000 });
  if (limited) {
    return limited;
  }

  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userId = auth.userContext.userId;
  if (!(await hasAutomationFeature(userId, "broker_credentials"))) {
    return Response.json({ error: "토스 API 키 등록이 필요합니다." }, { status: 403 });
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "005930").trim().toUpperCase();
  const interval = intervalOr(url.searchParams.get("interval"));
  const count = Math.min(Math.max(Number(url.searchParams.get("count") ?? 80), 20), 200);
  if (!symbol) {
    return Response.json({ error: "symbol이 필요합니다." }, { status: 400 });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ error: "등록된 토스 자격증명이 없습니다." }, { status: 412 });
  }

  try {
    const client = createTossClient(credentials);
    const accounts = await client.listAccounts();
    const account = accounts.find((a) => a.accountType === "BROKERAGE") ?? accounts[0] ?? null;
    const [candles, prices, holdings, buyingPower, fills] = await Promise.all([
      client.getCandles(symbol, { interval, count, adjusted: true }),
      client.getPrices([symbol]),
      account ? client.getHoldings(account.accountSeq, symbol) : Promise.resolve(null),
      account ? client.getBuyingPower(account.accountSeq, currencyFor(symbol)) : Promise.resolve(null),
      listFills(userId),
    ]);

    const position = holdings?.items.find((item) => item.symbol.toUpperCase() === symbol) ?? null;
    const markers = fills
      .filter((fill) => fill.symbol.toUpperCase() === symbol && fill.averageFilledPrice !== null)
      .slice(0, 80)
      .map((fill) => ({
        id: fill.id,
        side: fill.side,
        time: fill.recordedAt,
        price: fill.averageFilledPrice,
        quantity: fill.filledQuantity,
        strategyId: fill.strategyId,
        brokerOrderId: fill.brokerOrderId,
      }));

    return Response.json({
      symbol,
      interval,
      accountSeq: account?.accountSeq ?? null,
      price: prices[0] ?? null,
      candles: candles.candles.map((candle) => ({
        time: candle.timestamp,
        open: Number(candle.openPrice),
        high: Number(candle.highPrice),
        low: Number(candle.lowPrice),
        close: Number(candle.closePrice),
        volume: Number(candle.volume),
      })),
      position: position ? {
        quantity: Number(position.quantity),
        averagePurchasePrice: Number(position.averagePurchasePrice),
        lastPrice: Number(position.lastPrice),
        marketValue: position.marketValue ?? null,
        profitLoss: position.profitLoss ?? null,
      } : null,
      buyingPower,
      markers,
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "토스 차트 데이터 조회 실패"), { status: 502 });
    }
    return Response.json({ error: "차트 데이터 조회 중 오류가 발생했습니다." }, { status: 502 });
  }
}
