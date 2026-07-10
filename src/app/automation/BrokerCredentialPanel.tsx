"use client";

import { useEffect, useState } from "react";

import styles from "./automation.module.css";

type CredentialStatus = "pending" | "verified" | "failed" | "disabled";

type CredentialView = {
  broker: "toss";
  maskedIdentifier: string;
  status: CredentialStatus;
  lastVerifiedAt: string | null;
  updatedAt: string;
};

type AccountView = {
  accountNo: string;
  accountSeq: number;
  accountType: string;
};

type ApiErrorPayload = {
  error?: string;
  requestId?: string;
  toss?: {
    guidance?: string;
    requestId?: string;
  };
};

const STATUS_LABEL: Record<CredentialStatus, string> = {
  pending: "검증 대기",
  verified: "검증 완료",
  failed: "검증 실패",
  disabled: "비활성",
};

const formatApiError = (payload: ApiErrorPayload, fallback: string) => {
  const details = [
    payload.error,
    payload.toss?.guidance,
    payload.requestId || payload.toss?.requestId ? `requestId ${payload.requestId ?? payload.toss?.requestId}` : null,
  ].filter(Boolean);
  return details.join(" · ") || fallback;
};

export default function BrokerCredentialPanel() {
  const [credential, setCredential] = useState<CredentialView | null>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = async () => {
    const response = await fetch("/api/broker/credentials", { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { credential: CredentialView | null };
      setCredential(payload.credential);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const register = async () => {
    setError(null);
    setNotice(null);
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("client_id와 client_secret을 모두 입력하세요.");
      return;
    }
    setWorking(true);
    try {
      const response = await fetch("/api/broker/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      const payload = (await response.json()) as {
        credential?: CredentialView;
        accounts?: AccountView[];
        error?: string;
      } & ApiErrorPayload;
      if (!response.ok) {
        setError(formatApiError(payload, "자격증명 등록에 실패했습니다."));
        await loadStatus();
        return;
      }
      setCredential(payload.credential ?? null);
      setAccounts(payload.accounts ?? []);
      setClientSecret(""); // 시크릿은 화면에 남기지 않음
      window.dispatchEvent(new Event("broker-credentials-changed"));
      setNotice(
        `검증 완료 · 계좌 ${payload.accounts?.length ?? 0}개를 확인했습니다. 실거래는 여전히 OFF 상태입니다.`,
      );
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await fetch("/api/broker/credentials", { method: "DELETE" });
      setCredential(null);
      setAccounts([]);
      window.dispatchEvent(new Event("broker-credentials-changed"));
      setNotice("등록된 토스 자격증명을 삭제했습니다.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Broker Link</p>
          <h2>토스 API 연동</h2>
        </div>
        <span>{credential ? STATUS_LABEL[credential.status] : "미등록"}</span>
      </div>

      <p className={styles.empty}>
        토스증권 Open API의 client_id / client_secret을 등록하면 서버에서 암호화 저장 후 토큰
        발급·계좌 조회로 검증합니다. 시크릿은 평문으로 보관하지 않습니다.
      </p>

      {credential ? (
        <div className={styles.resultGrid}>
          <article>
            <span>client_id</span>
            <strong>{credential.maskedIdentifier}</strong>
            <p>마지막 갱신 {new Date(credential.updatedAt).toLocaleString("ko-KR")}</p>
          </article>
          <article>
            <span>상태</span>
            <strong>{STATUS_LABEL[credential.status]}</strong>
            <p>
              {credential.lastVerifiedAt
                ? `검증 ${new Date(credential.lastVerifiedAt).toLocaleString("ko-KR")}`
                : "아직 검증되지 않음"}
            </p>
          </article>
          <article>
            <span>실거래</span>
            <strong>OFF</strong>
            <p>검증만 수행 · 주문은 전송되지 않음</p>
          </article>
        </div>
      ) : null}

      {accounts.length ? (
        <div className={styles.intentList}>
          {accounts.map((account) => (
            <article key={account.accountSeq}>
              <strong>계좌 {account.accountNo}</strong>
              <span>{account.accountType}</span>
              <p>accountSeq {account.accountSeq}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className={styles.formGrid}>
        <label>
          client_id
          <input
            value={clientId}
            placeholder="c_..."
            autoComplete="off"
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <label>
          client_secret
          <input
            type="password"
            value={clientSecret}
            placeholder="s_..."
            autoComplete="off"
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.buttonPrimary} onClick={() => void register()} disabled={working}>
          {working ? "검증 중" : credential ? "재등록·재검증" : "등록하고 검증"}
        </button>
        {credential ? (
          <button type="button" className={styles.buttonDanger} onClick={() => void remove()} disabled={working}>
            삭제
          </button>
        ) : null}
      </div>

      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
