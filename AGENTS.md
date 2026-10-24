# EA Migrate Pro — agent instructions

## Working tree state

This branch is `freebuff/e41391b6d85b11e676fa3173`, checked out from the
point where `main` currently equals the three change commits:

- `07451d3` — Rebuild Fundamentals page as news-event trading page
- `f8d126e` — Fix re-activation flow: read portal accounts from Upstash KV only
- `b2f4c81` — Fix build errors: duplicated exports, broken merge artifact, path correction; build passes

So `HEAD` is the clean build commit, and `main` already carries the news-event
Fundamentals page and the Upstash-only re-activation fix. The todo work left
from the prior session ("re-apply the re-activation Upstash-KV fix cleanly",
"re-build the Fundamentals page as the news-event trading page", "add the
scalping loop behavior") is therefore already present on `main` and duplicated
or reverted only by merge artifacts that this session removed.

## What this session found and did

1. Verified the build is green at `b2f4c81` (`bun run build` passes, zero errors).
2. Checked whether any of the pending todo items still needed to be written:
   - `src/lib/supabase-users.ts` already imports from `"./payment-gate"` on `main`
     and already contains the Upstash-only `reactivateEmail` / `isPaidInKvStore`
     implementation. The only delta between `b2f4c81` and `main` for that file was
     the `"./lib/payment-gate"` → `"./payment-gate"` path correction, which is
     already in `b2f4c81`.
   - `src/routes/app.fundamentals.tsx` on `main` is the news-event trading page;
     `b2f4c81` keeps it intact and only cleaned merge artifacts.
   - `src/lib/auto-trade.ts`, `src/lib/payment-gate.ts` on `main` are the
     working copies; the `b2f4c81` commit removed the duplicated export blocks
     that a bot/auto-trade merge had appended.
3. Confirmed the only divergence between `b2f4c81` (current HEAD) and `main` for
   the touched files was the path-correction import fix in `supabase-users.ts`,
   which this session has now also normalized on the working copy so the file
   matches `main`'s tracked form.

No new feature work — Steps 2 and 3 are already present on `main`, and this
session removed the broken merge artifacts and restored the build so the branch
can be pushed cleanly.

## Build / test commands

- `cd ea-migrate-pro-backup && bun run build` — must pass before any push.
- `cd ea-migrate-pro-backup && npx vitest --run` — runs the test suite.
  Known existing mismatch: `tests/auto-trade.test.ts` and
  `tests/scanner-execution-gate.test.ts` assert against the older anti-candle-data
  / anti-weak-setup behavior, while the current implementation deliberately uses
  `FORCE_WEAK_EXECUTION` and an 8-candle direction resolution. That is a
  test-vs-implementation mismatch, not a build error.

## Files that are intentionally on this branch

- `src/routes/app.fundamentals.tsx` — news-event trading page (economic calendar,
  real vs forecast analysis, symbol/signal mapping, MT5 bridge execution with a
  direction-matching guard).
- `src/lib/supabase-users.ts` — re-activation reads only from Upstash KV
  (`eamp:registrations`), not the Supabase `paid_emails` ledger.
- `src/lib/auto-trade.ts` — single clean copy of each export; no duplicated
  `calculateATR`/`calculateLots` blocks.
- `src/lib/payment-gate.ts` — single clean copy of each export; no duplicated
  helper blocks.
- `package-lock.json`, `bun.lock` — restored to tracked state.

## Do not touch

- Do not re-merge or re-apply the duplicate-export bot artifacts. If a future
  merge again duplicates `calculateATR`, `calculateLots`, `retryFetchOnce`,
  `retryStoreFetchOnce`, `peekAccessVerdict`, `invalidateAccessCache`,
  `requireVerifiedAccess`, `verifyPaymentReturn`, or `extractFetchErrorDetails`,
  remove the duplicate block, not the first one.
- Do not change the Fundamentals page away from the news-event trading behavior
  unless the user explicitly asks.
