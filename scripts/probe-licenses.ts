/**
 * probe-licenses.ts — the KV licence store, driven end to end.
 *
 * WHAT IT PROVES
 * ──────────────
 * `/api/licenses` is the store that replaced Supabase for issued licence keys
 * (see api/_handlers/licenses.ts). This probe talks to the REAL handler module
 * with the REAL Redis command strings, against a small in-process Redis
 * (hashes, sets, strings incl. `SET … NX`) installed as the KV REST endpoint.
 * It therefore checks the things a typo would break: which keys are written,
 * how a key is counted, who may resolve a key, that a claim is single-use, and
 * that deleting a key also releases its claim.
 *
 * WHAT IT DOES NOT PROVE
 * ──────────────────────
 * It does not talk to Upstash, so it cannot prove the production credentials.
 * The store only exists when KV_REST_API_URL + KV_REST_API_TOKEN (or the
 * UPSTASH_* names) are set in the deployment — run it there, or with both
 * variables exported, to exercise the configured path; with neither set the
 * handler correctly answers 503 `unavailable: true` and the app falls back to
 * its legacy Supabase path (that refusal is asserted below too).
 *
 *   bun scripts/probe-licenses.ts
 */
import handler from "../api/_handlers/licenses.js";

type ApiResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

/** A minimal but faithful Redis, spoken over the Upstash REST shape. */
function installFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const strings = new Map<string, string>();

  const hash = (key: string) => {
    let value = hashes.get(key);
    if (!value) {
      value = new Map();
      hashes.set(key, value);
    }
    return value;
  };
  const set = (key: string) => {
    let value = sets.get(key);
    if (!value) {
      value = new Set();
      sets.set(key, value);
    }
    return value;
  };

  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const command = JSON.parse(String(init?.body ?? "[]")) as string[];
    const [name, ...args] = command;
    let result: unknown = null;
    switch ((name ?? "").toUpperCase()) {
      case "HSET": {
        hash(args[0]!).set(args[1]!, args[2]!);
        result = 1;
        break;
      }
      case "HGET":
        result = hash(args[0]!).get(args[1]!) ?? null;
        break;
      case "HDEL":
        result = hash(args[0]!).delete(args[1]!) ? 1 : 0;
        break;
      case "SADD": {
        const before = set(args[0]!).size;
        set(args[0]!).add(args[1]!);
        result = set(args[0]!).size - before;
        break;
      }
      case "SREM": {
        const removed = set(args[0]!).delete(args[1]!);
        result = removed ? 1 : 0;
        break;
      }
      case "SMEMBERS":
        result = [...set(args[0]!).values()];
        break;
      case "SCARD":
        result = set(args[0]!).size;
        break;
      case "SET": {
        const [key, value, ...flags] = args;
        const nx = flags.some((flag) => flag.toUpperCase() === "NX");
        if (nx && strings.has(key!)) {
          result = null;
        } else {
          strings.set(key!, value!);
          result = "OK";
        }
        break;
      }
      case "GET":
        result = strings.get(args[0]!) ?? null;
        break;
      case "DEL": {
        strings.delete(args[0]!);
        hashes.delete(args[0]!);
        sets.delete(args[0]!);
        result = 1;
        break;
      }
      default:
        throw new Error(`Unhandled command in the probe's Redis: ${name}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ result }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = original;
  };
}

async function call(body: Record<string, unknown>): Promise<ApiResponse> {
  const answer: ApiResponse = { statusCode: 0, body: {} };
  let settled = false;
  const response = {
    status(code: number) {
      answer.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      answer.body = (payload ?? {}) as Record<string, unknown>;
      settled = true;
    },
    setHeader() {
      /* headers are irrelevant to this probe */
    },
  };
  await handler({ method: "POST", body }, response);
  if (!settled) throw new Error("The handler never answered");
  return answer;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const KEY = "EMP-AB12-CD34-EF56";
const MENTOR = "mentor@example.com";
const CLIENT = "client@example.com";

async function main() {
  // ── 1. NOT CONFIGURED → the app's fallback signal, never a refusal ────
  delete process.env["KV_REST_API_URL"];
  delete process.env["KV_REST_API_TOKEN"];
  const unconfigured = await call({ action: "count", email: MENTOR });
  check(
    "no KV configured answers 503 unavailable",
    unconfigured.statusCode === 503 && unconfigured.body["unavailable"] === true,
    `status ${unconfigured.statusCode}`,
  );

  // ── 2. Configured: a fake Upstash REST endpoint ───────────────────────
  const restore = installFakeRedis();
  process.env["KV_REST_API_URL"] = "https://kv.invalid";
  process.env["KV_REST_API_TOKEN"] = "probe-token";

  const issued = await call({
    action: "issue",
    key: KEY,
    mentorEmail: MENTOR,
    clientEmail: CLIENT,
    clientName: "Msharanh",
    eaName: "Sniper killer Ea v2+",
    eaId: "ea-1",
    expiry: "Lifetime",
    symbols: ["XAUUSDM", "EURUSDm"],
  });
  check("issue stores the key", issued.statusCode === 200 && issued.body["ok"] === true, JSON.stringify(issued.body));

  const counted = await call({ action: "count", email: CLIENT });
  check("count sees the client's key", counted.body["count"] === 1, `count=${String(counted.body["count"])}`);

  const mentorCount = await call({ action: "count", email: MENTOR });
  check("count sees the mentor's issued key", mentorCount.body["count"] === 1, `count=${String(mentorCount.body["count"])}`);

  const listed = await call({ action: "list", mentorEmail: MENTOR });
  const listedRecords = (listed.body["licenses"] ?? []) as Array<Record<string, unknown>>;
  check("list returns the mentor's key with its EA details", listedRecords.length === 1 && listedRecords[0]?.["eaName"] === "Sniper killer Ea v2+");
  check("the EA symbols ride along", Array.isArray(listedRecords[0]?.["symbols"]) && (listedRecords[0]?.["symbols"] as unknown[]).length === 2);

  // ── 3. Ownership ──────────────────────────────────────────────────────
  const mine = await call({ action: "lookup", key: KEY, email: CLIENT });
  check("the client resolves their own key", mine.body["found"] === true && mine.body["wrongEmail"] === undefined);

  const stranger = await call({ action: "lookup", key: KEY, email: "stranger@example.com" });
  check(
    "somebody else's key is refused as wrongEmail, not as missing",
    stranger.body["found"] === false && stranger.body["wrongEmail"] === true,
    JSON.stringify(stranger.body),
  );

  const mentorLookup = await call({ action: "lookup", key: KEY, email: MENTOR });
  check("the issuing mentor may always resolve it", mentorLookup.body["found"] === true);

  // ── 4. The single-use claim ───────────────────────────────────────────
  const first = await call({ action: "claim", key: KEY, email: CLIENT });
  check("the first claim wins", first.body["ok"] === true, JSON.stringify(first.body));

  const second = await call({ action: "claim", key: KEY, email: "second@example.com" });
  check(
    "a second email is refused with alreadyInUse",
    second.body["ok"] === false && second.body["alreadyInUse"] === true,
    JSON.stringify(second.body),
  );
  check("the refusal uses the app's exact wording", second.body["error"] === "License key already in use");

  const sameAccountAgain = await call({ action: "claim", key: KEY, email: CLIENT });
  check("the same account re-claiming is also refused (a key is spent once)", sameAccountAgain.body["ok"] === false);

  // Re-issuing the same code must NOT hand back a fresh key.
  await call({ action: "issue", key: KEY, mentorEmail: MENTOR, clientEmail: CLIENT, eaName: "Sniper killer Ea v2+" });
  const afterReissue = await call({ action: "claim", key: KEY, email: "third@example.com" });
  check("re-issuing a code does not reset its claim", afterReissue.body["ok"] === false && afterReissue.body["alreadyInUse"] === true);

  // ── 5. Remove ─────────────────────────────────────────────────────────
  const removed = await call({ action: "remove", key: KEY });
  check("remove reports success", removed.body["ok"] === true);
  const after = await call({ action: "count", email: CLIENT });
  check("a deleted key is no longer counted", after.body["count"] === 0, `count=${String(after.body["count"])}`);
  const claimableAgain = await call({ action: "claim", key: KEY, email: CLIENT });
  check("delete releases the claim so a re-issue can be activated", claimableAgain.body["ok"] === true);

  // ── 6. Bad input is refused, not stored ───────────────────────────────
  const badKey = await call({ action: "issue", key: "NOT-A-KEY", mentorEmail: MENTOR });
  check("a malformed key is refused with 400", badKey.statusCode === 400 && badKey.body["ok"] === false);

  restore();
  console.log(failures === 0 ? "\nRESULT: OK" : `\nRESULT: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
