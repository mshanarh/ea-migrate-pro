/**
 * Cloud-authoritative payment gate.
 *
 * The old gate trusted localStorage ("payments" array) and the /app?success=true
 * URL parameter — both are trivially forged (devtools edit, typing the URL), which
 * is exactly how a non-paying user unlocked the app. This module decides access
 * from SUPABASE (and Whop, server-side) only:
 *
 *   admin  → the users row is is_admin, or the email is a platform owner
 *   paid   → the users row is is_paid, OR a license_keys row is bound to the
 *            email (the license key IS the payment — mentor-issued), OR Whop
 *            reports an active membership for the email
 *   unpaid → everything else
 *
 * A tiny in-memory cache (60s) keeps navigation snappy; it never survives a page
 * reload and only caches DATABASE results, so editing localStorage cannot
 * influence the decision. When Supabase is unreachable/unconfigured the caller
 * falls back to the legacy local store (dev must keep working) — but a forged
 * LOCAL record can never be validated by the cloud path.
 */
import { OWNER_EMAILS, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { whopVerifyMembership } from "@/lib/supabase.server";

export type CloudAccess = "admin" | "paid" | "unpaid";
export type AppAccessCheck = { action: "pass" | "signin" | "pay" };

type Resolution = { status: CloudAccess; at: number };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, Resolution>();

export function isOwnerEmail(email: string): boolean {
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}

/** Raw cloud decision — null means "cannot decide" (unconfigured / unreachable). */
export async function resolveCloudAccess(email: string | null | undefined): Promise<CloudAccess | null> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return "unpaid";
  if (isOwnerEmail(clean)) return "admin";
  if (!supabase) return null; // unconfigured — caller decides the fallback

  const cached = cache.get(clean);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.status;

  try {
    const status = await computeFromDatabase(clean);
    cache.set(clean, { status, at: Date.now() });
    return status;
  } catch (error) {
    console.warn("[payment-gate] cloud check failed:", error);
    return null;
  }
}

async function computeFromDatabase(clean: string): Promise<CloudAccess> {
  // 1. users row — explicit paid/admin flags (admin console approval).
  const { data: user, error: userError } = await supabase!
    .from("users")
    .select("is_paid, is_admin")
    .eq("email", clean)
    .maybeSingle();
  if (userError) throw userError;
  if (user?.is_admin) return "admin";
  if (user?.is_paid) return "paid";

  // 2. license_keys row bound to this email — the mentor-issued key is proof
  //    of payment. Exact match first, then case-insensitive fallback.
  const { data: license } = await supabase!
    .from("license_keys")
    .select("key")
    .eq("email", clean)
    .limit(1)
    .maybeSingle();
  if (license) return "paid";
  const { data: licenseLoose } = await supabase!
    .from("license_keys")
    .select("key")
    .ilike("email", clean)
    .limit(1)
    .maybeSingle();
  if (licenseLoose) return "paid";

  // 3. Whop — the checkout source of truth, verified SERVER-side with the
  //    WHOP_API_KEY (never from the browser). Also back-fills users.is_paid
  //    so later checks are database-only.
  const whop = await whopVerifyMembership({ data: { email: clean } });
  if (whop.ok && whop.paid) return "paid";

  return "unpaid";
}

/**
 * The gate every /app route guard must await. Fail-closed for cloud-decided
 * unpaid emails; falls back to the legacy local store only when the cloud
 * cannot be reached at all (Supabase unconfigured) so dev never blocks.
 */
export async function requireVerifiedAccess(email: string | null): Promise<AppAccessCheck> {
  if (!email) return { action: "signin" };
  const cloud = await resolveCloudAccess(email);
  if (cloud === "admin" || cloud === "paid") {
    // Reconcile the local store so in-app UI (which reads it) agrees with
    // the cloud decision. This is a downstream mirror, never the source.
    markEmailPaid(email);
    return { action: "pass" };
  }
  if (cloud === "unpaid") return { action: "pay" };
  // Cloud undecided (unconfigured) — legacy local behaviour.
  return paymentStatusForEmail(email) === "unpaid" ? { action: "pay" } : { action: "pass" };
}

/**
 * Verify a Whop checkout return (?success=true). Returns true ONLY when the
 * server-side Whop check (or the database, if an approval already landed)
 * confirms payment. Never trusts the URL parameter itself.
 */
export async function verifyPaymentReturn(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  const cloud = await resolveCloudAccess(clean);
  if (cloud === "admin" || cloud === "paid") {
    markEmailPaid(clean);
    return true;
  }
  if (cloud === null && !supabaseConfigured) return false;
  // resolveCloudAccess already ran the Whop check inside computeFromDatabase
  // for the unpaid branch — re-run explicitly here for a fresh answer.
  const whop = await whopVerifyMembership({ data: { email: clean } });
  if (whop.ok && whop.paid) {
    markEmailPaid(clean);
    return true;
  }
  return false;
}
