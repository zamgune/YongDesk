-- 사용자별 텔레그램 알림 수신 chat_id (없으면 서버 공통 TELEGRAM_CHAT_ID 사용)
alter table public.profiles add column if not exists telegram_chat_id text;
