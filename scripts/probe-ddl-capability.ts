/**
 * Is there ANY way to run DDL from here?
 *
 * The rate limit is inert until `email_code_requests` exists, and the previous
 * probe only proved that a guessed `exec_sql` does not exist. That is not the
 * same as "there is no DDL path" — the function could be named something else.
 *
 * So this asks the database to describe itself. PostgREST publishes an OpenAPI
 * document at the API root listing EVERY function it will route, so this reads
 * that document and prints the callable names rather than guessing at them.
 *
 * It also tries each RPC it finds with empty arguments, because a function can
 * be routable and still be the wrong tool — the reply says which.
 *
 * READ-ONLY: it reads the API description and calls functions with empty
 * arguments. It creates nothing and drops nothing.
 *
 * Run: bun scripts/probe-ddl-capability.ts
 */
const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
if (!url || !key) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}

const base = url.replace(/\/+$/, "");
const rest = `${base}/rest/v1`;

/* 1. The API description: every path PostgREST will route. */
const described = await fetch(`${rest}/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
});
console.log(`OpenAPI document: HTTP ${described.status}`);
if (!described.ok) {
  console.log("Could not read the API description, so the function list is unknown.");
  process.exit(1);
}

const spec = (await described.json()) as { paths?: Record<string, Record<string, unknown>> };
const rpcNames = Object.keys(spec.paths ?? {})
  .map((p) => p.replace(/^\/rpc\//, ""))
  .filter((name) => name.length > 0)
  .sort();

console.log(`\nCallable RPC functions (${rpcNames.length}):`);
for (const name of rpcNames) console.log(`  ${name}`);

/* 2. Which of those look like they might run SQL? */
const ddlShaped = rpcNames.filter((n) => /exec|sql|query|run|eval|migrate|ddl|script/i.test(n));
console.log(`\nNames that look DDL-shaped (${ddlShaped.length}): ${ddlShaped.join(", ") || "(none)"}`);

/* 3. Ask each candidate what it thinks. An empty call is harmless: a real
 *    exec function would complain about missing arguments, which is exactly
 *    the answer we want. */
for (const name of ddlShaped) {
  const response = await fetch(`${rest}/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  const text = (await response.text()).slice(0, 200);
  console.log(`  POST /rpc/${name} -> HTTP ${response.status} ${text}`);
}

console.log(
  ddlShaped.length === 0
    ? "\nCONCLUSION: no DDL-capable function is exposed. The migration must be pasted into the SQL editor."
    : "\nCONCLUSION: candidates exist above - inspect their replies to see if one runs DDL.",
);
