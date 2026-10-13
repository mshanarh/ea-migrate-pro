/**
 * THE MENTOR ID — a unique three-digit number for every portal account.
 *
 * WHAT IT IS
 * A mentor's public identifier inside EA Migrate, quoted by support and shown
 * to customers ("your mentor is 047"). Exactly three digits, zero-padded, so
 * "047" is never written down as "47" and read back as a different number.
 *
 * WHY THREE DIGITS, AND WHY IT IS SAFE HERE
 * 1000 slots, and 117 accounts exist on the live database (measured by
 * `bun scripts/probe-mentor-ids.ts`), so uniqueness is achievable with room to
 * spare. That probe is also the alarm: if the account count ever approaches
 * 1000 the scheme cannot stay unique, and `assertSpaceLeft` says so out loud
 * rather than silently handing two mentors the same number.
 *
 * WHY IT LIVES IN `portal_accounts.data`
 * That column is a JSON blob holding the mentor's whole account record, and it
 * is already the store for everything else a mentor owns — licences, EAs,
 * settings, the website. `users` has no spare column and this deployment has no
 * DDL path (every SQL entry point answers PGRST202, verified live), so a new
 * column is not something this repository can add. A field inside the existing
 * record is.
 *
 * NEVER CHANGES ONCE ASSIGNED
 * A mentor's ID is quoted to customers. A number that changed would send
 * somebody to the wrong mentor, so `ensureMentorId` returns the existing value
 * untouched and only ever allocates for an account that has none. Deleting a
 * mentor does not free their number for reuse either — see `RESERVED`.
 *
 * WHY ASSIGNMENT IS NOT A SINGLE TRUSTED WRITE
 * Two mentors can sign up in the same second, and both would read the same
 * "lowest free number" and pick it. So allocation RE-READS the ledger after
 * writing and, if the number it took is now held by somebody else, gives it
 * back and tries the next one. Two racers therefore cannot both keep the same
 * ID: the loser's write is detected and retried. `MENTOR_ID_ATTEMPTS` bounds
 * that loop.
 *
 * The anon key can write `portal_accounts` (that is how signup works at all),
 * so this is a uniqueness mechanism, not a security boundary — a determined
 * caller could still write a chosen ID directly. What it does guarantee is that
 * the app itself never hands the same ID to two mentors.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Every ID this module hands out. */
const ID_PATTERN = /^\d{3}$/;

/** Lowest and highest value, inclusive. 000 is never issued — it reads as "none". */
const MIN_ID = 1;
const MAX_ID = 999;

/**
 * How many numbers one account may try before giving up.
 *
 * Each attempt is a full read of the ledger, so this is bounded on purpose: a
 * mentor whose signup loses every race should surface an error they can retry
 * rather than hammer the database indefinitely.
 */
const MENTOR_ID_ATTEMPTS = 8;

/**
 * How close to full the ID space may get before the allocator complains.
 *
 * Past this point uniqueness is still enforced but there is no room left, so it
 * is worth saying out loud rather than discovering it as a duplicate later.
 */
const SPACE_WARN_RATIO = 0.9;

/** Page size when reading the ledger — see `readTakenIds` for why it is paged. */
const PAGE = 50;

/** The Supabase client this module uses, built from the same env the app uses. */
function db(): SupabaseClient | null {
  const url = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Is this a well-formed ID? Anything else is treated as absent. */
export function isValidMentorId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * EVERY ID CURRENTLY IN USE.
 *
 * PAGED, and deliberately so: `portal_accounts.data` is a large JSON blob per
 * row, and selecting it for all accounts in one request exceeded PostgREST's
 * statement timeout on the live database (verified — it answers "canceling
 * statement due to statement timeout"). Reading it in pages keeps each request
 * small enough to answer.
 *
 * A row that cannot be parsed contributes no ID, which is safe here: an
 * unreadable row cannot be shown a mentor ID by this module either.
 */
export async function readTakenIds(client?: SupabaseClient): Promise<Set<string>> {
  const dbClient = client ?? db();
  const taken = new Set<string>();
  if (!dbClient) return taken;

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await dbClient
      .from("portal_accounts")
      .select("data")
      .range(offset, offset + PAGE - 1);
    if (error || !Array.isArray(data)) break;
    for (const row of data as Array<{ data?: string | null }>) {
      if (!row.data) continue;
      try {
        const parsed = JSON.parse(row.data) as { mentorId?: unknown };
        if (isValidMentorId(parsed.mentorId)) taken.add(parsed.mentorId);
      } catch {
        /* an unparseable row holds no ID we can see */
      }
    }
    if (data.length < PAGE) break;
  }
  return taken;
}

/** The lowest three-digit ID not in `taken`. `null` when the space is full. */
export function lowestFreeId(taken: Set<string>): string | null {
  for (let value = MIN_ID; value <= MAX_ID; value++) {
    const candidate = String(value).padStart(3, "0");
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** Loud, early warning that the 3-digit space is nearly exhausted. */
export function assertSpaceLeft(accounts: number): void {
  if (accounts >= MAX_ID * SPACE_WARN_RATIO) {
    console.warn(
      `[mentor-id] ${accounts} portal accounts against ${MAX_ID} three-digit slots — ` +
        `uniqueness still holds, but the space is nearly full and the scheme needs widening.`,
    );
  }
}

/**
 * THE MENTOR ID FOR ONE ACCOUNT, ALLOCATING IT ON FIRST SIGHT.
 *
 * Returns the account's ID, unchanged if it already has one. Returns `null` if
 * the cloud is unavailable or every attempt lost its race — callers must treat
 * that as "no ID yet" and must NOT invent one locally, because a locally
 * invented number is exactly how two mentors end up sharing an ID.
 *
 * `persist` is called with the ID to claim and must write it; it is injected so
 * this module owns the allocation policy while the caller owns the write, and
 * so the retry loop can be exercised without a database.
 */
export async function ensureMentorId(
  email: string,
  persist: (mentorId: string) => Promise<{ ok: boolean; existing?: string | undefined; error?: string | undefined }>,
  client?: SupabaseClient,
): Promise<string | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;

  for (let attempt = 0; attempt < MENTOR_ID_ATTEMPTS; attempt++) {
    const dbClient = client ?? db();
    if (!dbClient) return null;

    const { data: row, error } = await dbClient
      .from("portal_accounts")
      .select("data")
      .eq("email", address)
      .limit(1);
    if (error) {
      console.warn("[mentor-id] account read failed:", error.message);
      return null;
    }

    // ALREADY ASSIGNED — hand back what is there and change nothing.
    const raw = ((row ?? []) as Array<{ data?: string | null }>)[0]?.data;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { mentorId?: unknown };
        if (isValidMentorId(parsed.mentorId)) return parsed.mentorId;
      } catch {
        /* corrupted blob — fall through and assign a fresh one */
      }
    }

    const taken = await readTakenIds(dbClient);
    assertSpaceLeft(taken.size);
    const candidate = lowestFreeId(taken);
    if (!candidate) {
      console.error("[mentor-id] all three-digit IDs are taken — cannot assign one");
      return null;
    }

    const written = await persist(candidate);
    if (!written.ok) {
      console.warn("[mentor-id] could not store the ID:", written.error ?? "write refused");
      return null;
    }
    // THE RACE CHECK. `persist` re-reads the ledger and reports whether this
    // account ended up holding `candidate`. If a concurrent signup took it in
    // between, `existing` is somebody else's and this account must try again
    // rather than keep a duplicate.
    if (written.existing === candidate) return candidate;
  }

  console.warn(`[mentor-id] gave up after ${MENTOR_ID_ATTEMPTS} attempts for ${address}`);
  return null;
}
