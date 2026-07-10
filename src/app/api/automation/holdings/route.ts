import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { hasAutomationFeature } from "@/lib/automation/store";
import { loadDecryptedCredentials } from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";

/** 특정 종목의 보유 여부/수량/평단 조회 (전략 세팅 보조). */
export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userId = auth.userContext.userId;
  if (!(await hasAutomationFeature(userId, "automation_beta"))) {
    return Response.json({ error: "자동매매 베타 권한이 필요합니다." }, { status: 403 });
  }
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return Response.json({ error: "symbol이 필요합니다." }, { status: 400 });
  }

  const credentials = await loadDecryptedCredentials(userId, "toss");
  if (!credentials) {
    return Response.json({ linked: false, held: false });
  }
  const client = createTossClient(credentials);
  try {
    const accounts = await client.listAccounts();
    const brokerage = accounts.find((a) => a.accountType === "BROKERAGE") ?? accounts[0];
    if (!brokerage) {
      return Response.json({ linked: true, held: false });
    }
    const holdings = await client.getHoldings(brokerage.accountSeq, symbol);
    const item = holdings.items.find((h) => h.symbol.toUpperCase() === symbol);
    if (!item) {
      return Response.json({ linked: true, held: false, symbol });
    }
    return Response.json({
      linked: true,
      held: true,
      symbol,
      quantity: Number(item.quantity),
      averagePurchasePrice: Number(item.averagePurchasePrice),
      currency: item.currency,
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(formatTossApiError(error, "보유 조회 실패"), { status: 502 });
    }
    return Response.json({ error: "보유 조회 중 오류가 발생했습니다." }, { status: 502 });
  }
}
