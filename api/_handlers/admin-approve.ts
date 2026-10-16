/**
 * POST /api/admin-approve — admin actions on one registration.
 * Body: { email, action: "approve" | "reject" | "pending" | "paid" | "unpaid" | "limit", limit? }
 *
 * Payment changes are also mirrored server-side into the app's existing
 * payment ledger when SUPABASE_SERVICE_ROLE_KEY is set, so the trading app's
 * OTP activation gate keeps honouring "Mark paid" / "Mark unpaid" — and the
 * approval itself is mirrored into `mentor_approvals`, the fallback the mentor
 * portal reads when the KV store cannot answer (see mirrorApproval below).
 */
import {
  adminFromRequest,
  getRegistration,
  normalizeEmail,
  parseBody,
  saveRegistration,
  toPublic,
  type ApiRequest,
  type ApiResponse,
  type Registration,
} from "./_registry.js";

const ACTIONS = ["approve", "reject", "pending", "paid", "unpaid", "limit"] as const;
type Action = (typeof ACTIONS)[number];

/** Service-role Supabase client, or null when the mirror is not configured. */
async function mirrorDb() {
  const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
  const key = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!url || !key) return null;
  // Imported lazily, like every other server-side Supabase use in /api.
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function mirrorPayment(email: string, paid: boolean): Promise<void> {
  try {
    const db = await mirrorDb();
    if (!db) return;
    await db.from("users").upsert({ email, is_paid: paid }, { onConflict: "email" });
    await db.from("paid_emails").upsert({ email, paid_at: paid ? new Date().toISOString() : null }, { onConflict: "email" });
  } catch (error) {
    console.warn("[admin-approve] payment mirror failed", error);
  }
}

/**
 * Mirror the DECISION into the legacy Supabase `mentor_approvals` table.
 *
 * The KV record is the authoritative store (see AGENTS.md), but the mentor
 * portal still reads that table as its FALLBACK whenever the KV read cannot
 * answer — and nothing has written `approved` to it since the store moved. A
 * signup leaves a `pending` row behind (src/lib/send-email.ts), so an approval
 * that only reached KV left the fallback answering "pending" — the exact
 * "I approved them and their portal still says pending" report.
 *
 * Best-effort, exactly like the payment mirror above: the KV write already
 * happened and a mirror failure is logged, never surfaced as a failed
 * approval. `mentor_approvals.email` is the primary key, so the upsert can
 * never duplicate a mentor.
 */
async function mirrorApproval(email: string, status: Registration["status"]): Promise<void> {
  try {
    const db = await mirrorDb();
    if (!db) return;
    await db.from("mentor_approvals").upsert({ email, status }, { onConflict: "email" });
  } catch (error) {
    console.warn("[admin-approve] approval mirror failed", error);
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!adminFromRequest(request)) {
    response.status(403).json({ ok: false, error: "Admin access required" });
    return;
  }
  const body = parseBody(request);
  const email = normalizeEmail(body["email"]);
  const action = body["action"] as Action;
  if (!email || !ACTIONS.includes(action)) {
    response.status(400).json({ ok: false, error: "Missing email or unknown action" });
    return;
  }

  try {
    const now = new Date().toISOString();
    const existing = await getRegistration(email);
    // App-only accounts (never registered on the website) still get a record
    // so payment/limit changes persist for them too.
    const record: Registration = existing ?? {
      email,
      firstName: "",
      displayName: "",
      username: "",
      whatsapp: "",
      passwordHash: "",
      passwordSalt: "",
      createdAt: now,
      updatedAt: now,
      status: "pending",
      isPaid: false,
      paidAt: null,
      licenseLimit: 0,
    };

    if (action === "approve") record.status = "approved";
    else if (action === "reject") record.status = "rejected";
    else if (action === "pending") record.status = "pending";
    else if (action === "paid" || action === "unpaid") {
      record.isPaid = action === "paid";
      record.paidAt = record.isPaid ? now : null;
    } else if (action === "limit") {
      record.licenseLimit = Math.max(0, Math.min(9999, Math.floor(Number(body["limit"]) || 0)));
      // MARKED AS DELIBERATE — this is the console's "Save limit" button, so the
      // number (0 included) is the admin's decision and is enforced as one. A
      // record that merely EXISTS has licenseLimit 0 by default, and reading
      // that as a cap is what would block a freshly approved mentor from ever
      // creating a key. See `licenseLimitSet` in _registry.ts.
      record.licenseLimitSet = true;
    }

    await saveRegistration(record);
    // The DECISION is mirrored for the portal's legacy fallback read, so no
    // read path can keep answering "pending" for an approved mentor.
    await mirrorApproval(email, record.status);
    if (action === "paid" || action === "unpaid") await mirrorPayment(email, record.isPaid);
    response.status(200).json({ ok: true, user: toPublic(record) });
  } catch (error) {
    console.error("[admin-approve]", error);
    response.status(503).json({ ok: false, error: "Registration storage is unavailable" });
  }
}
