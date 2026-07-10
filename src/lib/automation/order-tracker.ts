import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import type { TossOrderStatus } from "@/lib/toss/types";
import { stockAnalysisStoragePath } from "@/lib/local-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

/**
 * 자동매매가 제출한 주문의 추적 원장 + 체결 기록.
 *
 * 워커가 실제 전송한 주문(brokerOrderId)을 적재하면 동기화기가 진행 중/종료
 * 주문을 폴링해 체결 수량·평단·상태를 갱신하고 체결 델타를 기록합니다.
 * Supabase 설정 시 order_intents(추적) + execution_logs(체결)를, 아니면 .cache
 * 파일을 사용합니다.
 */

export const TERMINAL_TOSS_STATUSES: ReadonlySet<string> = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
  "REPLACED",
  "CANCEL_REJECTED",
  "REPLACE_REJECTED",
]);

export const isTerminalStatus = (status: string): boolean => TERMINAL_TOSS_STATUSES.has(status);

export type TrackedOrder = {
  userId: string;
  brokerOrderId: string;
  clientOrderId: string;
  accountSeq: number;
  strategyId: string;
  stepId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number | null;
  status: TossOrderStatus;
  filledQuantity: number;
  averageFilledPrice: number | null;
  terminal: boolean;
  submittedAt: string;
  lastSyncedAt: string | null;
};

export type FillRecord = {
  id: string;
  userId: string;
  brokerOrderId: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  filledQuantity: number;
  averageFilledPrice: number | null;
  commission: number | null;
  tax: number | null;
  status: TossOrderStatus;
  recordedAt: string;
};

export type OrderPreviewInput = {
  accountSeq: number;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  price: number;
  currency: "KRW" | "USD";
};

export type OrderPreviewRecord = OrderPreviewInput & {
  id: string;
  userId: string;
  clientOrderId: string;
  estimatedOrderValue: number;
  available: number | null;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  liveTradingEffective: boolean;
  liveTradingBlockedReason: string | null;
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
};

type NewSubmittedOrder = Omit<
  TrackedOrder,
  "status" | "filledQuantity" | "averageFilledPrice" | "terminal" | "lastSyncedAt"
>;

export type OrderStatusUpdate = Pick<
  TrackedOrder,
  "brokerOrderId" | "status" | "filledQuantity" | "averageFilledPrice" | "terminal"
> & { lastSyncedAt: string };

/** 토스 주문상태 → order_intents.status 매핑 */
const toIntentStatus = (status: string): string => {
  if (status === "FILLED") return "filled";
  if (status === "PARTIAL_FILLED") return "partial_filled";
  if (status === "CANCELED") return "canceled";
  if (status === "REJECTED" || status === "CANCEL_REJECTED" || status === "REPLACE_REJECTED") return "rejected";
  return "submitted";
};

const isKrSymbol = (symbol: string) => /^\d{6}$/.test(symbol.trim());

const normalizePreviewInput = (input: OrderPreviewInput): OrderPreviewInput => ({
  accountSeq: Number(input.accountSeq),
  symbol: input.symbol.trim().toUpperCase(),
  side: input.side,
  orderType: input.orderType,
  quantity: Number(input.quantity),
  price: Number(input.price),
  currency: input.currency,
});

export const buildOrderPreviewPayloadHash = (input: OrderPreviewInput): string =>
  createHash("sha256")
    .update(JSON.stringify(normalizePreviewInput(input)))
    .digest("hex");

export const createOrderPreviewClientOrderId = (previewId: string): string =>
  previewId.replace(/-/g, "").slice(0, 32);

// === 파일 백엔드 ===

type TrackerStore = {
  orders: TrackedOrder[];
  fills: FillRecord[];
  previews: OrderPreviewRecord[];
};

const STORE_PATH = stockAnalysisStoragePath("automation-platform", "order-tracker.json");

const readFileStore = async (): Promise<TrackerStore> => {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrackerStore>;
    return {
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      fills: Array.isArray(parsed.fills) ? parsed.fills : [],
      previews: Array.isArray(parsed.previews) ? parsed.previews : [],
    };
  } catch {
    return { orders: [], fills: [], previews: [] };
  }
};

const writeFileStore = async (store: TrackerStore) => {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tempPath, STORE_PATH);
};

// === Supabase 백엔드 ===

// macOS sidecar는 단일 설치의 주문 시도 원장을 App Support 파일에만 둔다.
// 웹/관리 경로의 선택형 Supabase 원장은 로컬 실거래 복구 경계에 관여하지 않는다.
const shouldUseSupabaseStore = () =>
  process.env.STOCK_ANALYSIS_RUNTIME !== "macos-local" && getSupabaseAdminConfig() !== null;
const supabase = () => createSupabaseAdminClient();
const throwIfSupabaseError = (error: { message?: string } | null, operation: string) => {
  if (error) {
    throw new Error(`${operation}: ${error.message ?? "Supabase request failed"}`);
  }
};

const rowToTracked = (row: Record<string, unknown>): TrackedOrder => ({
  userId: row.user_id as string,
  brokerOrderId: (row.broker_order_id as string) ?? "",
  clientOrderId: (row.client_order_id as string) ?? "",
  accountSeq: Number(row.account_seq ?? 0),
  strategyId: (row.strategy_key as string) ?? "",
  stepId: (row.step_id as string) ?? "",
  symbol: row.symbol as string,
  side: row.side as "buy" | "sell",
  quantity: Number(row.quantity ?? 0),
  limitPrice: row.limit_price === null ? null : Number(row.limit_price),
  status: ((row.broker_status as string) ?? "PENDING") as TossOrderStatus,
  filledQuantity: Number(row.filled_quantity ?? 0),
  averageFilledPrice: row.average_filled_price === null ? null : Number(row.average_filled_price),
  terminal: Boolean(row.terminal),
  submittedAt: (row.created_at as string) ?? new Date().toISOString(),
  lastSyncedAt: (row.last_synced_at as string) ?? null,
});

const rowToPreview = (row: Record<string, unknown>): OrderPreviewRecord | null => {
  const payload = row.payload as Record<string, unknown> | null;
  const preview = payload?.preview as Partial<OrderPreviewRecord> | undefined;
  if (!preview || typeof preview !== "object") {
    return null;
  }
  return {
    id: (row.id as string) ?? preview.id ?? "",
    userId: (row.user_id as string) ?? preview.userId ?? "",
    clientOrderId: preview.clientOrderId ?? createOrderPreviewClientOrderId((row.id as string) ?? ""),
    accountSeq: Number(preview.accountSeq ?? 0),
    symbol: preview.symbol ?? "",
    side: preview.side === "sell" ? "sell" : "buy",
    orderType: preview.orderType === "market" ? "market" : "limit",
    quantity: Number(preview.quantity ?? 0),
    price: Number(preview.price ?? 0),
    currency: preview.currency === "USD" ? "USD" : "KRW",
    estimatedOrderValue: Number(preview.estimatedOrderValue ?? 0),
    available: preview.available === null || preview.available === undefined ? null : Number(preview.available),
    ok: preview.ok === true,
    blockers: Array.isArray(preview.blockers) ? preview.blockers.filter((entry): entry is string => typeof entry === "string") : [],
    warnings: Array.isArray(preview.warnings) ? preview.warnings.filter((entry): entry is string => typeof entry === "string") : [],
    liveTradingEffective: preview.liveTradingEffective === true,
    liveTradingBlockedReason: typeof preview.liveTradingBlockedReason === "string" ? preview.liveTradingBlockedReason : null,
    payloadHash: preview.payloadHash ?? "",
    createdAt: preview.createdAt ?? ((row.created_at as string) || new Date().toISOString()),
    expiresAt: preview.expiresAt ?? new Date(0).toISOString(),
    submittedAt: typeof preview.submittedAt === "string" ? preview.submittedAt : null,
  };
};

// === 공개 API ===

export const recordOrderPreview = async ({
  userId,
  input,
  available,
  ok,
  blockers,
  warnings,
  liveTradingEffective,
  liveTradingBlockedReason,
}: {
  userId: string;
  input: OrderPreviewInput;
  available: number | null;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  liveTradingEffective: boolean;
  liveTradingBlockedReason: string | null;
}): Promise<OrderPreviewRecord> => {
  const normalized = normalizePreviewInput(input);
  const now = new Date();
  const preview: OrderPreviewRecord = {
    ...normalized,
    id: randomUUID(),
    userId,
    clientOrderId: "",
    estimatedOrderValue: normalized.quantity * normalized.price,
    available,
    ok,
    blockers,
    warnings,
    liveTradingEffective,
    liveTradingBlockedReason,
    payloadHash: buildOrderPreviewPayloadHash(normalized),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    submittedAt: null,
  };
  preview.clientOrderId = createOrderPreviewClientOrderId(preview.id);

  if (shouldUseSupabaseStore()) {
    const { error } = await supabase().from("execution_logs").insert({
      id: preview.id,
      user_id: userId,
      broker: "toss",
      level: ok ? "info" : "warning",
      message: ok
        ? `주문 미리보기 확인 ${preview.side} ${preview.symbol} ${preview.quantity}주`
        : `주문 미리보기 차단 ${preview.side} ${preview.symbol} ${preview.quantity}주`,
      payload: {
        kind: "order_preview",
        preview,
      },
    });
    throwIfSupabaseError(error, "record order preview");
    return preview;
  }

  const store = await readFileStore();
  await writeFileStore({
    ...store,
    previews: [preview, ...store.previews].slice(0, 200),
  });
  return preview;
};

const readOrderPreview = async (
  userId: string,
  previewId: string,
): Promise<OrderPreviewRecord | null> => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("execution_logs")
      .select("id, user_id, payload, created_at")
      .eq("id", previewId)
      .eq("user_id", userId)
      .eq("payload->>kind", "order_preview")
      .maybeSingle();
    throwIfSupabaseError(error, "read order preview");
    return data ? rowToPreview(data as Record<string, unknown>) : null;
  }
  const store = await readFileStore();
  return store.previews.find((preview) => preview.userId === userId && preview.id === previewId) ?? null;
};

/** 로컬 sidecar의 최종 제출 경로가 서버 입력을 다시 신뢰하지 않도록 사용한다. */
export const getOrderPreview = async (
  userId: string,
  previewId: string,
): Promise<OrderPreviewRecord | null> => readOrderPreview(userId, previewId);

export const verifyOrderPreview = async ({
  userId,
  previewId,
  input,
}: {
  userId: string;
  previewId: string;
  input: OrderPreviewInput;
}): Promise<
  | { ok: true; preview: OrderPreviewRecord }
  | { ok: false; status: number; reason: string; preview?: OrderPreviewRecord }
> => {
  const preview = await readOrderPreview(userId, previewId);
  if (!preview) {
    return { ok: false, status: 428, reason: "주문 미리보기를 먼저 실행하세요." };
  }
  if (preview.submittedAt) {
    return { ok: false, status: 409, reason: "이미 제출에 사용된 주문 미리보기입니다.", preview };
  }
  if (Date.parse(preview.expiresAt) <= Date.now()) {
    return { ok: false, status: 428, reason: "주문 미리보기가 만료되었습니다. 다시 확인하세요.", preview };
  }
  const nextHash = buildOrderPreviewPayloadHash(input);
  if (preview.payloadHash !== nextHash) {
    return { ok: false, status: 409, reason: "주문 입력값이 미리보기와 다릅니다. 다시 확인하세요.", preview };
  }
  if (!preview.ok) {
    return { ok: false, status: 422, reason: preview.blockers[0] ?? "주문 미리보기가 통과되지 않았습니다.", preview };
  }
  return { ok: true, preview };
};

export const markOrderPreviewSubmitted = async (
  userId: string,
  previewId: string,
  submittedAt = new Date().toISOString(),
): Promise<void> => {
  const preview = await readOrderPreview(userId, previewId);
  if (!preview) {
    return;
  }
  const submittedPreview = { ...preview, submittedAt };
  if (shouldUseSupabaseStore()) {
    const { error } = await supabase()
      .from("execution_logs")
      .update({
        payload: {
          kind: "order_preview",
          preview: submittedPreview,
        },
      })
      .eq("id", previewId)
      .eq("user_id", userId);
    throwIfSupabaseError(error, "mark order preview submitted");
    return;
  }
  const store = await readFileStore();
  await writeFileStore({
    ...store,
    previews: store.previews.map((entry) => entry.id === previewId ? submittedPreview : entry),
  });
};

export const recordSubmittedOrder = async (order: NewSubmittedOrder): Promise<void> => {
  if (shouldUseSupabaseStore()) {
    const client = supabase();
    const { data: existing, error: readError } = await client
      .from("order_intents")
      .select("id")
      .eq("user_id", order.userId)
      .eq("broker_order_id", order.brokerOrderId)
      .maybeSingle();
    throwIfSupabaseError(readError, "read submitted order");
    if (existing) {
      return; // 멱등
    }
    const { error } = await client.from("order_intents").insert({
      user_id: order.userId,
      market: isKrSymbol(order.symbol) ? "KR" : "US",
      symbol: order.symbol,
      side: order.side,
      order_type: order.limitPrice === null ? "market" : "limit",
      quantity: order.quantity,
      limit_price: order.limitPrice,
      status: "submitted",
      broker: "toss",
      broker_order_id: order.brokerOrderId,
      client_order_id: order.clientOrderId,
      account_seq: order.accountSeq,
      step_id: order.stepId,
      strategy_key: order.strategyId,
      broker_status: "PENDING",
      filled_quantity: 0,
      terminal: false,
      reason: "automation worker order",
    });
    throwIfSupabaseError(error, "record submitted order");
    return;
  }

  const store = await readFileStore();
  if (store.orders.some((o) => o.brokerOrderId === order.brokerOrderId)) {
    return;
  }
  store.orders.push({
    ...order,
    status: "PENDING",
    filledQuantity: 0,
    averageFilledPrice: null,
    terminal: false,
    lastSyncedAt: null,
  });
  await writeFileStore(store);
};

export const listOpenTrackedOrders = async (
  userId: string,
  accountSeq?: number,
): Promise<TrackedOrder[]> => {
  if (shouldUseSupabaseStore()) {
    let query = supabase()
      .from("order_intents")
      .select("*")
      .eq("user_id", userId)
      .eq("terminal", false)
      .not("broker_order_id", "is", null);
    if (accountSeq !== undefined) {
      query = query.eq("account_seq", accountSeq);
    }
    const { data, error } = await query;
    throwIfSupabaseError(error, "list open tracked orders");
    return (data ?? []).map(rowToTracked);
  }
  const store = await readFileStore();
  return store.orders.filter(
    (o) => o.userId === userId && !o.terminal && (accountSeq === undefined || o.accountSeq === accountSeq),
  );
};

export const listTrackedOrders = async (userId: string): Promise<TrackedOrder[]> => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("order_intents")
      .select("*")
      .eq("user_id", userId)
      .not("broker_order_id", "is", null)
      .order("created_at", { ascending: false });
    throwIfSupabaseError(error, "list tracked orders");
    return (data ?? []).map(rowToTracked);
  }
  const store = await readFileStore();
  return store.orders
    .filter((o) => o.userId === userId)
    .toSorted((a, b) => b.submittedAt.localeCompare(a.submittedAt));
};

export const listFills = async (userId: string): Promise<FillRecord[]> => {
  if (shouldUseSupabaseStore()) {
    const { data, error } = await supabase()
      .from("execution_logs")
      .select("id, broker_order_id, payload, created_at")
      .eq("user_id", userId)
      .eq("payload->>kind", "fill")
      .order("created_at", { ascending: false });
    throwIfSupabaseError(error, "list fills");
    return (data ?? []).map((row) => {
      const p = (row.payload ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        userId,
        brokerOrderId: (row.broker_order_id as string) ?? "",
        strategyId: (p.strategyId as string) ?? "",
        symbol: (p.symbol as string) ?? "",
        side: (p.side as "buy" | "sell") ?? "buy",
        filledQuantity: Number(p.filledQuantity ?? 0),
        averageFilledPrice: p.averageFilledPrice === null || p.averageFilledPrice === undefined ? null : Number(p.averageFilledPrice),
        commission: p.commission === null || p.commission === undefined ? null : Number(p.commission),
        tax: p.tax === null || p.tax === undefined ? null : Number(p.tax),
        status: ((p.status as string) ?? "FILLED") as TossOrderStatus,
        recordedAt: (row.created_at as string) ?? new Date().toISOString(),
      } satisfies FillRecord;
    });
  }
  const store = await readFileStore();
  return store.fills
    .filter((f) => f.userId === userId)
    .toSorted((a, b) => b.recordedAt.localeCompare(a.recordedAt));
};

export const applySyncUpdates = async ({
  orderUpdates,
  newFills,
}: {
  orderUpdates: OrderStatusUpdate[];
  newFills: FillRecord[];
}): Promise<void> => {
  if (shouldUseSupabaseStore()) {
    const client = supabase();
    for (const u of orderUpdates) {
      const { error } = await client
        .from("order_intents")
        .update({
          broker_status: u.status,
          status: toIntentStatus(u.status),
          filled_quantity: u.filledQuantity,
          average_filled_price: u.averageFilledPrice,
          terminal: u.terminal,
          last_synced_at: u.lastSyncedAt,
        })
        .eq("broker_order_id", u.brokerOrderId);
      throwIfSupabaseError(error, "sync order status");
    }
    if (newFills.length) {
      const { error } = await client.from("execution_logs").insert(
        newFills.map((f) => ({
          user_id: f.userId,
          broker: "toss",
          broker_order_id: f.brokerOrderId,
          level: "info",
          message: `체결 ${f.filledQuantity}주 ${f.symbol} @ ${f.averageFilledPrice ?? "-"} (${f.status})`,
          payload: {
            kind: "fill",
            strategyId: f.strategyId,
            symbol: f.symbol,
            side: f.side,
            filledQuantity: f.filledQuantity,
            averageFilledPrice: f.averageFilledPrice,
            commission: f.commission,
            tax: f.tax,
            status: f.status,
          },
        })),
      );
      throwIfSupabaseError(error, "record fills");
    }
    return;
  }

  const store = await readFileStore();
  const updateByOrderId = new Map(orderUpdates.map((u) => [u.brokerOrderId, u]));
  const orders = store.orders.map((o) => {
    const update = updateByOrderId.get(o.brokerOrderId);
    return update ? { ...o, ...update } : o;
  });
  await writeFileStore({ ...store, orders, fills: [...store.fills, ...newFills] });
};
