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
import type { Account, PaymentRecord, PortalStatus } from "@/lib/auth-store";

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
  for (const row of (accountsRes.data ?? []) as Array<{ email: string; data: string }>) {
    try {
      const parsed = JSON.parse(row.data) as Account;
      const approval = approvals.get(row.email.toLowerCase());
      accounts.push({ ...toPublic({ ...parsed, email: row.email }), status: approval ?? parsed.status });
    } catch {
      /* corrupted row — skip it */
    }
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
