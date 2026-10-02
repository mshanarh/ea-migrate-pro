-- ============================================================
-- EA Migrate Pro — RUN THIS ONCE, IN THIS ORDER
-- Supabase dashboard → SQL Editor → New query → paste → Run
-- ============================================================
--
-- It does three things:
--
--   1. ea_media_for_email() — lets the app fetch an EA's PICTURE without
--      also downloading its video. Without it the app pulls ~27 MB on every
--      home visit, the request dies on a phone, and your EA card shows the
--      platform logo instead of the EA picture.
--
--   2. The admin console's write permissions — Approve, Reject, Save limit,
--      Mark paid, Allow reactivation and Broadcast. Without these the buttons
--      say "permission denied".
--
--   3. Deletes leftover test rows from an earlier check.
--
-- Safe to run more than once.
-- ============================================================


-- ── 1) EA picture without the video ───────────────────────────────────
create or replace function public.ea_media_for_email(p_email text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'id',    ea->>'id',
             'name',  ea->>'name',
             'image', ea->>'image'
           ) as entry
    from public.portal_accounts p
    cross join lateral jsonb_array_elements(
      case when left(btrim(p.data), 1) = '{' then coalesce(p.data::jsonb -> 'eas', '[]'::jsonb)
           else '[]'::jsonb end
    ) as ea
    where exists (
      select 1
      from jsonb_array_elements(
        case when left(btrim(p.data), 1) = '{' then coalesce(p.data::jsonb -> 'licenses', '[]'::jsonb)
             else '[]'::jsonb end
      ) as lic
      where lower(coalesce(lic->>'clientEmail', '')) = lower(coalesce(p_email, ''))
        and lic->>'eaId' = ea->>'id'
    )
  ) as matched;
$$;

grant execute on function public.ea_media_for_email(text) to anon, authenticated;


-- ── 2) Admin console writes ───────────────────────────────────────────
grant insert, update on public.mentor_approvals to anon;
grant insert        on public.users            to anon;

-- Licence limits (app_settings: 'limit:<email>') and broadcast history
grant insert, update on public.app_settings to anon;
grant insert        on public.app_messages to anon;

-- Payment + device-reactivation flags
grant update (is_paid)              on public.users to anon;
grant update (reactivation_enabled) on public.users to anon;
grant insert, update on public.paid_emails to anon;


-- ── 3) Clean up test rows from an earlier check ───────────────────────
delete from public.mentor_approvals where email like '%@eamigratepro.invalid';
delete from public.license_keys    where email like '%@eamigratepro.invalid';
delete from public.paid_emails     where email like '%@eamigratepro.invalid';
delete from public.app_settings    where key like '%@eamigratepro.invalid';
delete from public.users           where email like '%@eamigratepro.invalid';
delete from public.admin_emails    where email like '%@eamigratepro.invalid';


-- ══════════════════════════════════════════════════════════════════════
-- CHECK IT WORKED — run these three after. All should succeed.
-- ══════════════════════════════════════════════════════════════════════

-- A. The picture function. Expect a short JSON array with your EA in it.
--    A few KB. If it is megabytes, something is wrong.
select public.ea_media_for_email('biyasentobeko222@gmail.com');

-- B. Console writes. Expect "[]" three times (no rows matched, no error).
update public.mentor_approvals set status = status where email = 'nobody@example.invalid';
update public.app_settings     set value  = value  where key   = 'limit:nobody@example.invalid';
update public.users            set is_paid = is_paid where email = 'nobody@example.invalid';
