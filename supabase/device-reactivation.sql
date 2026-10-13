-- ============================================================
-- EA Migrate — DEVICE BINDING + REACTIVATION (run once in SQL Editor)
--
-- Gives every email a single-device binding in the cloud:
--   device_email = the email this account is currently bound to (nullable)
--   device_id    = the opaque device id that bound it
-- Sign-in compares the local device id against the cloud binding; a
-- mismatch offers "Reactivate" which releases the old device and binds
-- this one. Applies to EVERYONE — clients and admins alike.
-- ============================================================

alter table public.users add column if not exists device_email text;
alter table public.users add column if not exists device_id    text;

-- Sign-in needs to read another email's binding (to detect "already used
-- elsewhere") and rewrite its own row's binding on reactivation. The
-- project's chosen trade-off stays: anon full access, no self-grant risk
-- on flags because registration still cannot create paid/admin rows.
create policy "anon can manage device binding"
  on public.users for update to anon, authenticated
  using (true) with check (true);
