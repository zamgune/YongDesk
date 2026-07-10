-- 자동매매 실행 영속화: order_intents 를 브로커 주문 추적 + 체결 상태까지 담도록 확장하고,
-- 워커 멱등 상태 테이블을 추가합니다. (파일 store 를 대체)

-- 1) order_intents: 브로커 주문 추적/체결 컬럼 추가
alter table public.order_intents
  add column if not exists broker_order_id text,
  add column if not exists client_order_id text,
  add column if not exists account_seq bigint,
  add column if not exists step_id text,
  add column if not exists broker_status text,
  add column if not exists filled_quantity numeric(28, 10) not null default 0,
  add column if not exists average_filled_price numeric(28, 10),
  add column if not exists terminal boolean not null default false,
  add column if not exists last_synced_at timestamptz,
  -- 전략 store 가 아직 파일 기반이므로 FK 대신 식별 문자열로 보관
  add column if not exists strategy_key text;

-- 상태 체크 제약 확장 (체결 라이프사이클 반영)
alter table public.order_intents drop constraint if exists order_intents_status_check;
alter table public.order_intents
  add constraint order_intents_status_check
  check (status in ('draft', 'blocked', 'approved', 'submitted', 'partial_filled', 'filled', 'cancelled', 'canceled', 'rejected', 'failed'));

-- 멱등성: 사용자별 브로커 주문 ID 유일
create unique index if not exists order_intents_user_broker_order_id_idx
  on public.order_intents (user_id, broker_order_id)
  where broker_order_id is not null;

-- 2) 워커 멱등 상태 (일일 발동 stepKey/카운트)
create table if not exists public.automation_worker_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_config_id uuid,
  strategy_key text not null,
  trade_date date not null,
  executed_step_keys text[] not null default '{}',
  buys integer not null default 0,
  sells integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_key, trade_date)
);

create trigger automation_worker_state_set_updated_at
before update on public.automation_worker_state
for each row execute function public.set_updated_at();

alter table public.automation_worker_state enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.automation_worker_state to authenticated;

create policy "worker state owner select"
on public.automation_worker_state for select
to authenticated
using (user_id = (select auth.uid()));

create policy "worker state owner insert"
on public.automation_worker_state for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "worker state owner update"
on public.automation_worker_state for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "worker state owner delete"
on public.automation_worker_state for delete
to authenticated
using (user_id = (select auth.uid()));
