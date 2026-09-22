/**
 * Upstash connectivity check — exercises the exact same REST pipeline the
 * server functions use (UPSTASH_REDIS_REST_URL/TOKEN from the environment).
 * Writes a throwaway test key, reads it back, deletes it. Never prints the
 * token or URL values.
 */
const url = (process.env["UPSTASH_REDIS_REST_URL"] ?? "").trim().replace(/\/+$/, "");
const token = (process.env["UPSTASH_REDIS_REST_TOKEN"] ?? "").trim();
console.log("1) UPSTASH_REDIS_REST_URL set:", url.length > 0);
console.log("2) UPSTASH_REDIS_REST_TOKEN set:", token.length > 0);
if (!url || !token) {
  console.log("RESULT: FAIL — add both keys in Settings → Environment.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const testKey = "eamp:connectivity-test";
const testValue = JSON.stringify({ ok: true, at: new Date().toISOString() });

try {
  const write = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers,
    body: JSON.stringify([
      ["HSET", testKey, "probe", testValue],
      ["HGET", testKey, "probe"],
      ["HDEL", testKey, "probe"],
    ]),
  });
  console.log("3) Pipeline write+read+delete ->", write.status);
  if (!write.ok) {
    console.log("   RESULT: FAIL — HTTP", write.status, (await write.text()).slice(0, 200));
    process.exit(1);
  }
  const results = await write.json();
  const [setRes, getRes, delRes] = results;
  const roundTrip = getRes?.result === testValue;
  console.log("   HSET ok:", !setRes?.error, "| round-trip read matches:", roundTrip, "| HDEL ok:", !delRes?.error);
  if (roundTrip && !setRes?.error && !delRes?.error) {
    console.log("RESULT: OK — Upstash is reachable and the approval/license persistence layer will work.");
  } else {
    console.log("RESULT: FAIL — unexpected pipeline response:", JSON.stringify(results).slice(0, 300));
    process.exit(1);
  }
} catch (error) {
  console.log("3) Request failed:", error?.message ?? error);
  console.log("   RESULT: FAIL — could not reach the Upstash REST endpoint.");
  process.exit(1);
}
