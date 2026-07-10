"use client";

import { useEffect, useState } from "react";

import styles from "./automation.module.css";

type FeaturePayload = {
  liveTrading?: boolean;
  liveTradingMasterEnabled?: boolean;
  liveTradingEffective?: boolean;
  liveTradingBlockedReason?: string | null;
};

export default function LiveTradingToggle() {
  const [liveTrading, setLiveTrading] = useState(false);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [effective, setEffective] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/me/features", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as FeaturePayload;
    setLiveTrading(Boolean(payload.liveTrading));
    setMasterEnabled(Boolean(payload.liveTradingMasterEnabled));
    setEffective(Boolean(payload.liveTradingEffective));
    setBlockedReason(payload.liveTradingBlockedReason ?? null);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/me/live-trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !liveTrading }),
      });
      const payload = (await response.json()) as FeaturePayload & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "실거래 설정 변경에 실패했습니다.");
        return;
      }
      setLiveTrading(Boolean(payload.liveTrading));
      setMasterEnabled(Boolean(payload.liveTradingMasterEnabled));
      setEffective(Boolean(payload.liveTradingEffective));
      setBlockedReason(payload.liveTradingBlockedReason ?? null);
      window.dispatchEvent(new Event("live-trading-changed"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Live Trading</p>
          <h2>실거래 ON/OFF</h2>
        </div>
        <span>{effective ? "실거래 가능" : "실거래 차단"}</span>
      </div>
      <label className={styles.switchRow}>
        <input type="checkbox" checked={liveTrading} onChange={() => void toggle()} disabled={working} />
        <strong>{liveTrading ? "사용자 토글 ON" : "사용자 토글 OFF"}</strong>
      </label>
      <p className={styles.empty}>
        서버 킬스위치 {masterEnabled ? "ON" : "OFF"} · 실제 주문은 사용자 토글과 서버 킬스위치가 모두 켜진 경우만 전송됩니다.
      </p>
      {!effective && blockedReason ? <p className={styles.empty}>{blockedReason}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
