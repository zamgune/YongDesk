import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";

/**
 * 텔레그램 알림. 봇 토큰은 서버 공통(TELEGRAM_BOT_TOKEN), 수신 chat_id는
 * 사용자별(profiles.telegram_chat_id) 우선, 없으면 서버 공통(TELEGRAM_CHAT_ID).
 * 알림 실패가 매매 흐름을 절대 막지 않도록 오류는 삼킨다.
 */
export const sendTelegramMessage = async (text: string, chatId?: string | null): Promise<boolean> => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const target = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!token || !target || !text.trim()) {
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target, text }),
    });
    return response.ok;
  } catch {
    // ponytail: 알림은 best-effort — 실패해도 매매는 계속
    return false;
  }
};

export const isTelegramBotConfigured = (): boolean => Boolean(process.env.TELEGRAM_BOT_TOKEN);

// ponytail: Supabase 미설정(로컬 dev)이면 개인 chat_id 저장 없이 env 공통값만 사용
export const getUserTelegramChatId = async (userId: string): Promise<string | null> => {
  if (!getSupabaseAdminConfig()) {
    return null;
  }
  try {
    const { data } = await createSupabaseAdminClient()
      .from("profiles")
      .select("telegram_chat_id")
      .eq("user_id", userId)
      .maybeSingle();
    const chatId = data?.telegram_chat_id;
    return typeof chatId === "string" && chatId.trim() ? chatId.trim() : null;
  } catch {
    return null;
  }
};

export const setUserTelegramChatId = async (userId: string, chatId: string | null): Promise<void> => {
  if (!getSupabaseAdminConfig()) {
    throw new Error("개인 알림 설정에는 Supabase 저장소가 필요합니다.");
  }
  const { error } = await createSupabaseAdminClient()
    .from("profiles")
    .upsert({ user_id: userId, telegram_chat_id: chatId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    throw new Error(`텔레그램 설정 저장 실패: ${error.message}`);
  }
};
