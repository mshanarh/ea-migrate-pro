/**
 * Does the 3-per-60-minutes code rate limit actually hold?
 *
 * WHY THE DATABASE IS DOUBLED RATHER THAN USED
 * ───────────────────────────────────────────
 * `email_code_requests` does not exist on this deployment yet — verified live,
 * it answers PGRST205 — and there is no DDL path from the app (exec_sql answers
 * PGRST202), so the table can only be created by pasting
 * `supabase/email-code-rate-limit.sql` into the SQL editor. Until that is done
 * there is nothing to rate limit against.
 *
 * So this suite supplies the ONE table the limiter touches, as an in-memory
 * double that implements the same semantics PostgREST gives it: `insert`
 * answers 23505 on a duplicate primary key, `update` only touches rows that
 * match every `eq` filter, and an update matching nothing returns an empty
 * array (which is how the lost-update guard is detected).
 *
 * The double replaces `@supabase/supabase-js`, so the code under test is the
 * REAL handler — not a reimplementation of the rules being checked. Mail is
 * intercepted at `src/lib/mailjet.server`, and that interception is asserted
 * before any result is believed, so this suite cannot pass while quietly
 * emailing real people.
 *
 * READ/WRITE: none. Nothing here touches the live database or a real inbox.
 *
 * Run: bun scripts/verify-code-rate-limit.ts
 */
import { mock } from "bun:test";

/* -- the limiter's table, in memory ---------------------------------- */

type Row = { email: string; count: number; first_request_at: string; last_request_at: string };

const table: Row[] = [];

type Result = { data: unknown; error: { code: string; message: string } | null };

const ok = (data: unknown): Result => ({ data, error: null });

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => String(row[column as keyof Row]) === String(value));
}

class Builder {
  private mode: "select" | "update" = "select";
  private pending: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];

  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  limit(): this {
    return this;
  }
  update(values: Record<string, unknown>): this {
    this.mode = "update";
    this.pending = values;
    return this;
  }
  insert(values: Record<string, unknown>): Promise<Result> {
    const row = values as unknown as Row;
    if (table.some((existing) => existing.email === row.email)) {
      // Exactly what PostgREST answers for a duplicate primary key.
      return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value" } });
    }
    table.push({ ...row });
    return Promise.resolve(ok([row]));
  }
  then<R1 = Result, R2 = never>(
    onFulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
  private run(): Promise<Result> {
    if (this.mode === "update") {
      const hit = table.filter((row) => matches(row, this.filters));
      for (const row of hit) Object.assign(row, this.pending);
      // An UPDATE matching nothing reports success with no rows, which is
      // precisely the lost-update signal the guard relies on.
      return Promise.resolve(ok(hit));
    }
    return Promise.resolve(ok(table.filter((row) => matches(row, this.filters))));
  }
}

/** `users` / `portal_accounts` / `paid_emails` answer empty: this probe's
 *  addresses are NOT paid and NOT admins in the database — they get through
 *  `ADMIN_EMAILS` only, which is the bypass under test elsewhere. */
mock.module("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => new Builder() }),
}));

/* -- capture what the handler tried to send --------------------------- */

type Sent = { to: string; html: string; text: string };
const sent: Sent[] = [];
mock.module("../src/lib/mailjet.server", () => ({
  sendMail: async (m: Sent) => {
    sent.push({ to: m.to, html: m.html, text: m.text });
    return { ok: true as const };
  },
  mailConfigured: () => true,
  mailSender: () => "probe@eamigratepro.invalid",
}));

/* -- the probe address is an ADMIN, so the paid check is skipped ------ */

const PROBE = "probe.ratelimit.admin@eamigratepro.invalid";
const SECOND = "probe.ratelimit.other@eamigratepro.invalid";
process.env["ADMIN_EMAILS"] = "someone-else@example.com," + PROBE + "," + SECOND;
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "probe-service-role";
process.env["SUPABASE_URL"] = "https://probe.invalid";

const { default: handler } = await import("../api/activation");

/* -- drive the handler ----------------------------------------------- */

type Reply = { ok: boolean; rateLimited?: boolean; retryAfterMinutes?: number; error?: string; notPaid?: boolean };

async function call(body: Record<string, unknown>): Promise<Reply> {
  let payload: Reply | null = null;
  // The handler writes `response.status(n).json(body)`, so `status()` has to
  // return the SAME object that carries the capturing `json`.
  const response = {
    status() {
      return response;
    },
    json(value: unknown) {
      payload = value as Reply;
    },
    setHeader() {},
  };
  await handler({ method: "POST", body: JSON.stringify(body) }, response);
  if (!payload) throw new Error("handler sent no JSON");
  return payload;
}

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  console.log(`${condition ? "PASS " : "FAIL "} ${name}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  if (!condition) failures++;
}

/* 0. The mail double must actually be in place, or every PASS below is a lie. */
await call({ action: "issueCode", email: PROBE });
check("mail interception works (no real mail was sent)", sent.length === 1, `${sent.length} captured`);
table.length = 0;
sent.length = 0;

/* 1. Three requests are allowed, and each one is counted. */
for (let n = 1; n <= 3; n++) {
  const reply = await call({ action: "issueCode", email: PROBE });
  check(`request ${n} of 3 is allowed`, reply.ok === true, reply.error);
}
check("the row counts all three", table[0]?.count === 3, `count=${table[0]?.count}`);

/* 2. The fourth is refused with the exact wording the owner specified. */
const fourth = await call({ action: "issueCode", email: PROBE });
check("the 4th request in the window is blocked", fourth.ok === false, fourth.error);
check(
  'the block message is exactly "Max 3 codes requested, wait 60 minutes"',
  fourth.error === "Max 3 codes requested, wait 60 minutes",
  fourth.error,
);
check("the reply carries the machine-readable rateLimited flag", fourth.rateLimited === true);
check(
  "retryAfterMinutes is a sane whole number of minutes",
  typeof fourth.retryAfterMinutes === "number" && fourth.retryAfterMinutes >= 1 && fourth.retryAfterMinutes <= 60,
  fourth.retryAfterMinutes,
);
check("no fourth email was actually sent", sent.length === 3, `${sent.length} sent`);

/* 3. Still blocked on the 5th, and the count has NOT crept upward. */
const fifth = await call({ action: "issueCode", email: PROBE });
check("the 5th request stays blocked", fifth.ok === false && fifth.rateLimited === true);
check("a blocked request does not consume a slot", table[0]?.count === 3, `count=${table[0]?.count}`);

/* 4. Other actions are NOT rate limited — only requesting a code is. */
const verify = await call({ action: "verifyCode", email: PROBE, code: "000000" });
check("verifyCode is not rate limited", verify.rateLimited === undefined, verify.error);

/* 5. The window resets once it has aged out. */
table[0].first_request_at = new Date(Date.now() - 61 * 60 * 1000).toISOString();
const afterReset = await call({ action: "issueCode", email: PROBE });
check("a request after 60 minutes is allowed again", afterReset.ok === true, afterReset.error);
check("the count reset to 1, not to 4", table[0]?.count === 1, `count=${table[0]?.count}`);

/* 6. A different email has its own budget. It must ALSO be an admin here, or
 * it would be refused by the paid check and this would prove nothing about the
 * limiter. */
const otherReply = await call({ action: "issueCode", email: SECOND });
check("a second address is not limited by the first", otherReply.ok === true, otherReply.error);
check("the second address has its own count of 1", table.find((r) => r.email === SECOND)?.count === 1);

/* 7. The window is anchored on the FIRST request, not the last. */
table.length = 0;
table.push({ email: PROBE, count: 3, first_request_at: new Date(Date.now() - 59 * 60 * 1000).toISOString(), last_request_at: new Date().toISOString() });
const stillBlocked = await call({ action: "issueCode", email: PROBE });
check("3 requests spread over 59 minutes is still 3 (anchored on the first)", stillBlocked.rateLimited === true, stillBlocked.error);

/* 8. Requirement 3: both parts of the email state the real 5-minute window. */
table.length = 0;
sent.length = 0;
await call({ action: "issueCode", email: PROBE });
const message = sent[0];
check("an email was produced", !!message);
check('the HTML says "after 5 minutes"', /after 5 minutes/.test(message?.html ?? ""), message?.html?.match(/after \d+ minutes/)?.[0]);
check('the plain text says "after 5 minutes"', /after 5 minutes/.test(message?.text ?? ""), message?.text?.match(/after \d+ minutes/)?.[0]);
check("the HTML never says 2 minutes", !/after 2 minutes/.test(message?.html ?? ""));
check("the text never says 2 minutes", !/after 2 minutes/.test(message?.text ?? ""));

console.log(failures === 0 ? "\nRESULT: OK — the code rate limit holds." : `\nRESULT: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
