-- TRADE PUSH NOTIFICATIONS — run once in the Supabase SQL editor.
--
-- device_tokens:        every FCM token registered per customer email.
-- trade_notifications:  history shown on /app/notifications (last 50).
--
-- WRITES happen only from the Vercel functions with the service role key;
-- the anon key gets SELECT on trade_notifications only (the /app/notifications
-- page reads it from the browser — this deployment's auth lives in
-- localStorage, so there is no JWT to scope rows per user; rows carry the
-- email and the page filters client-side). device_tokens is service-role only:
-- a writable token table would let anyone hijack another inbox's alerts.

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  fcm_token text not null unique,
  device_name text,
  created_at timestamptz default now()
);

create table if not exists trade_notifications (
  id uuid primary key default gen_random_uuid(),
  email text,
  symbol text,
  action text,
  volume float,
  price float,
  profit float,
  time timestamptz default now()
);

create index if not exists trade_notifications_email_time
  on trade_notifications (email, time desc);

alter table device_tokens enable row level security;
alter table trade_notifications enable row level security;

drop policy if exists "anon read trade_notifications" on trade_notifications;
create policy "anon read trade_notifications"
  on trade_notifications for select to anon using (true);
