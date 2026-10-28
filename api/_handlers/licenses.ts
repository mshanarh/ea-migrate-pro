/**
 * /api/licenses — THE LICENCE-KEY STORE, IN UPSTASH KV.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Issued licence keys used to live in Supabase (`license_keys` + the
 * `licenses` array inside `portal_accounts.data`). When that project hits its
 * egress cap every one of those calls answers
 *
 *     Service for this project is restricted … exceed_egress_quota
 *
 * and the whole licence lifecycle breaks at once:
 *
 *   • the mentor's Generate License screen reports "The key was NOT saved to
 *     the cloud" (its portal_accounts push failed) — the screenshot bug;
 *   • the app cannot resolve the key at all, so a real, paid customer is told
 *     "That license key was not found";
 *   • the single-use lock (Supabase `users.license_key`) cannot be written, so
 *     activation fails with "We could not check that licence key".
 *
 * AGENTS.md already declares where this data belongs: registrations, approval
 * state, the payment flag and licence LIMITS live in the Vercel KV / Upstash
 * store (`api/_handlers/_registry.ts`). Keys were the missing piece, so they
 * now live in the same store, behind this endpoint.
 *
 * THE DATA MODEL (three Redis keys, all prefixed so the admin can read them)
 * ─────────────────────────────────────────────────────────────────────────
 *   eamp:license-keys               HASH  key code → JSON LicenceRecord
 *   eamp:license-by-mentor:<email>  SET   key codes the mentor issued
 *   eamp:license-by-client:<email>  SET   key codes assigned to a client
 *   eamp:license-claim:<KEY>        STR   email that claimed the key (SET NX)
 *
 * The two SETs exist so "how many keys does this email have" is an SCARD and
 * not a scan of every record, and so a mentor can list their own keys without
 * reading anyone else's. The claim key is the single-use lock: SET NX is atomic
 * in Redis, which is EXACTLY the first-write-wins semantics the Supabase
 * `users.license_key` column was being used for — and unlike that column it
 * cannot be released by the customer, because the token is server-side only.
 *
 * ACTIONS (POST, JSON body)
 * ─────────────────────────
 *   issue   { key, mentorEmail, clientEmail?, clientName?, eaName?, eaId?,
 *             expiry?, image? }            → store a newly generated key
 *   list    { mentorEmail }               → the mentor's own keys
 *   count   { email }                     → how many keys that email holds
 *   lookup  { key, email }                → resolve a key for activation
 *   remove  { key, mentorEmail? }         → delete a key everywhere
 *   claim   { key, email }                → single-use activation lock
 *
 * Every answer carries `ok`. When the KV store is not configured at all the
 * answer is HTTP 503 with `unavailable: true`, and the client falls back to its
 * old Supabase path — this endpoint can only ever ADD a working route, never
 * remove one, so a deployment without KV behaves exactly as it did before.
 */
import {
  kvCommand,
  normalizeEmail,
  parseBody,
  storeConfigured,
  type ApiRequest,
  type ApiResponse,
} from "./_registry.js";

/** The record stored for one issued key. */
export type LicenceRecord = {
  key: string;
  /** The mentor account that generated it. */
  mentorEmail: string;
  /** Name the mentor typed on the Generate License form. */
  clientName: string;
  /** The address the key was issued TO. Empty = an open key. */
  clientEmail: string;
  eaName: string;
  eaId: string;
  expiry: string;
  createdAt: string;
  /** Set by the first activation. A claimed key is spent for everyone. */
  claimedBy: string | null;
  claimedAt: string | null;
  /** The EA's symbol list — the robot's Selected Quotes. */
  symbols?: string[];
  /** The EA picture, when it survived the size cap below. */
  image?: string;
  /**
   * THE EA'S ROBOT VIDEO, TIED TO THIS KEY.
   *
   * A mentor's demo video is far too large for this store, so the record keeps
   * a POINTER: `videoId` names the row in the `ea_videos` media store that
   * holds the bytes (id `ea-<eaId>` for a mentor upload), and `video` carries a
   * small playable source (an http(s) URL, or a data URL under the cap below)
   * when that is all it takes. Either way the lookup is by LICENCE KEY, so
   * whoever activates the key gets the video — no device, no mentor session.
   */
  videoId?: string;
  video?: string;
  /** Size of the stored video's data URL, in characters (diagnostics + UI). */
  videoBytes?: number;
  /**
   * WHEN this record's EA config last changed (issue, or a mentor EA edit).
   * The app shows it as the "last updated" note and uses it to tell a live
   * server config from a local fallback.
   */
  updatedAt?: string;
};

const KEYS_HASH = "eamp:license-keys";
const MENTOR_PREFIX = "eamp:license-by-mentor:";
const CLIENT_PREFIX = "eamp:license-by-client:";
const CLAIM_PREFIX = "eamp:license-claim:";

/**
 * A HARD CAP ON THE INLINE EA PICTURE.
 *
 * Upstash's REST API rejects a request body over ~1 MB, and a mentor's EA
 * picture is a base64 data URL that can be several MB. Storing the whole thing
 * would make the ISSUE call fail — and a failed issue is the exact bug this
 * endpoint exists to fix — so an oversized picture is dropped and everything
 * else (the key, the EA name, the client, the expiry) is still written. The
 * app then shows the platform logo for that robot instead of nothing at all,
 * which is the honest trade: a key that activates beats a picture that blocks
 * it.
 */
const MAX_IMAGE_CHARS = 400_000;

/**
 * The same cap for an INLINE video source. A real demo video is served through
 * `videoId` (the media store); this only ever carries a small clip or a URL.
 */
const MAX_VIDEO_CHARS = 400_000;

const ACTIONS = [
  "issue",
  "list",
  "count",
  "lookup",
  "remove",
  "claim",
  "ea-config",
  "update-ea",
  "video-put",
  "video-link",
  "video-info",
  "video-chunk",
  "video-clear",
] as const;
type Action = (typeof ACTIONS)[number];

/** The generator's shape (EMP-XXXX-XXXX-XXXX) plus the older EMP- + 12 chars. */
function validKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : "";
  if (!key) return "";
  const shaped = /^EMP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key) || /^EMP-[A-Z0-9]{12}$/.test(key);
  return shaped ? key : "";
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function mentorKey(email: string): string {
  return `${MENTOR_PREFIX}${email}`;
}

function clientKey(email: string): string {
  return `${CLIENT_PREFIX}${email}`;
}

function claimKey(key: string): string {
  return `${CLAIM_PREFIX}${key}`;
}

/** SET members as a clean string list (Redis may answer null for a missing set). */
async function members(redisKey: string): Promise<string[]> {
  const raw = await kvCommand(["SMEMBERS", redisKey]);
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

/** One stored record by key code, or null when it does not exist. */
async function readRecord(key: string): Promise<LicenceRecord | null> {
  const raw = await kvCommand(["HGET", KEYS_HASH, key]);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as LicenceRecord;
  } catch {
    return null;
  }
}

/* ── issue ───────────────────────────────────────────────────────────── */

/**
 * STORE ONE NEWLY GENERATED KEY.
 *
 * Both indexes are written so the key is countable per mentor and per client
 * immediately. A RE-ISSUE of the same code keeps any claim that already
 * exists: overwriting a record must never turn a spent key back into a fresh
 * one, which would be a free re-activation for whoever held it.
 */
async function issue(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const key = validKey(body["key"]);
  if (!key) return { status: 400, body: { ok: false, error: "A valid licence key is required" } };

  const mentorEmail = normalizeEmail(body["mentorEmail"]);
  if (!mentorEmail) return { status: 400, body: { ok: false, error: "mentorEmail is required" } };

  const clientEmail = normalizeEmail(body["clientEmail"]);
  const existing = await readRecord(key);

  const imageRaw = text(body["image"], MAX_IMAGE_CHARS + 1);
  const videoIdRaw = text(body["videoId"], 200);
  const videoRaw = text(body["video"], MAX_VIDEO_CHARS + 1);
  const symbolsRaw = Array.isArray(body["symbols"])
    ? (body["symbols"] as unknown[])
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.trim())
        .filter(Boolean)
        .slice(0, 200)
    : [];
  const record: LicenceRecord = {
    key,
    mentorEmail,
    clientName: text(body["clientName"], 120),
    clientEmail,
    eaName: text(body["eaName"], 120),
    eaId: text(body["eaId"], 120),
    expiry: text(body["expiry"], 40) || "Lifetime",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    claimedBy: existing?.claimedBy ?? null,
    claimedAt: existing?.claimedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (symbolsRaw.length > 0) record.symbols = symbolsRaw;
  // Only keep a picture that fits under the request-size cap (see above).
  if (imageRaw && imageRaw.length <= MAX_IMAGE_CHARS) record.image = imageRaw;
  // THE VIDEO TRAVELS WITH THE KEY from the moment it is issued.
  if (videoIdRaw) record.videoId = videoIdRaw;
  if (videoRaw && videoRaw.length <= MAX_VIDEO_CHARS) record.video = videoRaw;

  await kvCommand(["HSET", KEYS_HASH, key, JSON.stringify(record)]);
  await kvCommand(["SADD", mentorKey(mentorEmail), key]);
  if (clientEmail) await kvCommand(["SADD", clientKey(clientEmail), key]);

  return { status: 200, body: { ok: true, key, duplicate: existing !== null } };
}

/* ── list ────────────────────────────────────────────────────────────── */

/** Every key the mentor generated, newest first. */
async function list(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const email = normalizeEmail(parseBody(request)["mentorEmail"]);
  if (!email) return { status: 400, body: { ok: false, error: "mentorEmail is required" } };
  const codes = await members(mentorKey(email));
  const records: LicenceRecord[] = [];
  for (const code of codes) {
    const record = await readRecord(code);
    if (record) records.push(record);
  }
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { status: 200, body: { ok: true, licenses: records } };
}

/* ── count ───────────────────────────────────────────────────────────── */

/**
 * HOW MANY KEYS THIS EMAIL HOLDS.
 *
 * Both indexes are counted: an email that ISSUES keys may also be the CLIENT on
 * some of them, and the licence cap the admin set has to see the union — the
 * old Supabase count read `license_keys.email`, which is the issuing address,
 * so a client's own keys were invisible to their own limit.
 */
async function count(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const email = normalizeEmail(parseBody(request)["email"]);
  if (!email) return { status: 400, body: { ok: false, error: "email is required" } };
  const [issued, assigned] = await Promise.all([members(mentorKey(email)), members(clientKey(email))]);
  return { status: 200, body: { ok: true, count: new Set([...issued, ...assigned]).size } };
}

/* ── lookup ──────────────────────────────────────────────────────────── */

/**
 * RESOLVE A KEY FOR ACTIVATION.
 *
 * Ownership rules are the ones the app already enforces:
 *   • a key with NO client email is an OPEN key — whoever types it first may
 *     activate it (this is how the admin's shared keys work);
 *   • a key issued TO an address belongs to that address;
 *   • the MENTOR who generated the key may always resolve it.
 * A key that exists but belongs to somebody else is answered `wrongEmail` — a
 * refusal, not a missing key, so the app can say the accurate thing.
 */
async function lookup(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const key = validKey(body["key"]);
  if (!key) return { status: 400, body: { ok: false, error: "A valid licence key is required" } };
  const email = normalizeEmail(body["email"]);
  const record = await readRecord(key);
  if (!record) return { status: 200, body: { ok: true, found: false } };

  if (ownershipDenied(record, email)) {
    return {
      status: 200,
      body: {
        ok: true,
        found: false,
        wrongEmail: true,
        error: "That license key belongs to a different email.",
      },
    };
  }
  return { status: 200, body: { ok: true, found: true, license: record } };
}

/** True when the key is explicitly assigned to a DIFFERENT email. */
function ownershipDenied(record: LicenceRecord, email: string): boolean {
  const client = normalizeEmail(record.clientEmail);
  if (!email) return Boolean(client);
  if (client && client !== email && normalizeEmail(record.mentorEmail) !== email) return true;
  return false;
}

/* ── remove ──────────────────────────────────────────────────────────── */

/** DELETE a key everywhere: the record, both indexes and its claim lock. */
async function remove(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const key = validKey(body["key"]);
  if (!key) return { status: 400, body: { ok: false, error: "A valid licence key is required" } };

  const record = await readRecord(key);
  await kvCommand(["HDEL", KEYS_HASH, key]);
  if (record) {
    await kvCommand(["SREM", mentorKey(normalizeEmail(record.mentorEmail)), key]);
    if (record.clientEmail) await kvCommand(["SREM", clientKey(normalizeEmail(record.clientEmail)), key]);
  }
  // The claim lock goes too, or re-issuing the same code would immediately
  // answer "already in use" for the intended customer.
  await kvCommand(["DEL", claimKey(key)]);
  return { status: 200, body: { ok: true, removed: true } };
}

/* ── claim ───────────────────────────────────────────────────────────── */

/**
 * THE SINGLE-USE ACTIVATION LOCK — first write wins, atomically.
 *
 * Redis `SET … NX` is the whole mechanism: exactly one caller can create the
 * token, every later caller sees it already exists. That replaces the Supabase
 * `users.license_key` column (which the anon key cannot rewrite, but which the
 * database refuses to write AT ALL once the project is over its egress cap).
 *
 * The SAME wording is used whether the key is already taken by this account or
 * by another one, because it is the same rule: a key is activated once. The
 * previous code kept two sentences for it and customers read them as two
 * different problems.
 *
 * EXPORTED so `/api/activation`'s claimKey uses THIS implementation rather than
 * a second copy — two locks that drift apart is exactly how one surface starts
 * refusing keys the other accepts.
 */
export async function claimLicenceKeyForEmail(
  key: string,
  email: string,
): Promise<{ ok: boolean; alreadyInUse?: boolean; heldBy?: string | null; error?: string }> {
  const record = await readRecord(key);
  // A KEY THAT WAS NEVER ISSUED IS NOT LOCKED to whoever typed it first.
  const created = await kvCommand(["SET", claimKey(key), email, "NX"]);
  if (created === "OK") {
    if (record) {
      await kvCommand([
        "HSET",
        KEYS_HASH,
        key,
        JSON.stringify({ ...record, claimedBy: email, claimedAt: new Date().toISOString() }),
      ]);
    }
    return { ok: true };
  }

  const holder = await kvCommand(["GET", claimKey(key)]);
  const heldBy = typeof holder === "string" ? normalizeEmail(holder) : "";
  return { ok: false, alreadyInUse: true, heldBy: heldBy || null, error: "License key already in use" };
}

/**
 * WHO HOLDS THE CLAIM LOCK, read BEFORE an attempt is made — the witness that
 * lets a caller tell a lost answer from a spent key.
 *
 * `claimLicenceKeyForEmail` answers `alreadyInUse` for both cases and cannot
 * distinguish them: a claim whose `SET … NX` committed but whose response was
 * dropped on a mobile network looks identical, from the outcome alone, to a
 * key this account activated long ago. Answering "already in use" for the
 * first case strands the customer on their own key forever — every retry
 * finds their own email in the holder slot.
 *
 * /api/activation reads this first: holder EMPTY before the attempt, own
 * email in the outcome after a failed attempt, means this request's own write
 * landed and only its answer was lost. It is never a verdict on its own.
 * Two reads, because one network blip must not collapse the distinction.
 */
export async function holderOfClaimLock(
  key: string,
): Promise<{ answered: boolean; holder: string | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const holder = await kvCommand(["GET", claimKey(key)]);
      return {
        answered: true,
        holder: typeof holder === "string" && holder.trim() ? normalizeEmail(holder) : null,
      };
    } catch (error) {
      console.warn(
        "[licenses] claim-holder read attempt " + (attempt + 1) + " failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { answered: false, holder: null };
}

/** The endpoint's claim action — see `claimLicenceKeyForEmail` for the rule. */
async function claim(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const key = validKey(body["key"]);
  const email = normalizeEmail(body["email"]);
  if (!key || !email) {
    return { status: 400, body: { ok: false, error: "A valid licence key and email are required" } };
  }
  const outcome = await claimLicenceKeyForEmail(key, email);
  return {
    status: 200,
    body: {
      ok: outcome.ok,
      ...(outcome.alreadyInUse ? { alreadyInUse: true } : {}),
      ...(outcome.heldBy ? { heldBy: outcome.heldBy } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    },
  };
}

/* ── ea-config ───────────────────────────────────────────────────────── */

/** Clean a symbol list from a request body. Empty is meaningful — it means
 *  the mentor removed every symbol, and the app must hear that. */
function symbolList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((symbol): symbol is string => typeof symbol === "string")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/**
 * THE APP'S LIVE EA CONFIG — by licence KEY, which is the identity the app
 * actually holds.
 *
 * This is the endpoint that replaces "the symbols I saw when I activated":
 * every screen calls it with the activated keys and receives the mentor's
 * CURRENT symbol list (plus name and picture) from the same store the mentor
 * portal writes to. Nothing here is a snapshot taken at activation.
 *
 * `symbols: null` means the record predates symbols being stored — the app
 * keeps its last known list. `symbols: []` means the mentor deliberately
 * removed them all.
 */
async function eaConfig(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const raw = Array.isArray(body["keys"]) ? (body["keys"] as unknown[]) : [];
  const keys = Array.from(
    new Set(
      raw
        .map((value) => validKey(value))
        .filter((key): key is string => Boolean(key)),
    ),
  ).slice(0, 50);
  if (keys.length === 0) {
    return { status: 400, body: { ok: false, error: "At least one licence key is required" } };
  }
  const configs: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    const record = await readRecord(key);
    if (!record) continue;
    configs.push({
      key,
      ...(record.eaId ? { eaId: record.eaId } : {}),
      ...(record.eaName ? { eaName: record.eaName } : {}),
      symbols: Array.isArray(record.symbols) ? record.symbols : null,
      ...(record.image ? { image: record.image } : {}),
      // THE ROBOT VIDEO — resolved by key, never by device or mentor session.
      ...(record.videoId ? { videoId: record.videoId } : {}),
      ...(record.video ? { video: record.video } : {}),
      updatedAt: record.updatedAt ?? record.createdAt,
    });
  }
  return { status: 200, body: { ok: true, configs } };
}

/**
 * MENTOR EA EDIT → EVERY KEY FOR THAT EA.
 *
 * The portal calls this when the mentor saves an EA's symbols/name/picture, so
 * the record the app reads is updated in the SAME store. No key regeneration,
 * re-activation or re-login is needed: the next refresh on the client's phone
 * resolves the new list by the key it already holds.
 */
async function updateEa(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const mentorEmail = normalizeEmail(body["mentorEmail"]);
  if (!mentorEmail) {
    return { status: 400, body: { ok: false, error: "mentorEmail is required" } };
  }
  const eaId = text(body["eaId"], 120);
  const eaName = text(body["eaName"], 120);
  if (!eaId && !eaName) {
    return { status: 400, body: { ok: false, error: "eaId or eaName is required" } };
  }
  const hasSymbols = Array.isArray(body["symbols"]);
  const symbols = symbolList(body["symbols"]);
  const imageRaw = text(body["image"], MAX_IMAGE_CHARS + 1);
  const videoIdRaw = text(body["videoId"], 200);
  const videoRaw = text(body["video"], MAX_VIDEO_CHARS + 1);
  const at = new Date().toISOString();
  const codes = await members(mentorKey(mentorEmail));
  let updated = 0;
  for (const code of codes) {
    const record = await readRecord(code);
    if (!record) continue;
    const sameId = Boolean(eaId && record.eaId && record.eaId === eaId);
    const sameName =
      Boolean(eaName) &&
      record.eaName.trim().toLowerCase() === eaName.toLowerCase();
    if (!sameId && !sameName) continue;
    const next: LicenceRecord = {
      ...record,
      ...(eaName ? { eaName } : {}),
      // An explicit list wins — including an EMPTY one (a removal).
      ...(hasSymbols ? { symbols } : {}),
      ...(imageRaw && imageRaw.length <= MAX_IMAGE_CHARS ? { image: imageRaw } : {}),
      // A re-uploaded video replaces the pointer; the app reads it by key.
      ...(videoIdRaw ? { videoId: videoIdRaw } : {}),
      ...(videoRaw && videoRaw.length <= MAX_VIDEO_CHARS ? { video: videoRaw } : {}),
      updatedAt: at,
    };
    await kvCommand(["HSET", KEYS_HASH, code, JSON.stringify(next)]);
    updated += 1;
  }
  return { status: 200, body: { ok: true, updated, updatedAt: at } };
}

/* ── robot video — the bytes live in THIS store ──────────────────────── */

/**
 * THE ROBOT VIDEO IS STORED NEXT TO THE LICENCE RECORD THAT RESOLVES IT.
 *
 * The first cut pointed at the `ea_videos` table in Supabase. Production proved
 * that link dead: the mentor's Save wrote the record with NO pointer at all
 * (`ea-config` answered key + eaId + eaName + symbols + image + updatedAt and
 * nothing else), because the only copy of the MP4 was on the mentor's device
 * and the upload failed without a word. So the bytes are kept HERE, in the same
 * Upstash store as the licence records — the store that demonstrably answers:
 *
 *   eamp:ea-video:<eaId>   HASH   meta = {"chunks":N,"bytes":B}, c0…cN-1 = data
 *
 * A real MP4 is base64-chunked (≤600 KB per chunk) because the KV REST API
 * rejects a request body near 1 MB. The licence record keeps only `videoId`
 * (a few dozen bytes), and the app resolves it BY KEY — never by device, never
 * by the mentor's session.
 */
const VIDEO_PREFIX = "eamp:ea-video:";
const VIDEO_CHUNK_MAX_CHARS = 600_000;
const VIDEO_CHUNKS_MAX = 64;

function videoKey(rowId: string): string {
  return `${VIDEO_PREFIX}${rowId}`;
}

/** The EA's own id is the row id (it already looks like `ea-…`). */
function videoRowId(eaId: string): string {
  return eaId.trim();
}

async function videoMetaFor(rowId: string): Promise<{ chunks: number; bytes: number } | null> {
  const raw = await kvCommand(["HGET", videoKey(rowId), "meta"]);
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as { chunks?: unknown; bytes?: unknown };
    const chunks = Number(parsed.chunks);
    const bytes = Number(parsed.bytes);
    if (!Number.isInteger(chunks) || chunks < 1) return null;
    return { chunks, bytes: Number.isFinite(bytes) ? bytes : 0 };
  } catch {
    return null;
  }
}

/** ONE chunk of the mentor's upload. Idempotent: re-sending an index replaces it. */
async function videoPut(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const mentorEmail = normalizeEmail(body["mentorEmail"]);
  const eaId = text(body["eaId"], 120);
  if (!mentorEmail) return { status: 400, body: { ok: false, error: "mentorEmail is required" } };
  if (!eaId) return { status: 400, body: { ok: false, error: "eaId is required" } };
  const index = Number(body["index"]);
  const total = Number(body["total"]);
  const data = typeof body["data"] === "string" ? body["data"] : "";
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total)) {
    return { status: 400, body: { ok: false, error: "A chunk index and total are required" } };
  }
  if (total < 1 || total > VIDEO_CHUNKS_MAX || index >= total) {
    return { status: 400, body: { ok: false, error: `total must be 1..${VIDEO_CHUNKS_MAX} and index below it` } };
  }
  if (!data || data.length > VIDEO_CHUNK_MAX_CHARS) {
    return {
      status: 400,
      body: { ok: false, error: `Each chunk must be 1..${VIDEO_CHUNK_MAX_CHARS} characters` },
    };
  }
  const rowId = videoRowId(eaId);
  await kvCommand(["HSET", videoKey(rowId), `c${index}`, data]);
  return { status: 200, body: { ok: true, rowId, index, total } };
}

/**
 * SEAL THE UPLOAD AND POINT **EVERY** KEY OF THIS EA AT IT — one idempotent
 * backfill. `keysLinked: 0` is reported honestly (with how many keys the mentor
 * has) so the portal can never claim a link that did not happen.
 */
async function videoLink(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const mentorEmail = normalizeEmail(body["mentorEmail"]);
  if (!mentorEmail) return { status: 400, body: { ok: false, error: "mentorEmail is required" } };
  const eaId = text(body["eaId"], 120);
  const eaName = text(body["eaName"], 120);
  if (!eaId && !eaName) {
    return { status: 400, body: { ok: false, error: "eaId or eaName is required" } };
  }
  const inline = typeof body["video"] === "string" ? body["video"].trim() : "";
  if (inline && inline.length > MAX_VIDEO_CHARS) {
    return { status: 400, body: { ok: false, error: "That video source is too large to store inline" } };
  }
  const chunks = Number(body["chunks"]);
  const bytes = Number(body["bytes"]);
  const rowId = eaId ? videoRowId(eaId) : "";
  if (!inline) {
    if (!rowId) {
      return { status: 400, body: { ok: false, error: "eaId is required for a stored video" } };
    }
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > VIDEO_CHUNKS_MAX) {
      return { status: 400, body: { ok: false, error: "chunks is required for a stored video" } };
    }
    await kvCommand([
      "HSET",
      videoKey(rowId),
      "meta",
      JSON.stringify({ chunks, bytes: Number.isFinite(bytes) ? bytes : 0, at: new Date().toISOString() }),
    ]);
  }

  const at = new Date().toISOString();
  const codes = await members(mentorKey(mentorEmail));
  let keysLinked = 0;
  const wantedId = eaId.trim().toLowerCase();
  const wantedName = eaName.trim().toLowerCase();
  for (const code of codes) {
    const record = await readRecord(code);
    if (!record) continue;
    const sameId = Boolean(wantedId) && record.eaId.trim().toLowerCase() === wantedId;
    const sameName = Boolean(wantedName) && record.eaName.trim().toLowerCase() === wantedName;
    if (!sameId && !sameName) continue;
    const next: LicenceRecord = { ...record, updatedAt: at };
    delete next.video;
    if (inline) {
      next.video = inline;
      delete next.videoId;
      delete next.videoBytes;
    } else {
      next.videoId = rowId;
      if (Number.isFinite(bytes) && bytes > 0) next.videoBytes = bytes;
    }
    await kvCommand(["HSET", KEYS_HASH, code, JSON.stringify(next)]);
    keysLinked += 1;
  }
  return {
    status: 200,
    body: {
      ok: true,
      rowId: rowId || null,
      keysLinked,
      keysForMentor: codes.length,
      inline: Boolean(inline),
    },
  };
}

/** WHAT THE APP ASKS FIRST: does this KEY have a stored video, and how big. */
async function videoInfo(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const key = validKey(parseBody(request)["key"]);
  if (!key) return { status: 400, body: { ok: false, error: "A valid licence key is required" } };
  const record = await readRecord(key);
  if (!record) return { status: 200, body: { ok: true, found: false } };
  if (!record.videoId) return { status: 200, body: { ok: true, found: Boolean(record.video) } };
  const meta = await videoMetaFor(record.videoId);
  if (!meta) {
    // The record points at a video whose index is missing — an ERROR to retry,
    // never "this key has no video".
    return {
      status: 503,
      body: { ok: false, error: `The stored video for this key (${record.videoId}) is incomplete.` },
    };
  }
  return { status: 200, body: { ok: true, found: true, rowId: record.videoId, chunks: meta.chunks, bytes: meta.bytes } };
}

/** ONE chunk at a time — a 6 MB MP4 never has to fit in a single response. */
async function videoChunk(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const key = validKey(body["key"]);
  const index = Number(body["index"]);
  if (!key) return { status: 400, body: { ok: false, error: "A valid licence key is required" } };
  if (!Number.isInteger(index) || index < 0 || index >= VIDEO_CHUNKS_MAX) {
    return { status: 400, body: { ok: false, error: "A valid chunk index is required" } };
  }
  const record = await readRecord(key);
  if (!record?.videoId) {
    return { status: 200, body: { ok: false, found: false, error: "This key has no stored video" } };
  }
  const meta = await videoMetaFor(record.videoId);
  if (!meta) {
    return { status: 503, body: { ok: false, error: "The stored video is incomplete. Try again." } };
  }
  if (index >= meta.chunks) return { status: 400, body: { ok: false, error: "Chunk out of range" } };
  const data = await kvCommand(["HGET", videoKey(record.videoId), `c${index}`]);
  if (typeof data !== "string" || !data) {
    return { status: 503, body: { ok: false, error: `Chunk ${index} of the video is missing.` } };
  }
  return { status: 200, body: { ok: true, data, index, chunks: meta.chunks } };
}

/** Remove a stored video and unlink it from this mentor's keys. */
async function videoClear(request: ApiRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = parseBody(request);
  const mentorEmail = normalizeEmail(body["mentorEmail"]);
  const eaId = text(body["eaId"], 120);
  if (!eaId) return { status: 400, body: { ok: false, error: "eaId is required" } };
  const rowId = videoRowId(eaId);
  await kvCommand(["DEL", videoKey(rowId)]);
  const codes = mentorEmail ? await members(mentorKey(mentorEmail)) : [];
  let unlinked = 0;
  const wantedId = eaId.trim().toLowerCase();
  for (const code of codes) {
    const record = await readRecord(code);
    if (!record) continue;
    if (record.eaId.trim().toLowerCase() !== wantedId) continue;
    const next: LicenceRecord = { ...record, updatedAt: new Date().toISOString() };
    delete next.videoId;
    delete next.videoBytes;
    delete next.video;
    await kvCommand(["HSET", KEYS_HASH, code, JSON.stringify(next)]);
    unlinked += 1;
  }
  return { status: 200, body: { ok: true, cleared: rowId, unlinked } };
}

/* ── handler ─────────────────────────────────────────────────────────── */

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const body = parseBody(request);
  const action = body["action"] as Action;
  if (!ACTIONS.includes(action)) {
    response.status(400).json({ ok: false, error: "Unknown action" });
    return;
  }

  // UNCONFIGURED KV IS NOT AN ERROR FOR THE APP — `unavailable: true` is the
  // machine-readable signal that tells the client to use its Supabase fallback.
  if (!storeConfigured()) {
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: "Licence storage is not configured on the server.",
    });
    return;
  }

  try {
    const answer =
      action === "issue"
        ? await issue(request)
        : action === "list"
          ? await list(request)
          : action === "count"
            ? await count(request)
            : action === "lookup"
              ? await lookup(request)
              : action === "remove"
                ? await remove(request)
                : action === "claim"
                  ? await claim(request)
                  : action === "ea-config"
                    ? await eaConfig(request)
                    : action === "update-ea"
                      ? await updateEa(request)
                      : action === "video-put"
                        ? await videoPut(request)
                        : action === "video-link"
                          ? await videoLink(request)
                          : action === "video-info"
                            ? await videoInfo(request)
                            : action === "video-chunk"
                              ? await videoChunk(request)
                              : await videoClear(request);
    response.status(answer.status).json(answer.body);
  } catch (error) {
    console.error("[licenses]", action, error);
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: "Licence storage is unavailable. Please try again.",
    });
  }
}
