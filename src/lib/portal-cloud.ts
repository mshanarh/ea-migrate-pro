/**
 * Portal cloud store — DIRECT browser ↔ Supabase (anon key).
 *
 * The production app is a STATIC Vite site where TanStack server functions
 * (the old syncListAccounts / syncAdminUpdate / syncSetPayment path) 404 —
 * the admin console's poll and Approve buttons therefore always failed with
 * "the change may be lost". This module performs the exact same reads and
 * writes the server functions did, straight from the browser, against the
 * same tables the schema grants full anon access (portal_accounts,
 * mentor_approvals, portal_payments).
 */
import type { Account, ExpertAdvisor, PaymentRecord, PortalStatus } from "@/lib/auth-store";

export type PublicAccount = Omit<Account, "password">;
export type AdminPatch = {
  status?: PortalStatus;
  licenseLimit?: number;
  licenses?: Account["licenses"];
  /** When true, `licenses` is the full replacement list — removals propagate. */
  replaceLicenses?: boolean;
};
export type SyncListResult = { enabled: boolean; accounts: PublicAccount[]; payments: PaymentRecord[] };

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();

/** False while Supabase is unconfigured — every call short-circuits safely. */
export function portalCloudConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

type Client = import("@supabase/supabase-js").SupabaseClient;
let client: Client | null = null;

async function db(): Promise<Client | null> {
  if (!portalCloudConfigured()) return null;
  if (!client) {
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function toPublic(account: Account): PublicAccount {
  const { password: _password, ...rest } = account;
  return rest;
}

/** All approval rows, keyed by email. */
async function listApprovals(): Promise<Map<string, PortalStatus>> {
  const map = new Map<string, PortalStatus>();
  const dbClient = await db();
  if (!dbClient) return map;
  const { data, error } = await dbClient.from("mentor_approvals").select("email, status");
  if (error) {
    console.error("[portal-cloud] approvals read failed:", error.message);
    return map;
  }
  for (const row of (data ?? []) as Array<{ email: string; status: string }>) {
    if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
      map.set(row.email.toLowerCase(), row.status as PortalStatus);
    }
  }
  return map;
}

/** List every cloud account with the approval status merged over it. */
export async function portalListAccounts(): Promise<SyncListResult> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, accounts: [], payments: [] };
  const [accountsRes, paymentsRes, approvals] = await Promise.all([
    dbClient.from("portal_accounts").select("email, data").order("updated_at", { ascending: false }),
    dbClient.from("portal_payments").select("email, paid, paid_at"),
    listApprovals(),
  ]);
  if (accountsRes.error) {
    console.error("[portal-cloud] accounts read failed:", accountsRes.error.message);
    return { enabled: true, accounts: [], payments: [] };
  }
  const accounts: PublicAccount[] = [];
  const seen = new Set<string>();
  for (const row of (accountsRes.data ?? []) as Array<{ email: string; data: string }>) {
    seen.add(row.email.toLowerCase());
    try {
      const parsed = JSON.parse(row.data) as Account;
      const approval = approvals.get(row.email.toLowerCase());
      accounts.push({ ...toPublic({ ...parsed, email: row.email }), status: approval ?? parsed.status });
    } catch {
      /* corrupted row — still surfaced below as a skeleton entry */
      accounts.push({
        id: "cloud-" + row.email,
        email: row.email,
        firstName: "",
        displayName: row.email.split("@")[0] ?? row.email,
        username: row.email.split("@")[0] ?? row.email,
        whatsapp: "",
        role: "mentor",
        status: approvals.get(row.email.toLowerCase()) ?? "pending",
        createdAt: "",
        licenseLimit: 0,
        licenses: [],
        eas: [],
      });
    }
  }
  // REGISTRATIONS WITHOUT AN ACCOUNT ROW: some signups only ever created a
  // mentor_approvals row (their account write hit the old server-function
  // 404). They MUST still appear on the admin console's Pending tab —
  // otherwise people think the platform ate their registration.
  for (const [approvalEmail, approvalStatus] of approvals) {
    if (seen.has(approvalEmail)) continue;
    accounts.push({
      id: "approval-" + approvalEmail,
      email: approvalEmail,
      firstName: "",
      displayName: approvalEmail.split("@")[0] ?? approvalEmail,
      username: approvalEmail.split("@")[0] ?? approvalEmail,
      whatsapp: "",
      role: "mentor",
      status: approvalStatus,
      createdAt: "",
      licenseLimit: 0,
      licenses: [],
      eas: [],
    });
  }
  const payments: PaymentRecord[] = ((paymentsRes.data ?? []) as Array<{ email: string; paid: boolean; paid_at: string | null }>).map(
    (row) => ({ email: row.email, paid: row.paid, ...(row.paid_at ? { paidAt: row.paid_at } : {}) }),
  );
  return { enabled: true, accounts, payments };
}

/**
 * Admin update — approval status, license limit and license list. Mirrors
 * the server function's merge rules: the approval write ALWAYS lands (so a
 * later poll can't resurrect "pending"), and license pushes union-merge by
 * id so a stale device can't delete another session's keys.
 */
/**
 * Registration — writes the FULL account (minus password) into the shared
 * store + the approval row, straight from the browser.
 *
 * This is the missing piece that made new registrations INVISIBLE in the
 * admin console: the old signup flow only called syncRegister (a TanStack
 * server function), which 404s on the static Vercel build — the
 * mentor_approvals row (written by the email sender) landed, but the
 * portal_accounts row the admin list reads never did. The merge rules match
 * syncRegister: cloud-controlled fields (status/role/limit/licenses) win
 * from an existing row; brand-new rows are stored as they registered.
 */
export async function portalRegisterAccount(account: Account): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const email = account.email.trim().toLowerCase();
  if (!email) return { enabled: true, ok: false, error: "Missing email" };
  try {
    const { data: existingRow, error: readError } = await dbClient
      .from("portal_accounts")
      .select("data")
      .eq("email", email)
      .maybeSingle();
    if (readError) return { enabled: true, ok: false, error: readError.message };
    // MERGE, never clobber: cloud-controlled fields of an existing row win.
    let merged: Account = { ...account, email };
    if (existingRow?.data) {
      try {
        const existing = JSON.parse(existingRow.data) as Account;
        const licensesById = new Map(existing.licenses.map((license) => [license.id, license]));
        for (const license of account.licenses) licensesById.set(license.id, license);
        merged = {
          ...account,
          email,
          status: existing.status,
          role: existing.role,
          licenseLimit: existing.licenseLimit,
          licenses: Array.from(licensesById.values()),
        };
      } catch {
        /* corrupted existing row — the fresh account replaces it */
      }
    }
    const { error: writeError } = await dbClient
      .from("portal_accounts")
      .upsert({ email, data: JSON.stringify(merged), updated_at: new Date().toISOString() }, { onConflict: "email" });
    if (writeError) return { enabled: true, ok: false, error: writeError.message };
    // Approval row: keeps the console's Pending/Approved tabs authoritative.
    // Never overwrite an existing admin decision (approved/rejected).
    if (!existingRow?.data) {
      const { error: approvalError } = await dbClient
        .from("mentor_approvals")
        .upsert({ email, status: "pending" }, { onConflict: "email", ignoreDuplicates: true });
      if (approvalError) console.warn("[portal-cloud] approval row write failed:", approvalError.message);
    }
    return { enabled: true, ok: true };
  } catch (error) {
    return { enabled: true, ok: false, error: error instanceof Error ? error.message : "Cloud registration failed" };
  }
}

export async function portalAdminUpdate(
  targetEmail: string,
  patch: AdminPatch,
): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const target = targetEmail.trim().toLowerCase();
  try {
    if (patch.status) {
      const { error } = await dbClient
        .from("mentor_approvals")
        .upsert({ email: target, status: patch.status }, { onConflict: "email" });
      if (error) return { enabled: true, ok: false, error: error.message };
    }

    if (patch.licenseLimit !== undefined || patch.licenses) {
      const { data: existing, error: readError } = await dbClient
        .from("portal_accounts")
        .select("data")
        .eq("email", target)
        .maybeSingle();
      if (readError) return { enabled: true, ok: false, error: readError.message };
      let account: Account = existing
        ? (JSON.parse(existing.data) as Account)
        : {
            id: "m-cloud-" + Date.now(),
            firstName: "",
            displayName: target,
            email: target,
            username: target.split("@")[0] ?? target,
            password: "",
            whatsapp: "",
            role: "mentor",
            status: "pending",
            createdAt: new Date().toISOString(),
            licenseLimit: 0,
            licenses: [],
            eas: [],
          };
      if (patch.licenseLimit !== undefined) account = { ...account, licenseLimit: patch.licenseLimit };
      if (patch.licenses) {
        if (patch.replaceLicenses) {
          account = { ...account, licenses: patch.licenses };
        } else {
          const merged = [...account.licenses];
          for (const license of patch.licenses) {
            const index = merged.findIndex((item) => item.id === license.id);
            if (index >= 0) merged[index] = license;
            else merged.push(license);
          }
          account = { ...account, licenses: merged };
        }
      }
      const { error: writeError } = await dbClient
        .from("portal_accounts")
        .upsert({ email: target, data: JSON.stringify(account) }, { onConflict: "email" });
      if (writeError) return { enabled: true, ok: false, error: writeError.message };
    }
    return { enabled: true, ok: true };
  } catch (error) {
    return { enabled: true, ok: false, error: error instanceof Error ? error.message : "Cloud update failed" };
  }
}

/** Record a payment flag in the shared store (portal_payments). */
export async function portalSetPayment(email: string, paid: boolean): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const { error } = await dbClient
    .from("portal_payments")
    .upsert({ email: email.trim().toLowerCase(), paid, ...(paid ? { paid_at: new Date().toISOString() } : {}) }, { onConflict: "email" });
  return error ? { enabled: true, ok: false, error: error.message } : { enabled: true, ok: true };
}

/**
 * DELETE a license key from the cloud `license_keys` table.
 *
 * Removing a key only from the mentor's portal record left the license_keys
 * row alive — the key kept activating on the app forever. Deleting BOTH is
 * what makes "delete" mean delete: the row goes from license_keys (the
 * table the app activates against) and the mentor's portal_accounts record.
 */
export async function portalDeleteLicenseKey(key: string): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const clean = key.trim().toUpperCase();
  const { error } = await dbClient.from("license_keys").delete().eq("key", clean);
  if (error) return { enabled: true, ok: false, error: error.message };
  return { enabled: true, ok: true };
}

/**
 * Push ONE newly-created license into the mentor's cloud portal record
 * (portal_accounts). Without this, keys created on the portal lived only in
 * that device's localStorage: the app on any other surface (the Android
 * wrapper!) activated against license_keys + portal_accounts and reported
 * "That license key was not found" even for the owner's own email.
 * Union-merges by id so re-pushing never duplicates or deletes other keys.
 */
export async function portalUpsertLicense(
  mentorEmail: string,
  license: Account["licenses"][number],
  eaMedia?: { image?: string; video?: string },
): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const mentor = mentorEmail.trim().toLowerCase();
  try {
    const { data: existing, error: readError } = await dbClient
      .from("portal_accounts")
      .select("data")
      .eq("email", mentor)
      .maybeSingle();
    if (readError) return { enabled: true, ok: false, error: readError.message };
    if (!existing) return { enabled: true, ok: false, error: "Mentor has no cloud record yet — register once first." };
    const account =
      typeof existing.data === "string" ? (JSON.parse(existing.data) as Account) : (existing.data as Account);
    // GUARANTEE the EA media (picture/video) exists in the cloud record:
    // the license alone gives the app a name, but clients' phones need the
    // IMAGE for the robot card and the floating bubble. The mentor's local
    // EA list is the source — carry the linked EA (image included) along
    // with every issued key.
    let eas = account.eas ?? [];
    if (eaMedia?.image || eaMedia?.video) {
      const linked = eas.find((ea) => ea.id === license.eaId);
      if (linked) {
        if (eaMedia.image && !linked.image) linked.image = eaMedia.image;
        if (eaMedia.video && !linked.video) linked.video = eaMedia.video;
      } else if (license.eaId) {
        eas = [
          ...eas,
          {
            id: license.eaId,
            name: license.robotName || license.expertAdvisor || license.name || "EA",
            ...(license.symbols && Array.isArray(license.symbols)
              ? { symbols: (license.symbols as string[]).filter((s): s is string => typeof s === "string") }
              : {}),
            ...(eaMedia.image ? { image: eaMedia.image } : {}),
            ...(eaMedia.video ? { video: eaMedia.video } : {}),
            createdAt: new Date().toISOString(),
          } as ExpertAdvisor,
        ];
      }
    }
    const licensesById = new Map((account.licenses ?? []).map((item) => [item.id, item]));
    licensesById.set(license.id, license);
    const merged: Account = { ...account, eas, licenses: Array.from(licensesById.values()) };
    const { error: writeError } = await dbClient
      .from("portal_accounts")
      .upsert({ email: mentor, data: JSON.stringify(merged) }, { onConflict: "email" });
    if (writeError) return { enabled: true, ok: false, error: writeError.message };
    return { enabled: true, ok: true };
  } catch (error) {
    return { enabled: true, ok: false, error: error instanceof Error ? error.message : "Cloud push failed" };
  }
}

/**
 * Remove ONE license (by id) from the mentor's cloud portal record, so a
 * deleted key does not resurrect on the next device restore.
 */
export async function portalRemoveLicense(
  mentorEmail: string,
  licenseId: string,
): Promise<{ enabled: boolean; ok: boolean; error?: string }> {
  const dbClient = await db();
  if (!dbClient) return { enabled: false, ok: false };
  const mentor = mentorEmail.trim().toLowerCase();
  try {
    const { data: existing, error: readError } = await dbClient
      .from("portal_accounts")
      .select("data")
      .eq("email", mentor)
      .maybeSingle();
    if (readError) return { enabled: true, ok: false, error: readError.message };
    if (!existing) return { enabled: true, ok: true };
    const account =
      typeof existing.data === "string" ? (JSON.parse(existing.data) as Account) : (existing.data as Account);
    const merged: Account = { ...account, licenses: account.licenses.filter((item) => item.id !== licenseId) };
    const { error: writeError } = await dbClient
      .from("portal_accounts")
      .upsert({ email: mentor, data: JSON.stringify(merged) }, { onConflict: "email" });
    if (writeError) return { enabled: true, ok: false, error: writeError.message };
    return { enabled: true, ok: true };
  } catch (error) {
    return { enabled: true, ok: false, error: error instanceof Error ? error.message : "Cloud remove failed" };
  }
}
