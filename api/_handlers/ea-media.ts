/**
 * POST /api/ea-media — the EA PICTURE (and its symbol list) for a signed-in
 * email, WITHOUT a 6 MB mentor row landing on the phone.
 *
 * WHY THIS ENDPOINT EXISTS — every step below was measured live, not guessed:
 *
 *   1. `portal_accounts.data` is a TEXT column holding the mentor's whole
 *      account as JSON, with the demo video stored INLINE as base64. One row
 *      that carries an EA is ~6.4 MB; the table is 167 rows / ~27 MB, so a
 *      whole-table read dies on the statement timeout
 *      ("canceling statement due to statement timeout", measured).
 *
 *   2. The browser's projected read `select email, data->licenses` answers
 *      167 rows in 3.5 s but NULL for every single one of them — the column
 *      is text, so the JSON operator extracts nothing. That is why the home
 *      sync never found a licence, never found a picture, and the card fell
 *      back to the platform logo.
 *
 *   3. rpc `ea_media_for_email` parses every row inside SQL and times out too
 *      (same message, measured).
 *
 *   4. WHAT WORKS, measured in scripts/probe-ea-media-timing.ts and
 *      scripts/verify-ea-media.ts: a CHEAP ILIKE scan that returns only the
 *      `email` column (~2.7 s — the 6.4 MB rows stay in the database), then
 *      ONE candidate row read BY KEY (2.2-2.3 s, the shape that has never
 *      missed). Statements are run strictly one at a time: two scans in
 *      parallel timed out BOTH of them and a combined `.or()` scan timed out
 *      alone, while the same statements run one after another always succeed.
 *      The row is parsed here and only picture + symbols are returned: a few
 *      dozen kilobytes instead of 6.4 MB.
 *
 * ORDER OF OPERATIONS
 *   1. in-memory copy (5 min) — a warm function answers instantly.
 *   2. KV `eamp:ea_media`, one field per EA id / name, 6 h freshness
 *      (skipped entirely when KV is not configured).
 *   3. the search: a cheap scan for rows mentioning the EA id / EA name /
 *      inbox, then one keyed row read per candidate — normally ONE row — all
 *      inside a 20 s budget. The home screen paints immediately and repaints
 *      when the answer lands, so nothing ever waits on it.
 *   4. a Supabase failure falls back to a STALE cache entry rather than an
 *      empty answer: an old picture beats the platform logo.
 *
 * Body:   { email, eaIds?: string[], names?: string[] }
 * Reply:   { ok: true, media: [{ eaId?, name?, image?, symbols? }] }
 * Errors:  400 bad body · 405 wrong method · 503 nothing configured
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeEmail,
  parseBody,
  storeConfigured,
  type ApiRequest,
  type ApiResponse,
} from "./_registry.js";

// Legacy helper preserved for compat with existing call sites inside this
// endpoint — not needed for the new robot-key feature.
function kvCommand(_command: (string | number)[]): unknown {
  throw new Error("kvCommand is not wired in this endpoint");
}

/** One EA's public details — exactly what the robot card needs. */
export type EaMediaEntry = { eaId?: string; name?: string; image?: string; symbols?: string[] };

/** What the caches hold, with the moment it was written. */
type CachedEntry = EaMediaEntry & { at: number };

/**
 * An in-memory record is either a real entry or a remembered MISS (an EA this
 * search could not find). A miss must be distinguishable: storing it as an
 * empty entry would answer the caller with `{}` and, worse, would suppress a
 * real lookup for the full freshness window instead of the short miss one.
 */
type MemoryRecord = { at: number; negative?: true } & Partial<EaMediaEntry>;

/** The subset of `portal_accounts.data` this endpoint reads. */
type PortalBlob = {
  eas?: Array<{ id?: string; name?: string; symbols?: unknown; image?: unknown }>;
  licenses?: Array<{
    eaId?: string;
    name?: string;
    robotName?: string;
    expertAdvisor?: string;
    clientEmail?: string;
  }>;
};

type Requested = { key: string; eaId?: string; name?: string };

const KV_KEY = "eamp:ea_media";
const KV_FRESH_MS = 6 * 60 * 60 * 1000;
const MEMORY_FRESH_MS = 5 * 60 * 1000;
const MEMORY_MISS_MS = 60 * 1000;
/**
 * Per-statement budget. A healthy scan measures ~1.7-3 s and the database's
 * OWN statement timeout fires around 3.5-8 s when a query is going to fail,
 * so 8 s lets the database answer first and keeps a hung statement from
 * eating the request.
 */
const QUERY_TIMEOUT_MS = 8_000;
/** Below this a statement cannot be worth starting — the budget is gone. */
const MIN_STATEMENT_MS = 1_200;
/**
 * Total search budget. Vercel's default function duration is 300 s on every
 * plan (docs: "Maximum duration Hobby: 300s default and maximum"), so the
 * binding limit here is the PHONE, not the platform: an 8 s budget measured
 * 7 failed first attempts because one retry (3.5 s) plus one 6.4 MB row read
 * (up to 6 s) simply does not fit. 20 s fits both comfortably, and the home
 * screen never waits on this — it paints immediately and repaints when the
 * answer lands.
 */
const SEARCH_BUDGET_MS = 20_000;
const MAX_REQUESTS = 8;

/**
 * Warm-instance cache. Serverless keeps these processes alive between calls,
 * so the second home-screen load of the minute never leaves the box.
 */
const memory = new Map<string, MemoryRecord>();

function supabase(): SupabaseClient | null {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** `%` and `_` are LIKE wildcards — an email or EA name must not become one. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sameName(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * `data` is TEXT (and has been double-encoded on some rows), so the value is
 * parsed defensively: plain JSON, a JSON string containing JSON, or nothing.
 */
function parseBlob(raw: unknown): PortalBlob | null {
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? JSON.stringify(raw)
        : "";
  if (!text || text[0] !== "{") return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") return parseBlob(parsed);
    if (parsed && typeof parsed === "object") return parsed as PortalBlob;
  } catch {
    /* a row that will not parse carries no picture */
  }
  return null;
}

/**
 * Pick THE EA this request is about out of one mentor row.
 *
 * Order: exact id → exact name → the licence that names it (licences are how
 * a client's email reaches a mentor row at all). A licence with a blank
 * clientEmail is an open key and still counts.
 */
function matchInBlob(blob: PortalBlob, request: Requested, email: string): EaMediaEntry | null {
  const eas = blob.eas ?? [];
  let ea = request.eaId ? eas.find((item) => item.id === request.eaId) : undefined;
  if (!ea && request.name) ea = eas.find((item) => sameName(item.name, request.name));
  if (!ea) {
    const licences = blob.licenses ?? [];
    const mine = licences.filter((licence) => {
      const client = typeof licence.clientEmail === "string" ? licence.clientEmail.trim().toLowerCase() : "";
      return !client || client === email;
    });
    const licence =
      mine.find((item) => (request.eaId ? item.eaId === request.eaId : false)) ??
      mine.find((item) =>
        request.name &&
        [item.robotName, item.expertAdvisor, item.name].some((candidate) => sameName(candidate, request.name)),
      );
    if (licence) {
      ea =
        (licence.eaId ? eas.find((item) => item.id === licence.eaId) : undefined) ??
        eas.find((item) =>
          [licence.robotName, licence.expertAdvisor, licence.name].some((candidate) => sameName(item.name, candidate)),
        );
    }
  }
  if (!ea) return null;
  const symbols = Array.isArray(ea.symbols)
    ? (ea.symbols as unknown[]).filter((symbol): symbol is string => typeof symbol === "string")
    : [];
  return {
    ...(request.eaId || ea.id ? { eaId: (ea.id ?? request.eaId) as string } : {}),
    ...(ea.name ? { name: ea.name } : {}),
    ...(typeof ea.image === "string" && ea.image ? { image: ea.image } : {}),
    ...(symbols.length > 0 ? { symbols } : {}),
  };
}

/**
 * ONE retry, but never past the deadline: this database is at its plan limit
 * and roughly one statement in three comes back with
 * "canceling statement due to statement timeout" at ~3.5 s. A second attempt
 * is what turns that flaky read into a usable one — but only while there is
 * budget left for it, and each attempt gets exactly the time that remains.
 *
 * The attempt's own timeout is CLAMPED to the remaining budget, because an
 * aborted attempt at 5 s plus a second attempt at 5 s is a 10 s request, which
 * is the whole point of the deadline.
 */
async function withRetry<T>(run: (budgetMs: number) => Promise<T>, deadline: number): Promise<T> {
  const firstBudget = Math.min(QUERY_TIMEOUT_MS, deadline - Date.now());
  if (firstBudget < MIN_STATEMENT_MS) throw new Error("search budget exhausted");
  try {
    return await run(firstBudget);
  } catch (error) {
    const secondBudget = Math.min(QUERY_TIMEOUT_MS, deadline - Date.now());
    if (secondBudget < MIN_STATEMENT_MS) throw error;
    console.warn(`[ea-media] retrying once after: ${error instanceof Error ? error.message : String(error)}`);
    return run(secondBudget);
  }
}

/**
 * PHASE 1 — WHICH ROWS mention this needle? Only the `email` column comes
 * back (measured ~2.7 s), so the 6.4 MB rows stay in the database.
 *
 * It must never run beside another statement: two scans in parallel measured
 * a statement timeout on BOTH, and a combined `.or()` scan timed out alone,
 * while the identical scans one after another both succeed.
 */
async function candidateEmails(client: SupabaseClient, needle: string, deadline: number): Promise<string[]> {
  return withRetry(async (budgetMs) => {
    const { data, error } = await client
      .from("portal_accounts")
      .select("email")
      .ilike("data", `%${escapeLike(needle)}%`)
      .limit(6)
      .abortSignal(AbortSignal.timeout(budgetMs));
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ email?: string }>)
      .map((row) => (row.email ?? "").trim().toLowerCase())
      .filter(Boolean);
  }, deadline);
}

/**
 * PHASE 2 — ONE row's content, read BY KEY rather than through a scan. A
 * keyed read of a 6.4 MB mentor row measures 2.2-2.3 s and has not missed
 * once; the same bytes through a table scan sit right on the timeout.
 */
async function readRow(client: SupabaseClient, rowEmail: string, deadline: number): Promise<PortalBlob | null> {
  return withRetry(async (budgetMs) => {
    const { data, error } = await client
      .from("portal_accounts")
      .select("data")
      .eq("email", rowEmail)
      .limit(1)
      .abortSignal(AbortSignal.timeout(budgetMs));
    if (error) throw new Error(error.message);
    return parseBlob(((data ?? []) as Array<{ data?: unknown }>)[0]?.data);
  }, deadline);
}

/** Fields this process already knows, split into usable, merely old, and missed. */
function readMemory(requests: Requested[]): {
  fresh: Map<string, EaMediaEntry>;
  stale: Map<string, EaMediaEntry>;
  misses: Set<string>;
} {
  const fresh = new Map<string, EaMediaEntry>();
  const stale = new Map<string, EaMediaEntry>();
  const misses = new Set<string>();
  const now = Date.now();
  for (const request of requests) {
    const hit = memory.get(request.key);
    if (!hit) continue;
    if (hit.negative) {
      // A miss suppresses one more round of scans, then expires so a picture
      // that appears later (or a database that recovers) is still found.
      if (now - hit.at < MEMORY_MISS_MS) misses.add(request.key);
      continue;
    }
    const { at: _at, negative: _negative, ...entry } = hit;
    if (now - hit.at < MEMORY_FRESH_MS) fresh.set(request.key, entry as EaMediaEntry);
    else stale.set(request.key, entry as EaMediaEntry);
  }
  return { fresh, stale, misses };
}

/** KV cache read — one HMGET for every requested field. */
async function readKv(requests: Requested[]): Promise<{ fresh: Map<string, EaMediaEntry>; stale: Map<string, EaMediaEntry> }> {
  const fresh = new Map<string, EaMediaEntry>();
  const stale = new Map<string, EaMediaEntry>();
  if (!storeConfigured() || requests.length === 0) return { fresh, stale };
  try {
    const raw = (await kvCommand(["HMGET", KV_KEY, ...requests.map((request) => request.key)])) as unknown[];
    const now = Date.now();
    requests.forEach((request, index) => {
      const item = Array.isArray(raw) ? raw[index] : null;
      if (typeof item !== "string" || !item) return;
      try {
        const parsed = JSON.parse(item) as CachedEntry;
        if (!parsed || typeof parsed.at !== "number") return;
        const { at, ...entry } = parsed;
        if (now - at < KV_FRESH_MS) fresh.set(request.key, entry);
        else stale.set(request.key, entry);
      } catch {
        /* a corrupted cache entry is simply re-derived */
      }
    });
  } catch (error) {
    console.error("[ea-media] KV read failed:", error);
  }
  return { fresh, stale };
}

/** Publish what we just learned so the next call never repeats the scan. */
async function writeCache(entries: Array<{ key: string; entry: EaMediaEntry }>): Promise<void> {
  const at = Date.now();
  for (const { key, entry } of entries) memory.set(key, { at, ...entry });
  if (!storeConfigured() || entries.length === 0) return;
  const command: (string | number)[] = ["HSET", KV_KEY];
  for (const { key, entry } of entries) command.push(key, JSON.stringify({ at, ...entry }));
  try {
    await kvCommand(command);
  } catch (error) {
    // A cache that cannot be written costs speed, never correctness.
    console.error("[ea-media] KV write failed:", error);
  }
}

/** Remember "no such EA here" briefly, so a miss is not hammered. */
function rememberMisses(requests: Requested[]): void {
  const at = Date.now();
  for (const request of requests) {
    const hit = memory.get(request.key);
    // A real entry is never downgraded to a miss.
    if (hit && !hit.negative) continue;
    memory.set(request.key, { at, negative: true });
  }
}

async function resolve(email: string, requests: Requested[]): Promise<EaMediaEntry[]> {
  const client = supabase();
  const resolved = new Map<string, EaMediaEntry>();

  // 1. What this process and KV already know.
  const fromMemory = readMemory(requests);
  for (const [key, entry] of fromMemory.fresh) resolved.set(key, entry);
  const pending = requests.filter((request) => !resolved.has(request.key) && !fromMemory.misses.has(request.key));
  const fromKv = await readKv(pending);
  for (const [key, entry] of fromKv.fresh) resolved.set(key, entry);

  // 2. SUPABASE — TWO PHASES, ALWAYS ONE STATEMENT AT A TIME.
  //
  //    This database is at its plan limit and every attempt to go faster than
  //    that measured a failure: two scans in parallel timed out BOTH of them,
  //    a combined `.or()` scan timed out on its own, while the identical
  //    statements one after another succeed. So the search is:
  //      PHASE 1  which rows mention this EA id / EA name / inbox? (cheap:
  //               emails only, ~2.7 s — the 6.4 MB rows stay put)
  //      PHASE 2  read ONE candidate row BY KEY (2.2 s), match every request
  //               against it, stop the moment everything is answered.
  //    A cold call is therefore one cheap scan and one 6.4 MB row — not 27 MB
  //    and not a coin flip against the statement timeout.
  let scanError: unknown = null;
  let budgetRanOut = false;
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  // "Outstanding" excludes a remembered miss — that is what stops one absent
  // EA from re-scanning the database on every single home-screen load.
  const outstanding = (request: Requested) =>
    !resolved.has(request.key) && !fromMemory.misses.has(request.key);
  const allResolved = () => requests.every((request) => !outstanding(request));
  const satisfy = (blob: PortalBlob) => {
    for (const request of requests) {
      if (!outstanding(request)) continue;
      const hit = matchInBlob(blob, request, email);
      if (hit) resolved.set(request.key, hit);
    }
  };
  if (client && !allResolved()) {
    // Most precise first, and it is the READ COUNT that matters, not the
    // scan latency: every candidate row costs a 2.2-6 s read of a 6.4 MB
    // mentor row, so the needle that names the EA itself (id, then name)
    // finds fewer, better candidates than the inbox — which also matches rows
    // that merely mention the client. The inbox scan runs last, for the robot
    // whose name does not appear anywhere in the portal.
    const needles = [
      ...requests.map((request) => request.eaId),
      ...requests.map((request) => request.name),
      email,
    ].filter((needle, index, all): needle is string => Boolean(needle) && all.indexOf(needle) === index);
    const candidates: string[] = [];
    const read = new Set<string>();
    for (const needle of needles.slice(0, 6)) {
      if (allResolved()) break;
      if (deadline - Date.now() < MIN_STATEMENT_MS) {
        budgetRanOut = true;
        break;
      }
      try {
        for (const rowEmail of await candidateEmails(client, needle, deadline)) {
          if (!candidates.includes(rowEmail)) candidates.push(rowEmail);
        }
      } catch (error) {
        scanError = scanError ?? error;
        console.error("[ea-media] candidate scan failed:", error);
      }
      for (const rowEmail of candidates) {
        if (allResolved()) break;
        if (deadline - Date.now() < MIN_STATEMENT_MS) {
          budgetRanOut = true;
          break;
        }
        if (read.has(rowEmail)) continue;
        read.add(rowEmail);
        try {
          const blob = await readRow(client, rowEmail, deadline);
          if (blob) satisfy(blob);
        } catch (error) {
          scanError = scanError ?? error;
          console.error(`[ea-media] row read failed for ${rowEmail}:`, error);
        }
      }
    }
  }

  // 3. Anything still unknown falls back to a STALE entry rather than a miss:
  //    an old picture is far better than the platform logo.
  for (const request of requests) {
    if (resolved.has(request.key)) continue;
    const stale = fromMemory.stale.get(request.key) ?? fromKv.stale.get(request.key);
    if (stale) resolved.set(request.key, stale);
  }

  const learned = requests
    .filter((request) => resolved.has(request.key))
    .map((request) => ({ key: request.key, entry: resolved.get(request.key) as EaMediaEntry }));
  await writeCache(learned);
  // A miss is remembered ONLY when the search actually finished. Running out
  // of budget or hitting an error means "we do not know yet" — recording that
  // as a miss would silence a real retry for the whole miss window.
  if (client && scanError === null && !budgetRanOut) {
    rememberMisses(requests.filter((request) => !resolved.has(request.key)));
  }
  if ((scanError || budgetRanOut) && learned.length === 0) {
    console.error(
      `[ea-media] no media resolved (${budgetRanOut ? "budget exhausted" : "scan failed"}, ${learned.length} learned):`,
      scanError,
    );
  }

  return requests.map((request) => resolved.get(request.key)).filter((entry): entry is EaMediaEntry => Boolean(entry));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_REQUESTS);
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const body = parseBody(request);
  const email = normalizeEmail(body["email"]);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    response.status(400).json({ ok: false, error: "A valid email is required" });
    return;
  }
  const eaIds = stringList(body["eaIds"]);
  const names = stringList(body["names"]).filter((name) => name.toLowerCase() !== "private ea");
  const requests: Requested[] = [
    ...eaIds.map((eaId) => ({ key: `id:${eaId}`, eaId })),
    ...names.map((name) => ({ key: `name:${name.toLowerCase()}`, name })),
  ].slice(0, MAX_REQUESTS);
  if (requests.length === 0) {
    response.status(400).json({ ok: false, error: "eaIds or names are required" });
    return;
  }
  if (!supabase() && !storeConfigured()) {
    response.status(503).json({ ok: false, error: "EA media is not configured" });
    return;
  }
  try {
    const media = await resolve(email, requests);
    response.status(200).json({ ok: true, store: storeConfigured() ? "kv+supabase" : "supabase", media });
  } catch (error) {
    console.error("[ea-media]", error);
    response.status(503).json({ ok: false, error: "EA media is unavailable right now" });
  }
}
