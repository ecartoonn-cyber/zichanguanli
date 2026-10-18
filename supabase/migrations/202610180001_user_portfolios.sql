-- One private portfolio document per authenticated user.
-- Never use a service-role key from the browser. All client access relies on the
-- signed-in user's JWT plus these row-level policies.
create table if not exists public.user_portfolios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schema_version integer not null default 2 check (schema_version = 2),
  revision integer not null default 1 check (revision > 0),
  state jsonb not null default '{"schemaVersion":2,"holdings":[],"profile":{"answers":{},"savedAt":null}}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_portfolios_state_is_object check (jsonb_typeof(state) = 'object')
);

alter table public.user_portfolios enable row level security;

-- Do not let unauthenticated visitors access portfolio documents.
revoke all on table public.user_portfolios from anon, authenticated;
grant select, insert, update, delete on table public.user_portfolios to authenticated;

create policy "portfolio_select_own"
  on public.user_portfolios for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "portfolio_insert_own"
  on public.user_portfolios for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "portfolio_update_own"
  on public.user_portfolios for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "portfolio_delete_own"
  on public.user_portfolios for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_user_portfolios_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_user_portfolios_updated_at() from public, anon, authenticated;
create trigger user_portfolios_updated_at
  before update on public.user_portfolios
  for each row execute function public.set_user_portfolios_updated_at();
