"use client";

import { useEffect, useMemo, useState } from "react";

import type { AutomationMarket, AutomationMode, AutomationStrategyStatus } from "@/domain/automation";
import styles from "./automation.module.css";

type StrategySimulation = {
  configHash: string;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  summary: string;
  simulatedAt: string;
};

type StrategyConfigView = {
  id: string;
  name: string;
  symbol: string;
  market: AutomationMarket;
  mode?: AutomationMode;
  status: AutomationStrategyStatus;
  currentPrice: number;
  currentConfigHash?: string;
  lastSimulation?: StrategySimulation;
  updatedAt: string;
};

type StrategyConfigResponse = {
  configs?: StrategyConfigView[];
  error?: string;
};

type StrategyActionResponse = {
  config?: StrategyConfigView;
  result?: {
    riskCheck?: {
      passed: boolean;
      blockers: string[];
      warnings: string[];
    };
    summary?: string;
  };
  liveTradingEnabled?: boolean;
  results?: unknown[];
  error?: string;
};

const STATUS_LABEL: Record<AutomationStrategyStatus, string> = {
  draft: "초안",
  enabled: "활성",
  disabled: "일시정지",
};

const modeLabel = (mode: AutomationMode | undefined) => {
  if (mode === "loop-grid") return "순환";
  if (mode === "percent-grid") return "분할";
  return "사다리";
};

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ko-KR") : "기록 없음";

export default function StrategyManagerPanel() {
  const [configs, setConfigs] = useState<StrategyConfigView[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledCount = useMemo(
    () => configs.filter((config) => config.status === "enabled").length,
    [configs],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/strategy-configs", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as StrategyConfigResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? "전략 목록을 불러오지 못했습니다.");
        return;
      }
      setConfigs(payload?.configs ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("strategy-configs-refresh", refresh);
    return () => window.removeEventListener("strategy-configs-refresh", refresh);
  }, []);

  const runAction = async (
    id: string,
    request: () => Promise<Response>,
    success: (payload: StrategyActionResponse) => string,
  ) => {
    setWorkingId(id);
    setError(null);
    setMessage(null);
    try {
      const response = await request();
      const payload = (await response.json().catch(() => null)) as StrategyActionResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? "전략 작업에 실패했습니다.");
        return;
      }
      setMessage(success(payload ?? {}));
      await load();
    } finally {
      setWorkingId(null);
    }
  };

  const simulate = (id: string) =>
    runAction(
      id,
      () => fetch(`/api/strategy-configs/${encodeURIComponent(id)}/simulate`, { method: "POST" }),
      (payload) => payload.result?.summary ?? "시뮬레이션을 완료했습니다.",
    );

  const setStatus = (id: string, status: AutomationStrategyStatus) =>
    runAction(
      id,
      () => fetch(`/api/strategy-configs/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
      () => (status === "enabled" ? "전략을 활성화했습니다." : "전략을 일시정지했습니다."),
    );

  const deleteConfig = (id: string) => {
    if (!window.confirm("이 전략을 삭제할까요?")) {
      return;
    }
    void runAction(
      id,
      () => fetch(`/api/strategy-configs/${encodeURIComponent(id)}`, { method: "DELETE" }),
      () => "전략을 삭제했습니다.",
    );
  };

  const runTick = (id: string) =>
    runAction(
      id,
      () => fetch("/api/automation/worker/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: id }),
      }),
      (payload) => `워커 평가 완료 (전략 ${payload.results?.length ?? 0}개, 실거래 ${payload.liveTradingEnabled ? "ON" : "OFF"}).`,
    );

  return (
    <section className={`${styles.panel} ${styles.widePanel}`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Strategy Control</p>
          <h2>내 전략 관리</h2>
        </div>
        <span>{enabledCount} 활성</span>
      </div>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {configs.length ? (
        <div className={styles.intentList}>
          {configs.map((config) => {
            const stale = Boolean(
              config.lastSimulation &&
              config.currentConfigHash &&
              config.lastSimulation.configHash !== config.currentConfigHash,
            );
            const canEnable = Boolean(config.lastSimulation?.passed && !stale);
            const busy = workingId === config.id;
            return (
              <article key={config.id}>
                <strong>{config.name}</strong>
                <span>{STATUS_LABEL[config.status]}</span>
                <p>
                  {config.market} {config.symbol} · {modeLabel(config.mode)} · 기준가 {Math.round(config.currentPrice).toLocaleString("ko-KR")}
                </p>
                <p>
                  최근 시뮬레이션: {config.lastSimulation ? config.lastSimulation.summary : "없음"}
                  {stale ? " · 설정 변경 후 재검증 필요" : ""}
                </p>
                <small>{formatDate(config.lastSimulation?.simulatedAt ?? config.updatedAt)}</small>
                {config.lastSimulation?.blockers.length ? (
                  <p className={styles.error}>{config.lastSimulation.blockers[0]}</p>
                ) : null}
                {config.lastSimulation?.warnings.length ? (
                  <p className={styles.empty}>{config.lastSimulation.warnings[0]}</p>
                ) : null}
                <div className={styles.actions}>
                  <button type="button" className={styles.buttonSecondary} onClick={() => void simulate(config.id)} disabled={busy}>
                    {busy ? "처리 중" : "시뮬레이션"}
                  </button>
                  {config.status === "enabled" ? (
                    <button type="button" className={styles.buttonSecondary} onClick={() => void setStatus(config.id, "disabled")} disabled={busy}>
                      일시정지
                    </button>
                  ) : (
                    <button type="button" className={styles.buttonPrimary} onClick={() => void setStatus(config.id, "enabled")} disabled={busy || !canEnable}>
                      활성화
                    </button>
                  )}
                  <button type="button" className={styles.buttonSecondary} onClick={() => void runTick(config.id)} disabled={busy || config.status !== "enabled"}>
                    워커 평가
                  </button>
                  <button type="button" className={styles.buttonDanger} onClick={() => deleteConfig(config.id)} disabled={busy}>
                    삭제
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>{loading ? "전략 목록을 불러오는 중입니다." : "저장된 전략이 없습니다."}</p>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} onClick={() => void load()} disabled={loading}>
          {loading ? "갱신 중" : "전략 목록 갱신"}
        </button>
      </div>
    </section>
  );
}
