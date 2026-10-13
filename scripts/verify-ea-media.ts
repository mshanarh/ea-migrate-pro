/**
 * Does /api/ea-media actually hand back the EA PICTURE the robot card is
 * missing — against the REAL handler and the REAL Supabase project?
 *
 * WHAT BROKE (all measured from this workspace before this endpoint existed):
 *   - `portal_accounts.data` is TEXT with the demo video inline: a mentor row
 *     is ~6.4 MB, the table ~27 MB, and a whole-table read dies on the
 *     statement timeout ("canceling statement due to statement timeout");
 *   - the browser's projected read `select email, data->licenses` answers 167
 *     rows in 3.5 s but NULL for every one of them (TEXT column, so the JSON
 *     operator extracts nothing) → the home sync never found a licence, never
 *     found a picture, and the card fell back to the platform logo;
 *   - rpc `ea_media_for_email` parses all 27 MB in SQL and dies the same way.
 *
 * So this runs the handler itself, as Vercel runs it, and checks the answers
 * the app depends on:
 *   1. a client email + EA name resolves to an entry WITH a picture;
 *   2. an EA id resolves (the exact link the robot record carries);
 *   3. a client with no row of their OWN still resolves by name — that is the
 *      case the screenshot in the bug report is: a licensed client phone;
 *   4. a licence-issued client is found from the mentor row (email scan);
 *   5. an unknown EA answers honestly (ok, empty list) instead of erroring;
 *   6. the method/body guards answer 405/400;
 *   7. the SECOND call is served from cache — the whole point of the KV layer,
 *      and the only way the home screen stops paying for Supabase.
 *
 * IMAGE BYTES ARE NEVER PRINTED — only that a `data:image/...` payload of a
 * plausible size came back.
 *
 * READ-ONLY: the handler only reads `portal_accounts` and writes the
 * `eamp:ea_media` cache key (KV is not configured in this workspace, so only
 * the in-memory copy is exercised here).
 *
 * Run: bun scripts/verify-ea-media.ts
 */
import { spawnSync } from "node:child_process";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const { default: handler } = await import("../api/ea-media");

type Reply = { status: number; payload: Record<string, unknown>; headers: Record<string, string> };

/** Call the real handler with the request/response shape Vercel gives it. */
async function call(body: unknown, method = "POST"): Promise<Reply> {
  const reply: Reply = { status: 0, payload: {}, headers: {} };
  const response = {
    status(code: number) {
      reply.status = code;
      return response;
    },
    json(value: unknown) {
      reply.payload = (value ?? {}) as Record<string, unknown>;
    },
    setHeader(key: string, value: string) {
      reply.headers[key] = value;
    },
  };
  await handler(
    {
      method,
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      headers: {},
    },
    response,
  );
  return reply;
}

function entries(reply: Reply): Array<{ eaId?: string; name?: string; image?: string; symbols?: string[] }> {
  const media = reply.payload["media"];
  return Array.isArray(media)
    ? (media as Array<{ eaId?: string; name?: string; image?: string; symbols?: string[] }>)
    : [];
}

function pictureSize(entry: { image?: string } | undefined): number {
  return entry && typeof entry.image === "string" ? entry.image.length : 0;
}

function isPicture(entry: { image?: string } | undefined): boolean {
  return Boolean(entry && typeof entry.image === "string" && entry.image.startsWith("data:image/"));
}

/* 1. Client email + EA name — the exact call /app/home now makes. */
const MENTOR_CLIENT = "biyasentobeko222@gmail.com";
const SNIPER_NAME = "Sniper killer Ea v2+";

const started = Date.now();
const byName = await call({ email: MENTOR_CLIENT, names: [SNIPER_NAME] });
const coldMs = Date.now() - started;
check("handler answers 200", byName.status === 200, `status=${byName.status}`);
check("reply carries ok:true", byName.payload["ok"] === true, JSON.stringify(byName.payload).slice(0, 160));
check("an EA entry came back", entries(byName).length > 0, `${entries(byName).length} entries`);
const named = entries(byName)[0];
check("the entry has a real picture", isPicture(named), `${pictureSize(named)} chars`);
check(
  "the picture is a plausible size (not a stub, not the whole row)",
  pictureSize(named) > 2_000 && pictureSize(named) < 4_000_000,
  `${Math.round(pictureSize(named) / 1024)}KB`,
);
check(
  "the entry carries the EA's symbols",
  Array.isArray(named?.symbols) && (named?.symbols?.length ?? 0) > 0,
  `${named?.symbols?.length ?? 0} symbols`,
);
check("a cold call is a single narrow scan, not a table read", coldMs < 15_000, `${coldMs}ms`);

/* 2. The EA id — the exact link a robot record carries. */
const byId = await call({ email: MENTOR_CLIENT, eaIds: ["ea-muvcexrvvlhvbe"] });
check("an EA id resolves too", byId.status === 200 && entries(byId).length > 0, `${entries(byId).length} entries`);
check("and it resolves to a picture", isPicture(entries(byId)[0]), `${pictureSize(entries(byId)[0])} chars`);

/* 3. A client with no row of their own, resolved by EA name only. */
const LICENSED_CLIENT = "pablosimpson808@gmail.com";
const other = await call({ email: LICENSED_CLIENT, names: [SNIPER_NAME] });
check(
  "a licensed client with no row of their own still gets the picture",
  other.status === 200 && isPicture(entries(other)[0]),
  `${entries(other).length} entries, ${pictureSize(entries(other)[0])} chars`,
);

/* 4. A client found through the MENTOR's row (the email scan). */
const viaLicence = await call({ email: LICENSED_CLIENT, eaIds: ["ea-muvcexrvvlhvbe"] });
check(
  "the licence link resolves by id as well",
  viaLicence.status === 200 && isPicture(entries(viaLicence)[0]),
  `${pictureSize(entries(viaLicence)[0])} chars`,
);

/* 5. Honesty for an EA that does not exist. */
const nobody = await call({ email: "nobody.at.all@eamigratepro.invalid", names: ["Definitely Not An EA 9000"] });
check("an unknown EA answers ok with an empty list", nobody.status === 200 && entries(nobody).length === 0);

/* 6. Guards. */
const badEmail = await call({ email: "not-an-email", names: [SNIPER_NAME] });
check("a bad email is refused with 400", badEmail.status === 400, `status=${badEmail.status}`);
const noNeedle = await call({ email: MENTOR_CLIENT });
check("a body with no eaIds/names is refused with 400", noNeedle.status === 400, `status=${noNeedle.status}`);
const wrongMethod = await call({ email: MENTOR_CLIENT, names: [SNIPER_NAME] }, "GET");
check("GET is refused with 405", wrongMethod.status === 405, `status=${wrongMethod.status}`);
check("every answer is marked no-store", byName.headers["Cache-Control"] === "no-store");

/* 7. The cache: the second call must not go back to Supabase. */
const warmed = Date.now();
const again = await call({ email: MENTOR_CLIENT, names: [SNIPER_NAME] });
const warmMs = Date.now() - warmed;
check("a repeat call still answers with the picture", isPicture(entries(again)[0]), `${pictureSize(entries(again)[0])} chars`);
check("and it is served from cache", warmMs < 2_000, `${warmMs}ms vs ${coldMs}ms cold`);

/* The client's matching rule — the same lookup /app/home applies to the
 * answer, so a payload the client cannot use must fail here too. */
const robot = { eaId: undefined as string | undefined, name: SNIPER_NAME, symbols: [] as string[], image: undefined as string | undefined };
const hit =
  entries(again).find((entry) => entry.eaId && entry.eaId === robot.eaId) ??
  entries(again).find((entry) => (entry.name ?? "").trim().toLowerCase() === (robot.name ?? "").trim().toLowerCase());
check("the client-side match (eaId, then name) finds the entry", Boolean(hit?.image), hit?.name ?? "no match");

console.log(
  failures === 0
    ? `\nRESULT: OK — /api/ea-media returns the EA picture (cold ${coldMs}ms, cached ${warmMs}ms).`
    : `\nRESULT: ${failures} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
