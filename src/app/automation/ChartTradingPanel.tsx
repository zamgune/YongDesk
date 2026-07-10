"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./automation.module.css";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Marker = {
  id: string;
  side: "buy" | "sell";
  time: string;
  price: number | null;
  quantity: number;
  strategyId: string;
};

type ChartPayload = {
  symbol: string;
  accountSeq: number | null;
  price: { lastPrice: string; currency: "KRW" | "USD" } | null;
  candles: Candle[];
  position: {
    quantity: number;
    averagePurchasePrice: number;
    lastPrice: number;
  } | null;
  buyingPower: { cashBuyingPower: string; currency: "KRW" | "USD" } | null;
  markers: Marker[];
  error?: string;
};

type TossErrorPayload = {
  error?: string;
  code?: string;
  requestId?: string;
  toss?: {
    guidance?: string;
    requestId?: string;
    retryAfterMs?: number;
    rateLimit?: {
      limit: number | null;
      remaining: number | null;
      resetSeconds: number | null;
    };
  };
};

type OrderPreview = {
  id: string;
  clientOrderId: string;
  accountSeq: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  currency: "KRW" | "USD";
  estimatedOrderValue: number;
  available: number | null;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  liveTradingEffective: boolean;
  liveTradingBlockedReason: string | null;
  expiresAt: string;
};

type PreviewPayload = TossErrorPayload & {
  ok?: boolean;
  reason?: string;
  submitReady?: boolean;
  blockers?: string[];
  warnings?: string[];
  preview?: OrderPreview;
};

const formatNumber = (value: number | string | null | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "-";
};

const formatApiError = (payload: TossErrorPayload | null, fallback: string) => {
  if (!payload) return fallback;
  const details = [
    payload.error,
    payload.toss?.guidance,
    payload.requestId || payload.toss?.requestId ? `requestId ${payload.requestId ?? payload.toss?.requestId}` : null,
  ].filter(Boolean);
  return details.join(" · ") || fallback;
};

export default function ChartTradingPanel() {
  const [symbol, setSymbol] = useState("005930");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("71500");
  const [quantity, setQuantity] = useState("1");
  const [data, setData] = useState<ChartPayload | null>(null);
  const [selected, setSelected] = useState<Marker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch(`/api/toss/chart-trading?symbol=${encodeURIComponent(symbol)}&interval=1d&count=80`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ChartPayload;
      if (!response.ok) {
        setData(null);
        setError(formatApiError(payload, "차트 데이터를 불러오지 못했습니다."));
        return;
      }
      setData(payload);
      setPrice(String(Math.round(Number(payload.price?.lastPrice ?? payload.position?.lastPrice ?? price))));
      setSelected(payload.markers[0] ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    window.addEventListener("broker-credentials-changed", load);
    return () => window.removeEventListener("broker-credentials-changed", load);
    // symbol은 검색 버튼으로만 반영합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chart = useMemo(() => {
    const candles = data?.candles ?? [];
    if (candles.length === 0) {
      return {
        candles,
        y: () => 140,
        x: () => 20,
      };
    }
    const values = candles.flatMap((candle) => [candle.high, candle.low]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const xStep = candles.length > 1 ? 760 / (candles.length - 1) : 760;
    return {
      candles,
      y: (value: number) => 250 - ((value - min) / span) * 220,
      x: (index: number) => 20 + index * xStep,
    };
  }, [data]);

  const currentQuantity = Number(quantity);
  const currentPrice = Number(price);
  const previewMatches = Boolean(
    preview &&
      preview.symbol === symbol.trim().toUpperCase() &&
      preview.side === side &&
      preview.quantity === currentQuantity &&
      preview.price === currentPrice &&
      preview.accountSeq === (data?.accountSeq ?? preview.accountSeq),
  );

  const previewOrder = async () => {
    setError(null);
    setMessage(null);
    setPreview(null);
    if (!Number.isFinite(currentQuantity) || currentQuantity <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      setError("가격과 수량을 올바르게 입력하세요.");
      return;
    }
    setPreviewing(true);
    try {
      const response = await fetch("/api/automation/orders/precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          quantity: currentQuantity,
          price: currentPrice,
          accountSeq: data?.accountSeq ?? undefined,
          currency: data?.price?.currency,
        }),
      });
      const payload = (await response.json().catch(() => null)) as PreviewPayload | null;
      if (!response.ok || !payload?.preview) {
        setError(formatApiError(payload, "주문 미리보기에 실패했습니다."));
        return;
      }
      setPreview(payload.preview);
      setMessage(payload.submitReady ? "주문 미리보기가 통과되었습니다." : "주문 미리보기에서 차단 조건이 발견되었습니다.");
    } finally {
      setPreviewing(false);
    }
  };

  const submitOrder = async () => {
    setError(null);
    setMessage(null);
    if (!preview || !previewMatches) {
      setError("현재 입력값으로 주문 미리보기를 다시 실행하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/automation/orders/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          quantity: currentQuantity,
          price: currentPrice,
          orderType: "limit",
          accountSeq: preview.accountSeq,
          currency: data?.price?.currency,
          previewId: preview.id,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TossErrorPayload & { liveTradingEnabled?: boolean; order?: unknown } | null;
      if (!response.ok) {
        setError(formatApiError(payload, "주문이 차단되었습니다."));
        return;
      }
      setMessage(payload?.liveTradingEnabled ? "토스 주문이 제출되었습니다." : "주문 검증만 완료되었습니다.");
      setPreview(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.tradeShell}>
      <div className={styles.tradeTopbar}>
        <div>
          <p className={styles.kicker}>Chart Trading</p>
          <h2>차트 매매</h2>
        </div>
        <div className={styles.tradeSearch}>
          <input
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value.toUpperCase());
              setPreview(null);
            }}
          />
          <button type="button" className={styles.buttonSecondary} onClick={() => void load()} disabled={loading}>
            {loading ? "조회 중" : "조회"}
          </button>
        </div>
      </div>

      {error && !data ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <div className={styles.tradeGrid}>
          <article className={styles.tradeChart}>
            <div className={styles.tradeChartHeader}>
              <strong>{data?.symbol ?? symbol}</strong>
              <span>{formatNumber(data?.price?.lastPrice)} {data?.price?.currency ?? ""}</span>
            </div>
            {chart.candles.length === 0 ? (
              <p className={styles.empty}>차트 데이터가 없습니다.</p>
            ) : (
              <svg viewBox="0 0 800 280" className={styles.tradeSvg} role="img" aria-label="토스 캔들 차트">
                <rect x="0" y="0" width="800" height="280" rx="8" />
                {chart.candles.map((candle, index) => {
                  const x = chart.x(index);
                  const top = chart.y(Math.max(candle.open, candle.close));
                  const bottom = chart.y(Math.min(candle.open, candle.close));
                  const up = candle.close >= candle.open;
                  return (
                    <g key={`${candle.time}-${index}`}>
                      <line x1={x} x2={x} y1={chart.y(candle.high)} y2={chart.y(candle.low)} className={styles.candleWick} />
                      <rect
                        x={x - 3}
                        y={top}
                        width="6"
                        height={Math.max(3, bottom - top)}
                        className={up ? styles.candleUp : styles.candleDown}
                      />
                    </g>
                  );
                })}
                {(data?.markers ?? []).map((marker) => {
                  const candleIndex = Math.max(0, chart.candles.findIndex((candle) => candle.time.slice(0, 10) === marker.time.slice(0, 10)));
                  const x = chart.x(candleIndex);
                  const y = marker.price ? chart.y(marker.price) : 140;
                  return (
                    <g
                      key={marker.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelected(marker)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelected(marker);
                        }
                      }}
                    >
                      <circle cx={x} cy={y} r="10" className={marker.side === "buy" ? styles.markerBuy : styles.markerSell} />
                      <text x={x} y={y + 4} textAnchor="middle" className={styles.markerText}>{marker.side === "buy" ? "B" : "S"}</text>
                    </g>
                  );
                })}
              </svg>
            )}
            {selected ? (
              <div className={styles.fillDetail}>
                <strong>{selected.side === "buy" ? "매수" : "매도"} 체결</strong>
                <span>{formatNumber(selected.price)} · {formatNumber(selected.quantity)}주 · {selected.strategyId}</span>
              </div>
            ) : (
              <p className={styles.empty}>저장된 체결 마커가 없습니다.</p>
            )}
          </article>

          <aside className={styles.tradeSide}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.kicker}>Order</p>
                  <h2>주문 패널</h2>
                </div>
                <span>검증 후 제출</span>
              </div>
              <div className={styles.segmented}>
                <button
                  type="button"
                  className={side === "buy" ? styles.active : ""}
                  onClick={() => {
                    setSide("buy");
                    setPreview(null);
                  }}
                >
                  매수
                </button>
                <button
                  type="button"
                  className={side === "sell" ? styles.active : ""}
                  onClick={() => {
                    setSide("sell");
                    setPreview(null);
                  }}
                >
                  매도
                </button>
              </div>
              <label>
                가격
                <input
                  value={price}
                  onChange={(event) => {
                    setPrice(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <label>
                수량
                <input
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <div className={styles.resultGrid}>
                <article><span>예상금액</span><strong>{formatNumber(Number(price) * Number(quantity))}</strong></article>
                <article><span>매수가능</span><strong>{formatNumber(data?.buyingPower?.cashBuyingPower)}</strong></article>
                <article><span>보유수량</span><strong>{formatNumber(data?.position?.quantity)}</strong></article>
              </div>
              {preview ? (
                <div className={styles.previewBox}>
                  <strong>{preview.ok ? "미리보기 통과" : "미리보기 차단"}</strong>
                  <p>
                    주문ID {preview.clientOrderId} · 예상 {formatNumber(preview.estimatedOrderValue)} {preview.currency}
                    {preview.available !== null ? ` · 가능 ${formatNumber(preview.available)}` : ""}
                  </p>
                  {preview.blockers.length ? <ul>{preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
                  {preview.warnings.length ? <p>{preview.warnings.join(" · ")}</p> : null}
                  <small>만료 {new Date(preview.expiresAt).toLocaleTimeString("ko-KR")}</small>
                </div>
              ) : null}
              <div className={styles.actions}>
                <button type="button" className={styles.buttonSecondary} onClick={() => void previewOrder()} disabled={previewing || submitting}>
                  {previewing ? "확인 중" : "주문 미리보기"}
                </button>
                <button
                  type="button"
                  className={side === "sell" ? styles.buttonDanger : styles.buttonPrimary}
                  onClick={() => void submitOrder()}
                  disabled={!previewMatches || !preview?.ok || submitting}
                >
                  {submitting ? "제출 중" : side === "buy" ? "매수 제출" : "매도 제출"}
                </button>
              </div>
              {message ? <p className={styles.notice}>{message}</p> : null}
              {error && data ? <p className={styles.error}>{error}</p> : null}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}
