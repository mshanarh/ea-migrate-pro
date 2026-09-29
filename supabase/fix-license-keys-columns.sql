-- ============================================================
-- EA Migrate — LIVE-DATABASE REPAIR (run once in the Supabase SQL Editor)
--
-- Verified missing in the live project (probed 2026-09-29):
--   • license_keys.ea_name / license_keys.expiry  — absent
--   • portal_accounts / portal_payments / mt5_accounts — absent
-- Consequences fixed by this file:
--   • New keys saved fine, but without an EA name the app shows "Private EA"
--   • The app could never restore robots/MT5 from the cloud (tables missing)
--   • portal_accounts-based flows 404'd (PGRST205) everywhere
-- ============================================================

-- 1) license_keys: EA metadata columns + a REAL unique constraint on key
alter table public.license_keys add column if not exists ea_name text;
alter table public.license_keys add column if not exists expiry  text;
create unique index if not exists license_keys_key_unique on public.license_keys (key);

-- 2) Portal sync tables (match src/lib/account-sync.server.ts + schema.sql)
create table if not exists public.portal_accounts (
  email      text primary key,
  data       jsonb not null,
  updated_at timestamp default now()
);
create table if not exists public.portal_payments (
  email    text primary key,
  paid     boolean not null default false,
  paid_at  timestamp
);
create table if not exists public.mt5_accounts (
  user_id     text primary key,
  record      jsonb not null,
  enabled     boolean not null default true,
  updated_at  timestamp default now()
);

-- 3) RLS: the browser (anon key) reads/writes these directly in production
alter table public.portal_accounts enable row level security;
alter table public.portal_payments enable row level security;
alter table public.mt5_accounts    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['portal_accounts','portal_payments','mt5_accounts']
  loop
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || ' full access', t
    );
  end loop;
exception
  when duplicate_object then null; -- policy already exists — safe to re-run
end $$;

create index if not exists portal_accounts_updated_idx on public.portal_accounts (updated_at desc);
create index if not exists license_keys_email_idx on public.license_keys (email);

-- Done. After running this, new keys save with their EA name, deleted keys
-- stop activating, and the app's cloud restore works again.
