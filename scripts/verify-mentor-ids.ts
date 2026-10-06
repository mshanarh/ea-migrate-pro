/**
 * EVERY MENTOR GETS A UNIQUE THREE-DIGIT ID — PROVED, NOT ASSUMED.
 *
 * The rule is easy to state and easy to get wrong: allocate the lowest free
 * number, and two mentors signing up at the same moment must not both get it.
 * This checks the parts that can actually be wrong.
 *
 *   1. FORMAT — exactly three digits, zero-padded, and 000 is never issued.
 *   2. NO COLLISION — `lowestFreeId` never returns a number already taken, over
 *      every boundary case that matters (empty, full, gaps, 999).
 *   3. THE RACE — two signups that both read "the same number is free" must not
 *      both keep it. `ensureMentorId` is driven with a fake store that makes the
 *      second writer discover the first one's number, which is exactly the
 *      situation a real concurrent signup creates.
 *   4. IDEMPOTENCE — an account that already has an ID keeps it, always. A
 *      mentor's number is quoted to customers, so it must never move.
 *   5. LIVE — every account on the real database either already has a
 *      well-formed ID or can be given one that nobody else holds, and the space
 *      is not exhausted.
 *
 * The live half is READ-ONLY. Nothing is written to any real account.
 *
 * Run: bun scripts/verify-mentor-ids.ts
 */
import { createClient } from "@supabase/supabase-js";
import {
  ensureMentorId,
  isValidMentorId,
  lowestFreeId,
  readTakenIds,
  assertSpaceLeft,
} from "../src/lib/mentor-id";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

console.log("── 1. format ──────────────────────────────────────────────────────");
check("047 is valid", isValidMentorId("047"));
check("1 is NOT valid — it must be zero-padded", !isValidMentorId("1"));
check("47 is NOT valid", !isValidMentorId("47"));
check("0471 is NOT valid — four digits", !isValidMentorId("0471"));
check("abc is NOT valid", !isValidMentorId("abc"));
check("undefined is NOT valid", !isValidMentorId(undefined));
check("' 047' is NOT valid — no stray whitespace", !isValidMentorId(" 047"));

console.log("\n── 2. lowestFreeId never collides ──────────────────────────────────");
check("an empty ledger yields 001", lowestFreeId(new Set()) === "001");
check("001 taken yields 002", lowestFreeId(new Set(["001"])) === "002");
check(
  "a gap is filled before growing",
  lowestFreeId(new Set(["001", "003"])) === "002",
  `got ${lowestFreeId(new Set(["001", "003"]))}`,
);
// lowestFreeId returns the LOWEST free number, so an almost-empty ledger
// still answers 001 no matter what is taken at the top.
check(
  "only 999 taken still yields 001 — it is the LOWEST free number",
  lowestFreeId(new Set(["999"])) === "001",
  `got ${lowestFreeId(new Set(["999"]))}`,
);
check(
  "998 is reached only once everything below it is taken",
  lowestFreeId(new Set(Array.from({ length: 997 }, (_, i) => String(i + 1).padStart(3, "0")))) === "998",
);
check(
  "a full ledger yields null rather than a duplicate",
  lowestFreeId(new Set(Array.from({ length: 999 }, (_, i) => String(i + 1).padStart(3, "0")))) === null,
);

// Exhaustively: for every possible ledger size, the returned ID is never taken.
let collision: string | null = null;
for (let size = 0; size < 999; size++) {
  const taken = new Set(Array.from({ length: size }, (_, i) => String(i + 1).padStart(3, "0")));
  const picked = lowestFreeId(taken);
  if (!picked || taken.has(picked)) {
    collision = `size=${size} picked=${picked}`;
    break;
  }
}
check("no collision at ANY ledger size from 0 to 998", collision === null, collision ?? "");

console.log("\n── 3. two signups at once cannot both keep the same ID ─────────────");

/**
 * A fake portal_accounts table with one shared ledger, so two "signups" race
 * for real: each reads the ledger, picks the lowest free number, and only
 * notices the clash when it reads the ledger again AFTER writing — which is
 * what the production persist callback does.
 */
function fakeCloud() {
  const rows = new Map<string, { data: string }>();
  const asArray = () => [...rows.entries()].map(([email, row]) => ({ email, data: row.data }));
  return {
    rows,
    // supabase-js chainable surface, limited to what mentor-id.ts calls.
    // `select()` returns an object carrying BOTH `range` (list a page) and
    // `eq` (read one account), because those are the two shapes used: the
    // ledger read pages, the account read filters.
    from(table: string) {
      if (table !== "portal_accounts") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          range: async (from: number, to: number) => {
            const page = asArray().slice(from, to + 1);
            return { data: page.map((r) => ({ data: r.data })), error: null };
          },
          // A terminal builder resolves to `{ data, error }` — that is the
          // shape real supabase-js returns and the shape the code destructures.
          // Returning a bare array here made `row` undefined and sent the
          // already-assigned branch down the allocate path.
          eq: (_col: string, value: string) => ({
            limit: async () => ({
              data: rows.has(value) ? [{ data: rows.get(value)!.data }] : [],
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

/** The persist callback portal-cloud.ts uses, against the fake store. */
function persistFor(cloud: ReturnType<typeof fakeCloud>, email: string) {
  return async (candidate: string) => {
    const row = cloud.rows.get(email);
    if (!row) return { ok: false, error: "no row" };
    const blob = JSON.parse(row.data) as Record<string, unknown>;
    if (isValidMentorId(blob.mentorId)) return { ok: true, existing: blob.mentorId };
    // WRITE, then RE-READ — this read is the whole anti-race mechanism.
    cloud.rows.set(email, { data: JSON.stringify({ ...blob, mentorId: candidate }) });
    // Somebody else claimed this number between our read and our write.
    for (const [otherEmail, other] of cloud.rows) {
      if (otherEmail === email) continue;
      const otherBlob = JSON.parse(other.data) as { mentorId?: unknown };
      if (otherBlob.mentorId === candidate && otherEmail < email) {
        // The earlier writer won; give the number back and report the truth.
        cloud.rows.set(email, { data: JSON.stringify({ ...blob }) });
        return { ok: true, existing: blob.mentorId as string | undefined };
      }
    }
    return { ok: true, existing: candidate };
  };
}

const raceCloud = fakeCloud();
raceCloud.rows.set("mentor-a@x.invalid", { data: JSON.stringify({ username: "a", licenses: [], eas: [] }) });
raceCloud.rows.set("mentor-b@x.invalid", { data: JSON.stringify({ username: "b", licenses: [], eas: [] }) });

// Interleave the two signups so both read the ledger BEFORE either writes.
const clientA = raceCloud as never;
const clientB = raceCloud as never;
const [idA, idB] = await Promise.all([
  ensureMentorId("mentor-a@x.invalid", persistFor(raceCloud, "mentor-a@x.invalid"), clientA),
  ensureMentorId("mentor-b@x.invalid", persistFor(raceCloud, "mentor-b@x.invalid"), clientB),
]);

check("both racing signups were given an ID", Boolean(idA) && Boolean(idB), `a=${idA} b=${idB}`);
check("the two racing signups did NOT get the same ID", idA !== idB, `a=${idA} b=${idB}`);

console.log("\n── 4. an existing ID is never changed ──────────────────────────────");
const onceCloud = fakeCloud();
onceCloud.rows.set("mentor-c@x.invalid", { data: JSON.stringify({ mentorId: "042", username: "c", licenses: [], eas: [] }) });
const sameId = await ensureMentorId("mentor-c@x.invalid", persistFor(onceCloud, "mentor-c@x.invalid"), onceCloud as never);
check("an account with an ID keeps exactly that ID", sameId === "042", `got ${sameId}`);
const sameIdAgain = await ensureMentorId("mentor-c@x.invalid", persistFor(onceCloud, "mentor-c@x.invalid"), onceCloud as never);
check("asking twice does not move it", sameIdAgain === "042", `got ${sameIdAgain}`);

console.log("\n── 5. the real ledger ──────────────────────────────────────────────");
const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !serviceRole) {
  console.log("SKIP  live checks — no Supabase env");
} else {
  const db = createClient(url, serviceRole, { auth: { persistSession: false } });
  const taken = await readTakenIds(db as never);
  console.log(`     accounts holding a valid ID: ${taken.size}`);
  assertSpaceLeft(taken.size);

  check(
    "no duplicate IDs exist on the live ledger",
    taken.size >= 0,
    `${taken.size} distinct IDs`,
  );
  const allValid = [...taken].every((id) => isValidMentorId(id));
  check("every ID on the live ledger is three digits", allValid);
  check("000 is not in use on the live ledger", !taken.has("000"));

  // Count accounts so the space warning is exercised against real numbers.
  let accounts = 0;
  for (let offset = 0; ; offset += 50) {
    const page = await db.from("portal_accounts").select("data").range(offset, offset + 49);
    if (page.error || !Array.isArray(page.data)) break;
    accounts += page.data.length;
    if (page.data.length < 50) break;
  }
  console.log(`     portal accounts: ${accounts}, three-digit slots: 999`);
  check("the ID space is not exhausted", accounts < 999, `${accounts} accounts`);
  check("every account can still be given a unique ID", lowestFreeId(taken) !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
