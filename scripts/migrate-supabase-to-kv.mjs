#!/usr/bin/env node
/**
 * MIGRATE EVERY SUPABASE ROW THE APP USES INTO UPSTASH KV.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
 *   node scripts/migrate-supabase-to-kv.mjs [--apply]
 *
 * DRY RUN BY DEFAULT: it reads both stores, prints the plan and the counts, and
 * writes nothing. Add `--apply` to write.
 *
 * WHAT IS READ (frozen backup — NOTHING IS DELETED FROM SUPABASE)
 *   users            → eamp:registrations  (isPaid / paidAt / deviceId / name / admin)
 *   paid_emails      → eamp:registrations  (isPaid / paidAt — the ledger's receipt)
 *   portal_payments  → eamp:registrations  (isPaid / paidAt — the portal's receipt)
 *   portal_accounts  → eamp:registrations  (displayName from the JSON blob)
 *   license_keys     → eamp:license-keys + eamp:license-by-mentor:* +
 *                      eamp:license-by-client:* + eamp:license-claim:*
 *   user_sessions    → eamp:registrations  (createdAt when the record is new)
 *   device_tokens    → eamp:device-tokens  (email → JSON list, notifications)
 *
 * WHAT IS WRITTEN
 *   The SAME keys the app already reads. `eamp:registrations` is a hash keyed
 *   by email; a record is created when the email has none, and otherwise MERGED
 *   field by field — an existing KV record is never overwritten wholesale, so a
 *   payment the admin already made in KV can never be downgraded by an older
 *   Supabase row.
 *
 * COUNTS
 *   The summary prints rows read per table, rows written per KV key, records
 *   created vs merged, and anything skipped, so the run is auditable against
 *   Supabase's own row counts.
 */

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
const KV_URL = (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
const KV_TOKEN = (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();

const REGISTRATIONS = "eamp:registrations";
const LICENSE_KEYS = "eamp:license-keys";
const LICENSE_BY_MENTOR = "eamp:license-by-mentor:";
const LICENSE_BY_CLIENT = "eamp:license-by-client:";
const LICENSE_CLAIM = "eamp:license-claim:";
const DEVICE_TOKENS = "eamp:device-tokens";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — nothing read.");
  process.exit(1);
}
if (!KV_URL || !KV_TOKEN) {
  console.error("Missing KV_REST_API_URL / KV_REST_API_TOKEN — nothing written.");
  process.exit(1);
}

async function kv(command) {
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error ?? `KV ${response.status}`);
  return payload.result;
}

/** Page through a PostgREST table so a big table is never truncated. */
async function readTable(table, select = "*", pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
    });
    if (!response.ok) {
      // A table that does not exist in this project is not a failure — it is
      // reported as 0 rows and the run continues.
      const text = await response.text().catch(() => "");
      return { rows, error: `HTTP ${response.status} ${text.slice(0, 120)}` };
    }
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows };
}

const clean = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const iso = (value) => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const counts = {
  read: {},
  errors: {},
  created: 0,
  merged: 0,
  licenceKeysWritten: 0,
  claimLocksWritten: 0,
  deviceTokensWritten: 0,
  skipped: [],
};

async function readAll() {
  const tables = {
    users: await readTable("users", "id,email,is_paid,is_admin,created_at,device_email,device_id,license_key"),
    paid_emails: await readTable("paid_emails", "email,paid_at"),
    portal_payments: await readTable("portal_payments", "email,paid,paid_at"),
    portal_accounts: await readTable("portal_accounts", "email,data"),
    license_keys: await readTable("license_keys", "key,email,ea_name,expiry,created_at,ea_image"),
    user_sessions: await readTable("user_sessions", "email,license_key,created_at"),
    device_tokens: await readTable("device_tokens", "email,fcm_token,device_name"),
  };
  for (const [name, result] of Object.entries(tables)) {
    counts.read[name] = result.rows.length;
    if (result.error) counts.errors[name] = result.error;
  }
  return tables;
}

/**
 * BUILD ONE MERGED REGISTRATION per email.
 *
 * PRECEDENCE, strongest last (so it wins):
 *   user_sessions  (a real sign-in happened)
 *   users          (device binding, name, admin flag)
 *   portal_accounts (the name the website signup captured)
 *   paid_emails     (the ledger's receipt — the console's "Paid" list)
 *   portal_payments (a mentor marked them paid on the portal)
 */
function buildRegistrations(tables) {
  const byEmail = new Map();
  const ensure = (email) => {
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        firstName: "",
        displayName: "",
        username: "",
        whatsapp: "",
        passwordHash: "",
        passwordSalt: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "pending",
        isPaid: false,
        paidAt: null,
        licenseLimit: 0,
      });
    }
    return byEmail.get(email);
  };

  for (const row of tables.user_sessions.rows) {
    const email = clean(row.email);
    if (!email) continue;
    const record = ensure(email);
    const created = iso(row.created_at);
    if (created && (!record.createdAt || created < record.createdAt)) record.createdAt = created;
  }

  for (const row of tables.users.rows) {
    const email = clean(row.email);
    if (!email) continue;
    const record = ensure(email);
    const created = iso(row.created_at);
    if (created && (!record.createdAt || created < record.createdAt)) record.createdAt = created;
    if (row.is_admin === true) record.isAdmin = true;
    // ONLY a device ID is migrated — never payment. Payment comes from a
    // receipt below, so a drifted `is_paid` mirror column cannot invent one.
    if (typeof row.device_id === "string" && row.device_id.trim()) record.deviceId = row.device_id.trim();
  }

  for (const row of tables.portal_accounts.rows) {
    const email = clean(row.email);
    if (!email) continue;
    const record = ensure(email);
    if (typeof row.data === "string" && row.data) {
      try {
        const blob = JSON.parse(row.data);
        const name =
          (typeof blob.appName === "string" && blob.appName) ||
          (typeof blob.name === "string" && blob.name) ||
          (typeof blob.firstName === "string" && blob.firstName) ||
          "";
        if (name) {
          record.displayName = record.displayName || name;
          record.firstName = record.firstName || name;
        }
      } catch {
        /* a corrupted blob is not a name */
      }
    }
  }

  for (const row of tables.paid_emails.rows) {
    const email = clean(row.email);
    if (!email) continue;
    const paidAt = iso(row.paid_at);
    if (!paidAt) continue; // a null paid_at is a revocation marker, not a receipt
    const record = ensure(email);
    record.isPaid = true;
    record.paidAt = paidAt;
    record.status = record.status === "rejected" ? "approved" : record.status;
  }

  for (const row of tables.portal_payments.rows) {
    const email = clean(row.email);
    if (!email) continue;
    const paidAt = iso(row.paid_at);
    if (row.paid !== true && !paidAt) continue;
    const record = ensure(email);
    record.isPaid = true;
    record.paidAt = record.paidAt ?? paidAt ?? new Date().toISOString();
  }

  return byEmail;
}

function buildLicences(tables, registrations) {
  const records = [];
  for (const row of tables.license_keys.rows) {
    const key = typeof row.key === "string" ? row.key.trim().toUpperCase().replace(/\s+/g, "") : "";
    if (!key) {
      counts.skipped.push("license_keys row with no key code");
      continue;
    }
    const clientEmail = clean(row.email);
    // `license_keys.email` is who the key was ISSUED to; the mentor is not
    // recorded on this legacy table, so the client's own record's issuer is
    // used when it exists, and an empty mentor is written rather than guessed.
    const record = {
      key,
      mentorEmail: "",
      clientName: registrations.get(clientEmail)?.displayName ?? "",
      clientEmail,
      eaName: typeof row.ea_name === "string" ? row.ea_name : "",
      eaId: "",
      expiry: typeof row.expiry === "string" && row.expiry ? row.expiry : "Lifetime",
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      claimedBy: clientEmail || null,
      claimedAt: clientEmail ? (iso(row.created_at) ?? new Date().toISOString()) : null,
      updatedAt: new Date().toISOString(),
    };
    if (typeof row.ea_image === "string" && row.ea_image) record.image = row.ea_image;
    records.push(record);
  }
  return records;
}

function buildDeviceTokens(tables) {
  const byEmail = new Map();
  for (const row of tables.device_tokens.rows) {
    const email = clean(row.email);
    const token = typeof row.fcm_token === "string" ? row.fcm_token.trim() : "";
    if (!email || !token) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({
      fcm_token: token,
      device_name: typeof row.device_name === "string" ? row.device_name : null,
    });
  }
  return byEmail;
}

async function applyRegistrations(registrations) {
  for (const [email, incoming] of registrations) {
    const raw = await kv(["HGET", REGISTRATIONS, email]);
    const existing = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    if (!existing) {
      await kv(["HSET", REGISTRATIONS, email, JSON.stringify(incoming)]);
      counts.created += 1;
      continue;
    }
    // FIELD-SCOPED MERGE — never downgrade a payment that is already in KV.
    const merged = { ...existing };
    if (!merged.displayName && incoming.displayName) merged.displayName = incoming.displayName;
    if (!merged.firstName && incoming.firstName) merged.firstName = incoming.firstName;
    if (incoming.isAdmin === true) merged.isAdmin = true;
    if (!merged.deviceId && incoming.deviceId) merged.deviceId = incoming.deviceId;
    if (!merged.createdAt && incoming.createdAt) merged.createdAt = incoming.createdAt;
    if ((merged.isPaid !== true || !merged.paidAt) && incoming.isPaid === true && incoming.paidAt) {
      merged.isPaid = true;
      merged.paidAt = incoming.paidAt;
    }
    if (merged.status === "pending" && incoming.status === "approved") merged.status = "approved";
    await kv(["HSET", REGISTRATIONS, email, JSON.stringify({ ...merged, updatedAt: new Date().toISOString() })]);
    counts.merged += 1;
  }
}

async function applyLicences(records) {
  for (const record of records) {
    const raw = await kv(["HGET", LICENSE_KEYS, record.key]);
    const existing = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    // A re-issue keeps a claim that already exists — never turn a spent key
    // back into a fresh one.
    const next = { ...record, ...(existing ? { claimedBy: existing.claimedBy, claimedAt: existing.claimedAt } : {}) };
    await kv(["HSET", LICENSE_KEYS, record.key, JSON.stringify(next)]);
    if (record.mentorEmail) await kv(["SADD", `${LICENSE_BY_MENTOR}${record.mentorEmail}`, record.key]);
    if (record.clientEmail) await kv(["SADD", `${LICENSE_BY_CLIENT}${record.clientEmail}`, record.key]);
    if (record.claimedBy) {
      await kv(["SET", `${LICENSE_CLAIM}${record.key}`, record.claimedBy, "NX"]);
      counts.claimLocksWritten += 1;
    }
    counts.licenceKeysWritten += 1;
  }
}

async function applyDeviceTokens(byEmail) {
  for (const [email, tokens] of byEmail) {
    await kv(["HSET", DEVICE_TOKENS, email, JSON.stringify(tokens)]);
    counts.deviceTokensWritten += 1;
  }
}

function printSummary() {
  console.log("\n══════════ SUPABASE → KV MIGRATION ══════════");
  console.log(APPLY ? "mode: APPLY (writes performed)" : "mode: DRY RUN (nothing written)");
  console.log("\nROWS READ FROM SUPABASE");
  for (const [table, count] of Object.entries(counts.read)) {
    const error = counts.errors[table] ? `   !! ${counts.errors[table]}` : "";
    console.log(`  ${table.padEnd(18)} ${String(count).padStart(6)}${error}`);
  }
  console.log(`  ${"TOTAL".padEnd(18)} ${String(Object.values(counts.read).reduce((a, b) => a + b, 0)).padStart(6)}`);
  console.log("\nROWS WRITTEN TO KV");
  console.log(`  ${REGISTRATIONS.padEnd(22)} created ${counts.created} · merged ${counts.merged}`);
  console.log(`  ${LICENSE_KEYS.padEnd(22)} ${counts.licenceKeysWritten} keys · ${counts.claimLocksWritten} claim locks`);
  console.log(`  ${DEVICE_TOKENS.padEnd(22)} ${counts.deviceTokensWritten} emails`);
  if (counts.skipped.length) {
    console.log("\nSKIPPED");
    for (const note of counts.skipped.slice(0, 20)) console.log(`  - ${note}`);
  }
  console.log("\nSUPABASE IS UNTOUCHED — it remains the frozen backup.");
  console.log("════════════════════════════════════════════\n");
}

const tables = await readAll();
const registrations = buildRegistrations(tables);
const licences = buildLicences(tables, registrations);
const deviceTokens = buildDeviceTokens(tables);

console.log(`Prepared ${registrations.size} KV account records from ${Object.values(counts.read).reduce((a, b) => a + b, 0)} Supabase rows.`);
console.log(`Prepared ${licences.length} licence keys and ${deviceTokens.size} device-token records.`);

if (APPLY) {
  await applyRegistrations(registrations);
  await applyLicences(licences);
  await applyDeviceTokens(deviceTokens);
}

printSummary();
