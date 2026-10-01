import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Lock,
  LockOpen,
  LogOut,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_EXEMPT_EMAILS,
  addLicense,
  generateKey,
  paymentStatusForEmail,
  removeLicense,
  setEmailPaymentStatus,
  setLicenseLimit,
  setStatus,
  signOut,
  toggleLicense,
  useCurrentAccount,
  useStore,
  hydrateFromCloud,
  type Account,
} from "@/lib/auth-store";
import {
  syncAdminUpdate,
  syncListAccounts,
  syncSetPayment,
  type AdminPatch,
  type PublicAccount,
} from "@/lib/account-sync.server";
import { sendPortalEmail } from "@/lib/send-email";
import {
  portalAdminUpdate,
  portalListAccounts,
  portalSetPayment,
} from "@/lib/portal-cloud";
import { supabaseConfigured, type UserRow } from "@/lib/supabase";
import { getReactivationEnabled, listUsersAnon, setUserFlagAnon, setReactivationEnabled } from "@/lib/supabase-users";
import { portalCloudConfigured, portalDeleteLicenseKey, portalRemoveLicense } from "@/lib/portal-cloud";

/**
 * Server functions exist in dev but 404 on the static production build —
 * try the server call, fall back to the direct browser cloud client.
 */
async function withCloudFallback<T>(serverCall: () => Promise<T>, browserCall: () => Promise<T>): Promise<T> {
  try {
    return await serverCall();
  } catch {
    return browserCall();
  }
}

async function pushAdminUpdate(targetEmail: string, patch: AdminPatch) {
  return withCloudFallback(
    () => syncAdminUpdate({ data: { adminEmail: "", targetEmail, patch } }),
    () => portalAdminUpdate(targetEmail, patch),
  );
}

async function listCloudAccounts() {
  return withCloudFallback(() => syncListAccounts(), () => portalListAccounts());
}

async function setCloudPayment(email: string, paid: boolean) {
  return withCloudFallback(
    () => syncSetPayment({ data: { adminEmail: "", email, paid } }),
    () => portalSetPayment(email, paid),
  );
}

/**
 * Mark an email paid/unpaid IN THE CLOUD users table — not just localStorage.
 * The app's payment gate, the Re-activate Client page and the device-binding
 * rules all read users.is_paid; the console's Paid button used to write only
 * the browser store, so a "paid" user still had is_paid=false in the database
 * and reactivation refused them ("this email has not paid").
 */
async function setCloudUserPaid(email: string, paid: boolean): Promise<boolean> {
  const result = await setUserFlagAnon(email, { is_paid: paid });
  if (!result.ok && result.error) console.warn("[admin] users.is_paid write failed:", result.error);
  return result.ok;
}
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Console — EA Migrate" }] }),
  component: AdminConsole,
});

/** Local Account minus password — cloud records arrive without it. */
type AdminViewAccount = Omit<Account, "password">;

const STATUS_PILL: Record<string, string> = {
  approved: "bg-primary/15 text-primary",
  rejected: "bg-destructive/15 text-destructive",
  pending: "bg-secondary text-muted-foreground",
};

function AdminConsole() {
  const account = useCurrentAccount();
  const store = useStore();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  // Tabbed mentor list: the console opens on Pending so new sign-ups waiting
  // for approval are the first thing the admin sees.
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [limit, setLimit] = useState(0);
  // Registered APP users (the Supabase users table) — every /app/login
  // signup, distinct from the mentor portal accounts above.
  const [registered, setRegistered] = useState<UserRow[]>([]);
  const [registeredError, setRegisteredError] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [cloud, setCloud] = useState<{ enabled: boolean; accounts: PublicAccount[] }>({
    enabled: false,
    accounts: [],
  });

  // Hooks must run before any early return — merging local + cloud mentors.
  const mentors: AdminViewAccount[] = useMemo(() => {
    const known = new Set(store.accounts.map((candidate) => candidate.email.toLowerCase()));
    const cloudOnly = cloud.accounts.filter(
      (candidate) => !known.has(candidate.email.toLowerCase()) && candidate.role === "mentor",
    );
    return [...store.accounts.filter((candidate) => candidate.role === "mentor"), ...cloudOnly];
  }, [cloud.accounts, store.accounts]);

  useEffect(() => {
    if (!account) navigate({ to: "/signin" });
  }, [account, navigate]);

  // Self-heal: approvals saved on this device BEFORE the sync-reliability fix
  // may still read "pending" in the shared store. Re-push every local decision
  // that disagrees with the cloud copy — once the store accepts it, the poll
  // stops resurrecting the stale status.
  const healed = useRef(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    if (healed.current || !account || !cloud.enabled) return;
    if (cloud.accounts.length === 0) return; // wait for a real snapshot
    healed.current = true;
    for (const local of storeRef.current.accounts) {
      if (local.role !== "mentor") continue;
      const remote = cloud.accounts.find(
        (candidate) => candidate.email.toLowerCase() === local.email.toLowerCase(),
      );
      if (!remote) continue;
      const patches: AdminPatch[] = [];
      if (remote.status !== local.status) patches.push({ status: local.status });
      // License limits saved before the sync fix never reached the shared
      // store — re-push any disagreement so "save" stays saved.
      if (remote.licenseLimit !== local.licenseLimit) {
        patches.push({ licenseLimit: local.licenseLimit });
      }
      // Keys the admin created locally but that never landed in the cloud.
      const missing = local.licenses.filter((license) => !remote.licenses.some((candidate) => candidate.id === license.id));
      if (missing.length > 0) patches.push({ licenses: local.licenses, replaceLicenses: true });
      for (const patch of patches) {
        void pushAdminUpdate(local.email, patch);
      }
    }
  }, [account, cloud.enabled, cloud.accounts]);

  // Registered users load INDEPENDENTLY of the mentor poll — a hiccup in one
  // must never blank the other, and the last good snapshot always stays up.
  const loadRegistered = useCallback(async () => {
    try {
      const usersResult = await listUsersAnon();
      if (usersResult.users.length > 0 || registered.length > 0) {
        if (usersResult.users.length > 0) {
          setRegistered(usersResult.users);
          setRegisteredError(null);
        }
        // Empty response while holding a good snapshot → transient glitch,
        // keep showing what we have.
      } else if (usersResult.error) {
        setRegisteredError(usersResult.error);
      }
    } catch (error) {
      setRegisteredError((current) => current ?? (error instanceof Error ? error.message : "Could not reach the database"));
    }
  }, [registered.length]);

  // Poll the shared cloud store every 3s: a registration from ANY device
  // appears here within seconds. Cloud-only records are merged into the local
  // store so admin actions work on them immediately.
  const pollCloud = useCallback(async () => {
    void loadRegistered();
    try {
      const result = await listCloudAccounts();
      setCloud({ enabled: result.enabled, accounts: result.accounts });
      if (result.enabled && result.accounts.length > 0) hydrateFromCloud(result.accounts);
    } catch {
      /* transient network error — keep the last snapshot */
    }
  }, [loadRegistered]);

  useEffect(() => {
    void pollCloud();
    const timer = setInterval(() => void pollCloud(), 3000);
    return () => clearInterval(timer);
  }, [pollCloud]);

  const pushCloudUpdate = useCallback(
    (targetEmail: string, patch: AdminPatch) => {      if (!account) return;
      const fail = (reason?: string) =>
        toast.error(
          reason
            ? `Could not save ${targetEmail}: ${reason}`
            : `Could not save ${targetEmail} to the shared store — the change may be lost. Check your connection and try again.`,
        );
      void pushAdminUpdate(targetEmail, patch).then((result) => {
          if (result.enabled && !result.ok) fail(result.error);
        })
        .catch((error) => {
          console.error("[admin] cloud update failed:", error);
          fail();
        });
    },
    [account],
  );

  /** APPROVAL = APP ACCESS — Approve/Reject move the email between the
   * Pending/Approved/Rejected tabs AND Approve flips users.is_paid=true in
   * the cloud database, because the sign-in gate on the user's own device
   * reads that flag: without it an approved user was still bounced to Whop
   * checkout and could never sign in. Reject/Restore keep the payment flag
   * untouched (Paid/Unpaid stays a separate decision in the Payment section). */
  const readSet = (storageKey: string): Set<string> => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  };
  const APPROVED_KEY = "eamp.admin.approved.v1";
  const REJECTED_KEY = "eamp.admin.rejected.v1";
  const [approvedEmails, setApprovedEmails] = useState<Set<string>>(() => readSet(APPROVED_KEY));
  const [rejectedEmails, setRejectedEmails] = useState<Set<string>>(() => readSet(REJECTED_KEY));
  const [userTab, setUserTab] = useState<"pending" | "approved" | "rejected">("pending");

  const persistSet = (storageKey: string, next: Set<string>) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    } catch {
      /* private mode — the list just resets on reload */
    }
  };

  const approveRegistered = (user: UserRow) => {
    const nextApproved = new Set(approvedEmails);
    nextApproved.add(user.email);
    setApprovedEmails(nextApproved);
    persistSet(APPROVED_KEY, nextApproved);
    if (rejectedEmails.has(user.email)) {
      const nextRejected = new Set(rejectedEmails);
      nextRejected.delete(user.email);
      setRejectedEmails(nextRejected);
      persistSet(REJECTED_KEY, nextRejected);
    }
    toast.success(`${user.email} approved in the portal`, { duration: 6000 });
    // UNLOCK APP SIGN-IN on the user's own device — the login/route gates
    // verify users.is_paid in the shared database, so the approval must land
    // there, not only in this console's local tabs.
    void setUserFlagAnon(user.email, { is_paid: true })
      .then((result) => {
        if (!result.ok)
          toast.error(`Could not unlock app sign-in for ${user.email}: ${result.error ?? "database error"}`, { duration: 8000 });
      })
      .catch(() =>
        toast.error(`Could not reach the database to unlock sign-in for ${user.email} — open the Payment status section and set them Paid.`, { duration: 9000 }),
      );
  };

  const rejectRegistered = (user: UserRow) => {
    const nextRejected = new Set(rejectedEmails);
    nextRejected.add(user.email);
    setRejectedEmails(nextRejected);
    persistSet(REJECTED_KEY, nextRejected);
    const nextApproved = new Set(approvedEmails);
    nextApproved.delete(user.email);
    setApprovedEmails(nextApproved);
    persistSet(APPROVED_KEY, nextApproved);
    toast.success(`${user.email} moved to Rejected`);
  };

  const restoreRegistered = (user: UserRow) => {
    const nextRejected = new Set(rejectedEmails);
    nextRejected.delete(user.email);
    setRejectedEmails(nextRejected);
    persistSet(REJECTED_KEY, nextRejected);
    toast.success(`${user.email} restored to the list`);
  };

  // ── BROADCAST — the message typer ON the admin console: write once, email
  // every mentor (portal accounts) and registered user.
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastArmed, setBroadcastArmed] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastProgress, setBroadcastProgress] = useState("");
  const sendBroadcast = async () => {
    if (broadcasting) return;
    const text = broadcastMsg.trim();
    if (!text) {
      toast.error("Write a message first.");
      return;
    }
    if (!broadcastArmed) {
      setBroadcastArmed(true);
      toast.info("Tap SEND again to email ALL mentors and users", { duration: 5000 });
      window.setTimeout(() => setBroadcastArmed((current) => (current ? current : false)), 6000);
      return;
    }
    setBroadcastArmed(false);
    setBroadcasting(true);
    const recipients = new Set<string>();
    try {
      const [portal, users] = await Promise.all([listCloudAccounts(), listUsersAnon()]);
      for (const entry of portal.accounts ?? []) {
        if (entry.email) recipients.add(String(entry.email).trim().toLowerCase());
      }
      for (const user of users.users ?? []) {
        if (user.email) recipients.add(String(user.email).trim().toLowerCase());
      }
    } catch {
      /* send to whoever we collected */
    }
    recipients.delete((account?.email ?? "").trim().toLowerCase());
    const list = Array.from(recipients).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (list.length === 0) {
      setBroadcasting(false);
      toast.error("No recipients found — check the cloud connection.");
      return;
    }
    let sent = 0;
    const failed: string[] = [];
    let index = 0;
    for (const email of list) {
      index += 1;
      setBroadcastProgress(`Sending ${index}/${list.length} — ${email}`);
      try {
        const result = await sendPortalEmail({ data: { type: "broadcast", email, message: text } });
        if (result.success) sent += 1;
        else failed.push(email);
      } catch {
        failed.push(email);
      }
    }
    setBroadcasting(false);
    setBroadcastProgress("");
    if (failed.length === 0) {
      toast.success(`Message sent to all ${sent} recipients.`);
      setBroadcastMsg("");
    } else {
      toast.error(`Sent ${sent}/${list.length}. Failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`, { duration: 8000 });
    }
  };

  if (!account) return null;
  if (account.role !== "admin")
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This console is restricted to EA Migrate administrators.
          </p>
          <Link
            to="/dashboard"
            className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground"
          >
            Back to portal
          </Link>
        </div>
      </div>
    );

  const selected = mentors.find((mentor) => mentor.id === selectedId) ?? null;
  const pending = mentors.filter((mentor) => mentor.status === "pending");
  const approved = mentors.filter((mentor) => mentor.status === "approved");
  const rejected = mentors.filter((mentor) => mentor.status === "rejected");
  const visibleMentors = tab === "pending" ? pending : tab === "approved" ? approved : rejected;
  const totalLicenses = mentors.reduce((total, mentor) => total + mentor.licenses.length, 0);
  const paymentEmails = Array.from(
    new Set([
      ...PAYMENT_EXEMPT_EMAILS,
      ...store.payments.map((payment) => payment.email),
      ...mentors.map((mentor) => mentor.email),
      // Registered app users get their Paid/Unpaid controls HERE (the
      // Approve buttons are portal status and never touch payment).
      ...registered.map((user) => user.email),
    ]),
  ).sort();
  const paidCount = paymentEmails.filter(
    (email) => paymentStatusForEmail(email) !== "unpaid",
  ).length;

  const selectMentor = (mentor: AdminViewAccount) => {
    setSelectedId(mentor.id);
    setLimit(mentor.licenseLimit);
  };
  const saveLimit = () => {
    if (!selected) return;
    setLicenseLimit(selected.id, limit);
    pushCloudUpdate(selected.email, { licenseLimit: limit });
    toast.success("Maximum keys updated");
  };
  const applyStatus = (mentor: AdminViewAccount, next: Account["status"]) => {
    setStatus(mentor.id, next);
    pushCloudUpdate(mentor.email, { status: next });
  };
  /** Pushes the FULL license list (pauses/removals included) to the cloud. */
  const pushLicenses = (mentorEmail: string, next: Account["licenses"]) => {
    const cloudMentor = cloud.accounts.find(
      (candidate) => candidate.email.toLowerCase() === mentorEmail.toLowerCase(),
    );
    if (!cloudMentor) return; // mentor is local-only — nothing to sync
    pushCloudUpdate(mentorEmail, { licenses: next, replaceLicenses: true });
  };
  const handleCreateKey = () => {
    if (!selected) return;
    if (!selected.eas.length) {
      toast.error("This user has no Expert Advisors yet — they must create one first.");
      return;
    }
    const firstEa = selected.eas[0];
    if (!firstEa) {
      toast.error("This user has no Expert Advisors yet — they must create one first.");
      return;
    }
    const result = addLicense(selected.id, "portal", generateKey(), { eaId: firstEa.id, expiry: "Lifetime" }, { bypassLimit: true });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const created = result.license;
    const after = storeRef.current.accounts.find((a) => a.id === selected.id);
    if (created && after) pushLicenses(selected.email, after.licenses);
    toast.success(`Key ${created?.key} created`);
  };
  // ── KEY ALLOWANCE (the OLD console way) — the admin sets the NUMBER of
  // keys the user may create on their own portal dashboard. No key is
  // generated here; the mentor/owner taps Create key on their dashboard
  // until the allowance runs out. Same mechanism as the mentor detail
  // panel's "Max keys allowed" input below.
  const [userLimit, setUserLimit] = useState(0);
  const [savingUserLimit, setSavingUserLimit] = useState(false);
  // Remembered allowances — an approved signup without a portal account yet
  // still keeps the number the admin set (this device), and the mentor
  // account's cloud licenseLimit takes over the moment the user opens a portal.
  const EMAIL_LIMITS_KEY = "eamp.admin.emailLimits.v1";
  const [emailLimits, setEmailLimits] = useState<Record<string, number>>(() => {
    try {
      const raw = window.localStorage.getItem(EMAIL_LIMITS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const rememberEmailLimit = (email: string, limit: number) => {
    const next = { ...emailLimits, [email.toLowerCase()]: limit };
    setEmailLimits(next);
    try {
      window.localStorage.setItem(EMAIL_LIMITS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the number just lives for this session */
    }
  };
  const selectedUser = useMemo(
    () => registered.find((user) => user.email === selectedUserEmail) ?? null,
    [registered, selectedUserEmail],
  );
  const selectRegistered = (email: string) => {
    setSelectedUserEmail(email);
    const account = mentors.find((mentor) => mentor.email.toLowerCase() === email.toLowerCase());
    setUserLimit(account?.licenseLimit ?? emailLimits[email.toLowerCase()] ?? 0);
  };
  const saveUserLimit = () => {
    const user = selectedUser;
    if (!user) return;
    setSavingUserLimit(true);
    try {
      // Mentor/portal account? The number is enforced there — their dashboard
      // key creation stops at the allowance. Otherwise the number is
      // remembered on this console for that email (and syncs the moment a
      // portal account exists).
      const account = mentors.find((mentor) => mentor.email.toLowerCase() === user.email.toLowerCase());
      if (account) {
        setLicenseLimit(account.id, userLimit);
        pushCloudUpdate(account.email, { licenseLimit: userLimit });
      }
      rememberEmailLimit(user.email, userLimit);
      toast.success(`Key allowance for ${user.email} set to ${userLimit}`);
      setSelectedUserEmail(null);
    } finally {
      setSavingUserLimit(false);
    }
  };
  const handleToggleLicense = (license: Account["licenses"][number]) => {
    if (!selected) return;
    toggleLicense(selected.id, license.id);
    const after = storeRef.current.accounts.find((a) => a.id === selected.id);
    if (after) pushLicenses(selected.email, after.licenses);
  };
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  // Per-mentor reactivation permission (🔒 next to Approve). Loaded from the
  // cloud row whenever a different mentor is selected.
  const [reactivationUnlocked, setReactivationUnlocked] = useState(false);
  useEffect(() => {
    if (!selected) {
      setReactivationUnlocked(false);
      return;
    }
    // getReactivationEnabled already returns TRUE for admin/owner emails
    // (they are never lockable), and now also returns the DB truth for
    // mentors — including rows created by the toggle's own upsert, so a
    // fresh unlock SURVIVES signing out of the portal and back in.
    let cancelled = false;
    void getReactivationEnabled(selected.email).then((enabled) => {
      if (!cancelled) setReactivationUnlocked(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.email]);
  const handleRemoveLicense = (license: Account["licenses"][number]) => {
    if (!selected) return;
    // Two-tap confirm — window.confirm is suppressed in the Android WebView,
    // which made the delete button look dead on the phone.
    if (armedDelete !== license.id) {
      setArmedDelete(license.id);
      toast.info("Tap delete again to confirm", { duration: 4000 });
      window.setTimeout(() => setArmedDelete((current) => (current === license.id ? null : current)), 4000);
      return;
    }
    setArmedDelete(null);
    removeLicense(selected.id, license.id);
    const after = storeRef.current.accounts.find((a) => a.id === selected.id);
    if (after) pushLicenses(selected.email, after.licenses);
    // ALSO delete both cloud copies: the license_keys row (what the app
    // activates against) and the mentor's portal record (or the key
    // resurrects on the next restore).
    void Promise.allSettled([portalDeleteLicenseKey(license.key), portalRemoveLicense(selected.email, license.id)])
      .then(([row, record]) => {
        if (row.status === "fulfilled" && row.value.enabled && !row.value.ok)
          toast.error(`Cloud key delete failed: ${row.value.error ?? "unknown error"} — the key may still activate.`);
        if (record.status === "fulfilled" && record.value.enabled && !record.value.ok)
          toast.error(`Cloud record delete failed: ${record.value.error ?? "unknown error"}.`);
      })
      .catch(() => toast.error("Cloud key delete could not be reached — the key may still activate."));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/15 glow-ring">
              <BrandLogo className="size-full object-contain" />
            </span>
            <span className="truncate text-sm font-bold uppercase sm:text-base">
              EA <span className="text-primary">Migrate</span> Admin
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {supabaseConfigured || portalCloudConfigured() ? (
              <span className="hidden items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300 md:flex">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                SYNCED — Supabase connected
              </span>
            ) : (
              <span className="hidden rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300 md:block">
                Local-only mode
              </span>
            )}
            <button
              onClick={() => {
                signOut();
                navigate({ to: "/signin" });
              }}
              className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card/60"
              aria-label="Log out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
          Privacy control room
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Admin console</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Manage mentor approval, admin-set key allowances, payment status, and one-device
          activation records.
        </p>

        {!supabaseConfigured && !portalCloudConfigured() && (
          <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
            <p className="font-bold uppercase tracking-wide text-amber-300">Local-only mode</p>
            <p className="mt-1 leading-relaxed">
              Supabase is not connected, so approvals are saved on{" "}
              <strong>this device only</strong>. Ask the workspace owner to add{" "}
              <span className="font-mono">VITE_SUPABASE_URL</span> and{" "}
              <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> (Settings → Environment) to
              sync every device live.
            </p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            // PENDING on top = portal mentors + registered emails still awaiting
            // approval — it must move the moment an email is approved/rejected.
            {
              label: "Pending",
              value:
                pending.length +
                registered.filter((user) => !approvedEmails.has(user.email) && !rejectedEmails.has(user.email)).length,
            },
            { label: "Approved users", value: approved.length + approvedEmails.size },
            { label: "Keys issued", value: totalLicenses },
            { label: "Paid emails", value: paidCount },
          ].map((stat) => (
            <div key={stat.label} className="panel p-4 glow-ring sm:p-5">
              <p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
              <p className="mt-1.5 text-2xl font-bold sm:mt-2 sm:text-3xl">{stat.value}</p>
            </div>
          ))}
        </div>

          {/* MESSAGE TYPER — write once, email every mentor + user. */}
          <section className="panel mt-6 p-4 sm:p-5">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
              <label htmlFor="admin-broadcast" className="text-sm font-semibold">
                Message to all mentors &amp; users
              </label>
              <textarea
                id="admin-broadcast"
                value={broadcastMsg}
                onChange={(event) => setBroadcastMsg(event.target.value)}
                rows={4}
                placeholder="Type your message here…"
                className="mt-3 w-full rounded-2xl border border-border/70 bg-card/60 p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {broadcasting ? broadcastProgress : "Everyone gets it by email."}
                </p>
                <button
                  type="button"
                  onClick={() => void sendBroadcast()}
                  disabled={broadcasting}
                  className={
                    broadcastArmed
                      ? "flex h-11 shrink-0 items-center gap-2 rounded-full bg-emerald-500 px-6 text-sm font-black text-white transition-transform active:scale-[0.98]"
                      : "flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                  }
                >
                  <Send className="size-4" />
                  {broadcasting ? "Sending…" : broadcastArmed ? "Tap again to send to ALL" : "Send"}
                </button>
              </div>
            </div>
          </section>

          {/* ---------------- registered emails — the OLD approval flow ----------------
              Same position and same shape as the Mentor users list: tabs with
              counts (Pending first + default), plain rows, Approve/Reject move
              the email between tabs. Tap a row to set its KEY ALLOWANCE — the
              NUMBER of keys that user may create on their own portal. */}
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Users className="size-4 text-primary" /> Registered emails
              </h2>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder="Search email"
                  className="h-10 w-full max-w-56 rounded-xl border border-border/70 bg-card/60 pl-9 pr-3 text-sm"
                  aria-label="Search registered emails"
                />
              </div>
            </div>
            {registeredError && (
              <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
                Could not load registered users: {registeredError}
              </p>
            )}
            {!registeredError && registered.length === 0 && (
              <p className="mt-4 rounded-2xl border border-border/60 bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
                No registered users yet.
              </p>
            )}
            {/* Pending / Approved / Rejected — the OLD approval flow, same
                shape as the mentor tabs above. Every signup starts Pending;
                Approve/Reject just move it between the tabs and NEVER touch
                the payment flag (that lives in the Payment status section at
                the bottom). */}
            <div className="mt-4 flex items-center gap-2">
              {(
                [
                  ["pending", "Pending", registered.filter((user) => !approvedEmails.has(user.email) && !rejectedEmails.has(user.email)).length],
                  ["approved", "Approved", approvedEmails.size],
                  ["rejected", "Rejected", rejectedEmails.size],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setUserTab(key)}
                  className={
                    userTab === key
                      ? "flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-primary/60 bg-primary/15 text-[11px] font-bold uppercase tracking-wide text-primary sm:text-xs"
                      : "flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card/60 text-[11px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground sm:text-xs"
                  }
                >
                  {label}
                  <span
                    className={
                      userTab === key
                        ? "rounded-full bg-primary/20 px-2 py-0.5 text-[10px]"
                        : "rounded-full bg-secondary px-2 py-0.5 text-[10px]"
                    }
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
            {registered.length > 0 && (
              <>
                <ul className="mt-3 space-y-3">
                  {registered
                    .filter((user) =>
                      userTab === "pending"
                        ? !approvedEmails.has(user.email) && !rejectedEmails.has(user.email)
                        : userTab === "approved"
                          ? approvedEmails.has(user.email) && !rejectedEmails.has(user.email)
                          : rejectedEmails.has(user.email),
                    )
                    .filter((user) => user.email.toLowerCase().includes(userQuery.trim().toLowerCase()))
                    .map((user) => (
                      <li
                        key={user.email}
                        onClick={() => selectRegistered(user.email)}
                        className={
                          selectedUserEmail === user.email
                            ? "cursor-pointer rounded-2xl border border-primary/60 bg-primary/5 p-4"
                            : "cursor-pointer rounded-2xl border border-border/60 bg-secondary/30 p-4 transition-colors hover:border-primary/30"
                        }
                      >
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold sm:text-base">{user.email}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {user.created_at && !Number.isNaN(new Date(user.created_at).getTime())
                                ? `Registered ${new Date(user.created_at).toLocaleString()}`
                                : "Registered"}
                            </p>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {rejectedEmails.has(user.email) ? (
                              <span className="rounded-full bg-red-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                                Rejected
                              </span>
                            ) : approvedEmails.has(user.email) ? (
                              <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                                Approved
                              </span>
                            ) : (
                              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                                Pending
                              </span>
                            )}
                            {user.is_admin && (
                              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                                Admin
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {rejectedEmails.has(user.email) ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  restoreRegistered(user);
                                }}
                                className="h-9 rounded-xl bg-secondary px-4 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground"
                              >
                                Restore
                              </button>
                            ) : (
                              <>
                                {!approvedEmails.has(user.email) && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      approveRegistered(user);
                                    }}
                                    className="h-9 rounded-xl bg-primary px-4 text-[11px] font-bold uppercase text-primary-foreground hover:opacity-90"
                                  >
                                    Approve
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    rejectRegistered(user);
                                  }}
                                  className="h-9 rounded-xl bg-destructive/20 px-4 text-[11px] font-bold uppercase text-destructive hover:bg-destructive/30"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {selectedUserEmail === user.email && (
                          <div
                            className="mt-3 rounded-2xl bg-secondary/45 p-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <p className="text-sm font-semibold">Max keys allowed</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              How many keys this user may create on their own portal.
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setUserLimit((current) => Math.max(0, current - 1))}
                                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/60"
                                aria-label="Decrease key allowance"
                              >
                                <Minus className="size-4" />
                              </button>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={userLimit}
                                onChange={(event) => setUserLimit(Math.max(0, Math.floor(Number(event.target.value)) || 0))}
                                className="h-10 w-20 rounded-xl border border-border/70 bg-card/60 text-center text-sm font-bold"
                                aria-label="Max keys allowed"
                              />
                              <button
                                type="button"
                                onClick={() => setUserLimit((current) => current + 1)}
                                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/60"
                                aria-label="Increase key allowance"
                              >
                                <Plus className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={saveUserLimit}
                                disabled={savingUserLimit}
                                className="h-10 rounded-xl bg-primary px-4 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-60"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
                {userQuery.trim() &&
                  registered.filter((user) => user.email.toLowerCase().includes(userQuery.trim().toLowerCase()))
                    .length === 0 && (
                    <p className="mt-3 text-center text-sm text-muted-foreground">No users match "{userQuery}".</p>
                  )}
              </>
            )}
          </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* ---------------- mentor list ---------------- */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Users className="size-4 text-primary" /> Mentor users
              </h2>
              <span className="text-xs text-muted-foreground">EA data stays private</span>
            </div>

            <div className="mb-3 flex items-center gap-2">
              {(
                [
                  ["pending", "Pending", pending],
                  ["approved", "Approved", approved],
                  ["rejected", "Rejected", rejected],
                ] as const
              ).map(([key, label, list]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={
                    tab === key
                      ? "flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-primary/60 bg-primary/15 text-[11px] font-bold uppercase tracking-wide text-primary sm:text-xs"
                      : "flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card/60 text-[11px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground sm:text-xs"
                  }
                >
                  {label}
                  <span
                    className={
                      tab === key
                        ? "rounded-full bg-primary/20 px-2 py-0.5 text-[10px]"
                        : "rounded-full bg-secondary px-2 py-0.5 text-[10px]"
                    }
                  >
                    {list.length}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {visibleMentors.length === 0 && (
                <p className="rounded-2xl border border-border/60 bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
                  No {tab} users right now.
                </p>
              )}
              {visibleMentors.map((mentor) => {
                const remaining = Math.max(mentor.licenseLimit - mentor.licenses.length, 0);
                const payment = paymentStatusForEmail(mentor.email);
                return (
                  <button
                    key={mentor.id}
                    type="button"
                    onClick={() => selectMentor(mentor)}
                    className={
                      selected?.id === mentor.id
                        ? "panel w-full border-primary/60 bg-primary/5 p-4 text-left sm:p-5"
                        : "panel w-full p-4 text-left hover:border-primary/30 sm:p-5"
                    }
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold sm:text-base">
                          {mentor.email}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {mentor.eas.length} EAs ·{" "}
                          {mentor.licenses.filter((license) => license.active).length} active keys ·{" "}
                          {remaining} left
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_PILL[mentor.status] ?? STATUS_PILL["pending"]}`}
                      >
                        {mentor.status}
                      </span>
                      <span
                        className={
                          payment === "unpaid"
                            ? "rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                            : "rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
                        }
                      >
                        {payment === "admin" ? "Admin" : payment}
                      </span>
                      {!knownLocally(mentor) && (
                        <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-300">
                          New
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---------------- detail panel ---------------- */}
          <section className="panel h-fit p-4 sm:p-5 lg:sticky lg:top-24">
            {!selected ? (
              <div className="flex min-h-56 items-center justify-center text-center">
                <p className="max-w-xs text-sm text-muted-foreground">
                  Select a mentor to manage approval and the exact key allowance available on their
                  dashboard.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                      User record
                    </p>
                    <h2 className="mt-1 break-all text-base font-semibold">{selected.email}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close user details"
                    className="shrink-0 text-muted-foreground"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniStat
                    label="EAs"
                    value={selected.eas.length}
                    icon={<Bot className="size-4" />}
                  />
                  <MiniStat
                    label="Active keys"
                    value={selected.licenses.filter((license) => license.active).length}
                    icon={<CheckCircle2 className="size-4" />}
                  />
                  <MiniStat
                    label="Payment"
                    value={paymentStatusForEmail(selected.email) === "unpaid" ? "Unpaid" : "Paid"}
                    icon={<CreditCard className="size-4" />}
                  />
                </div>

                <div className="mt-5 space-y-2">
                  <p className="text-sm text-muted-foreground">Portal status</p>
                  {/* REACTIVATION UNLOCK — the 🔒 next to Approve. Only when
                      the admin unlocks it can this mentor open their
                      Re-activate Client tool. */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !reactivationUnlocked;
                      setReactivationUnlocked(next);
                      void setReactivationEnabled(selected.email, next)
                        .then((result) => {
                          if (result.ok) {
                            toast.success(next ? `Reactivation UNLOCKED for ${selected.email}` : `Reactivation LOCKED for ${selected.email}`);
                          } else {
                            setReactivationUnlocked(!next);
                            toast.error(result.error ?? "Could not update the reactivation flag.");
                          }
                        })
                        .catch(() => {
                          setReactivationUnlocked(!next);
                          toast.error("Could not reach the database — try again.");
                        });
                    }}
                    className={`flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-bold ${
                      reactivationUnlocked
                        ? "bg-emerald-400/15 text-emerald-300 border border-emerald-400/40"
                        : "bg-secondary text-muted-foreground border border-border/60"
                    }`}
                    aria-pressed={reactivationUnlocked}
                  >
                    {reactivationUnlocked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                    {reactivationUnlocked ? "Reactivation unlocked" : "Reactivation locked"}
                  </button>
                  {selected.status === "pending" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          applyStatus(selected, "approved");
                          setSelectedId(null);
                          toast.success(`${selected.email} approved`);
                        }}
                        className="h-11 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          applyStatus(selected, "rejected");
                          setSelectedId(null);
                          toast.success(`${selected.email} rejected`);
                        }}
                        className="h-11 rounded-full bg-destructive/20 px-4 text-sm font-bold text-destructive"
                      >
                        Reject
                      </button>
                    </div>
                  ) : selected.status === "rejected" ? (
                    <button
                      type="button"
                      onClick={() => applyStatus(selected, "approved")}
                      className="h-11 w-full rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
                    >
                      Move to Approved
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => applyStatus(selected, "rejected")}
                      className="h-11 w-full rounded-full bg-destructive/20 px-4 text-sm font-bold text-destructive"
                    >
                      Revoke access
                    </button>
                  )}
                </div>

                <div className="mt-4 rounded-2xl bg-secondary/45 p-4">
                  <p className="text-sm font-semibold">Max keys allowed</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The allowance shown to the mentor on their dashboard.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={limit}
                      onChange={(event) => setLimit(Number(event.target.value))}
                      className="h-11 w-28 rounded-xl border border-border/70 bg-card/60 px-3 text-sm"
                      aria-label="Maximum keys allowed"
                    />
                    <button
                      type="button"
                      onClick={saveLimit}
                      className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">License keys</p>
                    <button
                      type="button"
                      onClick={handleCreateKey}
                      className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground transition-transform active:scale-[0.98]"
                    >
                      <Plus className="size-4" /> Create key
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.eas.length === 0
                      ? "The user must create an Expert Advisor first — keys link to an EA."
                      : `Keys link to the user's first EA (${selected.eas.length} available).`}
                  </p>
                  {selected.licenses.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No keys created.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {selected.licenses.map((license) => (
                        <li key={license.id} className="rounded-2xl bg-secondary/50 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-sm text-primary">
                              {license.key}
                            </span>
                            <span
                              className={
                                license.active
                                  ? "rounded-full bg-primary/15 px-2 py-1 text-[10px] font-semibold uppercase text-primary"
                                  : "rounded-full bg-background/60 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground"
                              }
                            >
                              {license.active ? "Active" : "Paused"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Linked to: {license.robotName || license.expertAdvisor || license.name || "Unlinked"} · Expiry:{" "}
                            {license.expiry || license.plan}
                          </p>
                          <div className="mt-3 flex gap-3">
                            <button
                              type="button"
                              onClick={() => handleToggleLicense(license)}
                              className="text-xs font-semibold text-primary"
                            >
                              {license.active ? "Pause" : "Activate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveLicense(license)}
                              aria-label="Remove license"
                              className={
                                armedDelete === license.id
                                  ? "font-bold text-destructive"
                                  : "text-muted-foreground hover:text-destructive"
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>

          {/* ---------------- payments ---------------- */}
          <section className="panel p-4 sm:p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <CreditCard className="size-4 text-primary" /> Payment status
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Whop return status and admin exemptions visible by email.
                </p>
              </div>
              <ShieldCheck className="size-5 shrink-0 text-primary" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {paymentEmails.map((email) => {
                const status = paymentStatusForEmail(email);
                const record = store.payments.find((payment) => payment.email === email);
                return (
                  <div
                    key={email}
                    className="rounded-2xl border border-border/60 bg-secondary/30 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold">{email}</span>
                      <span
                        className={
                          status === "unpaid"
                            ? "shrink-0 text-xs font-bold uppercase text-muted-foreground"
                            : "shrink-0 text-xs font-bold uppercase text-emerald-300"
                        }
                      >
                        {status === "admin" ? "Admin — free" : status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {record?.paidAt && status === "paid"
                        ? "Paid on " + new Date(record.paidAt).toLocaleString()
                        : status === "admin"
                          ? "Payment bypass enabled"
                          : "Unpaid — app access blocked"}
                    </p>
                    {status !== "admin" && (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEmailPaymentStatus(email, true);
                            // ALSO write users.is_paid=true in the cloud — the
                            // app gate, reactivation page and device binding all
                            // read the DATABASE, not this browser's localStorage.
                            void setCloudUserPaid(email, true).then((ok) => {
                              if (ok) toast.success(`${email} marked PAID in the cloud`);
                              else toast.error(`${email} marked paid locally — cloud write failed, reactivation may still refuse them`);
                            });
                          }}
                          className={
                            status === "paid"
                              ? "h-9 flex-1 rounded-xl bg-emerald-400/20 text-xs font-bold uppercase text-emerald-300"
                              : "h-9 flex-1 rounded-xl bg-secondary text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
                          }
                        >
                          Paid
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEmailPaymentStatus(email, false);
                            void setCloudUserPaid(email, false).then((ok) => {
                              if (ok) toast.success(`${email} marked UNPAID in the cloud`);
                            });
                          }}
                          className={
                            status === "unpaid"
                              ? "h-9 flex-1 rounded-xl bg-destructive/20 text-xs font-bold uppercase text-destructive"
                              : "h-9 flex-1 rounded-xl bg-secondary text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
                          }
                        >
                          Unpaid
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-secondary/45 p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function knownLocally(mentor: AdminViewAccount): boolean {
  return mentor.id.startsWith("m-") && Number.isFinite(Number(mentor.id.slice(2)));
}
