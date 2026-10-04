-- ============================================================
-- EA Migrate Pro — admin dashboard security (run ONCE in
-- Supabase → SQL Editor). Safe to re-run.
-- ============================================================
--
-- WHAT THIS DOES
--   The admin console and the mobile app both talk to Supabase with the
--   SAME public anon key. While the schema only had "anon may update
--   anything", that key was a shared write credential: anyone could POST
--   is_paid=true or mentor_approvals.status='approved' and grant
--   themselves the app. This migration removes that.
--
--   1. admin_emails  — the allow-list of console operators.
--   2. Revokes direct anon writes on the three tables a user must never be
--      able to change for themselves: users (is_paid / is_admin),
--      mentor_approvals (approval state) and app_settings (license limits).
--   3. Re-exposes exactly those writes through SECURITY DEFINER functions
--      that check the caller against admin_emails. The function is the only
--      way back in, and it refuses non-admins.
--   4. app_messages  — the broadcast history table (the console reads it
--      through the same functions).
--
-- WHO IS AN ADMIN
--   Seed admin_emails with the platform owners. Add a row to let someone
--   else into the console. The console UI hides itself from non-admins as
--   well; this is the database-level half of that rule.
-- ============================================================

-- ── 1) Admin allow-list ─────────────────────────────────────────────────
create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamp default now()
);

-- The signed-in app email is the identity: only an address in this table may
-- call the privileged functions below.
create or replace function public.is_admin_email(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_emails
    where lower(email) = lower(coalesce(candidate, ''))
  );
$$;

-- ── 2) Seed the owners (no-op when already present) ─────────────────────
insert into public.admin_emails (email) values
  ('ntobekotraders.official@gmail.com'),
  ('eamigratepro@gmail.com'),
  ('lwethunkandi3@gmail.com')
on conflict (email) do nothing;

-- ── 3) Broadcast history as a real table ────────────────────────────────
create table if not exists public.app_messages (
  id         text primary key,
  body       text not null,
  sent_at    timestamp default now(),
  recipients integer default 0,
  sender     text default 'admin'
);
create index if not exists app_messages_sent_at_idx on public.app_messages (sent_at desc);

-- ── 4) Lock the sensitive columns away from the shared anon key ────────
-- Reads stay open (the app gate must see is_paid, and the console must list
-- users). WRITES do not: no anonymous caller may flip a payment flag, an
-- approval state or a license limit.
revoke update on public.users            from anon;
revoke update on public.mentor_approvals from anon;
revoke insert on public.mentor_approvals from anon;
revoke delete on public.mentor_approvals from anon;
revoke update on public.app_settings     from anon;
revoke delete on public.app_settings     from anon;
revoke insert on public.app_messages     from anon;
revoke update on public.app_messages     from anon;
revoke delete on public.app_messages     from anon;

-- Reads the app genuinely needs (RLS already permits them; stated for clarity).
grant select on public.users            to anon;
grant select on public.mentor_approvals to anon;
grant select on public.app_messages     to anon;
grant select on public.app_settings     to anon;

-- ── 5) The ONLY write path: admin-checked SECURITY DEFINER functions ────
create or replace function public.admin_set_approval(
  p_email  text,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_email(current_setting('request.jwt.claim.email', true))
     and not public.is_admin_email(auth.jwt() ->> 'email') then
    raise exception 'admin only';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'bad status';
  end if;

  insert into public.users (email) values (lower(p_email))
    on conflict (email) do nothing;
  insert into public.mentor_approvals (email, status)
    values (lower(p_email), p_status)
    on conflict (email) do update set status = excluded.status;
  return true;
end;
$$;

create or replace function public.admin_set_license_limit(
  p_email text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(p_email);
begin
  if not public.is_admin_email(auth.jwt() ->> 'email') then
    raise exception 'admin only';
  end if;
  insert into public.app_settings (key, value, updated_at)
    values ('limit:' || v_email, json_build_object('limit', greatest(coalesce(p_limit, 0), 0))::text, now())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  return true;
end;
$$;

create or replace function public.admin_set_paid(
  p_email text,
  p_paid  boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(p_email);
begin
  if not public.is_admin_email(auth.jwt() ->> 'email') then
    raise exception 'admin only';
  end if;
  update public.users set is_paid = coalesce(p_paid, false) where email = v_email;
  -- THE LEDGER MUST BE WRITTEN IN BOTH DIRECTIONS. This used to insert only
  -- when p_paid was true, so revoking through this function left the previous
  -- paid_at timestamp in place and — because the app gate treats a paid_emails
  -- row with paid_at = null as an explicit revocation — an account marked
  -- unpaid here still read as paid. A revocation with no marker is a button
  -- that does nothing.
  insert into public.paid_emails (email, paid_at)
  values (v_email, case when p_paid then now() else null end)
    on conflict (email) do update set paid_at = excluded.paid_at;
  return true;
end;
$$;

-- ── 6) Grant EXECUTE only — calling is allowed, forging is not ─────────
grant execute on function public.admin_set_approval(text, text)      to anon, authenticated;
grant execute on function public.admin_set_license_limit(text, integer) to anon, authenticated;
grant execute on function public.admin_set_paid(text, boolean)        to anon, authenticated;
grant execute on function public.is_admin_email(text)                to anon, authenticated;

-- ── VERIFY (run these after) ───────────────────────────────────────────
-- select * from public.admin_emails;
-- select proname, prosecdef from pg_proc
--  where proname like 'admin_%' or proname = 'is_admin_email';
