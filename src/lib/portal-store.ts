/**
 * THE PORTAL STORE — the app's only account/payment/licence/device API.
 *
 * Upstash KV is the single store (KV_REST_API_URL / KV_REST_API_TOKEN, read
 * server-side only). Nothing in this file talks to a database directly: every
 * call is one POST to /api/account or /api/check-access, and every write is
 * field-scoped on the server. That is what keeps the token out of the browser
 * and keeps a device bind from ever touching a payment flag.
 *
 * THE ONE RULE, unchanged everywhere in the app:
 *   • the store is reachable and says paid  → pass
 *   • the store is UNREACHABLE              → "try again" (retryable)
 *   • only a reachable store that actually answers "no" may say unpaid
 *
 * There is no second store to fall back to any more, so an unreadable store can
 * never be mistaken for an unpaid account — it answers `unavailable: true` and
 * the screens show a retry line instead of the plan chooser.
 */
import { OWNER_EMAILS, isPaymentExemptEmail } from "./auth-store";

/** A KV account record, in the shape the app's screens already expect. */
export type UserRow = {
  id: string;
  email: string;
  is_paid: boolean;
  is_admin: boolean;
  created_at: string;
};

export type HostRobotKey = {
  key_code: string;
  ea_id: string | null;
  mentor_id: string | null;
  is_used: boolean;
  used_by_email: string | null;
  created_at: string;
};

export type UserSessionRow = {
  id: string;
  email: string;
  license_key: string | null;
  created_at: string;
};

/** True: the store is server-side, so the browser is always able to ask it. */
export const portalStoreConfigured = true;

export type RegistrationOutcome = "allow" | "checkout";

export type RegistrationResult = {
  outcome: RegistrationOutcome;
  user: UserRow | null;
  verified: boolean;
  error?: string;
  /** The store could NOT decide (unreachable). Not an unpaid verdict. */
  unavailable?: boolean;
  /**
   * WHAT THE STORE ANSWERED, for the sign-in diagnostic line. One entry now —
   * KV — so a refusal can print the real cause instead of "one source was
   * unreachable".
   */
  stores?: Record<string, string>;
  unreadable?: string[];
};

export type ServerDeviceBinding = { deviceEmail: string | null; deviceId: string | null } | null;

export type AccessServerAnswer = {
  ok: boolean;
  isPaid: boolean;
  status: "admin" | "paid" | "revoked" | "rejected" | "unpaid" | "undecided";
  paidAt?: string;
  deviceBinding?: ServerDeviceBinding;
  deviceMatches?: boolean;
  unavailable?: boolean;
  detail?: string;
};

export type DeviceBindingCheck = { boundToOtherDevice: boolean; error?: string; unavailable?: boolean };

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

function clean(email: string): string {
  return email.trim().toLowerCase();
}

/** The signed-in account's email — the `x-admin-email` header's value. */
function currentEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("eamp.store.v1");
    if (!raw) return "";
    const store = JSON.parse(raw) as { accounts?: Array<{ email?: string; id?: string }>; currentId?: string | null };
    const account = (store.accounts ?? []).find((entry) => entry.id === store.currentId);
    return typeof account?.email === "string" ? clean(account.email) : "";
  } catch {
    return "";
  }
}

type AccountReply = {
  ok?: boolean;
  error?: string;
  unavailable?: boolean;
  profile?: AccountProfile | null;
  users?: Array<Record<string, unknown>>;
  count?: number;
  enabled?: boolean;
  hasKey?: boolean;
  binding?: ServerDeviceBinding;
  clearedAt?: string;
  stillPaid?: boolean;
  boundToOtherDevice?: boolean;
  alreadyInUse?: boolean;
  heldBy?: string;
  kept?: boolean;
};

async function callAccount(action: string, payload: Record<string, unknown> = {}): Promise<AccountReply> {
  try {
    const admin = currentEmail();
    const reply = await fetch("/api/account", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(admin ? { "x-admin-email": admin } : {}),
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await reply.json().catch(() => ({}))) as AccountReply;
    if (!reply.ok && !parsed.error) parsed.error = `HTTP ${reply.status}`;
    if (reply.status === 503) parsed.unavailable = true;
    return parsed;
  } catch (error) {
    return {
      ok: false,
      unavailable: true,
      error: `store unreachable (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

function toUserRow(profile: AccountProfile | null | undefined): UserRow | null {
  if (!profile) return null;
  return {
    id: profile.email,
    email: profile.email,
    is_paid: profile.isPaid === true,
    is_admin: profile.isAdmin === true,
    created_at: profile.createdAt,
  };
}

/**
 * THE SERVER'S ACCESS VERDICT — one POST, one answer (payment + binding).
 *
 * `ok: false` with `unavailable: true` means the store could not be read. The
 * caller must show a retry message; it must never fall through to "unpaid".
 */
export async function checkAccessServer(email: string, deviceId?: string): Promise<AccessServerAnswer> {
  const url = "/api/check-access";
  try {
    const reply = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deviceId ? { email, deviceId } : { email }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await reply.json().catch(() => ({}))) as {
      ok?: boolean;
      isPaid?: boolean;
      status?: string;
      paidAt?: string;
      deviceBinding?: unknown;
      deviceMatches?: unknown;
      unavailable?: boolean;
      error?: string;
    };
    if (payload.unavailable === true || reply.status === 503) {
      return {
        ok: false,
        isPaid: false,
        status: "undecided",
        unavailable: true,
        detail: `${url} → ${payload.error ?? `HTTP ${reply.status}`}`,
      };
    }
    if (!reply.ok || !payload.ok || payload.status == null) {
      return {
        ok: false,
        isPaid: false,
        status: "undecided",
        unavailable: true,
        detail: `${url} → ${payload.error ?? `HTTP ${reply.status}`}`,
      };
    }
    const status = payload.status as AccessServerAnswer["status"];
    const answer: AccessServerAnswer = {
      ok: true,
      isPaid: Boolean(payload.isPaid),
      status,
      paidAt: typeof payload.paidAt === "string" ? payload.paidAt : "",
    };
    if (payload.deviceBinding !== undefined) {
      const raw = payload.deviceBinding as { deviceEmail?: unknown; deviceId?: unknown } | null;
      answer.deviceBinding =
        raw === null
          ? null
          : {
              deviceEmail: typeof raw?.deviceEmail === "string" ? raw.deviceEmail : null,
              deviceId: typeof raw?.deviceId === "string" ? raw.deviceId : null,
            };
    }
    if (typeof payload.deviceMatches === "boolean") answer.deviceMatches = payload.deviceMatches;
    return answer;
  } catch (error) {
    return {
      ok: false,
      isPaid: false,
      status: "undecided",
      unavailable: true,
      detail: `${url} → no response (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`,
    };
  }
}

/**
 * THE SIGN-IN GATE, asked of one store.
 *
 * A positive answer is final. `unavailable` is a retry, not a refusal — the
 * login screen shows "please try again", never the plan chooser, when the store
 * could not be read. A reachable store that says unpaid is the only unpaid path.
 */
export async function registerWithEmail(email: string, _licenseKey?: string): Promise<RegistrationResult> {
  const address = clean(email);
  if (!address) return { outcome: "checkout", user: null, verified: false, error: "missing-email" };

  const access = await checkAccessServer(address);
  if (!access.ok || access.unavailable) {
    console.warn(`[access] ${address}: undecided — ${access.detail ?? "store unavailable"}`);
    return {
      outcome: "checkout",
      user: null,
      verified: false,
      unavailable: true,
      stores: { "KV registrations": "unreachable" },
      unreadable: [access.detail ?? "KV registrations → unreachable"],
      ...(access.detail ? { error: access.detail } : {}),
    };
  }
  if (access.isPaid) {
    const profile = await callAccount("profile", { email: address });
    return {
      outcome: "allow",
      user: toUserRow(profile.profile),
      verified: true,
      stores: { "KV registrations": access.status },
      unreadable: [],
    };
  }
  // A reachable store that answered "revoked" is a refusal, not a payment gap.
  if (access.status === "revoked" || access.status === "rejected") {
    return { outcome: "checkout", user: null, verified: false, error: `access-${access.status}` };
  }
  return { outcome: "checkout", user: null, verified: false };
}

/** Remember the name typed at sign-in (best effort, first write wins). */
export async function recordAppUserName(email: string, name: string): Promise<{ ok: boolean }> {
  const address = clean(email);
  if (!address || !name.trim()) return { ok: false };
  const reply = await callAccount("record-name", { email: address, name });
  return { ok: reply.ok === true };
}

/** One account record (null when the email has no KV record). */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const address = clean(email);
  if (!address) return null;
  const reply = await callAccount("profile", { email: address });
  return toUserRow(reply.profile);
}

/** The full KV profile, for screens that need paidAt / deviceId / flags. */
export async function getAccountProfile(email: string): Promise<AccountProfile | null> {
  const address = clean(email);
  if (!address) return null;
  const reply = await callAccount("profile", { email: address });
  return reply.profile ?? null;
}

/** Does this email hold a licence key in the KV licence store? */
export async function emailHasLicenseKey(email: string): Promise<boolean> {
  const address = clean(email);
  if (!address) return false;
  const reply = await callAccount("has-license", { email: address });
  return reply.ok === true && reply.hasKey === true;
}

/** Is this email marked paid? (Delegates to the one access decision.) */
export async function emailPaidInLedger(email: string): Promise<boolean> {
  const access = await checkAccessServer(clean(email));
  return access.ok && access.isPaid;
}

/**
 * CLAIM A LICENCE KEY + BIND THIS DEVICE.
 *
 * Both writes are server-side KV: the claim is the single-use lock and the bind
 * is the one-email-one-device rule. No payment flag is written here — a key
 * proves you hold it, it does not decide what you paid.
 */
export async function recordKeyActivationInCloud(
  key: string,
  email: string,
  deviceId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const address = clean(email);
  const cleanKey = key.trim().toUpperCase().replace(/\s+/g, "");
  if (!address || !cleanKey) return { ok: false, error: "Missing email or key." };

  const claim = await callAccount("claim-key", { key: cleanKey, email: address });
  if (!claim.ok && claim.alreadyInUse !== true) {
    return { ok: false, error: claim.error ?? "That license key is not valid for this email." };
  }
  if (claim.alreadyInUse === true && claim.heldBy && clean(claim.heldBy) !== address) {
    return { ok: false, error: "License key already in use by another account." };
  }
  if (deviceId) {
    const bind = await callAccount("bind-device", { email: address, deviceId });
    // A bind that is refused because another device holds the account is a real
    // answer; a store failure is not — report it as retryable.
    if (!bind.ok && bind.boundToOtherDevice !== true) {
      return { ok: false, error: bind.error ?? "The device could not be bound." };
    }
  }
  return { ok: true };
}

/* ── admin console ───────────────────────────────────────────────────── */

/** Every registration, newest first. */
export async function listUsersAnon(): Promise<{ users: UserRow[]; error?: string }> {
  const reply = await callAccount("list");
  if (!reply.ok || !Array.isArray(reply.users)) {
    return { users: [], error: reply.error ?? "Account storage is unavailable" };
  }
  const users = reply.users.map((row) => ({
    id: String(row["email"] ?? ""),
    email: String(row["email"] ?? ""),
    is_paid: row["isPaid"] === true,
    is_admin: row["isAdmin"] === true || OWNER_EMAILS.includes(String(row["email"] ?? "").toLowerCase()),
    created_at: String(row["createdAt"] ?? ""),
  }));
  return { users };
}

/** "Mark paid" / "Make admin" — one field each, admin-only server-side. */
export async function setUserFlagAnon(
  email: string,
  patch: { is_paid?: boolean; is_admin?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const address = clean(email);
  if (typeof patch.is_paid === "boolean") {
    const reply = await callAccount("set-paid", { email: address, value: patch.is_paid });
    if (!reply.ok) return { ok: false, error: reply.error ?? "The payment flag could not be written" };
  }
  if (typeof patch.is_admin === "boolean") {
    const reply = await callAccount("set-admin", { email: address, value: patch.is_admin });
    if (!reply.ok) return { ok: false, error: reply.error ?? "The admin flag could not be written" };
  }
  return { ok: true };
}

/** Mark paid, in the console's own words. */
export async function setEmailPaid(email: string, paid: boolean): Promise<{ ok: boolean; error?: string }> {
  return setUserFlagAnon(email, { is_paid: paid });
}

/** How many admins exist (owner bootstrap reads this). */
export async function countAdminsAnon(): Promise<number> {
  const reply = await callAccount("count-admins");
  return reply.ok === true && typeof reply.count === "number" ? reply.count : 0;
}

/* ── reactivation ────────────────────────────────────────────────────── */

/**
 * May this account release a client's device? Locked by default; admins and
 * owners are always unlocked. A store failure answers false here — this is the
 * MENTOR's lock, not a payment verdict, so failing closed locks a tool rather
 * than blocking a customer.
 */
export async function getReactivationEnabled(email: string): Promise<boolean> {
  const address = clean(email);
  if (OWNER_EMAILS.includes(address) || isPaymentExemptEmail(address)) return true;
  const reply = await callAccount("reactivation-flag", { email: address });
  return reply.ok === true && reply.enabled === true;
}

export async function setReactivationEnabled(
  email: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const reply = await callAccount("reactivation-flag", { email: clean(email), value: enabled });
  return reply.ok ? { ok: true } : { ok: false, error: reply.error ?? "The flag could not be written" };
}

/**
 * RELEASE A CLIENT'S DEVICE — server-side, KV only.
 *
 * Clears `deviceId` and NOTHING else: payment, `paidAt`, licence keys, expiry
 * and the subscription are untouched. The caller charges its reactivation token
 * ONLY when this answers ok, so a failed unbind costs the mentor nothing.
 */
export async function reactivateEmail(
  email: string,
): Promise<{ ok: boolean; error?: string; clearedAt?: string }> {
  const address = clean(email);
  if (!address) return { ok: false, error: "Missing email." };
  const reply = await callAccount("reactivate", { email: address, requester: currentEmail() });
  if (!reply.ok) {
    return {
      ok: false,
      error: reply.unavailable
        ? "Re-activation could not complete — the store was unreachable. Please try again."
        : (reply.error ?? "The device binding could not be cleared."),
    };
  }
  return { ok: true, ...(reply.clearedAt ? { clearedAt: reply.clearedAt } : {}) };
}

/* ── device binding ──────────────────────────────────────────────────── */

/** Read the KV binding for one email (null = unbound). */
export async function getDeviceBinding(
  email: string,
): Promise<{ deviceEmail: string | null; deviceId: string | null } | null> {
  const reply = await callAccount("binding", { email: clean(email) });
  if (!reply.ok) return null;
  return reply.binding ?? { deviceEmail: null, deviceId: null };
}

/** Is this email bound to a DIFFERENT device? Answered at sign-in. */
export async function checkDeviceBinding(email: string, localDeviceId: string): Promise<DeviceBindingCheck> {
  const binding = await getDeviceBinding(email);
  if (!binding || !binding.deviceId) return { boundToOtherDevice: false };
  return { boundToOtherDevice: binding.deviceId !== localDeviceId };
}

/**
 * BIND this device to the email (first activation).
 *
 *   • an unbound account binds to this device,
 *   • a record already bound to THIS device is a no-op,
 *   • a record bound to a DIFFERENT device is REFUSED — the message is the one
 *     the login screen recognises, so the user sees "Contact admin for
 *     reactivation" instead of being let in.
 *
 * Subscription, licence keys and payment state are untouched.
 */
export async function bindDeviceToEmail(
  email: string,
  localDeviceId: string,
): Promise<{ ok: boolean; error?: string; boundToOtherDevice?: boolean }> {
  const address = clean(email);
  if (!address || !localDeviceId) return { ok: false, error: "Missing email or device." };
  const reply = await callAccount("bind-device", { email: address, deviceId: localDeviceId });
  if (reply.ok) return { ok: true };
  if (reply.boundToOtherDevice) {
    return {
      ok: false,
      boundToOtherDevice: true,
      error: "Account already used — Contact admin for reactivation",
    };
  }
  return {
    ok: false,
    error: reply.unavailable
      ? "The device binding could not be read — please try again."
      : (reply.error ?? "The device could not be bound."),
  };
}

/** A stable local device id (the app's existing key). */
export function localDeviceId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "eamp.device.id";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(KEY, created);
    return created;
  } catch {
    return "";
  }
}
