-- ============================================================
-- EA Migrate Pro — admin console writes, simple access
-- (run ONCE in Supabase → SQL Editor). Safe to re-run.
-- ============================================================
--
-- WHAT THIS DOES
--   Gives the public anon key back the writes the admin console needs:
--   approve / reject, licence limits, the paid flag, the reactivation
--   toggle and the broadcast history.
--
--   This UNDOES the revokes in admin-dashboard-rls.sql. Those revokes
--   forced the console to sign in with Supabase Auth before the
--   database would accept a write, which put a second password prompt
--   between the owner and their own console. The owner has asked for
--   the console to open straight from the portal instead, so the
--   writes go back to being plain browser writes.
--
--   The console still only SHOWS itself to a signed-in admin (the
--   portal account's role, or an address in OWNER_EMAILS). That check
--   lives in the app; these grants are about what the database accepts
--   once the console decides to write.
-- ============================================================

-- Approve / Reject
grant insert, update on public.mentor_approvals to anon;
grant insert, update on public.users            to anon;

-- Licence limits (app_settings: 'limit:<email>') and broadcast history
grant insert, update on public.app_settings to anon;
grant insert        on public.app_messages to anon;

-- Payment + device-reactivation flags
grant update (is_paid)              on public.users to anon;
grant update (reactivation_enabled) on public.users to anon;
grant insert, update on public.paid_emails to anon;

-- ── VERIFY (run this after) ──────────────────────────────────────────
-- All three should return "[]" (no rows matched) rather than an error:
--
-- update mentor_approvals set status = status where email = 'nobody@example.invalid';
-- update app_settings     set value  = value  where key   = 'limit:nobody@example.invalid';
-- update users            set is_paid = is_paid where email = 'nobody@example.invalid';
