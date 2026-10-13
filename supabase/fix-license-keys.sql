-- ── license_keys schema alignment ────────────────────────────────────────
-- The live table predates the full schema: it has (id, key, email,
-- created_at) but not the optional ea_name/expiry columns the app writes
-- when a mentor issues a key. Without them, mentor-issued keys lose the
-- robot name/expiry. Run ONCE in Supabase → SQL Editor. Safe to re-run.

alter table public.license_keys add column if not exists ea_name text;
alter table public.license_keys add column if not exists expiry text;

-- The app upserts with onConflict: "key" — that needs a unique constraint.
create unique index if not exists license_keys_key_unique
  on public.license_keys (key);

-- Backfill nothing required: new keys issued after this will carry
-- ea_name/expiry automatically via the app's send-email flow.
