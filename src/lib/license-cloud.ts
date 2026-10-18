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
