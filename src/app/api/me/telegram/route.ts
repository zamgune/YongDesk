import { getUserTelegramChatId, isTelegramBotConfigured, sendTelegramMessage, setUserTelegramChatId } from "@/lib/notify/telegram";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type TelegramPayload = {
  chatId?: unknown;
};

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const chatId = await getUserTelegramChatId(auth.userContext.userId);
  return Response.json({ chatId, botConfigured: isTelegramBotConfigured() });
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "telegram-settings", { limit: 10, windowMs: 60_000 });
  if (limited) {
    return limited;
  }
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const userId = auth.userContext.userId;
  const payload = (await request.json().catch(() => ({}))) as TelegramPayload;
  const chatId = typeof payload.chatId === "string" ? payload.chatId.trim() : "";

  try {
    await setUserTelegramChatId(userId, chatId || null);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "텔레그램 설정 저장 실패" },
      { status: 503 },
    );
  }

  if (!chatId) {
    return Response.json({ chatId: null, testSent: false });
  }
  if (!isTelegramBotConfigured()) {
    return Response.json({ chatId, testSent: false, error: "서버에 TELEGRAM_BOT_TOKEN이 설정되지 않았습니다." });
  }
  const testSent = await sendTelegramMessage("🔔 자동매매 알림 연결이 완료되었습니다.", chatId);
  return Response.json({
    chatId,
    testSent,
    error: testSent ? undefined : "테스트 전송 실패 — chat_id를 확인하고 봇에게 먼저 말을 걸었는지 확인하세요.",
  });
}
