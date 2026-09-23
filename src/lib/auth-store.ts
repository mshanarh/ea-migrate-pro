import { useSyncExternalStore } from "react";

export type PortalStatus = "pending" | "approved" | "rejected";

export type PaymentRecord = {
  email: string;
  paid: boolean;
  paidAt?: string | undefined;
};

export type DeviceBinding = {
  email: string;
  deviceId: string;
  boundAt: string;
};

export type PaymentStatus = "paid" | "unpaid" | "admin";

export type License = {
  id: string;
  key: string;
  plan: string;
  issuedAt: string;
  active: boolean;
  name?: string | undefined;
  robotName?: string | undefined;
  clientEmail?: string | undefined;
  expertAdvisor?: string | undefined;
  eaId?: string | undefined;
  eaNameHash?: string | undefined;
  briefing?: string | undefined;
  symbols?: string[] | undefined;
  image?: string | undefined;
  video?: string | undefined;
  expiry?: string | undefined;
  expiresAt?: string | undefined;
};

export type MentorWebsite = {
  eaId: string;
  robotName: string;
  tagline: string;
  theme: string;
  currency: string;
  androidPrice: string;
  androidLink: string;
  iosPrice: string;
  iosLink: string;
  pcPrice: string;
  pcLink: string;
  description: string;
  whatsapp: string;
  resultImages: string[];
  botImage?: string;
  updatedAt?: string;
};

export type ExpertAdvisor = {
  id: string;
  name: string;
  version?: string;
  createdAt: string;
  eaNameHash?: string | undefined;
  briefing?: string | undefined;
  symbols?: string[] | undefined;
  image?: string | undefined;
  video?: string | undefined;
};

export type Account = {
  id: string;
  firstName: string;
  displayName: string;
  email: string;
  username: string;
  password: string;
  whatsapp: string;
  role: "mentor" | "admin";
  status: PortalStatus;
  createdAt: string;
  licenseLimit: number;
  licenses: License[];
  eas: ExpertAdvisor[];
  website?: MentorWebsite;
};

type Store = {
  accounts: Account[];
  currentId: string | null;
  payments: PaymentRecord[];
  deviceBindings: DeviceBinding[];
};

const KEY = "eamp.store.v1";

const seedAdmin: Account = {
  id: "admin",
  firstName: "Platform",
  displayName: "EA Migrate Admin",
  email: "admin@eamigrate.pro",
  username: "admin",
  password: "admin123",
  whatsapp: "",
  role: "admin",
  status: "approved",
  createdAt: new Date().toISOString(),
   licenseLimit: 2000,
  licenses: [],
  eas: [],
};

const seedMentor: Account = {
  id: "mentor-demo",
  firstName: "Skuva",
  displayName: "Skuva FX",
  email: "mentor@example.com",
  username: "skuva",
  password: "mentor123",
  whatsapp: "+27 71 234 5678",
  role: "mentor",
  status: "pending",
  createdAt: new Date().toISOString(),
   licenseLimit: 2000,
  licenses: [],
  eas: [],
};

/** Platform owner accounts — admins by definition, on every device. */
export const OWNER_EMAILS = ["biyasentobeko222@gmail.com", "biyasentobeko222@gmail", "admin@eamigrate.pro"];

/**
 * Emails forced to the normal-mentor role EVERYWHERE (server responses and
 * every device's local store), no matter what any record says. The platform
 * owner strips admin status from an email by adding it here.
 */
export const MENTOR_ONLY_EMAILS = ["ntobekotraders.official@gmail.com"];

export const PAYMENT_EXEMPT_EMAILS = ["biyasentobeko222@gmail", "biyasentobeko222@gmail.com"];

/**
 * Emails that lost their platform privileges: they must ALWAYS go through
 * payment, even when a device still holds a stale paid/admin record for them.
 */
export const REVOKED_PAYMENT_EMAILS = ["lwethunkandi3@gmail.com"];

function cleanEmail(email: string) {
  return email.trim().toLowerCase();
}

function isRevokedEmail(email: string) {
  return REVOKED_PAYMENT_EMAILS.includes(cleanEmail(email));
}

export function isPaymentExemptEmail(email: string) {
  return PAYMENT_EXEMPT_EMAILS.includes(cleanEmail(email));
}

export function paymentStatusForEmail(email: string): PaymentStatus {
  load();
  const clean = cleanEmail(email);
  // Revoked emails always require payment — stale records cannot help them.
  if (isRevokedEmail(clean)) return "unpaid";
  if (isPaymentExemptEmail(clean)) return "admin";
  return state.payments.some((payment) => payment.email === clean && payment.paid) ? "paid" : "unpaid";
}

export function markEmailPaid(email: string) {
  load();
  const clean = cleanEmail(email);
  if (!clean || isRevokedEmail(clean) || isPaymentExemptEmail(clean)) return;
  const existing = state.payments.find((payment) => payment.email === clean);
  if (existing?.paid) return;
  state = {
    ...state,
    payments: [...state.payments.filter((payment) => payment.email !== clean), { email: clean, paid: true, paidAt: new Date().toISOString() }],
  };
  persist();
}

export function setEmailPaymentStatus(email: string, paid: boolean) {
  load();
  const clean = cleanEmail(email);
  if (!clean || isRevokedEmail(clean) || isPaymentExemptEmail(clean)) return;
  const rest = state.payments.filter((payment) => payment.email !== clean);
  state = {
    ...state,
    payments: paid ? [...rest, { email: clean, paid: true, paidAt: new Date().toISOString() }] : [...rest, { email: clean, paid: false }],
  };
  persist();
}

export function getEmailDeviceBinding(email: string) {
  load();
  return state.deviceBindings.find((binding) => binding.email === cleanEmail(email));
}

export function bindEmailToDevice(email: string, deviceId: string): { error?: string } {
  load();
  const clean = cleanEmail(email);
  const existing = state.deviceBindings.find((binding) => binding.email === clean);
  if (existing && existing.deviceId !== deviceId) {
    return { error: "Account already used — this email is linked to another device. One email, one device." };
  }
  if (!existing) {
    state = { ...state, deviceBindings: [...state.deviceBindings, { email: clean, deviceId, boundAt: new Date().toISOString() }] };
    persist();
  }
  return {};
}

export function hashEaName(name: string) {
  let hash = 2166136261;
  for (const character of name.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function maskEaId(eaId: string) {
  const suffix = eaId.replace(/[^a-z0-9]/gi, "").slice(-4).toLowerCase().padStart(4, "0");
  return "Private EA #" + suffix;
}

export function createEaRecord(name: string): ExpertAdvisor {
  const cleanName = name.trim();
  return {
    id: "ea-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: cleanName,
    eaNameHash: hashEaName(cleanName),
    createdAt: new Date().toISOString(),
  };
}


function normalise(store: Store): Store {
  const accounts = (Array.isArray(store.accounts) ? store.accounts : []).map((a) => {
    const account = {
      ...a,
      licenseLimit:
        typeof a.licenseLimit === "number" && Number.isFinite(a.licenseLimit)
          ? Math.max(0, Math.floor(a.licenseLimit))
          : 0,
      licenses: Array.isArray(a.licenses) ? a.licenses : [],
      eas: (Array.isArray(a.eas) ? a.eas : []).map((ea) => ({ id: ea.id, name: ea.name, eaNameHash: ea.eaNameHash || hashEaName(ea.name), briefing: ea.briefing, symbols: ea.symbols, createdAt: ea.createdAt, ...(ea.image ? { image: ea.image } : {}), ...(ea.video ? { video: ea.video } : {}) })),
    };
    const email = a.email.trim().toLowerCase();
    if (REVOKED_PAYMENT_EMAILS.includes(email) || MENTOR_ONLY_EMAILS.includes(email))
      return { ...account, role: "mentor" as const };
    return OWNER_EMAILS.includes(email)
      ? { ...account, role: "admin" as const, status: "approved" as const }
      : account;
  });

  const payments = (Array.isArray(store.payments) ? store.payments : [])
    .filter((payment) => typeof payment?.email === "string")
    .map((payment) => ({ email: payment.email.trim().toLowerCase(), paid: payment.paid === true, paidAt: payment.paidAt }));
  const deviceBindings = (Array.isArray(store.deviceBindings) ? store.deviceBindings : [])
    .filter((binding) => typeof binding?.email === "string" && typeof binding?.deviceId === "string")
    .map((binding) => ({ email: binding.email.trim().toLowerCase(), deviceId: binding.deviceId, boundAt: binding.boundAt || new Date().toISOString() }));
  return { ...store, accounts, currentId: store.currentId ?? null, payments, deviceBindings };
}

let state: Store = { accounts: [seedAdmin, seedMentor], currentId: null, payments: [], deviceBindings: [] };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = normalise(JSON.parse(raw) as Store);
  } catch {
    /* ignore */
  }
}


function persist() {
  if (typeof window !== "undefined") {
    // A blocked/evicted storage must never crash the click that made the
    // change — in-memory state still wins for this session.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot: Store = { accounts: [], currentId: null, payments: [], deviceBindings: [] };

function getSnapshot() {
  load();
  return state;
}

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

export function useCurrentAccount() {
  const s = useStore();
  return s.accounts.find((a) => a.id === s.currentId) ?? null;
}

export function signIn(email: string, password: string): { error?: string; accountId?: string; role?: Account["role"] } {
  load();
  // Normalise inputs exactly like they are stored at registration.
  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = password.trim();
  console.log("[sign-in] Trying login:", cleanEmail);
  const account = state.accounts.find((a) => a.email.toLowerCase() === cleanEmail);
  if (!account || account.password !== cleanPass) {
    console.log("[sign-in] Login error: wrong email or password for", cleanEmail);
    return { error: "Wrong email or password. Check the email you registered with and try again." };
  }
  console.log("[sign-in] Login success:", account.id);
  state = { ...state, currentId: account.id };
  persist();
  return { accountId: account.id, role: account.role };
}

export function resetPassword(email: string, password: string): { error?: string } {
  load();
  const cleanEmail = email.trim().toLowerCase();
  const account = state.accounts.find((a) => a.email.toLowerCase() === cleanEmail);
  if (!account) return { error: "No account was found with that email address." };
  if (password.trim().length < 8) return { error: "Your new password must be at least 8 characters." };
  update(account.id, (a) => ({ ...a, password: password.trim() }));
  return {};
}

/**
 * Merge cloud-verified accounts into this device's local store (passwords are
 * already stripped by the server layer). Used by the cross-device sign-in
 * fallback so a user can sign in on a new phone/browser.
 */
export function hydrateFromCloud(accounts: Array<Omit<Account, "password">>) {
  load();
  let changed = false;
  const existing = new Map(state.accounts.map((account) => [account.email.toLowerCase(), account]));
  for (const cloud of accounts) {
    const key = cloud.email.toLowerCase();
    const known = existing.get(key);
    if (known) {
      // Keep the local password (it IS the real password locally) AND the local
      // EAs: locally created/edited EAs carry the mentor's latest videos, while
      // the cloud copy can be stale (saved once at registration). Merging keeps
      // every EA that exists on either side, local fields winning per EA.
      const mergedEas = mergeEas(known.eas, cloud.eas);
      const easChanged = mergedEas.length !== known.eas.length || mergedEas.some((ea, index) => ea !== known.eas[index]);
      // Status reconciliation: a cloud "pending" must NEVER overwrite an admin
      // decision (approved/rejected) held locally. This exact clobber made
      // approved users reappear as pending after the admin re-logged in when
      // the approval's cloud write had failed. Any other cloud status
      // (approved/rejected) propagates across devices as the shared truth.
      const status =
        cloud.status === "pending" && known.status !== "pending" ? known.status : cloud.status;
      // Admin-set license data must survive the poll too: the previous spread
      // let a stale cloud copy overwrite a locally saved license limit and
      // resurrect removed keys, so "save" appeared to undo itself.
      const licensesById = new Map(known.licenses.map((license) => [license.id, license]));
      let licensesChanged = false;
      for (const license of cloud.licenses) {
        if (!licensesById.has(license.id)) {
          licensesById.set(license.id, license);
          licensesChanged = true;
        }
      }
      const licenseLimit = known.licenseLimit > 0 ? known.licenseLimit : cloud.licenseLimit;
      existing.set(key, {
        ...known,
        ...cloud,
        // The owner is ALWAYS an admin locally — a stale cloud copy must never
        // demote them (this is what made owner sign-ins land on a pending
        // mentor portal instead of the admin console).
        role: OWNER_EMAILS.includes(cloud.email.toLowerCase()) ? "admin" : cloud.role,
        status,
        password: known.password,
        eas: mergedEas,
        licenseLimit,
        licenses: Array.from(licensesById.values()),
      });
      if (
        easChanged ||
        mergedEas.length !== cloud.eas.length ||
        status !== known.status ||
        licensesChanged ||
        licenseLimit !== known.licenseLimit
      )
        changed = true;
    } else if (cloud.role === "admin") {
      // Admin records DO hydrate now: the platform owner can sign in on any
      // device directly into the admin console. normalise() re-asserts the
      // owner's admin role, and a removed admin cannot be reintroduced by
      // this path because the server layer strips them before returning.
      existing.set(key, { ...cloud, password: "" } as Account);
      changed = true;
    } else {
      existing.set(key, { ...cloud, password: "" } as Account);
      changed = true;
    }
  }
  if (!changed) return;
  state = normalise({ ...state, accounts: Array.from(existing.values()) });
  persist();
}

/** Union merge keyed by EA id — local records win per-EA, cloud-only EAs added. */
function mergeEas(local: ExpertAdvisor[], cloud: ExpertAdvisor[]): ExpertAdvisor[] {
  const byId = new Map(cloud.map((ea) => [ea.id, ea]));
  for (const ea of local) byId.set(ea.id, ea);
  return Array.from(byId.values());
}

/** Marks an account as the signed-in user (used by the cloud sign-in fallback). */
export function setCurrentAccount(email: string) {
  load();
  const account = state.accounts.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
  if (!account) return;
  state = { ...state, currentId: account.id };
  persist();
}

export function signOut() {
  load();
  state = { ...state, currentId: null };
  persist();
}

/**
 * After a successful CLOUD sign-in, adopt the just-verified password into
 * this device's local record. Without this, a device holding a stale
 * password fails local sign-in first on every visit and always needs the
 * cloud fallback (the record even kept a dead password after the account
 * was healed in the shared store).
 */
export function adoptCloudPassword(email: string, password: string) {
  load();
  const clean = email.trim().toLowerCase();
  const account = state.accounts.find((a) => a.email.toLowerCase() === clean);
  if (!account || account.password === password) return;
  update(account.id, (a) => ({ ...a, password }));
}

export function register(
  data: Omit<Account, "id" | "role" | "status" | "createdAt" | "licenseLimit" | "licenses" | "eas" | "website">,
): { error?: string; account?: Account } {
  load();
  const email = data.email.trim().toLowerCase();
  if (state.accounts.some((a) => a.email.toLowerCase() === email)) {
    return { error: "That email is already registered." };
  }
  // Platform owners are admins the moment they sign up — no pending gate,
  // no admin approval loop, on any device.
  const isOwner = OWNER_EMAILS.includes(email);
  const account: Account = {
    ...data,
    email,
    id: "m-" + Date.now(),
    role: isOwner ? "admin" : "mentor",
    status: isOwner ? "approved" : "pending",
    createdAt: new Date().toISOString(),
    licenseLimit: isOwner ? 2000 : 0,
    licenses: [],
    eas: [],
  };
  state = normalise({ ...state, accounts: [...state.accounts, account], currentId: account.id });
  persist();
  return { account };
}

function update(id: string, fn: (a: Account) => Account) {
  load();
  state = {
    ...state,
    accounts: state.accounts.map((a) => (a.id === id ? fn(a) : a)),
  };
  persist();
}

export function setStatus(id: string, status: PortalStatus) {
  update(id, (a) => ({ ...a, status }));
}

export function addLicense(
  id: string,
  plan: string,
  key: string,
  details: Partial<Omit<License, "id" | "key" | "plan" | "issuedAt" | "active">> = {},
  /** The admin panel issues keys by its own authority — limit does not block it. */
  opts: { bypassLimit?: boolean } = {},
): { error?: string; license?: License } {
  load();
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return { error: "Mentor account not found." };
  if (!details.eaId) return { error: "Choose an Expert Advisor." };
  if (!opts.bypassLimit) {
    if (account.licenseLimit <= 0) {
      return { error: "The admin has not set a license limit for this account yet." };
    }
    if (account.licenses.length >= account.licenseLimit) {
      return { error: "This account has reached its license limit." };
    }
  }
  const linkedEa = account.eas.find((ea) => ea.id === details.eaId);
  const robotName = linkedEa?.name.trim() || details.expertAdvisor?.trim() || details.name?.trim() || "Private EA";

  const license: License = {
    id: "l-" + Date.now(),
    key,
    plan,
    issuedAt: new Date().toISOString(),
    active: true,
    ...details,
    robotName,
    expertAdvisor: robotName,
    eaId: details.eaId,
    eaNameHash: details.eaNameHash,
    expiresAt: details.expiry && details.expiry !== "Lifetime" ? new Date(Date.now() + ({ "1 Week": 7, "1 Month": 30, "3 Months": 90, "6 Months": 180, "1 Year": 365 }[details.expiry] ?? 0) * 86400000).toISOString() : undefined,
  };

  update(id, (a) => ({
    ...a,
    licenses: [...a.licenses, license],
  }));
  return { license };
}

export function renameEa(accountId: string, eaId: string, patch: { briefing?: string; symbols?: string[]; image?: string; video?: string }): { error?: string } {
  load();
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return { error: "Mentor account not found." };
  update(accountId, (a) => ({
    ...a,
    eas: a.eas.map((ea) => ea.id === eaId ? { ...ea, ...patch } : ea),
  }));
  return {};
}

export function setEAs(id: string, eas: ExpertAdvisor[]) {
  update(id, (a) => ({ ...a, eas: eas.map((ea) => ({ id: ea.id, name: ea.name.trim(), eaNameHash: ea.eaNameHash || hashEaName(ea.name), briefing: ea.briefing, symbols: ea.symbols, createdAt: ea.createdAt, ...(ea.image ? { image: ea.image } : {}), ...(ea.video ? { video: ea.video } : {}) })) }));
}

export function saveWebsite(id: string, website: MentorWebsite) {
  update(id, (a) => ({ ...a, website }));
}

export function setLicenseLimit(id: string, limit: number) {
  update(id, (a) => ({ ...a, licenseLimit: Math.max(0, Math.floor(limit)) }));
}

export function toggleLicense(accountId: string, licenseId: string) {
  update(accountId, (a) => ({
    ...a,
    licenses: a.licenses.map((l) => (l.id === licenseId ? { ...l, active: !l.active } : l)),
  }));
}

export function removeLicense(accountId: string, licenseId: string) {
  update(accountId, (a) => ({
    ...a,
    licenses: a.licenses.filter((l) => l.id !== licenseId),
  }));
}

/** EMP-prefixed key — EMP-XXXX-XXXX-XXXX (three random groups). */
export function generateKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups: string[] = ["EMP"];
  for (let group = 0; group < 3; group += 1) {
    let chunk = "";
    for (let index = 0; index < 4; index += 1) {
      chunk += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    groups.push(chunk);
  }
  return groups.join("-");
}

export function validateLicense(key: string, eaId: string, clientEmail?: string): { valid: boolean; error?: string; license?: License } {
  load();
  const cleanKey = key.trim().toUpperCase();
  const license = state.accounts.flatMap((account) => account.licenses).find((item) => item.key === cleanKey);
  if (!license) return { valid: false, error: "License key not found." };
  if (!license.active) return { valid: false, error: "License is inactive." };
  if (license.eaId !== eaId) return { valid: false, error: "License is not linked to this EA." };
  if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) return { valid: false, error: "License has expired." };
  if (clientEmail && license.clientEmail && license.clientEmail.toLowerCase() !== clientEmail.trim().toLowerCase()) return { valid: false, error: "License email does not match." };
  return { valid: true, license };
}

export function updateProfile(id: string, patch: Partial<Account>) {
  update(id, (a) => ({ ...a, ...patch }));
}
