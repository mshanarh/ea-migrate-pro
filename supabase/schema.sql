-- ============================================================
-- EA Migrate Pro — Supabase schema (replaces the Upstash store
-- for users / sessions / admin approvals)
-- Run this ONCE in Supabase Dashboard → SQL Editor.
-- ============================================================

-- 1) USERS — one row per registered email
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  is_paid    boolean default false,
  is_admin   boolean default false,
  created_at timestamp default now()
);

-- Repair for projects created before is_admin existed: create-table-if-not-
-- exists never alters an existing table, so re-running this file also adds
-- any column a stale table is missing. Safe to run repeatedly.
alter table public.users add column if not exists is_admin   boolean default false;
alter table public.users add column if not exists is_paid    boolean default false;
alter table public.users add column if not exists created_at timestamp default now();

-- 2) SESSIONS — one row per app sign-in
create table if not exists public.user_sessions (
  id          uuid primary key default gen_random_uuid(),
  email       text references public.users(email) on delete cascade,
  license_key text,
  created_at  timestamp default now()
);

-- Repair for sessions tables created before license_key existed. Safe to
-- re-run; create-table-if-not-exists never alters an existing table.
alter table public.user_sessions add column if not exists license_key text;
alter table public.user_sessions add column if not exists created_at timestamp default now();

create index if not exists user_sessions_email_idx on public.user_sessions (email);
create index if not exists users_created_at_idx on public.users (created_at desc);

-- ============================================================
-- 3) ROW LEVEL SECURITY
--
--    Reads are open to the anon key so the /app/admin page can
--    list every registered email straight from the browser —
--    admin must never be blocked (this happened before with
--    RLS). Writes that change money/admin state (approve, make
--    admin) go through the app's server functions with the
--    service-role key, which bypasses RLS.
--
--    NOTE: with an anon-only flow there is no per-row way to
--    scope "own row" reads without Supabase Auth claims, so
--    read access is table-wide by design.
-- ============================================================
alter table public.users enable row level security;
alter table public.user_sessions enable row level security;

-- Registration: anyone may create their own (unpaid, non-admin) row.
create policy "anon can register own email"
  on public.users for insert to anon, authenticated
  with check (is_paid = false and is_admin = false);

-- Reads: open (covers "read own user by email" AND the admin list).
create policy "anon can read users"
  on public.users for select to anon, authenticated
  using (true);

-- Sessions: insert on sign-in, read own session.
create policy "anon can create own session"
  on public.user_sessions for insert to anon, authenticated
  with check (true);

create policy "anon can read sessions"
  on public.user_sessions for select to anon, authenticated
  using (true);

-- ── OPTIONAL: fully open write mode (no server functions needed) ──
-- Uncomment to let the admin page's Approve / Make Admin buttons work
-- straight from the browser with just the anon key. Less safe.
--
-- create policy "anon can update users"
--   on public.users for update to anon, authenticated
--   using (true) with check (true);
