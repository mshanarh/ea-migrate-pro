/**
 * POST /api/admin-backfill — ONE-TIME migration check: reads existing user
 * rows from Supabase (users + portal_accounts + paid_emails) and copies their
 * email, role and paid status into the KV store the admin dashboard reads
 * (`eamp:registrations`), so existing users are not lost from the admin list.
 *
 * Body: { email }  — the admin's own address (x-admin-email header), no other
 * payload. Idempotent: existing KV records are NEVER overwritten (their state
 * is newer — the dashboard writes it); only missing emails are created, plus
 * a `syncPaid` pass that refreshes isPaid for records whose KV flag is false
 * but the ledger says paid. Returns counts.
 */
import { createClient } from "@supabase/supabase-js";
import {
  adminFromRequest,
  getRegistration,
  normalizeEmail,
  saveRegistration,
  storeConfigured,
  type ApiRequest,
  type ApiResponse,
  type ApprovalState,
  type Registration,
} from "./_registry.js";

const HISTORY_KEY = "eamp:backfill"; // last run summary, for the "check" half

type SupaRow = Record<string, unknown>;

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!adminFromRequest(request)) {
    response.status(403).json({ ok: false, error: "Admin access required" });
    return;
  }
  if (!storeConfigured()) {
    response.status(503).json({ ok: false, error: "KV store is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)" });
    return;
  }
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !serviceRole) {
    response.status(503).json({ ok: false, error: "Supabase is not configured — nothing to backfill from" });
    return;
  }

  try {
    const db = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The SAME sources the pre-KV world used: users (role/payment mirror),
    // portal_accounts (role), paid_emails (the payment ledger).
    const [users, portals, paid] = await Promise.all([
      db.from("users").select("email, is_admin, is_paid"),
      db.from("portal_accounts").select("email, data"),
      db.from("paid_emails").select("email, paid_at"),
    ]);

    const roleByEmail = new Map<string, string>();
    for (const row of (portals.data ?? []) as SupaRow[]) {
      const email = normalizeEmail(row["email"]);
      try {
        const data = JSON.parse(String(row["data"] ?? "{}")) as { role?: string };
        if (email && data.role) roleByEmail.set(email, data.role.toLowerCase());
      } catch {
        /* unparseable blob carries no role */
      }
    }
    const paidByEmail = new Map<string, string | null>();
    for (const row of (paid.data ?? []) as SupaRow[]) {
      const email = normalizeEmail(row["email"]);
      if (email) paidByEmail.set(email, (row["paid_at"] as string | null) ?? null);
    }

    let created = 0;
    let syncedPaid = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of (users.data ?? []) as SupaRow[]) {
      const email = normalizeEmail(row["email"]);
      if (!email) continue;
      try {
        const existing = await getRegistration(email);
        const paidAt = paidByEmail.has(email) ? paidByEmail.get(email) ?? null : null;
        const ledgerPaid = paidAt != null;
        const kvPaid = (row["is_paid"] === true && ledgerPaid) || ledgerPaid;
        const role = roleByEmail.get(email);
        const status: ApprovalState =
          role === "admin" || row["is_admin"] === true ? "approved" : existing?.status ?? "pending";

        if (!existing) {
          const now = new Date().toISOString();
          const record: Registration = {
            email,
            firstName: "",
            displayName: email.split("@")[0] ?? email,
            username: email.split("@")[0] ?? email,
            whatsapp: "",
            passwordHash: "",
            passwordSalt: "",
            createdAt: now,
            updatedAt: now,
            status,
            isPaid: kvPaid,
            paidAt: kvPaid ? paidAt ?? now : null,
            licenseLimit: status === "approved" ? 10 : 0,
          };
          await saveRegistration(record);
          created += 1;
        } else if (!existing.isPaid && kvPaid) {
          // Ledger says paid, KV does not — the dashboard's own "Mark paid"
          // would have written KV, so this row predates cutover: promote it.
          await saveRegistration({ ...existing, isPaid: true, paidAt: existing.paidAt ?? paidAt ?? new Date().toISOString() });
          syncedPaid += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        errors.push(`${email}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
      }
    }

    const summary = { at: new Date().toISOString(), created, syncedPaid, skipped, failed: errors.length };
    console.log("[admin-backfill]", summary, errors.slice(0, 5));
    response.status(200).json({ ok: true, ...summary, errors: errors.slice(0, 20), historyKey: HISTORY_KEY });
  } catch (error) {
    console.error("[admin-backfill]", error);
    response.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Backfill failed" });
  }
}
