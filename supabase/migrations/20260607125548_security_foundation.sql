create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_position_id text not null,
  symbol text not null,
  name text,
  market text not null default 'US',
  currency text not null check (currency in ('USD', 'KRW')),
  quantity numeric(28, 10) not null check (quantity > 0),
  average_price numeric(28, 10) not null check (average_price > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_position_id)
);

create table public.paper_trading_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session text not null check (session in ('US', 'KR')),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session)
);

create table public.strategy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_type text not null,
  market text not null,
  name text not null,
  config jsonb not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.broker_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null check (broker in ('upbit', 'bithumb', 'toss')),
  masked_identifier text,
  encrypted_access_key text not null,
  encrypted_secret_key text,
  encrypted_passphrase text,
  encryption_key_id text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'disabled')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broker)
);

create table public.order_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_credential_id uuid references public.broker_credentials(id) on delete set null,
  market text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  order_type text not null,
  quantity numeric(28, 10),
  notional numeric(28, 10),
  limit_price numeric(28, 10),
  status text not null default 'draft' check (status in ('draft', 'blocked', 'approved', 'submitted', 'cancelled', 'failed')),
  strategy_config_id uuid references public.strategy_configs(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.risk_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_intent_id uuid not null references public.order_intents(id) on delete cascade,
  passed boolean not null,
  checks jsonb not null,
  created_at timestamptz not null default now()
);

create table public.execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_intent_id uuid references public.order_intents(id) on delete set null,
  broker text,
  broker_order_id text,
  level text not null default 'info' check (level in ('info', 'warning', 'error')),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger portfolios_set_updated_at
before update on public.portfolios
for each row execute function public.set_updated_at();

create trigger paper_trading_states_set_updated_at
before update on public.paper_trading_states
for each row execute function public.set_updated_at();

create trigger strategy_configs_set_updated_at
before update on public.strategy_configs
for each row execute function public.set_updated_at();

create trigger broker_credentials_set_updated_at
before update on public.broker_credentials
for each row execute function public.set_updated_at();

create trigger order_intents_set_updated_at
before update on public.order_intents
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.paper_trading_states enable row level security;
alter table public.strategy_configs enable row level security;
alter table public.broker_credentials enable row level security;
alter table public.order_intents enable row level security;
alter table public.risk_checks enable row level security;
alter table public.execution_logs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.portfolios to authenticated;
grant select, insert, update, delete on public.paper_trading_states to authenticated;
grant select, insert, update, delete on public.strategy_configs to authenticated;
grant select, insert, update, delete on public.order_intents to authenticated;
grant select, insert, update, delete on public.risk_checks to authenticated;
grant select, insert, update, delete on public.execution_logs to authenticated;
revoke all on public.broker_credentials from anon, authenticated;
grant all on public.broker_credentials to service_role;

create policy "profiles owner select"
on public.profiles for select
to authenticated
using (user_id = (select auth.uid()));

create policy "profiles owner insert"
on public.profiles for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "profiles owner update"
on public.profiles for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "profiles owner delete"
on public.profiles for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "portfolios owner select"
on public.portfolios for select
to authenticated
using (user_id = (select auth.uid()));

create policy "portfolios owner insert"
on public.portfolios for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "portfolios owner update"
on public.portfolios for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "portfolios owner delete"
on public.portfolios for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "paper states owner select"
on public.paper_trading_states for select
to authenticated
using (user_id = (select auth.uid()));

create policy "paper states owner insert"
on public.paper_trading_states for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "paper states owner update"
on public.paper_trading_states for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "paper states owner delete"
on public.paper_trading_states for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "strategy configs owner select"
on public.strategy_configs for select
to authenticated
using (user_id = (select auth.uid()));

create policy "strategy configs owner insert"
on public.strategy_configs for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "strategy configs owner update"
on public.strategy_configs for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "strategy configs owner delete"
on public.strategy_configs for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "order intents owner select"
on public.order_intents for select
to authenticated
using (user_id = (select auth.uid()));

create policy "order intents owner insert"
on public.order_intents for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "order intents owner update"
on public.order_intents for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "order intents owner delete"
on public.order_intents for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "risk checks owner select"
on public.risk_checks for select
to authenticated
using (user_id = (select auth.uid()));

create policy "risk checks owner insert"
on public.risk_checks for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "risk checks owner update"
on public.risk_checks for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "risk checks owner delete"
on public.risk_checks for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "execution logs owner select"
on public.execution_logs for select
to authenticated
using (user_id = (select auth.uid()));

create policy "execution logs owner insert"
on public.execution_logs for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "execution logs owner update"
on public.execution_logs for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "execution logs owner delete"
on public.execution_logs for delete
to authenticated
using (user_id = (select auth.uid()));
