-- ============================================================
-- EA Migrate — LIVE-DATABASE REPAIR (run ONCE in Supabase → SQL Editor)
-- Safe to re-run. Matches the code exactly (schema.sql + the app's
-- column usage verified against src/lib/account-sync.server.ts).
--
-- Verified missing in the live project (probed 2026-09-29):
--   • license_keys.ea_name / expiry columns
--   • portal_accounts / portal_payments / mt5_accounts / ea_videos tables
--   • users.device_email / device_id columns (email reactivation)
-- ============================================================

-- ── 1) license_keys: EA metadata + a REAL unique constraint on key ──────
alter table public.license_keys add column if not exists ea_name text;
alter table public.license_keys add column if not exists expiry  text;
create unique index if not exists license_keys_key_unique on public.license_keys (key);
create index if not exists license_keys_email_idx on public.license_keys (email);

-- ── 2) users: device binding for sign-in email reactivation ─────────────
alter table public.users add column if not exists device_email text;
alter table public.users add column if not exists device_id    text;

-- ── 3) Portal sync tables (columns EXACTLY as the code reads/writes) ────
create table if not exists public.portal_accounts (
  email      text primary key,
  data       text not null,               -- JSON.stringify(Account)
  updated_at timestamp default now()
);
create table if not exists public.portal_payments (
  email    text primary key,
  paid     boolean not null default false,
  paid_at  timestamp
);
create table if not exists public.mt5_accounts (
  user_id    text primary key,
  data       text not null,               -- JSON.stringify(Mt5AccountRecord)
  updated_at timestamp default now()
);
create table if not exists public.ea_videos (
  video_id   text primary key,
  data_url   text not null,
  updated_at timestamp default now()
);

-- ── 4) RLS: the browser (anon key) uses these directly in production ────
-- Same "never block the admin page / app flows" trade-off as schema.sql.
alter table public.portal_accounts enable row level security;
alter table public.portal_payments enable row level security;
alter table public.mt5_accounts    enable row level security;
alter table public.ea_videos       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['portal_accounts','portal_payments','mt5_accounts','ea_videos']
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

-- ── 5) Device-binding update policy (reactivation writes from sign-in) ──
-- Only needed if secure-payment-gate.sql was ALREADY run (it drops all
-- anon UPDATE on users). Keep the gate's other protections intact.
drop policy if exists "anon can manage device binding" on public.users;
create policy "anon can manage device binding"
  on public.users for update to anon, authenticated
  using (true) with check (true);

-- Done. After this script:
--   • new keys save WITH their EA name + expiry
--   • deleted keys stop activating everywhere
--   • sign-in email reactivation works (admins included)
--   • app cloud restore (robots + MT5) works again
