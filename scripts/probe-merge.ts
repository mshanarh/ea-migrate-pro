/**
 * Full merged live-app view (like portalGetAccount / dashboard poll / auth-store
 * hydration do): status = mentor_approvals (unless missing), plus cloud account
 * fields; allowance = app_settings limit:<email> (authoritative), else local
 * licenseLimit > 0 fallback, else null (blocked); remaining; button state;
 * submit cap check.
 * portal_accounts `data` blobs fetched per-email to avoid statement timeouts.
 */
import { getLicenseCapForEmail, countKeysForEmail } from "../src/lib/admin-store";
import { supabase } from "../src/lib/supabase";

if (!supabase) {
  console.log("supabase NOT configured");
  process.exit(1);
}

const apps = await supabase.from("app_settings").select("key,value").like("key", "limit:%");
const limitRows = new Map<string, number>();
for (const row of apps.data ?? []) {
  const email = String(row.key).slice("limit:".length);
  let value: unknown = row.value;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { continue; }
  }
  const limit = Number((value as { limit?: unknown } | null)?.limit);
  if (Number.isFinite(limit)) limitRows.set(email, Math.floor(limit));
}

const approvals = await supabase.from("mentor_approvals").select("email,status");
const byEmail = new Map<string, string>();
for (const x of approvals.data ?? []) byEmail.set(x.email, x.status);

const portals: string[] = [];
for (let p = 1; p <= 4; p++) {
  const one = await supabase.from("portal_accounts").select("email").limit(20).order("updated_at", { ascending: false }).range((p - 1) * 20, p * 20 - 1);
  if (one.data) portals.push(...(one.data as { email: string[] }).map((x) => x.email));
  if ((one.data ?? []).length < 20) break;
}

type View = {
  email: string;
  approval: string;
  cap: number | null;
  eas: number;
  licenses: number;
  statusBlob: string;
  hasRow: boolean;
  allowed: number | null;
  remaining: number;
  button: boolean;
  submitOK: boolean;
  can: boolean;
};

const views: View[] = [];
for (const e of portals) {
  const approval = byEmail.get(e) ?? "pending";
  const cap = await getLicenseCapForEmail(e);

  let eas = 0;
  let licenses = 0;
  let statusBlob = "";
  const ea = await supabase.from("portal_accounts").select("data").eq("email", e).maybeSingle();
  if (ea.data) {
    try {
      const a = JSON.parse(String(ea.data.data)) as { eas?: unknown[]; licenses?: unknown[]; status?: string };
      eas = a.eas?.length ?? 0;
      licenses = a.licenses?.length ?? 0;
      statusBlob = a.status ?? "";
    } catch { /* ignore */ }
  }

  const allowed = cap !== null ? cap : (Number.isFinite(ea.data ? (JSON.parse(String(ea.data.data)) as { licenseLimit?: number }).licenseLimit : 0) > 0 ? (ea.data ? (JSON.parse(String(ea.data.data)) as { licenseLimit?: number }).licenseLimit : 0) : null);
  const remaining = allowed === null ? 0 : Math.max(allowed - licenses, 0);
  const button = remaining > 0 && eas > 0;

  let submitOK = true;
  if (cap !== null) {
    const cu = await countKeysForEmail(e);
    submitOK = cu < cap;
  }

  views.push({
    email: e,
    approval,
    cap: cap ?? null,
    eas,
    licenses,
    statusBlob,
    hasRow: limitRows.has(e),
    allowed: allowed ?? null,
    remaining,
    button,
    submitOK,
    can: approval === "approved" && button && submitOK,
  });
}

const approvedRows = views.filter((v) => v.approval === "approved" && v.hasRow);
const blockedApprovedRows = approvedRows.filter((v) => !v.can);
console.log("approved+with-row:", approvedRows.length, "| of those blocked (must fix):", blockedApprovedRows.length);
for (const v of blockedApprovedRows) {
  console.log("  BLOCKED:", v.email, "| eas=", v.eas, "| licenses=", v.licenses, "| remaining=", v.remaining, "| submitOK=", v.submitOK, "| cap=", v.cap);
}

const noRowLeak = views.filter((v) => !v.hasRow && v.can);
console.log("\nno-row leaks (should stay blocked - user rejects those):", noRowLeak.length);
for (const v of noRowLeak) {
  console.log("  LEAK:", v.email, "| localLicenseLimit=", v.allowed);
}

const approvedNoRow = views.filter((v) => v.approval === "approved" && !v.hasRow);
console.log("\napproved-NO row (need to be blocked per user policy; local fallback must NOT unlock):", approvedNoRow.length, approvedNoRow.map((v) => v.email).join(", "));
