/**
 * Cloud-authoritative payment gate — THE APP OPENS FOR PAID ACCOUNTS, ONLY.
 *
 * The old gate trusted localStorage ("payments" array) and the /app?success=true
 * URL parameter — both are trivially forged (devtools edit, typing the URL), which
 * is exactly how a non-paying user unlocked the app. This module decides access
 * from SUPABASE (and Whop, server-side) only:
 *
 *   admin  → the users row is is_admin, or the email is a platform owner
 *   paid   → the users row is is_paid (the owner marked them paid in the
 *            console), OR a license_keys row is bound to the email (the key
 *            only exists because they paid), OR Whop reports an active
 *            membership for the email
 *   unpaid → everything else, and every unpaid email is sent to checkout
 *
 * MENTOR APPROVAL IS NOT IN THIS LIST, ON PURPOSE. Approving somebody in the
 * mentor portal is a portal decision; it has never had anything to do with the
 * app, and reading it here is what let unpaied people walk into the dashboard.
 * `mentor_approvals` is not consulted anywhere in this module.
 *
 * A tiny in-memory cache (60s) keeps navigation snappy; it never survives a page
 * reload and only caches DATABASE results, so editing localStorage cannot
 * influence the decision. When Supabase is unreachable/unconfigured the caller
 * falls back to the legacy local store (dev must keep working) — but a forged
 * LOCAL record can never be validated by the cloud path.
 */
import { OWNER_EMAILS, markEmailPaid, paymentStatusForEmail } from "@/lib/auth-store";
import { appSignOut, getDeviceId } from "@/lib/app-store";
import { supabase, supabaseConfigured } from "@/lib/supabase";

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

/** Is any license key bound to this email? Exact match, then case-insensitive. */
async function emailHasLicenseKeyCloud(clean: string): Promise<boolean> {
  const { data: license } = await supabase!
    .from("license_keys")
    .select("key")
    .eq("email", clean)
    .limit(1)
    .maybeSingle();
  if (license) return true;
  const { data: licenseLoose } = await supabase!
    .from("license_keys")
    .select("key")
    .ilike("email", clean)
    .limit(1)
    .maybeSingle();
  return !!licenseLoose;
}

/**
 * DEVICE-BINDING LIVENESS — true when the cloud has a users row for this
 * email whose device_id no longer matches THIS device. Bindings are only
 * written at a fresh sign-in (and at key activation), so a cleared binding
 * means the session predates the global access reset and must end. The
 * check fails OPEN (network hiccup = no kick) so a flaky connection can
 * never log someone out.
 */
async function deviceBindingRevoked(email: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select("device_id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) return false;
    if (!row) return false; // no users row — the payment decision handles it
    const boundDeviceId = (row as { device_id?: string | null } | null)?.device_id ?? null;
    return boundDeviceId !== getDeviceId();
  } catch {
    return false;
  }
}

async function computeFromDatabase(clean: string): Promise<CloudAccess> {
  // THE APP OPENS FOR PAID ACCOUNTS. THAT IS THE WHOLE RULE.
  //
  // Mentor approval is a PORTAL decision and has nothing to do with the app.
  // `mentor_approvals` used to be read first here, and an approved mentor was
  // let straight into the app without ever being marked paid — which is
  // exactly the confusion this gate exists to remove. It is no longer read at
  // all: approving somebody in the mentor portal says nothing about whether
  // they may use the app, and marking somebody paid is the only thing that
  // does. An unpaid email is sent to checkout, on every platform.
  const { data: user, error: userError } = await supabase!
    .from("users")
    .select("is_paid, is_admin")
    .eq("email", clean)
    .maybeSingle();
  if (userError) throw userError;
  if (user?.is_admin) return "admin";
  if (user?.is_paid) return "paid";

  // A license_keys row bound to this email is payment in practice — the key
  // only exists because somebody paid for it. Exact match first, then a
  // case-insensitive fallback.
  if (await emailHasLicenseKeyCloud(clean)) return "paid";

  // Whop — the checkout source of truth, verified SERVER-side with the
  // WHOP_API_KEY (never from the browser). DYNAMIC import: supabase.server
  // reads process.env at module init and registers TanStack server
  // functions — statically importing it into the client graph crashed the
  // Android WebView bundle ("Dashboard didn't load"). Any failure here just
  // means "no Whop confirmation"; the database still decides.
  try {
    const { whopVerifyMembership } = await import("@/lib/supabase.server");
    const whop = await whopVerifyMembership({ data: { email: clean } });
    if (whop.ok && whop.paid) return "paid";
  } catch {
    /* server functions unavailable in this bundle — DB decision stands */
  }

  return "unpaid";
}

/**
 * The gate every /app route guard must await. Fail-closed for cloud-decided
 * unpaid emails; falls back to the legacy local store only when the cloud
 * cannot be reached at all (Supabase unconfigured) so dev never blocks.
 */
export async function requireVerifiedAccess(email: string | null): Promise<AppAccessCheck> {
  if (!email) return { action: "signin" };
  // PLATFORM OWNERS pass EVERY gate instantly — before any database/Whop
  // call. A stale users row (is_admin/is_paid false) must never bounce the
  // owner to checkout (the "scanner says paid emails only" bug).
  if (isOwnerEmail(email)) {
    // …but the GLOBAL ACCESS RESET still applies to them: if the database
    // does not bind THIS device to the email, the old session ends here.
    // Sign back in on this device and the binding is re-created.
    const ownerKick = await deviceBindingRevoked(email);
    if (ownerKick) {
      appSignOut();
      return { action: "signin" };
    }
    return { action: "pass" };
  }
  // GLOBAL ACCESS RESET — everyone else: if the database no longer binds
  // this device to the email (the reset cleared every binding), the stale
  // session is dead. appSignOut clears it ONCE and the route sends the
  // person to /app/login, where the cloud gate decides who gets back in:
  // unpaid emails go to checkout, paid/admin emails re-bind on sign-in.
  if (await deviceBindingRevoked(email)) {
    appSignOut();
    return { action: "signin" };
  }
  let cloud: CloudAccess | null = null;
  try {
    cloud = await resolveCloudAccess(email);
  } catch {
    // NEVER let a gate error crash a route (that was the "Dashboard didn't
    // load" screen on Android) — degrade to the legacy local gate.
    cloud = null;
  }
  if (cloud === "admin" || cloud === "paid") {
    // Reconcile the local store so in-app UI (which reads it) agrees with
    // the cloud decision. This is a downstream mirror, never the source.
    markEmailPaid(email);
    return { action: "pass" };
  }
  // Anything that is not paid goes to checkout — on Android, iOS and the web.
  // There is no approval branch: an approved mentor who was never marked paid
  // is sent to Whop like everybody else, which is the entire point.
  if (cloud === "unpaid") return { action: "pay" };
  // Cloud undecided (unconfigured) — legacy local behaviour.
  return paymentStatusForEmail(email) === "unpaid" ? { action: "pay" } : { action: "pass" };
}

/**
 * Verify a Whop checkout return (?success=true). Returns true ONLY when the
 * database or the server-side Whop check confirms payment. Never trusts the
 * URL parameter itself, and never consults mentor approval.
 */
export async function verifyPaymentReturn(email: string): Promise<boolean> {
  const clean = email.trim().toLowerCase();
  try {
    const cloud = await resolveCloudAccess(clean);
    if (cloud === "admin" || cloud === "paid") {
      markEmailPaid(clean);
      return true;
    }
    if (cloud === "unpaid") return false;
  } catch {
    /* fall through to the explicit Whop check */
  }
  // resolveCloudAccess already ran the Whop check inside computeFromDatabase
  // for the unpaid branch — run it explicitly here for a fresh answer.
  try {
    const { whopVerifyMembership } = await import("@/lib/supabase.server");
    const whop = await whopVerifyMembership({ data: { email: clean } });
    if (whop.ok && whop.paid) {
      markEmailPaid(clean);
      return true;
    }
  } catch {
    /* server functions unavailable */
  }
  return false;
}
