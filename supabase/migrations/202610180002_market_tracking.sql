-- Market data is shared by product code; estimates and tracking state are private
-- to each authenticated portfolio owner.
alter table public.user_portfolios alter column schema_version set default 3;
alter table public.user_portfolios alter column state set default '{"schemaVersion":3,"holdings":[],"profile":{"answers":{},"savedAt":null,"allocationTargets":{}}}'::jsonb;
alter table public.user_portfolios drop constraint if exists user_portfolios_schema_version_check;
alter table public.user_portfolios add constraint user_portfolios_schema_version_check check (schema_version in (2, 3));

create table if not exists public.market_quotes (
  quote_id bigint generated always as identity primary key,
  product_code text not null,
  product_type text not null,
  price numeric not null check (price > 0),
  daily_return_pct numeric,
  currency text not null default 'CNY',
  source text not null,
  as_of_date date not null,
  fetched_at timestamptz not null default now(),
  unique (product_code, product_type, source, as_of_date)
);
create index if not exists market_quotes_latest_idx on public.market_quotes (product_code, product_type, as_of_date desc);

create table if not exists public.user_market_tracking (
  user_id uuid not null references auth.users(id) on delete cascade,
  holding_id text not null,
  product_code text not null,
  product_type text not null,
  enabled boolean not null default true,
  status text not null default 'awaiting-baseline' check (status in ('awaiting-baseline','active','unsupported','stale','error','disabled')),
  reason text,
  baseline_amount numeric,
  baseline_pnl_value numeric,
  baseline_pnl_basis text not null default '未知',
  baseline_price numeric,
  baseline_price_date date,
  source_amount numeric not null,
  source_pnl_value numeric,
  source_pnl_basis text not null,
  source_amount_updated_at date not null,
  source_pnl_updated_at date,
  latest_price numeric,
  latest_price_date date,
  latest_source text,
  estimated_amount numeric,
  estimated_pnl_value numeric,
  estimated_since_baseline numeric,
  estimated_return_pct numeric,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, holding_id)
);
create index if not exists user_market_tracking_enabled_idx on public.user_market_tracking (enabled, status);

create table if not exists public.user_market_estimates (
  user_id uuid not null references auth.users(id) on delete cascade,
  holding_id text not null,
  product_code text not null,
  product_type text not null,
  quote_date date not null,
  price numeric not null check (price > 0),
  daily_return_pct numeric,
  estimated_amount numeric,
  estimated_pnl_value numeric,
  estimated_since_baseline numeric not null,
  estimated_return_pct numeric not null,
  source text not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, holding_id, quote_date)
);
create index if not exists user_market_estimates_history_idx on public.user_market_estimates (user_id, holding_id, quote_date desc);

create table if not exists public.user_market_job_runs (
  run_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  market_scope text not null default '国内',
  status text not null check (status in ('running','success','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  checked_count integer not null default 0,
  updated_count integer not null default 0,
  unsupported_count integer not null default 0,
  stale_count integer not null default 0,
  failed_count integer not null default 0,
  summary text
);
create index if not exists user_market_job_runs_user_date_idx on public.user_market_job_runs (user_id, started_at desc);

alter table public.market_quotes enable row level security;
alter table public.user_market_tracking enable row level security;
alter table public.user_market_estimates enable row level security;
alter table public.user_market_job_runs enable row level security;

revoke all on public.market_quotes, public.user_market_tracking, public.user_market_estimates, public.user_market_job_runs from anon, authenticated;
grant select on public.market_quotes to authenticated;
grant select on public.user_market_tracking, public.user_market_estimates, public.user_market_job_runs to authenticated;

drop policy if exists market_quotes_read_authenticated on public.market_quotes;
create policy market_quotes_read_authenticated on public.market_quotes
  for select to authenticated using (true);

drop policy if exists user_market_tracking_read_own on public.user_market_tracking;
create policy user_market_tracking_read_own on public.user_market_tracking
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists user_market_estimates_read_own on public.user_market_estimates;
create policy user_market_estimates_read_own on public.user_market_estimates
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists user_market_job_runs_read_own on public.user_market_job_runs;
create policy user_market_job_runs_read_own on public.user_market_job_runs
  for select to authenticated using ((select auth.uid()) = user_id);

comment on table public.market_quotes is 'Shared product quotes from explicitly identified public sources; service role only may write.';
comment on table public.user_market_tracking is 'Per-user inferred valuation baseline and latest estimate; does not represent a broker position or transaction ledger.';
comment on table public.user_market_estimates is 'Daily estimates begin at user activation; rows are idempotent by user, holding and quote date.';
comment on table public.user_market_job_runs is 'Per-user scheduled/manual check history; RLS allows users to read only their own runs.';
