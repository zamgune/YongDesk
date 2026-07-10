import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type PortfolioCurrency = "USD" | "KRW";

type StoredPortfolioPosition = {
  id: string;
  symbol: string;
  market: string;
  name?: string;
  normalizedSymbol: string;
  avgPrice: number;
  quantity: number;
  currency: PortfolioCurrency;
  memo?: string;
  updatedAt: string;
};

type PortfolioRow = {
  client_position_id: string;
  symbol: string;
  market: string;
  name: string | null;
  currency: PortfolioCurrency;
  quantity: number;
  average_price: number;
  note: string | null;
  updated_at: string;
};

type PositionsPayload = {
  positions?: unknown;
};

const MAX_POSITIONS = 100;

const isCurrency = (value: unknown): value is PortfolioCurrency =>
  value === "USD" || value === "KRW";

const toSafeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
};

const normalizeSymbolForMarket = (symbol: string, market: string) => {
  const compact = symbol.trim().toUpperCase();
  if ((market === "KOSPI" || market === "KOSDAQ") && /^\d{6}$/.test(compact)) {
    return market === "KOSDAQ" ? `${compact}.KQ` : `${compact}.KS`;
  }
  return compact;
};

const parsePosition = (value: unknown): StoredPortfolioPosition | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const symbol = toSafeText(input.symbol, 24)?.toUpperCase();
  const market = toSafeText(input.market, 16)?.toUpperCase();
  const avgPrice = Number(input.avgPrice);
  const quantity = Number(input.quantity);
  const currency = isCurrency(input.currency) ? input.currency : null;
  if (!symbol || !market || !currency || !Number.isFinite(avgPrice) || avgPrice <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const id = toSafeText(input.id, 128) ?? `${market}:${symbol}`;
  const normalizedSymbol = normalizeSymbolForMarket(symbol, market);
  return {
    id,
    symbol,
    market,
    name: toSafeText(input.name, 80),
    normalizedSymbol,
    avgPrice,
    quantity,
    currency,
    memo: toSafeText(input.memo, 500),
    updatedAt: new Date().toISOString(),
  };
};

const rowToPosition = (row: PortfolioRow): StoredPortfolioPosition => ({
  id: row.client_position_id,
  symbol: row.symbol,
  market: row.market,
  name: row.name ?? undefined,
  normalizedSymbol: normalizeSymbolForMarket(row.symbol, row.market),
  avgPrice: Number(row.average_price),
  quantity: Number(row.quantity),
  currency: row.currency,
  memo: row.note ?? undefined,
  updatedAt: row.updated_at,
});

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("portfolios")
    .select("client_position_id,symbol,market,name,currency,quantity,average_price,note,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    return Response.json({ positions: [], unavailable: true });
  }

  return Response.json({
    positions: (data as PortfolioRow[]).map(rowToPosition),
  });
}

export async function PUT(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await request.json().catch(() => ({}))) as PositionsPayload;
  if (!Array.isArray(payload.positions) || payload.positions.length > MAX_POSITIONS) {
    return Response.json(
      { error: `positions는 최대 ${MAX_POSITIONS}개 배열이어야 합니다.` },
      { status: 400 },
    );
  }

  const positions = payload.positions
    .map(parsePosition)
    .filter((position): position is StoredPortfolioPosition => position !== null);
  if (positions.length !== payload.positions.length) {
    return Response.json({ error: "포트폴리오 입력값이 유효하지 않습니다." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error: deleteError } = await supabase
    .from("portfolios")
    .delete()
    .eq("user_id", auth.userContext.userId);

  if (deleteError) {
    return Response.json({ error: "포트폴리오 저장소를 갱신하지 못했습니다." }, { status: 500 });
  }

  if (positions.length) {
    const rows = positions.map((position) => ({
      user_id: auth.userContext.userId,
      client_position_id: position.id,
      symbol: position.symbol,
      market: position.market,
      name: position.name ?? null,
      currency: position.currency,
      quantity: position.quantity,
      average_price: position.avgPrice,
      note: position.memo ?? null,
    }));

    const { error: insertError } = await supabase
      .from("portfolios")
      .insert(rows);

    if (insertError) {
      return Response.json({ error: "포트폴리오를 저장하지 못했습니다." }, { status: 500 });
    }
  }

  return Response.json({ positions });
}
