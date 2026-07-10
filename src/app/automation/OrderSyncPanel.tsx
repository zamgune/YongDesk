"use client";

import { useEffect, useState } from "react";

import styles from "./automation.module.css";

type TrackedOrder = {
  brokerOrderId: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice: number | null;
  status: string;
  filledQuantity: number;
  averageFilledPrice: number | null;
  terminal: boolean;
  submittedAt: string;
  lastSyncedAt: string | null;
};

type FillRecord = {
  id: string;
  brokerOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  filledQuantity: number;
  averageFilledPrice: number | null;
  status: string;
  recordedAt: string;
};

type ApiErrorPayload = {
  error?: string;
  requestId?: string;
  toss?: {
    guidance?: string;
    requestId?: string;
  };
};

const formatApiError = (payload: ApiErrorPayload, fallback: string) => {
  const details = [
    payload.error,
    payload.toss?.guidance,
    payload.requestId || payload.toss?.requestId ? `requestId ${payload.requestId ?? payload.toss?.requestId}` : null,
  ].filter(Boolean);
  return details.join(" · ") || fallback;
};

export default function OrderSyncPanel() {
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [fills, setFills] = useState<FillRecord[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const response = await fetch("/api/automation/orders/sync", { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { orders: TrackedOrder[]; fills: FillRecord[] };
      setOrders(payload.orders ?? []);
      setFills(payload.fills ?? []);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runTick = async () => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/automation/worker/tick", { method: "POST" });
      const payload = (await response.json()) as {
        liveTradingEnabled?: boolean;
        results?: unknown[];
        error?: string;
      } & ApiErrorPayload;
      if (!response.ok) {
        setError(formatApiError(payload, "워커 실행에 실패했습니다."));
        return;
      }
      setMessage(
        `워커 실행 완료 (전략 ${payload.results?.length ?? 0}개, 실거래 ${payload.liveTradingEnabled ? "ON" : "OFF"}).`,
      );
      await refresh();
    } finally {
      setWorking(false);
    }
  };

  const runSync = async () => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/automation/orders/sync", { method: "POST" });
      const payload = (await response.json()) as {
        synced?: number;
        newFills?: number;
        error?: string;
      } & ApiErrorPayload;
      if (!response.ok) {
        setError(formatApiError(payload, "동기화에 실패했습니다."));
        return;
      }
      setMessage(`동기화 완료 (추적 ${payload.synced ?? 0}건, 신규 체결 ${payload.newFills ?? 0}건).`);
      await refresh();
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Execution</p>
          <h2>주문·체결 현황</h2>
        </div>
        <span>{orders.filter((o) => !o.terminal).length} 진행중</span>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.buttonPrimary} onClick={() => void runTick()} disabled={working}>
          {working ? "처리 중" : "워커 1회 실행"}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => void runSync()} disabled={working}>
          체결 동기화
        </button>
      </div>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <h3>추적 주문</h3>
      {orders.length ? (
        <div className={styles.intentList}>
          {orders.slice(0, 20).map((order) => (
            <article key={order.brokerOrderId}>
              <strong>
                {order.side === "buy" ? "매수" : "매도"} {order.symbol}
              </strong>
              <span>{order.status}</span>
              <p>
                {order.filledQuantity}/{order.quantity}주 체결
                {order.averageFilledPrice ? ` @ ${order.averageFilledPrice}` : ""}
                {order.limitPrice ? ` · 지정가 ${order.limitPrice}` : ""}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>전송된 주문이 없습니다. 실거래 OFF 상태에서는 워커가 발동 조건만 평가합니다.</p>
      )}

      <h3>최근 체결</h3>
      {fills.length ? (
        <div className={styles.intentList}>
          {fills.slice(0, 20).map((fill) => (
            <article key={fill.id}>
              <strong>
                {fill.side === "buy" ? "매수" : "매도"} {fill.symbol}
              </strong>
              <span>{fill.status}</span>
              <p>
                {fill.filledQuantity}주 @ {fill.averageFilledPrice ?? "-"} ·{" "}
                {new Date(fill.recordedAt).toLocaleString("ko-KR")}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>체결 내역이 없습니다.</p>
      )}
    </section>
  );
}
