-- ============================================================
-- EA Migrate Pro - activation code rate limit (run ONCE in
-- Supabase -> SQL Editor). Safe to re-run.
-- ============================================================
--
-- WHY
--
-- Every code request sends a real email through Mailjet and burns quota. This
-- table caps that at 3 requests per email per 60 minutes, so a stuck button, a
-- retry loop, or someone hammering "send code" cannot flood an inbox or run the
-- account out of sends.
--
-- It exists as a TABLE rather than in memory because this code runs as a
-- stateless Vercel serverless function: a Map in the module would be reset by
-- every cold start and by every concurrent instance, so "3 per hour" would
-- actually mean "3 per cold start".
--
-- Verified live before this file was written: the table did NOT exist
-- (PGRST205) and there is no DDL path from the app (exec_sql answers PGRST202),
-- which is why this has to be pasted into the SQL editor by hand.
--
-- COLUMNS
--   email             the address being limited; primary key, one row per inbox
--   count             requests made inside the CURRENT window
--   first_request_at  when the current window opened - the anchor the 60
--                     minutes is measured from
--   last_request_at   when the most recent request arrived, for diagnostics
--
-- After this is run, the server function maintains the rows itself. Nothing
-- else in the app reads or writes them.
-- ============================================================

create table if not exists public.email_code_requests (
  email             text primary key,
  count             integer     not null default 0,
  first_request_at  timestamptz not null default now(),
  last_request_at   timestamptz not null default now()
);

-- Housekeeping: the server function resets a row's count when its window
-- expires rather than deleting it, so this index is not on the hot path. It is
-- here so an operator can find and clear stale rows without a sequential scan.
create index if not exists email_code_requests_first_request_at_idx
  on public.email_code_requests (first_request_at);

-- The limiter is written ONLY by the /api/activation serverless function using
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely.
--
-- Locking the table down to nobody else is the point: the PUBLIC anon key ships
-- inside the JavaScript bundle, so if anon could write this table then anyone
-- could reset their own counter and the rate limit would be decorative.
alter table public.email_code_requests enable row level security;

revoke all on public.email_code_requests from anon, authenticated;

-- VERIFY (run this after):
--   select count(*) from public.email_code_requests;
--   -> 0, no errors: the table exists and is empty.
--
--   select has_table_privilege('anon', 'public.email_code_requests', 'select');
--   -> f : the browser key cannot read it.
--
--   select has_table_privilege('service_role', 'public.email_code_requests', 'insert');
--   -> t : the server function can write it.
