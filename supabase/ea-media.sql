-- ============================================================
-- EA Migrate Pro — EA pictures without the videos (run ONCE in
-- Supabase → SQL Editor). Safe to re-run.
-- ============================================================
--
-- THE PROBLEM
--   Every mentor's EA lives inside one big JSON column
--   (portal_accounts.data) together with its picture AND its demo
--   video, and the video is stored inline as base64.
--
--   To show a client their EA picture, the app had to read that whole
--   row — so it read EVERY account. With one mentor carrying a 6.4 MB
--   base64 MP4, the home screen was downloading 27 MB on every visit.
--   On a phone that request times out or is killed, the failure was
--   swallowed, and the robot ended up with no picture at all: the card
--   silently fell back to the platform logo.
--
-- THE FIX
--   This function returns ONLY id, name and image for the EAs a given
--   email actually holds a license for. The video never leaves the
--   database, so the response is a few kilobytes instead of megabytes.
--
--   It reads nothing the caller could not already read: portal_accounts
--   is world-readable through the public anon key, and the result is
--   restricted to EAs tied to that email's own licenses.
-- ============================================================

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

-- ── VERIFY (run this after) ───────────────────────────────────────────
-- select public.ea_media_for_email('biyasentobeko222@gmail.com');
--   → a JSON array with one small object per licensed EA, e.g.
--     [{"id":"ea-mukd5dyrtgw8eh","image":"data:image/jpeg;base64,…",
--       "name":"Sniper killer Ea v2.0"}]
--   The image is there and the 6 MB video is NOT.
--
-- select length(public.ea_media_for_email('biyasentobeko222@gmail.com')::text);
--   → a few tens of kilobytes, not megabytes
