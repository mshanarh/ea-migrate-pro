/**
 * /api/account — the ONE server-side door to the KV account record.
 *
 * Upstash KV (KV_REST_API_URL / KV_REST_API_TOKEN) is the only store for
 * portal accounts, payment status, licence keys, device bindings and
 * reactivation. The token is server-side only, so every browser-side account
 * operation is an action on this endpoint:
 *
 *   profile            read one account record
 *   list               admin: every registration
 *   set-paid           admin: "Mark paid" / "Mark unpaid"
 *   set-admin          admin: "Make Admin"
 *   count-admins       how many admins exist (owner bootstrap)
 *   reactivation-flag  read (self) / write (admin) the 🔒 unlock
 *   record-name        remember the name typed at sign-in
 *   has-license        does this email hold a licence key in the KV store
 *   binding            read the device binding for one email
 *   bind-device        one email = one device
 *   reactivate         admin/unlocked: CLEAR THE DEVICE BINDING ONLY
 *   claim-key          claim a licence key for an email (single use)
 *
 * EVERY WRITE IS FIELD-SCOPED. `patchRegistration` merges one field, so a
 * device bind can never clear a payment flag and a reactivation can never
 * touch a licence key, an expiry or a subscription.
 */
import {
  adminFromRequest,
  clearDeviceBinding,
  countAdmins,
  getRegistration,
  isAdminEmail,
  kvCommand,
  listRegistrations,
  normalizeEmail,
  parseBody,
  saveRegistration,
  setAdminFlag,
  setPaidStatus,
  setReactivationFlag,
  storeConfigured,
  type ApiRequest,
  type ApiResponse,
  type PublicRegistration,
  type Registration,
} from "./_registry.js";
import { claimLicenceKeyForEmail } from "./licenses.js";

const ACTIONS = [
  "profile",
  "list",
  "set-paid",
  "set-admin",
  "count-admins",
  "reactivation-flag",
  "record-name",
  "has-license",
  "binding",
  "bind-device",
  "reactivate",
  "claim-key",
] as const;
type Action = (typeof ACTIONS)[number];

const LICENCE_HASH = "eamp:license-keys";
const LICENCE_BY_CLIENT = "eamp:license-by-client:";

/** The shape the client modules consume — never the password hash/salt. */
export type AccountProfile = {
  email: string;
  isPaid: boolean;
  isAdmin: boolean;
  paidAt: string | null;
  createdAt: string;
  status: string;
  deviceId: string | null;
  reactivationEnabled: boolean;
  displayName: string;
  firstName: string;
};

function toProfile(record: Registration): AccountProfile {
  return {
    email: record.email,
    isPaid: record.isPaid === true,
    // A fixed-list admin has no record flag; the allowlist is answered below.
    isAdmin: record.isAdmin === true || isAdminEmail(record.email),
    paidAt: record.paidAt ?? null,
    createdAt: record.createdAt,
    status: String(record.status),
    deviceId: record.deviceId ?? null,
    reactivationEnabled: record.reactivationEnabled === true || isAdminEmail(record.email),
    displayName: record.displayName ?? "",
    firstName: record.firstName ?? "",
  };
}

/** Admin-only actions answer 403 unless the caller names an admin email. */
function requireAdmin(request: ApiRequest): string | null {
  return adminFromRequest(request);
}

async function countAdminsFor(): Promise<number> {
  return countAdmins();
}

/** Does this email hold a licence key in the KV licence store? */
async function holdsLicenceKey(email: string): Promise<boolean> {
  const keys = await kvCommand(["SMEMBERS", `${LICENCE_BY_CLIENT}${email}`]);
  if (!Array.isArray(keys) || keys.length === 0) return false;
  for (const key of keys.slice(0, 200)) {
    if (typeof key !== "string") continue;
    const raw = await kvCommand(["HGET", LICENCE_HASH, key]);
    if (typeof raw !== "string") continue;
    try {
      const record = JSON.parse(raw) as { claimedBy?: unknown; clientEmail?: unknown };
      if (normalizeEmail(record.claimedBy) === email) return true;
    } catch {
      /* a corrupted record is not proof */
    }
  }
  return false;
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!storeConfigured()) {
    response.status(503).json({ ok: false, unavailable: true, error: "Account storage is not configured — try again" });
    return;
  }

  const body = parseBody(request);
  const action = String(body["action"] ?? "") as Action;
  if (!ACTIONS.includes(action)) {
    response.status(400).json({ ok: false, error: "Unknown action" });
    return;
  }
  const email = normalizeEmail(body["email"]);

  try {
    switch (action) {
      case "profile": {
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        const record = await getRegistration(email);
        response.status(200).json({ ok: true, profile: record ? toProfile(record) : null });
        return;
      }
      case "list": {
        if (!requireAdmin(request)) {
          response.status(403).json({ ok: false, error: "Admin access required" });
          return;
        }
        const users: PublicRegistration[] = await listRegistrations();
        response.status(200).json({ ok: true, users });
        return;
      }
      case "set-paid": {
        if (!requireAdmin(request)) {
          response.status(403).json({ ok: false, error: "Admin access required" });
          return;
        }
        const result = await setPaidStatus(email, body["value"] === true);
        response.status(result.ok ? 200 : 404).json({
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
          ...(result.record ? { profile: toProfile(result.record) } : {}),
        });
        return;
      }
      case "set-admin": {
        if (!requireAdmin(request)) {
          response.status(403).json({ ok: false, error: "Admin access required" });
          return;
        }
        const result = await setAdminFlag(email, body["value"] === true);
        response.status(result.ok ? 200 : 404).json(result.ok ? { ok: true } : { ok: false, error: result.error });
        return;
      }
      case "count-admins": {
        response.status(200).json({ ok: true, count: await countAdminsFor() });
        return;
      }
      case "reactivation-flag": {
        const wantsWrite = typeof body["value"] === "boolean";
        if (wantsWrite) {
          if (!requireAdmin(request)) {
            response.status(403).json({ ok: false, error: "Admin access required" });
            return;
          }
          const result = await setReactivationFlag(email, body["value"] === true);
          response.status(result.ok ? 200 : 404).json(result.ok ? { ok: true } : { ok: false, error: result.error });
          return;
        }
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        const record = await getRegistration(email);
        // ADMINS ARE ALWAYS UNLOCKED — a store hiccup must never re-lock the owner.
        const enabled = isAdminEmail(email) || record?.reactivationEnabled === true;
        response.status(200).json({ ok: true, enabled });
        return;
      }
      case "record-name": {
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        const label = String(body["name"] ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
        if (!label) {
          response.status(400).json({ ok: false, error: "name is required" });
          return;
        }
        const record = await getRegistration(email);
        if (!record) {
          response.status(404).json({ ok: false, error: "That email is not registered" });
          return;
        }
        // FIRST WRITE WINS — a name is never rewritten by a later sign-in.
        if (record.displayName?.trim()) {
          response.status(200).json({ ok: true, kept: true });
          return;
        }
        await saveRegistration({ ...record, displayName: label });
        response.status(200).json({ ok: true });
        return;
      }
      case "has-license": {
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        response.status(200).json({ ok: true, hasKey: await holdsLicenceKey(email) });
        return;
      }
      case "binding": {
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        const record = await getRegistration(email);
        response.status(200).json({
          ok: true,
          binding: { deviceEmail: record?.deviceId ? email : null, deviceId: record?.deviceId ?? null },
        });
        return;
      }
      case "bind-device": {
        const deviceId = String(body["deviceId"] ?? "").trim();
        if (!email || !deviceId) {
          response.status(400).json({ ok: false, error: "email and deviceId are required" });
          return;
        }
        const record = await getRegistration(email);
        if (!record) {
          response.status(404).json({
            ok: false,
            error: "Not bound — this is not a registered email. Sign in with the email you registered with.",
          });
          return;
        }
        const bound = record.deviceId ?? null;
        if (bound === deviceId) {
          response.status(200).json({ ok: true, alreadyBound: true });
          return;
        }
        if (bound) {
          // ONE EMAIL, ONE DEVICE — never steal the binding from sign-in.
          response.status(409).json({
            ok: false,
            boundToOtherDevice: true,
            error: "Account already used — Contact admin for reactivation",
          });
          return;
        }
        await saveRegistration({ ...record, deviceId });
        response.status(200).json({ ok: true });
        return;
      }
      case "reactivate": {
        const requester = requireAdmin(request);
        if (!requester) {
          // A mentor may release clients only when an admin unlocked them.
          const caller = normalizeEmail(body["requester"]);
          const callerRecord = caller ? await getRegistration(caller) : null;
          const unlocked = isAdminEmail(caller) || callerRecord?.reactivationEnabled === true;
          if (!unlocked) {
            response.status(403).json({ ok: false, error: "Reactivation is locked for this account" });
            return;
          }
        }
        if (!email) {
          response.status(400).json({ ok: false, error: "email is required" });
          return;
        }
        const record = await getRegistration(email);
        if (!record) {
          response.status(404).json({ ok: false, error: "That email is not registered." });
          return;
        }
        // PAID ONLY — reactivation releases a device, it does not grant access.
        if (!(record.isPaid === true && record.paidAt)) {
          response.status(409).json({
            ok: false,
            error: "Not reactivated — this email is registered but not marked paid in KV store.",
          });
          return;
        }
        const cleared = await clearDeviceBinding(email);
        if (!cleared.ok) {
          response.status(500).json({ ok: false, error: cleared.error ?? "The device binding could not be cleared" });
          return;
        }
        console.info(
          `[reactivate] store=kv email=${email} requester=${requester ?? normalizeEmail(body["requester"])} ` +
            `cleared=yes paidAt=${record.paidAt} deviceWas=${record.deviceId ?? "none"}`,
        );
        response.status(200).json({
          ok: true,
          clearedAt: cleared.clearedAt,
          // Proof the payment side survived the unbind, for the console and the logs.
          stillPaid: cleared.record?.isPaid === true,
        });
        return;
      }
      case "claim-key": {
        const key = String(body["key"] ?? "").trim().toUpperCase();
        if (!email || !key) {
          response.status(400).json({ ok: false, error: "key and email are required" });
          return;
        }
        const outcome = await claimLicenceKeyForEmail(key, email);
        response.status(200).json({
          ok: outcome.ok,
          ...(outcome.alreadyInUse ? { alreadyInUse: true } : {}),
          ...(outcome.heldBy ? { heldBy: outcome.heldBy } : {}),
          ...(outcome.error ? { error: outcome.error } : {}),
        });
        return;
      }
      default:
        response.status(400).json({ ok: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("[account]", action, error);
    response.status(503).json({
      ok: false,
      unavailable: true,
      error: "Account storage is unreachable — try again",
    });
  }
}
