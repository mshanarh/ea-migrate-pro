-- ============================================================
-- Supabase → SQL Editor → run ONCE. Safe to re-run.
-- Replaces ea-media.sql's ea_media_for_email() with a version
-- that does not time out. (Verified live: the old one answers
-- "canceling statement due to statement timeout" for every email.)
-- ============================================================
--
-- WHY THE OLD ONE TIMED OUT
--   It parsed EVERY portal_accounts row's full `data` as JSON —
--   including every mentor's inline base64 video (6 MB+ per row) —
--   TWICE per row (eas pass + licenses pass), on every call.
--
-- WHAT THIS VERSION DOES DIFFERENTLY
--   1. A raw-text prefilter (`data ilike '%<email>%'`) runs FIRST.
--      Substring matching on text needs no JSON parsing, so the
--      video-heavy rows are skipped entirely unless they actually
--      mention the caller's email — normally 0-2 rows get parsed.
--   2. SECURITY DEFINER: runs with the owner's rights, bypassing
--      the per-row RLS policy evaluation on top of the parse.
--   3. Same result shape as before: [{id, name, image}] — pictures
--      and names only; the video still never leaves the database.
--
-- VERIFY AFTER RUNNING (must answer in well under 8 seconds):
--   select public.ea_media_for_email('you@example.com');
--   select length(public.ea_media_for_email('you@example.com')::text);
-- ============================================================

create or replace function public.ea_media_for_email(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'id',    ea ->> 'id',
             'name',  ea ->> 'name',
             'image', ea ->> 'image'
           ) as entry
    from (
      -- ONE parse per candidate row, and only rows whose raw text
      -- mentions this email are candidates.
      select (p.data) :: jsonb as doc
      from public.portal_accounts p
      where left(btrim(p.data), 1) = '{'
        and p.data ilike '%' || coalesce(p_email, '') || '%'
    ) d
    cross join lateral jsonb_array_elements(
      coalesce(d.doc -> 'eas', '[]' :: jsonb)
    ) as ea
    where exists (
      select 1
      from jsonb_array_elements(
        coalesce(d.doc -> 'licenses', '[]' :: jsonb)
      ) as lic
      where lower(coalesce(lic ->> 'clientEmail', '')) = lower(coalesce(p_email, ''))
        and lic ->> 'eaId' = ea ->> 'id'
    )
  ) as matched;
$$;

revoke execute on function public.ea_media_for_email(text) from public;
grant execute on function public.ea_media_for_email(text) to anon, authenticated;
