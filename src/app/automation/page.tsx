"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import styles from "./automation.module.css";
import BrokerCredentialPanel from "./BrokerCredentialPanel";
import ChartTradingPanel from "./ChartTradingPanel";
import LiveTradingToggle from "./LiveTradingToggle";
import OrderSyncPanel from "./OrderSyncPanel";
import ReadinessCenter from "./ReadinessCenter";
import StrategyBuilderPanel from "./StrategyBuilderPanel";
import StrategyManagerPanel from "./StrategyManagerPanel";
import StrategyPerformancePanel from "./StrategyPerformancePanel";
import TelegramPanel from "./TelegramPanel";

type SessionUser = { id: string; email?: string };
type AuthMode = "sign-in" | "sign-up";
type AuthResponse = {
  error?: string;
  user?: SessionUser | null;
  requiresEmailConfirmation?: boolean;
  provider?: string;
};

const readJsonPayload = async <T,>(response: Response): Promise<T | null> => {
  const payload = await response.json().catch(() => null);
  return payload as T | null;
};

export default function AutomationPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [provider, setProvider] = useState<string>("development");
  const [authMode, setAuthMode] = useState<AuthMode>("sign-up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [automationBeta, setAutomationBeta] = useState(false);
  const [brokerCredentials, setBrokerCredentials] = useState(false);
  const [betaCode, setBetaCode] = useState("");
  const [betaError, setBetaError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSession = async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const payload = (await response.json()) as { user: SessionUser | null; provider: string };
    setUser(payload.user);
    setProvider(payload.provider);
    if (payload.user) {
      const featureResponse = await fetch("/api/me/features", { cache: "no-store" });
      if (featureResponse.ok) {
        const featurePayload = (await featureResponse.json()) as {
          automationBeta?: boolean;
          brokerCredentials?: boolean;
        };
        setAutomationBeta(Boolean(featurePayload.automationBeta));
        setBrokerCredentials(Boolean(featurePayload.brokerCredentials));
      }
    } else {
      setAutomationBeta(false);
      setBrokerCredentials(false);
    }
  };

  useEffect(() => {
    void loadSession().finally(() => setAuthLoading(false));
  }, []);

  const submitAuth = async () => {
    setAuthError(null);
    setMessage(null);
    const safeEmail = email.trim();
    if (!safeEmail || password.length < 8) {
      setAuthError("이메일과 8자 이상 비밀번호가 필요합니다.");
      return;
    }
    if (authMode === "sign-up" && password !== confirmPassword) {
      setAuthError("비밀번호가 일치하지 않습니다.");
      return;
    }
    setWorking(true);
    const endpoint = authMode === "sign-up" ? "/api/auth/dev-sign-up" : "/api/auth/dev-sign-in";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: safeEmail, password }),
      });
      const payload = await readJsonPayload<AuthResponse>(response);
      if (!response.ok) {
        setAuthError(payload?.error ?? `인증 요청에 실패했습니다. (${response.status})`);
        return;
      }
      if (authMode === "sign-up" && payload?.requiresEmailConfirmation) {
        setMessage("회원가입 요청이 접수되었습니다. 이메일 인증 후 로그인해 주세요.");
        setAuthMode("sign-in");
        return;
      }
      await loadSession();
      setMessage(authMode === "sign-up" ? "회원가입과 로그인이 완료되었습니다." : "로그인되었습니다.");
    } catch {
      setAuthError("인증 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    setUser(null);
    setAutomationBeta(false);
    setBrokerCredentials(false);
  };

  const redeemBeta = async () => {
    setBetaError(null);
    setWorking(true);
    try {
      const response = await fetch("/api/beta/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: betaCode }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setBetaError(payload.error ?? "베타 코드 등록에 실패했습니다.");
        return;
      }
      setAutomationBeta(true);
      setMessage("베타 자동매매 권한이 활성화되었습니다.");
      window.dispatchEvent(new Event("automation-readiness-refresh"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Automation Beta</p>
          <h1>토스 연결 투자 워크벤치</h1>
          <p>토스 API 키를 연결해 보유 주식, 주문 가능 정보, 체결 상태를 확인하고 전략은 베타 권한 뒤에서 검증합니다.</p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/?tab=analysis" className={styles.buttonPrimary}>종목분석으로</Link>
          {user ? (
            <button type="button" className={styles.buttonGhost} onClick={() => void signOut()}>
              로그아웃
            </button>
          ) : null}
        </div>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      {authLoading ? (
        <section className={styles.panel}>
          <strong>세션 확인 중입니다.</strong>
        </section>
      ) : !user ? (
        <section className={styles.authGrid}>
          <article className={styles.panel}>
            <p className={styles.kicker}>Auth</p>
            <h2>{authMode === "sign-up" ? "회원가입" : "로그인"}</h2>
            <div className={styles.segmented}>
              <button
                type="button"
                className={authMode === "sign-up" ? styles.active : ""}
                onClick={() => setAuthMode("sign-up")}
                aria-pressed={authMode === "sign-up"}
              >
                회원가입 모드
              </button>
              <button
                type="button"
                className={authMode === "sign-in" ? styles.active : ""}
                onClick={() => setAuthMode("sign-in")}
                aria-pressed={authMode === "sign-in"}
              >
                로그인 모드
              </button>
            </div>
            <form
              className={styles.authForm}
              onSubmit={(event) => {
                event.preventDefault();
                void submitAuth();
              }}
            >
              <label>
                이메일
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                비밀번호
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="8자 이상"
                  autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
                  minLength={8}
                  required
                />
              </label>
              {authMode === "sign-up" ? (
                <label>
                  비밀번호 확인
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="비밀번호 재입력"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              ) : null}
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
              </button>
              <button type="submit" className={styles.buttonPrimary} disabled={working}>
                {working ? "처리 중…" : authMode === "sign-up" ? "가입하고 시작" : "로그인"}
              </button>
            </form>
            {authError ? (
              <p className={styles.error} role="alert">
                {authError}
              </p>
            ) : null}
          </article>
          <article className={styles.panel}>
            <p className={styles.kicker}>Security Gate</p>
            <h2>토스 연결은 로그인 후 가능합니다</h2>
            <p>회원가입 후 토스 API 키를 등록하면 포트폴리오 개인화 기능을 사용할 수 있습니다. 자동매매 전략 실행은 별도 베타 권한이 필요합니다.</p>
          </article>
        </section>
      ) : (
        <section className={styles.workspace}>
          <ReadinessCenter />
          <BrokerCredentialPanel />
          <TelegramPanel />
          {!automationBeta ? (
            <section className={styles.authGrid}>
              <article className={styles.panel}>
                <p className={styles.kicker}>Beta Access</p>
                <h2>전략 실행 베타 코드</h2>
                <p>
                  {user.email ?? user.id} 계정으로 로그인되었습니다. 현재 인증 제공자는 {provider}입니다. 토스 연결
                  {brokerCredentials ? " 권한은 활성화되어 있습니다." : " 후 포트폴리오 개인화부터 사용할 수 있습니다."}
                </p>
                <label>
                  베타 코드
                  <input value={betaCode} onChange={(event) => setBetaCode(event.target.value)} />
                </label>
                <button type="button" className={styles.buttonPrimary} onClick={() => void redeemBeta()} disabled={working}>
                  {working ? "확인 중" : "전략 베타 권한 활성화"}
                </button>
                {betaError ? <p className={styles.error}>{betaError}</p> : null}
              </article>
              <article className={styles.panel}>
                <p className={styles.kicker}>Safe Default</p>
                <h2>실거래는 기본 OFF</h2>
                <p>토스 키를 등록해도 주문 전송은 켜지지 않습니다. 전략 저장과 실행 API는 베타 권한이 없으면 서버에서 `403`으로 차단됩니다.</p>
              </article>
            </section>
          ) : (
            <>
              <LiveTradingToggle />
              <ChartTradingPanel />
              <StrategyPerformancePanel />
              <StrategyBuilderPanel />
              <StrategyManagerPanel />
              <OrderSyncPanel />
            </>
          )}
        </section>
      )}
    </main>
  );
}
