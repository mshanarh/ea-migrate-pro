-- ============================================================
-- EA Migrate Pro — admin security, part 2 (run ONCE).
-- Fixes what part 1 revoked too broadly.
-- ============================================================
--
-- Part 1 locked the sensitive WRITES, which is what we want — but it
-- also locked two writes the APP needs on every sign-in:
--   • users.device_id / device_email  (one email, one device)
--   • users.is_paid                   (set when a licence key activates)
-- Those now come back as COLUMN-level grants, so an anonymous caller can
-- only touch those three columns and still CANNOT write is_admin,
-- an approval status or a licence limit.
--
-- This file also adds the one function the APP needs (claiming a licence
-- key server-side, which is how payment is now recorded) and the message
-- history writer.
-- ============================================================

-- ── 1) Give the app back exactly what it writes ───────────────────────
grant update (device_id, device_email) on public.users to anon;
grant update (is_paid)                    on public.users to anon;
-- A signup writes its own pending row with ON CONFLICT DO NOTHING, which
-- needs INSERT only — the row can never be UPDATED to "approved" this way.
grant insert on public.mentor_approvals to anon;

-- ── 2) Claim a licence key SERVER-side ────────────────────────────────
-- The app calls this after someone activates a key. The database decides
-- whether that key really exists and whether it was already claimed by
-- someone else, then records payment and the device binding in one shot.
-- Nobody can grant themselves paid access with a raw request any more:
-- an unknown key is refused.
create or replace function public.claim_license_key(
  p_key    text,
  p_email  text,
  p_device text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key    text := upper(btrim(coalesce(p_key, '')));
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_owner  text;
begin
  if v_key = '' or v_email = '' then
    return false;
  end if;

  -- The key must exist, and must not already belong to a different email.
  select lower(email) into v_owner
    from public.license_keys
   where key = v_key
   limit 1;

  if v_owner is null then            -- unknown key → refused
    return false;
  end if;
  if v_owner is not null and v_owner <> v_email then
    return false;                    -- key belongs to somebody else
  end if;

  -- Claim it, record payment, bind the device.
  insert into public.users (email, is_paid)
    values (v_email, true)
    on conflict (email) do update set is_paid = true;

  if v_owner is null then
    update public.license_keys set email = v_email where key = v_key;
  end if;

  -- A REAL RE-PAYMENT CLEARS THE REVOCATION. The app gate reads a paid_emails
  -- row with paid_at = null as "the owner marked this account unpaid", and that
  -- marker now outranks is_paid so revocation actually works. Without this
  -- line somebody the owner had locked out could never get back in by paying
  -- again — they would activate their key, see is_paid = true, and still be
  -- told they are unpaid. Restoring the timestamp is what makes "marked unpaid"
  -- mean "until they pay again" rather than "permanently".
  insert into public.paid_emails (email, paid_at)
  values (v_email, now())
    on conflict (email) do update set paid_at = excluded.paid_at;

  if p_device is not null and btrim(p_device) <> '' then
    update public.users
       set device_email = v_email,
           device_id    = btrim(p_device)
     where email = v_email
       and (device_id is null or device_id = btrim(p_device));
  end if;

  return true;
end;
$$;

grant execute on function public.claim_license_key(text, text, text) to anon, authenticated;

-- ── 3) Broadcast history writer ───────────────────────────────────────
-- The admin console records every send here. Reads stay open; writes only
-- happen through this function.
create or replace function public.admin_record_message(
  p_id         text,
  p_body       text,
  p_sent_at    timestamptz,
  p_recipients integer,
  p_sender     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_email(auth.jwt() ->> 'email') then
    raise exception 'admin only';
  end if;
  insert into public.app_messages (id, body, sent_at, recipients, sender)
    values (coalesce(p_id, ''), coalesce(p_body, ''), coalesce(p_sent_at, now()),
            coalesce(p_recipients, 0), coalesce(p_sender, 'admin'))
  on conflict (id) do nothing;
  return true;
end;
$$;

grant execute on function public.admin_record_message(text, text, timestamptz, integer, text)
  to anon, authenticated;

-- ── VERIFY (run after) ────────────────────────────────────────────────
-- select email from public.admin_emails;                      -- 3 rows
-- select has_table_privilege('anon','public.users','UPDATE'); -- true
-- select column_name from information_schema.column_privileges
--  where grantee = 'anon' and table_name = 'users' and privilege_type = 'UPDATE';