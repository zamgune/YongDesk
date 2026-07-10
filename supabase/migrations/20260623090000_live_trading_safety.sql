-- 실거래 안전장치: 기능 권한과 grid/loop 전략 상태를 durable store 로 이동합니다.
-- 기능 권한은 실거래 게이트의 일부이므로 클라이언트 직접 쓰기를 허용하지 않습니다.

create table if not exists public.automation_feature_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('automation_beta', 'live_trading', 'broker_credentials')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature)
);

create table if not exists public.automation_strategy_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_key text not null,
  state_type text not null check (state_type in ('grid', 'loop')),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_key, state_type)
);

drop trigger if exists automation_feature_access_set_updated_at on public.automation_feature_access;
create trigger automation_feature_access_set_updated_at
before update on public.automation_feature_access
for each row execute function public.set_updated_at();

drop trigger if exists automation_strategy_state_set_updated_at on public.automation_strategy_state;
create trigger automation_strategy_state_set_updated_at
before update on public.automation_strategy_state
for each row execute function public.set_updated_at();

alter table public.automation_feature_access enable row level security;
alter table public.automation_strategy_state enable row level security;

revoke all on public.automation_feature_access from anon, authenticated;
revoke all on public.automation_strategy_state from anon, authenticated;

grant select on public.automation_feature_access to authenticated;
grant select on public.automation_strategy_state to authenticated;
grant all on public.automation_feature_access to service_role;
grant all on public.automation_strategy_state to service_role;

drop policy if exists "automation feature owner select" on public.automation_feature_access;
create policy "automation feature owner select"
on public.automation_feature_access for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "automation strategy state owner select" on public.automation_strategy_state;
create policy "automation strategy state owner select"
on public.automation_strategy_state for select
to authenticated
using (user_id = (select auth.uid()));
