"use client";

import { useEffect, useState } from "react";

import styles from "./automation.module.css";

type TelegramResponse = {
  chatId?: string | null;
  botConfigured?: boolean;
  testSent?: boolean;
  error?: string;
};

export default function TelegramPanel() {
  const [chatId, setChatId] = useState("");
  const [savedChatId, setSavedChatId] = useState<string | null>(null);
  const [botConfigured, setBotConfigured] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/me/telegram", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as TelegramResponse;
        setSavedChatId(payload.chatId ?? null);
        setChatId(payload.chatId ?? "");
        setBotConfigured(payload.botConfigured !== false);
      }
    })();
  }, []);

  const save = async () => {
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      const response = await fetch("/api/me/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatId.trim() }),
      });
      const payload = (await response.json()) as TelegramResponse;
      if (!response.ok) {
        setError(payload.error ?? "저장에 실패했습니다.");
        return;
      }
      setSavedChatId(payload.chatId ?? null);
      if (!payload.chatId) {
        setNotice("개인 알림을 해제했습니다.");
      } else if (payload.testSent) {
        setNotice("저장 완료 — 텔레그램으로 테스트 메시지를 보냈습니다.");
      } else {
        setError(payload.error ?? "저장은 됐지만 테스트 전송에 실패했습니다.");
      }
    } catch {
      setError("저장 요청 중 오류가 발생했습니다.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <article className={styles.panel}>
      <p className={styles.kicker}>Telegram Alerts</p>
      <h2>자동매매 텔레그램 알림</h2>
      <p>
        자동매매 주문·체결이 발생하면 텔레그램으로 알림을 보냅니다. 텔레그램에서 알림 봇에게 먼저 말을 건 뒤,{" "}
        <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a>에게 말을 걸면 내 chat id를
        알려줍니다.
      </p>
      {!botConfigured ? <p className={styles.error}>서버에 텔레그램 봇 토큰이 설정되지 않아 알림이 비활성 상태입니다.</p> : null}
      <label>
        내 텔레그램 chat id
        <input
          value={chatId}
          onChange={(event) => setChatId(event.target.value)}
          placeholder="예: 123456789"
          inputMode="numeric"
        />
      </label>
      <button type="button" className={styles.buttonPrimary} onClick={() => void save()} disabled={working}>
        {working ? "저장 중" : "저장하고 테스트 전송"}
      </button>
      {savedChatId ? <p>현재 등록: {savedChatId}</p> : <p>등록된 chat id가 없으면 알림이 서버 공용 채팅으로만 갑니다.</p>}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </article>
  );
}
