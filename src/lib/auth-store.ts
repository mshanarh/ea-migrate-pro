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
  licenseLimit: 0,
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
  licenseLimit: 0,
  licenses: [],
  eas: [],
};

const OWNER_EMAILS = ["biyasentobeko222@gmail.com", "biyasentobeko222@gmail", "lwethunkandi3@gmail.com"];

export const PAYMENT_EXEMPT_EMAILS = [
  "lwethunkandi3@gmail.com",
  "biyasentobeko222@gmail",
  "biyasentobeko222@gmail.com",
];

function cleanEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isPaymentExemptEmail(email: string) {
  return PAYMENT_EXEMPT_EMAILS.includes(cleanEmail(email));
}

export function paymentStatusForEmail(email: string): PaymentStatus {
  load();
  const clean = cleanEmail(email);
  if (isPaymentExemptEmail(clean)) return "admin";
  return state.payments.some((payment) => payment.email === clean && payment.paid) ? "paid" : "unpaid";
}

export function markEmailPaid(email: string) {
  load();
  const clean = cleanEmail(email);
  if (!clean || isPaymentExemptEmail(clean)) return;
  const existing = state.payments.find((payment) => payment.email === clean);
  if (existing?.paid) return;
  state = {
    ...state,
    payments: [...state.payments.filter((payment) => payment.email !== clean), { email: clean, paid: true, paidAt: new Date().toISOString() }],
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
    return { error: "This email is already activated on another device." };
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
    return OWNER_EMAILS.includes(a.email.trim().toLowerCase())
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
    window.localStorage.setItem(KEY, JSON.stringify(state));
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
  const cleanEmail = email.trim().toLowerCase();
  const account = state.accounts.find((a) => a.email.toLowerCase() === cleanEmail);
  if (!account || account.password !== password) return { error: "Wrong email or password." };
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

export function signOut() {
  load();
  state = { ...state, currentId: null };
  persist();
}

export function register(
  data: Omit<Account, "id" | "role" | "status" | "createdAt" | "licenseLimit" | "licenses" | "eas" | "website">,
): { error?: string } {
  load();
  if (state.accounts.some((a) => a.email.toLowerCase() === data.email.trim().toLowerCase())) {
    return { error: "That email is already registered." };
  }
  const account: Account = {
    ...data,
    email: data.email.trim().toLowerCase(),
    id: "m-" + Date.now(),
    role: "mentor",
    status: "pending",
    createdAt: new Date().toISOString(),
    licenseLimit: 0,
    licenses: [],
    eas: [],
  };
  state = normalise({ ...state, accounts: [...state.accounts, account], currentId: account.id });
  persist();
  return {};
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
): { error?: string } {
  load();
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return { error: "Mentor account not found." };
  if (!details.eaId) return { error: "Choose an Expert Advisor." };
  if (account.licenseLimit <= 0) {
    return { error: "The admin has not set a license limit for this account yet." };
  }
  if (account.licenses.length >= account.licenseLimit) {
    return { error: "This account has reached its license limit." };
  }

  update(id, (a) => ({
    ...a,
    licenses: [
      ...a.licenses,
      {
        id: "l-" + Date.now(),
        key,
        plan,
        issuedAt: new Date().toISOString(),
        active: true,
        ...details,
        eaId: details.eaId,
        eaNameHash: details.eaNameHash,
        expiresAt: details.expiry && details.expiry !== "Lifetime" ? new Date(Date.now() + ({ "3 Days": 3, "3 Months": 90, "6 Months": 180, "9 Months": 270, "1 Year": 365 }[details.expiry] ?? 0) * 86400000).toISOString() : undefined,
      },
    ],
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

export function generateKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return "EMP-" + suffix;
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
