-- ============================================================
-- EA Migrate Pro — admin console part 3 (run ONCE in
-- Supabase → SQL Editor). Safe to re-run.
-- ============================================================
--
-- WHY
--   The console's "Allow reactivation" toggle was the last write still
--   going straight at the `users` table with the public anon key.
--   Part 1 revoked anon UPDATEs on that table, so the toggle answered
--   "permission denied for table users" every time. It now goes through
--   the same admin-checked function as Approve / Save limit / Mark paid.
--
--   This file also removes the throwaway rows used to verify that the
--   RPC path works for a properly signed-in admin.
-- ============================================================

-- ── 1) The reactivation toggle, behind the admin check ────────────────
create or replace function public.admin_set_reactivation(
  p_email   text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(p_email);
begin
  if not public.is_admin_email(auth.jwt() ->> 'email')
     and not public.is_admin_email(current_setting('request.jwt.claim.email', true)) then
    raise exception 'admin only';
  end if;

  update public.users
     set reactivation_enabled = coalesce(p_enabled, false)
   where email = v_email;

  -- The mentor may never have opened the app, so no row exists yet. The
  -- console must still be able to unlock them BEFORE their first sign-in.
  if not found then
    insert into public.users (email, reactivation_enabled)
      values (v_email, coalesce(p_enabled, false))
      on conflict (email) do update
        set reactivation_enabled = excluded.reactivation_enabled;
  end if;
  return true;
end;
$$;

grant execute on function public.admin_set_reactivation(text, boolean) to anon, authenticated;

-- ── 2) Remove the verification leftovers ──────────────────────────────
-- Addresses under @eamigratepro.invalid were never real accounts.
delete from public.mentor_approvals where email like '%@eamigratepro.invalid';
delete from public.license_keys    where email like '%@eamigratepro.invalid';
delete from public.paid_emails     where email like '%@eamigratepro.invalid';
delete from public.app_settings    where key like '%@eamigratepro.invalid';
delete from public.users           where email like '%@eamigratepro.invalid';
delete from public.admin_emails    where email like '%@eamigratepro.invalid';

-- ── VERIFY (run these after) ───────────────────────────────────────────
-- select proname, prosecdef from pg_proc where proname like 'admin_%';
--   → admin_set_reactivation must appear with prosecdef = true
-- select * from public.admin_emails;
--   → only the three real owner addresses, no probe rows
