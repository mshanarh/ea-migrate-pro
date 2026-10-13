-- ── Secure the payment gate (run once in Supabase → SQL Editor) ─────────
-- Before this script, ANYONE with the public anon key could:
--   1. UPDATE public.users.is_paid = true            (self-approve payment)
--   2. INSERT a license_keys row bound to their email (forge a license and
--      then "activate" it — the app trusts that table)
--   3. UPDATE an existing license_keys.email to their own  (steal a key)
-- This closes all three. Privileged writes (approvals, key issuance) run
-- through the app's SERVER functions with the service-role key, which
-- bypasses RLS — so every legitimate flow keeps working.

-- ============================================================
-- 1. users: anon may register (unpaid, non-admin) and read —
--    NO update path at all. Approvals go through the admin
--    server function (service role).
-- ============================================================
alter table public.users enable row level security;

drop policy if exists "anon can update users" on public.users;
drop policy if exists "anon can update own non-privileged fields" on public.users;

-- Registration + read policies (re-asserted so re-running is safe).
create policy "anon can register own email"
  on public.users for insert to anon, authenticated
  with check (is_paid = false and is_admin = false);

create policy "anon can read users"
  on public.users for select to anon, authenticated
  using (true);

-- ============================================================
-- 2. license_keys: read stays open (activation lookup) —
--    NO anon insert/update/delete. Keys are issued ONLY via
--    the issueLicenseKeySecure server function (service role),
--    so a faker cannot mint a key row for their own email.
-- ============================================================
alter table public.license_keys enable row level security;

drop policy if exists "license_keys full access" on public.license_keys;
drop policy if exists "license_keys anon insert once" on public.license_keys;

create policy "license_keys readable by anon"
  on public.license_keys for select to anon, authenticated
  using (true);

-- ============================================================
-- 3. Users who signed up BEFORE this script with a forged is_paid
--    flag stay flagged — clean them once (the Whop check in the app
--    re-verifies and re-approves genuine payers automatically):
--
--    update public.users set is_paid = false where email not in (
--      select email from public.license_keys
--    ) and is_admin = false;
--
--    (Commented out on purpose — review the list first.)
-- ============================================================
