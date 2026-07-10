import { randomUUID } from "node:crypto";

import type { Order } from "@/lib/toss/types";
import { TossApiError } from "@/lib/toss/client";
import {
  isTerminalStatus,
  type FillRecord,
  type TrackedOrder,
} from "@/lib/automation/order-tracker";

/**
 * 체결 동기화(reconciliation) 핵심 로직.
 *
 *  1) OPEN 목록을 한 번 조회해 진행 중 주문 상태/부분체결을 갱신하고,
 *  2) 목록에서 찾지 못한 추적 주문은 개별 상세조회로 상태를 확정합니다.
 * Toss OpenAPI 1.2.2는 CLOSED 목록 조회를 받지만 closed-not-supported로 거절하므로
 * 종결 주문 동기화에는 주문 상세조회를 사용합니다.
 * 체결 수량이 직전 동기화보다 늘었으면 그 델타를 체결 기록으로 남깁니다.
 */

export type SyncLog = {
  level: "info" | "warning" | "error";
  brokerOrderId: string;
  message: string;
};

export type OrderUpdate = Pick<
  TrackedOrder,
  "brokerOrderId" | "status" | "filledQuantity" | "averageFilledPrice" | "terminal"
> & { lastSyncedAt: string };

export type SyncResult = {
  orderUpdates: OrderUpdate[];
  newFills: FillRecord[];
  logs: SyncLog[];
};

export type OrderFetcher = {
  getOpenOrders: (accountSeq: number, symbol?: string) => Promise<{ orders: Order[] }>;
  getOrder: (accountSeq: number, orderId: string) => Promise<Order>;
};

export type SyncOrderFillsInput = {
  userId: string;
  accountSeq: number;
  trackedOrders: TrackedOrder[];
  fetcher: OrderFetcher;
  now?: string;
};

const toNumberOrNull = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const syncOrderFills = async ({
  userId,
  accountSeq,
  trackedOrders,
  fetcher,
  now = new Date().toISOString(),
}: SyncOrderFillsInput): Promise<SyncResult> => {
  const orderUpdates: OrderUpdate[] = [];
  const newFills: FillRecord[] = [];
  const logs: SyncLog[] = [];

  if (trackedOrders.length === 0) {
    return { orderUpdates, newFills, logs };
  }

  // 1) OPEN 목록 일괄 조회
  let openById = new Map<string, Order>();
  try {
    const open = await fetcher.getOpenOrders(accountSeq);
    openById = new Map(open.orders.map((o) => [o.orderId, o]));
  } catch (error) {
    const message =
      error instanceof TossApiError
        ? `OPEN 주문 조회 실패 [${error.code}]: ${error.message}`
        : "OPEN 주문 조회 중 오류";
    logs.push({ level: "error", brokerOrderId: "*", message });
    return { orderUpdates, newFills, logs };
  }

  // 2) 추적 주문별 상태 확정
  for (const tracked of trackedOrders) {
    let toss: Order | null = openById.get(tracked.brokerOrderId) ?? null;
    if (!toss) {
      // OPEN 목록에 없음 → 종결 가능성이 있으므로 개별 상세조회.
      try {
        toss = await fetcher.getOrder(accountSeq, tracked.brokerOrderId);
      } catch (error) {
        const message =
          error instanceof TossApiError
            ? `주문 상세조회 실패 [${error.code}]: ${error.message}`
            : "주문 상세조회 중 오류";
        logs.push({ level: "error", brokerOrderId: tracked.brokerOrderId, message });
        continue;
      }
    }

    const filledQuantity = toNumberOrNull(toss.execution.filledQuantity) ?? 0;
    const averageFilledPrice = toNumberOrNull(toss.execution.averageFilledPrice);
    const terminal = isTerminalStatus(toss.status);
    const filledDelta = filledQuantity - tracked.filledQuantity;

    if (filledDelta > 0) {
      newFills.push({
        id: randomUUID(),
        userId,
        brokerOrderId: tracked.brokerOrderId,
        strategyId: tracked.strategyId,
        symbol: tracked.symbol,
        side: tracked.side,
        filledQuantity: filledDelta,
        averageFilledPrice,
        // 수수료·세금은 총액이므로 종결 시점에만 부착(중복 방지)
        commission: terminal ? toNumberOrNull(toss.execution.commission) : null,
        tax: terminal ? toNumberOrNull(toss.execution.tax) : null,
        status: toss.status,
        recordedAt: now,
      });
      logs.push({
        level: "info",
        brokerOrderId: tracked.brokerOrderId,
        message: `체결 ${filledDelta}주 (${tracked.side === "buy" ? "매수" : "매도"} ${tracked.symbol}) @ ${averageFilledPrice ?? "-"} · 상태 ${toss.status}`,
      });
    } else if (toss.status !== tracked.status) {
      logs.push({
        level: terminal && toss.status !== "FILLED" ? "warning" : "info",
        brokerOrderId: tracked.brokerOrderId,
        message: `상태 변경: ${tracked.status} → ${toss.status}`,
      });
    }

    orderUpdates.push({
      brokerOrderId: tracked.brokerOrderId,
      status: toss.status,
      filledQuantity,
      averageFilledPrice,
      terminal,
      lastSyncedAt: now,
    });
  }

  return { orderUpdates, newFills, logs };
};
