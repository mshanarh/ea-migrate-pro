/**
 * THE BROWSER'S DOOR TO /api/licenses — the Upstash-KV licence-key store.
 *
 * WHY A NEW STORE
 * ───────────────
 * Licence keys used to be written to Supabase (`license_keys` and the
 * `licenses` array inside `portal_accounts.data`). Once that project exceeded
 * its egress cap, every one of those calls answers
 *
 *     Service for this project is restricted … exceed_egress_quota
 *
 * so a mentor could no longer save a key ("The key was NOT saved to the
 * cloud") and the app could no longer resolve one ("That license key was not
 * found"/"We could not check that licence key"). AGENTS.md already places
 * registrations, approvals, the payment flag and licence LIMITS in KV; keys
 * now live there too, behind /api/licenses.
 *
 * THE CONTRACT, AND WHY IT IS NOT A BOOLEAN
 * ──────────────────────────────────────────
 * `enabled: false` means THIS STORE COULD NOT ANSWER — no endpoint on this
 * host, no KV configured on the server, a timeout, or a cold 503. It is the
 * only value that lets a caller fall back to its old Supabase path, and it
 * must never be read as "the operation failed".
 * `enabled: true, ok: true`  — KV answered and did the thing.
 * `enabled: true, ok: false` — KV answered and REFUSED (key already in use, a
 *                              key that belongs to another email). The reason
 *                              is in `error` and it is final.
 *
 * Collapsing those three into one boolean is how a working store gets blamed
 * for a network blip, and how an unreachable store silently looks like a
 * refusal. The same split is used by `activation-client.ts`.
 */

export type LicencedKey = {
  key: string;
  /** The mentor account that generated it. */
  mentorEmail: string;
  /** Name typed on the Generate License form. */
  clientName: string;
  /** The address the key was issued TO. Empty = an open key. */
  clientEmail: string;
  eaName: string;
  eaId: string;
  expiry: string;
  createdAt: string;
  claimedBy: string | null;
  claimedAt: string | null;
  /** The EA's symbols — the robot's Selected Quotes. */
  symbols?: string[];
  /** The EA picture, when it fit under the store's size cap. */
  image?: string;
  /** The row in the `ea_videos` media store holding this EA's robot video. */
  videoId?: string;
  /** A small playable video source (http(s) URL or data URL), when one fits. */
  video?: string;
  /** When the EA config last changed (issue, or a mentor EA edit). */
  updatedAt?: string;
};

/**
 * ONE EA'S LIVE CONFIG, resolved by the licence key the app holds.
 *
 * `symbols: null` = this record predates stored symbols (keep the local list);
 * `symbols: []` = the mentor removed every symbol (the app must drop them).
 */
export type EaConfigEntry = {
  key: string;
  eaId?: string;
  eaName?: string;
  symbols: string[] | null;
  image?: string;
  /** The media-store row holding this key's robot video ("ea-<eaId>"). */
  videoId?: string;
  /** A small playable video source, when the record carries one directly. */
  video?: string;
  updatedAt?: string;
};

/** Every answer this store gives. `enabled` is the fallback signal. */
export type KvAnswer = {
  enabled: boolean;
  ok: boolean;
  error?: string;
  unavailable?: boolean;
};

export type KvIssueAnswer = KvAnswer & { duplicate?: boolean };
export type KvCountAnswer = KvAnswer & { count: number };
export type KvListAnswer = KvAnswer & { licenses: LicencedKey[] };
export type KvClaimAnswer = KvAnswer & { alreadyInUse?: boolean; heldBy?: string | null };
export type KvLookupAnswer = KvAnswer & { found: boolean; license?: LicencedKey; wrongEmail?: boolean };
export type KvEaConfigAnswer = KvAnswer & { configs: EaConfigEntry[] };
export type KvEaUpdateAnswer = KvAnswer & { updated?: number; updatedAt?: string };

/** What a stored (chunked) robot video answers with. */
export type KvVideoInfoAnswer = KvAnswer & {
  found: boolean;
  rowId?: string;
  chunks?: number;
  bytes?: number;
};

export type KvVideoChunkAnswer = KvAnswer & { data?: string; chunks?: number };

export type KvVideoLinkAnswer = KvAnswer & {
  keysLinked?: number;
  keysForMentor?: number;
  rowId?: string | null;
  inline?: boolean;
};

/** A slow answer is a dead one — the store is a single Redis round trip. */
const DEADLINE_MS = 12_000;

type ReplyBody = {
  ok?: boolean;
  unavailable?: boolean;
  error?: string;
  key?: string;
  duplicate?: boolean;
  count?: number;
  licenses?: LicencedKey[];
  license?: LicencedKey;
  found?: boolean;
  wrongEmail?: boolean;
  alreadyInUse?: boolean;
  heldBy?: string | null;
  configs?: EaConfigEntry[];
  updated?: number;
  updatedAt?: string;
  rowId?: string | null;
  chunks?: number;
  bytes?: number;
  data?: string;
  keysLinked?: number;
  keysForMentor?: number;
  inline?: boolean;
};

/**
 * ONE POST, ONE SHAPE OF ANSWER.
 *
 * A host that only serves `dist/` rewrites every path to index.html, so an
 * unrouted store looks exactly like a working one unless the body is checked —
 * a real answer always carries a boolean `ok` (see activation-client.ts for the
 * same reasoning). HTML where JSON was contracted means `enabled: false`.
 */
async function post(payload: Record<string, unknown>): Promise<ReplyBody | null> {
  if (typeof window === "undefined") return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    /**
     * ONE RE-ASK FOR A REQUEST THAT NEVER GOT AN ANSWER — the failure a
     * flaky mobile network produces most, and the one that made a fine key
     * look absent: `lookup` returns `enabled: false`, the caller falls into
     * the legacy path, and the customer is told to pay or told the key does
     * not exist. Reads and idempotent actions only — `issue` may have
     * COMMITTED before its answer was lost, and re-sending it would greet the
     * mentor with a duplicate-key error for their own key.
     */
    if (attempt > 0) {
      if (payload["action"] === "issue") return null;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    try {
      const reply = await fetch("/api/licenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      // 404/405 is what a static host answers with no function at all.
      if (reply.status === 404 || reply.status === 405) return null;
      const parsed = (await reply.json().catch(() => null)) as ReplyBody | null;
      if (!parsed || typeof parsed.ok !== "boolean") return null;
      // `unavailable` is the server saying "no KV here" — the caller's fallback.
      if (parsed.unavailable) return null;
      return parsed;
    } catch {
      // Network-level: loop once more, then report "could not be asked".
    }
  }
  return null;
}

function offline<T extends KvAnswer>(fallback: T): T {
  return fallback;
}

/**
 * STORE A NEWLY GENERATED KEY — the call the Generate License screen needs to
 * succeed, and the one that was failing against Supabase.
 */
export async function issueLicenseKeyInKv(input: {
  key: string;
  mentorEmail: string;
  clientEmail?: string;
  clientName?: string;
  eaName?: string;
  eaId?: string;
  expiry?: string;
  symbols?: string[];
  image?: string;
  /** The EA's robot video, linked to the key from the moment it is issued. */
  videoId?: string;
  video?: string;
}): Promise<KvIssueAnswer> {
  const answer = await post({ action: "issue", ...input });
  if (!answer) return offline({ enabled: false, ok: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    ...(answer.duplicate ? { duplicate: true } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/** HOW MANY KEYS THIS EMAIL HOLDS — the admin's licence cap is checked with this. */
export async function countLicensesInKv(email: string): Promise<KvCountAnswer> {
  const answer = await post({ action: "count", email });
  if (!answer) return offline({ enabled: false, ok: false, count: 0 });
  return {
    enabled: true,
    ok: answer.ok === true,
    count: Number.isFinite(answer.count) ? Number(answer.count) : 0,
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/** THE MENTOR'S OWN KEYS, newest first. */
export async function listLicensesInKv(mentorEmail: string): Promise<KvListAnswer> {
  const answer = await post({ action: "list", mentorEmail });
  if (!answer) return offline({ enabled: false, ok: false, licenses: [] });
  return {
    enabled: true,
    ok: answer.ok === true,
    licenses: Array.isArray(answer.licenses) ? answer.licenses : [],
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/**
 * RESOLVE A KEY FOR ACTIVATION. `found: false` with no `wrongEmail` means the
 * store answered honestly and does not hold that key — which is different from
 * `enabled: false` (the store could not be asked at all).
 */
export async function lookupLicenseInKv(key: string, email: string): Promise<KvLookupAnswer> {
  const answer = await post({ action: "lookup", key, email });
  if (!answer) return offline({ enabled: false, ok: false, found: false });
  const result: KvLookupAnswer = {
    enabled: true,
    ok: answer.ok === true,
    found: answer.found === true,
    ...(answer.license ? { license: answer.license } : {}),
    ...(answer.wrongEmail ? { wrongEmail: true } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
  return result;
}

/**
 * THE LIVE EA CONFIG FOR THESE KEYS — what the bot screen, Quotes and the
 * Scanner read instead of the snapshot saved at activation. `enabled: false`
 * means the server store could not answer, so the caller shows its last known
 * list with a "last updated" note rather than pretending it is current.
 */
export async function fetchEaConfigsInKv(keys: string[]): Promise<KvEaConfigAnswer> {
  const clean = Array.from(new Set(keys.map((key) => key.trim().toUpperCase()).filter(Boolean))).slice(0, 50);
  if (clean.length === 0) return offline({ enabled: true, ok: true, configs: [] });
  const answer = await post({ action: "ea-config", keys: clean });
  if (!answer) return offline({ enabled: false, ok: false, configs: [] });
  const configs = Array.isArray(answer.configs)
    ? answer.configs.filter((entry): entry is EaConfigEntry => Boolean(entry) && typeof entry.key === "string")
    : [];
  return {
    enabled: true,
    ok: answer.ok === true,
    configs,
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/**
 * MENTOR EA EDIT → the SAME server config the app reads. Called by the portal
 * when an EA is saved, so a symbol added or removed appears on the client's
 * phone at the next refresh — no new key, no re-activation, no re-login.
 */
export async function updateEaConfigInKv(input: {
  mentorEmail: string;
  eaId?: string;
  eaName?: string;
  symbols: string[];
  image?: string;
  videoId?: string;
  video?: string;
}): Promise<KvEaUpdateAnswer> {
  const answer = await post({ action: "update-ea", ...input });
  if (!answer) return offline({ enabled: false, ok: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    ...(typeof answer.updated === "number" ? { updated: answer.updated } : {}),
    ...(typeof answer.updatedAt === "string" ? { updatedAt: answer.updatedAt } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/* ── the robot video, stored in this same KV store ───────────────────── */

/**
 * ONE CHUNK OF THE MENTOR'S MP4. A real video is far too big for a single KV
 * write (the REST API rejects a body near 1 MB), so it is uploaded in pieces and
 * reassembled by the app — see api/_handlers/licenses.ts.
 */
export async function putEaVideoChunkInKv(input: {
  mentorEmail: string;
  eaId: string;
  index: number;
  total: number;
  data: string;
}): Promise<KvAnswer> {
  const answer = await post({ action: "video-put", ...input });
  if (!answer) return offline({ enabled: false, ok: false });
  return { enabled: true, ok: answer.ok === true, ...(answer.error ? { error: answer.error } : {}) };
}

/**
 * SEAL THE UPLOAD AND POINT EVERY KEY OF THE EA AT IT.
 * `keysLinked` is real: 0 means the video is stored but no key points at it.
 */
export async function linkEaVideoInKv(input: {
  mentorEmail: string;
  eaId?: string;
  eaName?: string;
  video?: string;
  chunks?: number;
  bytes?: number;
}): Promise<KvVideoLinkAnswer> {
  const answer = await post({ action: "video-link", ...input });
  if (!answer) return offline({ enabled: false, ok: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    ...(typeof answer.keysLinked === "number" ? { keysLinked: answer.keysLinked } : {}),
    ...(typeof answer.keysForMentor === "number" ? { keysForMentor: answer.keysForMentor } : {}),
    ...(answer.rowId !== undefined ? { rowId: answer.rowId } : {}),
    ...(answer.inline !== undefined ? { inline: answer.inline } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/** Does THIS KEY have a stored video, and in how many chunks? */
export async function fetchEaVideoInfoInKv(key: string): Promise<KvVideoInfoAnswer> {
  const answer = await post({ action: "video-info", key });
  if (!answer) return offline({ enabled: false, ok: false, found: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    found: answer.found === true,
    ...(typeof answer.rowId === "string" ? { rowId: answer.rowId } : {}),
    ...(typeof answer.chunks === "number" ? { chunks: answer.chunks } : {}),
    ...(typeof answer.bytes === "number" ? { bytes: answer.bytes } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/** ONE chunk of the key's video. */
export async function fetchEaVideoChunkInKv(
  key: string,
  index: number,
): Promise<KvVideoChunkAnswer> {
  const answer = await post({ action: "video-chunk", key, index });
  if (!answer) return offline({ enabled: false, ok: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    ...(typeof answer.data === "string" ? { data: answer.data } : {}),
    ...(typeof answer.chunks === "number" ? { chunks: answer.chunks } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

/** DELETE a key: the record, both indexes and its claim lock. */
export async function removeLicenseKeyInKv(key: string): Promise<KvAnswer> {
  const answer = await post({ action: "remove", key });
  if (!answer) return offline({ enabled: false, ok: false });
  return { enabled: true, ok: answer.ok === true, ...(answer.error ? { error: answer.error } : {}) };
}

/**
 * THE SINGLE-USE ACTIVATION LOCK — first write wins, atomically in Redis.
 * This is what the Supabase `users.license_key` column was doing; it takes over
 * so activation keeps working while that database is restricted.
 */
export async function claimLicenseKeyInKv(key: string, email: string): Promise<KvClaimAnswer> {
  const answer = await post({ action: "claim", key, email });
  if (!answer) return offline({ enabled: false, ok: false });
  return {
    enabled: true,
    ok: answer.ok === true,
    ...(answer.alreadyInUse ? { alreadyInUse: true } : {}),
    ...(typeof answer.heldBy === "string" ? { heldBy: answer.heldBy } : {}),
    ...(answer.error ? { error: answer.error } : {}),
  };
}
