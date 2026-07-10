"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./automation.module.css";

type PaperSession = "US" | "KR";
type PaperRun = {
  id: string;
  session: PaperSession;
  strategyVersion: string;
  status: "executed" | "skipped";
  ordersCount: number;
  executionsCount: number;
  probeCount: number;
  finishedAt: string;
  summary: string;
};

type PaperOrder = {
  id: string;
  session: PaperSession;
  strategyVersion: string;
  side: "buy" | "sell";
};

type PaperExecution = {
  id: string;
  session: PaperSession;
  strategyVersion: string;
  side: "buy" | "sell";
  realizedPnl: number;
  executedAt: string;
};

type PaperStatePayload = {
  state: {
    runs: PaperRun[];
    orders: PaperOrder[];
    executions: PaperExecution[];
    updatedAt: string;
  };
};

type StrategyMetric = {
  strategyVersion: string;
  sessions: string;
  runs: number;
  orders: number;
  executions: number;
  realizedPnl: number;
  winRate: number | null;
  averagePnl: number | null;
  maxDrawdown: number;
  lastSummary: string;
  lastFinishedAt: string | null;
  curve: number[];
};

const formatNumber = (value: number) =>
  Math.round(value).toLocaleString("ko-KR");

const Sparkline = ({ values }: { values: number[] }) => {
  if (values.length < 2) {
    return <p className={styles.empty}>손익곡선 데이터 부족</p>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 180;
      const y = 46 - ((value - min) / span) * 40;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={styles.sparkline} viewBox="0 0 180 52" role="img" aria-label="전략 손익곡선">
      <polyline points={points} />
    </svg>
  );
};

export default function StrategyPerformancePanel() {
  const [payload, setPayload] = useState<PaperStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/paper-trading/state", { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as PaperStatePayload & { error?: string } | null;
      if (!response.ok) {
        setError(json?.error ?? "페이퍼 성과를 불러오지 못했습니다.");
        return;
      }
      setPayload(json);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const metrics = useMemo<StrategyMetric[]>(() => {
    const state = payload?.state;
    if (!state) return [];
    const versions = new Set<string>();
    for (const run of state.runs) versions.add(run.strategyVersion);
    for (const execution of state.executions) versions.add(execution.strategyVersion);
    for (const order of state.orders) versions.add(order.strategyVersion);

    return [...versions].map((strategyVersion) => {
      const runs = state.runs.filter((run) => run.strategyVersion === strategyVersion);
      const orders = state.orders.filter((order) => order.strategyVersion === strategyVersion);
      const executions = state.executions
        .filter((execution) => execution.strategyVersion === strategyVersion)
        .toSorted((a, b) => a.executedAt.localeCompare(b.executedAt));
      const realizedPnl = executions.reduce((sum, execution) => sum + execution.realizedPnl, 0);
      const closedExecutions = executions.filter((execution) => execution.side === "sell" && execution.realizedPnl !== 0);
      const wins = closedExecutions.filter((execution) => execution.realizedPnl > 0).length;
      let cumulative = 0;
      let peak = 0;
      let maxDrawdown = 0;
      const curve = [0, ...executions.map((execution) => {
        cumulative += execution.realizedPnl;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
        return cumulative;
      })];
      const sessions = [...new Set([...runs.map((run) => run.session), ...executions.map((execution) => execution.session)])].join(", ");
      const lastRun = runs.toSorted((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0] ?? null;
      return {
        strategyVersion,
        sessions: sessions || "-",
        runs: runs.length,
        orders: orders.length,
        executions: executions.length,
        realizedPnl,
        winRate: closedExecutions.length ? wins / closedExecutions.length : null,
        averagePnl: closedExecutions.length ? realizedPnl / closedExecutions.length : null,
        maxDrawdown,
        lastSummary: lastRun?.summary ?? "실행 기록 없음",
        lastFinishedAt: lastRun?.finishedAt ?? null,
        curve,
      };
    }).toSorted((a, b) => (b.lastFinishedAt ?? "").localeCompare(a.lastFinishedAt ?? ""));
  }, [payload]);

  return (
    <section className={`${styles.panel} ${styles.widePanel}`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Performance</p>
          <h2>전략 성과 Cockpit</h2>
        </div>
        <span>{metrics.length} 전략</span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {!metrics.length ? (
        <p className={styles.empty}>아직 페이퍼 실행 기록이 없습니다.</p>
      ) : (
        <div className={styles.performanceGrid}>
          {metrics.slice(0, 4).map((metric) => (
            <article key={metric.strategyVersion} className={styles.performanceCard}>
              <div className={styles.performanceTop}>
                <div>
                  <span>{metric.sessions}</span>
                  <strong>{metric.strategyVersion}</strong>
                </div>
                <Sparkline values={metric.curve} />
              </div>
              <div className={styles.metricGrid}>
                <div><span>실현손익</span><strong>{formatNumber(metric.realizedPnl)}</strong></div>
                <div><span>MDD</span><strong>{formatNumber(metric.maxDrawdown)}</strong></div>
                <div><span>승률</span><strong>{metric.winRate === null ? "-" : `${Math.round(metric.winRate * 100)}%`}</strong></div>
                <div><span>평균손익</span><strong>{metric.averagePnl === null ? "-" : formatNumber(metric.averagePnl)}</strong></div>
                <div><span>주문</span><strong>{metric.orders}</strong></div>
                <div><span>체결</span><strong>{metric.executions}</strong></div>
              </div>
              <p>{metric.lastSummary}</p>
              {metric.lastFinishedAt ? <small>{new Date(metric.lastFinishedAt).toLocaleString("ko-KR")}</small> : null}
            </article>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} onClick={() => void load()} disabled={loading}>
          {loading ? "갱신 중" : "성과 갱신"}
        </button>
      </div>
    </section>
  );
}
