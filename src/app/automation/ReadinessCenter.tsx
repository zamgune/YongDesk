"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./automation.module.css";

type ReadinessStatus = "pass" | "warn" | "fail";
type ReadinessOwner = "operator" | "user" | "system";

type ReadinessItem = {
  id: string;
  owner: ReadinessOwner;
  status: ReadinessStatus;
  label: string;
  summary: string;
  action: string;
  blocking: boolean;
};

type ReadinessPayload = {
  generatedAt: string;
  overall: "ready" | "limited" | "blocked";
  operatorVisible: boolean;
  storageMode: "supabase" | "local-file" | "hidden";
  env?: {
    nodeEnv: string;
    supabasePublicConfigured: boolean;
    supabaseAdminConfigured: boolean;
    credentialEncryptionConfigured: boolean;
    liveTradingMasterEnabled: boolean;
  };
  user: {
    automationBeta: boolean;
    brokerCredentials: boolean;
    liveTrading: boolean;
    liveTradingEffective: boolean;
  };
  items: ReadinessItem[];
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  pass: "통과",
  warn: "주의",
  fail: "차단",
};

const OWNER_LABEL: Record<ReadinessOwner, string> = {
  operator: "운영자 설정",
  user: "사용자 단계",
  system: "실행 게이트",
};

const statusClass = (status: ReadinessStatus) => {
  if (status === "pass") return styles.statusPass;
  if (status === "warn") return styles.statusWarn;
  return styles.statusFail;
};

const overallText = (payload: ReadinessPayload | null) => {
  if (!payload) return "확인 중";
  if (payload.overall === "ready") return "실거래 준비 완료";
  if (payload.overall === "limited") return "조회·검증 가능";
  return "설정 필요";
};

const visibleOwners = (payload: ReadinessPayload | null): ReadinessOwner[] =>
  payload?.operatorVisible ? ["operator", "user", "system"] : ["user", "system"];

export default function ReadinessCenter() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/automation/readiness", { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as ReadinessPayload & { error?: string } | null;
      if (!response.ok) {
        setError(json?.error ?? "준비 상태를 확인하지 못했습니다.");
        return;
      }
      if (!json) {
        setError("준비 상태 응답이 비어 있습니다.");
        return;
      }
      setPayload(json);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener("broker-credentials-changed", reload);
    window.addEventListener("live-trading-changed", reload);
    window.addEventListener("automation-readiness-refresh", reload);
    return () => {
      window.removeEventListener("broker-credentials-changed", reload);
      window.removeEventListener("live-trading-changed", reload);
      window.removeEventListener("automation-readiness-refresh", reload);
    };
  }, []);

  const grouped = useMemo(() => {
    const initial: Record<ReadinessOwner, ReadinessItem[]> = {
      operator: [],
      user: [],
      system: [],
    };
    for (const item of payload?.items ?? []) {
      initial[item.owner].push(item);
    }
    return initial;
  }, [payload]);

  const counts = useMemo(() => {
    const items = payload?.items ?? [];
    return {
      fail: items.filter((item) => item.status === "fail").length,
      warn: items.filter((item) => item.status === "warn").length,
      pass: items.filter((item) => item.status === "pass").length,
    };
  }, [payload]);

  return (
    <section className={`${styles.panel} ${styles.widePanel}`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Readiness Center</p>
          <h2>{payload?.operatorVisible ? "운영 준비 상태" : "내 자동매매 준비 상태"}</h2>
        </div>
        <span className={payload?.overall === "ready" ? styles.statusPass : payload?.overall === "limited" ? styles.statusWarn : styles.statusFail}>
          {overallText(payload)}
        </span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.readinessSummary}>
        <article>
          <span>{payload?.operatorVisible ? "저장소" : "표시 범위"}</span>
          <strong>
            {payload?.operatorVisible
              ? payload.storageMode === "supabase" ? "Supabase" : "Local file"
              : "내 계정"}
          </strong>
        </article>
        <article>
          <span>통과</span>
          <strong>{counts.pass}</strong>
        </article>
        <article>
          <span>주의</span>
          <strong>{counts.warn}</strong>
        </article>
        <article>
          <span>차단</span>
          <strong>{counts.fail}</strong>
        </article>
      </div>

      <div className={styles.readinessGroups}>
        {visibleOwners(payload).map((owner) => (
          <article key={owner} className={styles.readinessGroup}>
            <h3>{OWNER_LABEL[owner]}</h3>
            <div className={styles.readinessItems}>
              {grouped[owner].map((item) => (
                <div key={item.id} className={styles.readinessItem}>
                  <span className={statusClass(item.status)}>{STATUS_LABEL[item.status]}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.summary}</p>
                    {item.status !== "pass" ? <small>{item.action}</small> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} onClick={() => void load()} disabled={loading}>
          {loading ? "확인 중" : "다시 확인"}
        </button>
      </div>
      {payload ? <p className={styles.empty}>마지막 확인 {new Date(payload.generatedAt).toLocaleString("ko-KR")}</p> : null}
    </section>
  );
}
