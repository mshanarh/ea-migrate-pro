import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  CreditCard,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import {
  deleteBroadcast,
  loadAdminSnapshot,
  recordBroadcast,
  setUserApproval,
  setUserLicenseLimit,
  setUserPaid,
  setUserReactivation,
  type AdminMessage,
  type AdminSnapshot,
  type AdminUser,
  type AdminWriteResult,
  type ReviewStatus,
} from "@/lib/admin-store";
import { OWNER_EMAILS, signOut, useCurrentAccount } from "@/lib/auth-store";
import { sendPortalEmail } from "@/lib/send-email";
import { supabaseConfigured } from "@/lib/supabase";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Console — EA Migrate" }] }),
  component: AdminConsole,
});

/** Which slice of the console is on screen — one bottom-nav tab at a time. */
type TabKey = "pending" | "approved" | "paid" | "rejected" | "appusers" | "messages";

const TABS: Array<{ key: TabKey; label: string; short: string; icon: typeof Clock3 }> = [
  { key: "pending", label: "Pending users", short: "Pending", icon: Clock3 },
  { key: "approved", label: "Approved users", short: "Approved", icon: CheckCircle2 },
  { key: "paid", label: "Paid users", short: "Paid", icon: CreditCard },
  { key: "rejected", label: "Rejected users", short: "Rejected", icon: Ban },
  { key: "appusers", label: "Activated, not paid", short: "Not paid", icon: Smartphone },
  { key: "messages", label: "Message users", short: "Messages", icon: MessageSquare },
];

/**
 * The key allowance a newly approved account gets when the admin did not type
 * one. Approving somebody without an allowance left their licences page stuck
 * on "Your admin has not set a key allowance yet", so approval always writes a
 * real number and this is that number.
 */
const DEFAULT_LICENSE_LIMIT = 2000;

function isAdminEmail(email: string): boolean {
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Small presentational pieces ──────────────────────────────────────── */

function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "amber" | "emerald" | "primary" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    primary: "text-primary",
    red: "text-red-300",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? `rounded-2xl border border-primary/60 bg-primary/10 p-4 text-left transition-colors`
          : "rounded-2xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:border-primary/30"
      }
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-3xl font-black tabular-nums ${toneClass}`}>{value}</p>
    </button>
  );
}

function StatusPill({ status }: { status: ReviewStatus }) {
  // "app" is a trading-app account that never signed up on the mentor
  // portal — shown plainly so the admin can tell it apart from a mentor
  // waiting for review (and so it never reads as "pending").
  const map = {
    approved: "bg-emerald-400/15 text-emerald-300",
    rejected: "bg-red-400/15 text-red-300",
    pending: "bg-amber-400/15 text-amber-300",
    app: "bg-secondary text-muted-foreground",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${map[status]}`}>
      {status === "app" ? "app user" : status}
    </span>
  );
}

/** One user card — the whole row is a big tap target that opens the sheet. */
function UserCard({
  user,
  onOpen,
  showUsage,
}: {
  user: AdminUser;
  onOpen: () => void;
  showUsage: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:border-primary/40 active:scale-[0.995]"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xs font-black text-primary"
          aria-hidden="true"
        >
          {user.email.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-bold sm:text-base">{user.email}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {user.name ? (
              <>
                <span className="font-semibold text-foreground">{user.name}</span>
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            Joined {formatDate(user.createdAt)}
          </p>
        </div>
        <StatusPill status={user.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        {user.name ? (
          <span className="rounded-lg bg-primary/15 px-2 py-1 text-primary">
            <User className="mr-1 inline size-3" aria-hidden="true" />
            {user.name}
          </span>
        ) : null}
        <span className="rounded-lg bg-secondary px-2 py-1 text-muted-foreground">
          <KeyRound className="mr-1 inline size-3" aria-hidden="true" />
          {showUsage ? `${user.keysUsed} / ${user.licenseLimit} keys` : `Limit ${user.licenseLimit}`}
        </span>
        {user.isPaid ? (
          <span className="rounded-lg bg-emerald-400/15 px-2 py-1 text-emerald-300">Paid</span>
        ) : (
          <span className="rounded-lg bg-secondary px-2 py-1 text-muted-foreground">Unpaid</span>
        )}
        {user.deviceBound ? (
          <span className="rounded-lg bg-secondary px-2 py-1 text-muted-foreground">Device bound</span>
        ) : null}
        {user.isAdmin ? (
          <span className="rounded-lg bg-primary/15 px-2 py-1 text-primary">Admin</span>
        ) : null}
      </div>
    </button>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-5 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/30 px-5 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

/* ── The console ──────────────────────────────────────────────────────── */

function AdminConsole() {
  const account = useCurrentAccount();
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("pending");
  const [query, setQuery] = useState("");
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // User sheet state
  const [limitDraft, setLimitDraft] = useState(0);
  const [limitSaved, setLimitSaved] = useState(false);
  // The reason the last write was refused, shown inside the sheet. Empty means
  // "no problem" — the Save button must never claim success without one.
  const [limitError, setLimitError] = useState<string | null>(null);
  // Set when the DATABASE refused the write itself (not the value) — usually
  // the grant SQL has not been run. A persistent banner, not a toast.
  const [writeIssue, setWriteIssue] = useState<string | null>(null);

  // Message sender
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    const next = await loadAdminSnapshot();
    setSnapshot(next);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // The console loads as soon as it is open. There is no second sign-in:
  // pressing "Admin Portal" while signed in to the portal as an admin lands
  // straight here, which is how it behaved before the Supabase Auth gate.
  useEffect(() => {
    void refresh();
    // The console is the admin's cockpit — keep it live so a decision made
    // on another device (or a new signup) shows up without a manual reload.
    // Ten seconds, and it re-reads when the tab is focused again, so someone
    // who left this open while a signup came in does not have to hunt for the
    // refresh button.
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = setInterval(tick, 10_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  const users = snapshot?.users ?? [];
  const messages = snapshot?.messages ?? [];

  // STATS — counted from the rows the database just returned. Nothing here
  // is a constant: it moves the moment a status or payment flag changes.
  const stats = useMemo(
    () => ({
      pending: users.filter((user) => user.status === "pending").length,
      approved: users.filter((user) => user.status === "approved").length,
      paid: users.filter((user) => user.isPaid).length,
      rejected: users.filter((user) => user.status === "rejected").length,
    }),
    [users],
  );

  const counts: Record<TabKey, number> = {
    pending: stats.pending,
    approved: stats.approved,
    paid: stats.paid,
    rejected: stats.rejected,
    appusers: users.filter((user) => user.usedApp && !user.isPaid).length,
    messages: messages.length,
  };

  const search = query.trim().toLowerCase();
  const byTab = useMemo(() => {
    // The name is searchable too: the owner is looking for a person, and on a
    // phone screen they are far more likely to remember "Biyu" than
    // "biyasentobeko222@gmail.com".
    const match = (list: AdminUser[]) =>
      search
        ? list.filter(
            (user) =>
              user.email.toLowerCase().includes(search) || (user.name ?? "").toLowerCase().includes(search),
          )
        : list;
    return {
      pending: match(users.filter((user) => user.status === "pending")),
      approved: match(users.filter((user) => user.status === "approved")),
      paid: match(users.filter((user) => user.isPaid)),
      rejected: match(users.filter((user) => user.status === "rejected")),
      // EVERY account that has opened the trading app AND is not on the payment
      // ledger. That combination is the point of the tab: these people are
      // running the software on their own account without ever having been
      // marked paid, so they are the ones worth chasing. Listing paying
      // accounts here too buried them under everyone who did the right thing.
      appusers: match(users.filter((user) => user.usedApp && !user.isPaid)),
    };
  }, [users, search]);

  const visible = byTab[tab === "messages" ? "pending" : tab];

  const openUser = useMemo(
    () => users.find((user) => user.email === openEmail) ?? null,
    [users, openEmail],
  );

  useEffect(() => {
    setLimitDraft(openUser?.licenseLimit ?? DEFAULT_LICENSE_LIMIT);
    setLimitSaved(false);
    setLimitError(null);
  }, [openUser?.email, openUser?.licenseLimit]);

  // ── Access. The console is for admins: the portal account's own role, or
  //    one of the owner addresses. There is no second sign-in — an admin who
  //    is already signed in to the portal arrives here directly.
  if (!account) {
    return (
      <Gate title="Sign in required" hint="Open the admin console from an administrator account.">
        <Link
          to="/signin"
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-black text-primary-foreground"
        >
          Go to sign in
        </Link>
      </Gate>
    );
  }
  if (account.role !== "admin" && !isAdminEmail(account.email)) {
    return (
      <Gate title="Admins only" hint="This console is restricted to EA Migrate administrators.">
        <Link
          to="/dashboard"
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-black text-primary-foreground"
        >
          Back to portal
        </Link>
      </Gate>
    );
  }

  /**
   * Apply a successful write to the row on screen straight away.
   *
   * Every button used to end with a FULL `refresh()` — seven parallel reads
   * across users, mentor_approvals, license_keys, app_settings, paid_emails,
   * app_messages and portal_accounts, most of them unbounded table scans. On
   * a console holding real signup volume that is seconds of round trips, and
   * the row sat on its OLD value for the whole of them: the write had already
   * committed but the list looked frozen, which reads as "the button is slow"
   * and invites the admin to press it a second time.
   *
   * The console already knows precisely what it just wrote, so it patches that
   * one row and gets out of the way. Genuinely external changes (a signup from
   * another device) still arrive through the ten-second poll and the
   * visibility refresh below, which is where a whole-table reload belongs.
   */
  const patchUser = useCallback((email: string, patch: Partial<AdminUser>) => {
    const target = email.trim().toLowerCase();
    setSnapshot((current) => {
      if (!current) return current;
      return {
        ...current,
        users: current.users.map((user) =>
          user.email.trim().toLowerCase() === target ? { ...user, ...patch } : user,
        ),
      };
    });
  }, []);

  /**
   * ONE write, ONE honest answer. The database functions return true only
   * after the row is committed, so the console reports success — and only
   * success — when that happened. A refused write returns the result to the
   * caller, so the Save button can fall back to "Save limit" with the real
   * reason instead of sitting there claiming SAVED.
   *
   * `patch` is what the row should become on success. It is applied locally
   * instead of re-reading the database, so the button reacts on the same tick
   * as the toast.
   */
  const withUser = async (
    email: string,
    work: () => Promise<AdminWriteResult>,
    labels: { success: string; failure: string },
    patch?: Partial<AdminUser>,
  ): Promise<AdminWriteResult> => {
    setBusy(true);
    let result: AdminWriteResult;
    try {
      result = await work();
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "network error" };
    }
    setBusy(false);
    if (result.ok) {
      setWriteIssue(null);
      toast.success(labels.success);
      if (patch) patchUser(email, patch);
      return result;
    }
    const detail = result.error ?? "database error";
    toast.error(`${labels.failure} failed: ${detail}`);
    if (result.needsAttention) setWriteIssue(detail);
    return result;
  };

  /**
   * APPROVE — write the decision AND the key allowance, then tell the user.
   *
   * THE TWO WRITES BELONG TOGETHER. Approving used to write only the approval
   * row, so an approved mentor's key allowance stayed unset (app_settings
   * `limit:<email>` had no row) and their licences page showed "Your admin has
   * not set a key allowance yet" — the account was approved and still could not
   * create a key. The limit is now saved in the same action, defaulting to 2000
   * (or whatever the admin typed in the sheet), so no account is ever left
   * approved with an unset allowance.
   *
   * The email is the confirmation that their portal is open; a failed send
   * never undoes the approval itself (the database is the source of truth), it
   * is only reported so the admin can resend from the Messages tab.
   *
   * APPROVAL OPENS THE MENTOR PORTAL. IT DOES NOT OPEN THE APP. The app is
   * gated on payment alone, so the confirmation says so explicitly — the
   * old "they can sign in now" is exactly the wording that made people
   * approve somebody and then wonder why they still hit Whop checkout.
   */
  const approve = (user: AdminUser) => {
    // `limitDraft` is seeded from the open user's saved limit and is 0 when no
    // allowance was ever set — 0 would mean "no keys at all", so an unset
    // draft falls back to the platform default.
    const limit = limitDraft > 0 ? limitDraft : DEFAULT_LICENSE_LIMIT;
    return void withUser(
      user.email,
      async () => {
        // Approval first: it is the decision. The limit is saved straight
        // after, and its failure is reported rather than silently swallowed.
        const approved = await setUserApproval(user.email, "approved");
        if (!approved.ok) return approved;
        const limited = await setUserLicenseLimit(user.email, limit);
        if (!limited.ok) {
          return { ...limited, error: `Approved, but the key allowance was not saved: ${limited.error ?? "database error"}` };
        }
        return approved;
      },
      {
        success: `${user.email} approved with a ${limit}-key allowance — portal open. Mark them PAID to let them into the app.`,
        failure: `Approve ${user.email}`,
      },
      { status: "approved", licenseLimit: limit },
    ).then((result) => {
      // Only tell the user they are in when the database actually wrote it.
      if (result.ok) void notifyDecision(user, "approved");
    });
  };

  /** REJECT — same shape, with the decline copy. */
  const reject = (user: AdminUser) =>
    void withUser(
      user.email,
      () => setUserApproval(user.email, "rejected"),
      {
        success: `${user.email} rejected — portal access revoked`,
        failure: `Reject ${user.email}`,
      },
      { status: "rejected" },
    ).then((result) => {
      if (result.ok) void notifyDecision(user, "rejected");
    });

  /** Confirmation email for the person whose account was just reviewed. */
  const notifyDecision = async (user: AdminUser, decision: "approved" | "rejected") => {
    try {
      const result = await sendPortalEmail({
        data: {
          type: "approval_decision",
          email: user.email,
          decision,
          ...(decision === "approved" ? { licenseLimit: user.licenseLimit } : {}),
        },
      });
      if (!result.success) {
        toast.error(`Approved, but the confirmation email did not send: ${result.error ?? "unknown error"}`);
      }
    } catch {
      toast.error("Approved, but the confirmation email could not be sent.");
    }
  };

  const saveLimit = (user: AdminUser) =>
    void withUser(
      user.email,
      () => setUserLicenseLimit(user.email, limitDraft),
      {
        success: `Maximum keys for ${user.email} set to ${limitDraft}`,
        failure: `Save the maximum for ${user.email}`,
      },
      // Mirror the store's own clamp so the row shows exactly what was
      // stored — an out-of-range draft must not leave a value on screen the
      // database never accepted.
      { licenseLimit: Math.max(0, Math.min(9999, Math.floor(Number(limitDraft) || 0))) },
    ).then((result) => {
      setLimitSaved(result.ok);
      setLimitError(result.ok ? null : result.error ?? "The database did not confirm the save.");
    });

  const togglePaid = (user: AdminUser) =>
    void withUser(
      user.email,
      () => setUserPaid(user.email, !user.isPaid),
      {
        success: user.isPaid ? `${user.email} marked unpaid` : `${user.email} marked paid`,
        failure: `Payment flag for ${user.email}`,
      },
      {
        isPaid: !user.isPaid,
        paidAt: user.isPaid ? null : new Date().toISOString(),
      },
    );

  const toggleReactivation = (user: AdminUser) =>
    void withUser(
      user.email,
      () => setUserReactivation(user.email, !user.reactivationEnabled),
      {
        success: user.reactivationEnabled
          ? `Device reactivation locked for ${user.email}`
          : `Device reactivation unlocked for ${user.email}`,
        failure: `Reactivation toggle for ${user.email}`,
      },
      { reactivationEnabled: !user.reactivationEnabled },
    );

  /**
   * Send to every registered user. Recipients come from the database rows
   * just loaded — never from a hardcoded list — and the message is recorded
   * in app_settings afterwards with the REAL count that was emailed.
   */
  const sendToAll = async () => {
    const body = message.trim();
    if (!body) {
      toast.error("Write a message first.");
      return;
    }
    const recipients = users
      .map((user) => user.email)
      .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      .filter((email) => email !== account.email.toLowerCase());
    if (recipients.length === 0) {
      toast.error("There are no registered users to message yet.");
      return;
    }
    setSending(true);
    let sent = 0;
    let index = 0;
    for (const email of recipients) {
      index += 1;
      setSendProgress(`Sending ${index} of ${recipients.length} — ${email}`);
      try {
        const result = await sendPortalEmail({ data: { type: "broadcast", email, message: body } });
        if (result.success) sent += 1;
      } catch {
        /* counted as not delivered */
      }
    }
    // History is a real database record: message, timestamp, recipient
    // count and who sent it.
    await recordBroadcast(body, sent, account.email);
    setSending(false);
    setConfirming(false);
    setSendProgress("");
    if (sent === recipients.length) {
      toast.success(`Message sent to all ${sent} users.`);
      setMessage("");
    } else {
      toast.error(`Sent ${sent} of ${recipients.length} users.`);
    }
    await refresh(true);
  };

  const activeTab: (typeof TABS)[number] = TABS.find((item) => item.key === tab) ?? TABS[0]!;
  const ActiveTabIcon = activeTab.icon;

  return (
    <div className="min-h-dvh bg-[#07090B] pb-24 text-white">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07090B]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/dashboard" className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/15">
            <BrandLogo className="size-full object-contain" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black uppercase tracking-[0.16em] sm:text-base">
              EA <span className="text-primary">Migrate</span> Admin
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {account.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh(true)}
            aria-label="Refresh data"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate({ to: "/signin" });
            }}
            aria-label="Log out"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        {snapshot?.error ? (
          <p className="border-t border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[11px] text-amber-200">
            Some data could not be read ({snapshot.error}). Showing the rest.
          </p>
        ) : null}
        {!supabaseConfigured ? (
          <p className="border-t border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[11px] text-amber-200">
            The database is not connected — this console can only show what it can read.
          </p>
        ) : null}
        {/* A refused WRITE is a database problem, not an access one — the
            grant SQL has not been run. Say so until a write succeeds. */}
        {writeIssue ? (
          <div className="flex items-start gap-2 border-t border-red-400/30 bg-red-500/10 px-4 py-2.5 text-[11px] text-red-200">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{writeIssue}</span>
            <button
              type="button"
              onClick={() => setWriteIssue(null)}
              className="shrink-0 rounded-lg border border-red-300/40 px-2 py-1 font-black uppercase"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {/* ── Stats: 2×2 on phones, 4 across on desktop. No sideways scroll. ── */}
        <section aria-label="Dashboard statistics">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pending" value={stats.pending} tone="amber" active={tab === "pending"} onClick={() => setTab("pending")} />
            <StatCard label="Approved" value={stats.approved} tone="emerald" active={tab === "approved"} onClick={() => setTab("approved")} />
            <StatCard label="Paid" value={stats.paid} tone="primary" active={tab === "paid"} onClick={() => setTab("paid")} />
            <StatCard label="Rejected" value={stats.rejected} tone="red" active={tab === "rejected"} onClick={() => setTab("rejected")} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Live from the database · {users.length} registered account{users.length === 1 ? "" : "s"}
          </p>
        </section>

        {/* ── Section content ── */}
        <section className="mt-6">
          {tab === "messages" ? (
            <MessagePanel
              message={message}
              setMessage={setMessage}
              confirming={confirming}
              setConfirming={setConfirming}
              sending={sending}
              progress={sendProgress}
              recipientCount={users.length}
              onSend={() => void sendToAll()}
              messages={messages}
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <ActiveTabIcon className="size-4 text-primary" aria-hidden="true" />
                  {activeTab.label}
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search email or name"
                    aria-label="Search users by email or name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              {loading ? (
                <LoadingBlock label="Loading users from the database…" />
              ) : visible.length === 0 ? (
                <EmptyState
                  title={search ? `No ${activeTab.short.toLowerCase()} users match “${query}”` : `No ${activeTab.short.toLowerCase()} users`}
                  hint={
                    tab === "pending"
                      ? "New sign-ups appear here automatically and wait for your decision."
                      : tab === "paid"
                        ? "An account appears here once its payment flag is set to paid in the database."
                        : tab === "appusers"
                          ? "Every account that has opened the trading app but is not on the payment ledger appears here."
                          : "Accounts move here when you approve or reject them."
                  }
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {visible.map((user) => (
                    <li key={user.email}>
                      <UserCard
                        user={user}
                        showUsage={tab === "approved" || tab === "paid"}
                        onOpen={() => setOpenEmail(user.email)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </main>

      {/* ── Bottom navigation (mobile) / top strip (desktop) ── */}
      <nav
        aria-label="Console sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#07090B]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex max-w-5xl">
          {TABS.map((item) => {
            const active = item.key === tab;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold text-primary"
                    : "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold text-muted-foreground"
                }
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {counts[item.key] > 0 ? (
                    <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-[9px] font-black leading-4 text-primary-foreground">
                      {counts[item.key]}
                    </span>
                  ) : null}
                </span>
                {item.short}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── User management sheet ── */}
      {openUser ? (
        <UserSheet
          user={openUser}
          busy={busy}
          limitDraft={limitDraft}
          limitSaved={limitSaved}
          limitError={limitError}
          setLimitDraft={(value) => {
            setLimitDraft(value);
            setLimitSaved(false);
            setLimitError(null);
          }}
          onClose={() => setOpenEmail(null)}
          onApprove={() => approve(openUser)}
          onReject={() => reject(openUser)}
          onSaveLimit={() => saveLimit(openUser)}
          onTogglePaid={() => togglePaid(openUser)}
          onToggleReactivation={() => toggleReactivation(openUser)}
        />
      ) : null}
    </div>
  );
}

/* ── Access denied / signed-out shell ─────────────────────────────────── */

function Gate({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#07090B] px-6 text-center text-white">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-primary/15">
          <BrandLogo className="size-full object-contain" />
        </div>
        <h1 className="mt-6 text-2xl font-black">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{hint}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/* ── User management panel ────────────────────────────────────────────── */

function UserSheet({
  user,
  busy,
  limitDraft,
  setLimitDraft,
  limitSaved,
  limitError,
  onClose,
  onApprove,
  onReject,
  onSaveLimit,
  onTogglePaid,
  onToggleReactivation,
}: {
  user: AdminUser;
  busy: boolean;
  limitDraft: number;
  setLimitDraft: (value: number) => void;
  limitSaved: boolean;
  limitError: string | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSaveLimit: () => void;
  onTogglePaid: () => void;
  onToggleReactivation: () => void;
}) {
  const overLimit = user.keysUsed > user.licenseLimit && user.licenseLimit > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Manage ${user.email}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      {/* max-h + internal scroll keeps the panel inside the Android viewport */}
      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0C1013] sm:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="break-all text-base font-black">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {user.name ? (
                <>
                  <span className="font-semibold text-foreground">Registered as {user.name}</span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              Joined {formatDate(user.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={user.status} />
            {user.isPaid ? (
              <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-300">Paid</span>
            ) : (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase text-muted-foreground">Unpaid</span>
            )}
            {user.deviceBound ? (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase text-muted-foreground">Device bound</span>
            ) : null}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Keys used</dt>
              <dd className="mt-1 text-2xl font-black tabular-nums">{user.keysUsed}</dd>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Maximum</dt>
              <dd className={`mt-1 text-2xl font-black tabular-nums ${overLimit ? "text-red-300" : ""}`}>{user.licenseLimit}</dd>
            </div>
          </dl>
          {user.licenseLimit === 0 ? (
            <p className="mt-2 text-xs text-amber-300">No limit set — this user cannot create any license key yet.</p>
          ) : overLimit ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              This user is {user.keysUsed - user.licenseLimit} key{user.keysUsed - user.licenseLimit === 1 ? "" : "s"} over the limit.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {Math.max(user.licenseLimit - user.keysUsed, 0)} key slot{user.licenseLimit - user.keysUsed === 1 ? "" : "s"} left.
            </p>
          )}
          {user.paidAt ? <p className="mt-2 text-xs text-muted-foreground">Paid on {formatDate(user.paidAt)}</p> : null}

          {/* License limit — the number the user may create/use. */}
          <div className="mt-5">
            <label htmlFor="admin-limit" className="text-sm font-bold">
              Maximum license keys
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              How many keys this user is allowed to create and use. Saved to the database and enforced when they create a key.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLimitDraft(Math.max(0, limitDraft - 1))}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"
                aria-label="Decrease maximum keys"
              >
                −
              </button>
              <input
                id="admin-limit"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                value={limitDraft}
                onChange={(event) => setLimitDraft(Math.max(0, Math.min(999, Math.floor(Number(event.target.value) || 0))))}
                className="h-11 w-20 rounded-xl border border-white/10 bg-white/5 text-center text-base font-black tabular-nums"
              />
              <button
                type="button"
                onClick={() => setLimitDraft(Math.min(999, limitDraft + 1))}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"
                aria-label="Increase maximum keys"
              >
                +
              </button>
              <button
                type="button"
                onClick={onSaveLimit}
                disabled={busy || limitDraft === user.licenseLimit}
                className="h-11 flex-1 rounded-xl bg-primary text-xs font-black uppercase text-primary-foreground disabled:opacity-50"
              >
                {limitSaved ? "Saved" : "Save limit"}
              </button>
            </div>
            {/* Nothing is claimed unless the database confirmed it. A failed
                save keeps the button live and shows why, so a stuck "SAVED"
                can never hide a number that was never written. */}
            {limitError ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-300">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Not saved — {limitError}
              </p>
            ) : limitSaved && limitDraft === user.licenseLimit ? (
              <p className="mt-2 text-[11px] text-emerald-300">
                Saved in the database — the maximum is now {user.licenseLimit}.
              </p>
            ) : null}
          </div>

          {/* Secondary toggles */}
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onTogglePaid}
              disabled={busy}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-black uppercase disabled:opacity-50"
            >
              <CreditCard className="size-4" aria-hidden="true" />
              {user.isPaid ? "Mark unpaid" : "Mark paid"}
            </button>
            <button
              type="button"
              onClick={onToggleReactivation}
              disabled={busy}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-black uppercase disabled:opacity-50"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              {user.reactivationEnabled ? "Lock reactivation" : "Allow reactivation"}
            </button>
          </div>
        </div>

        {/* Primary decisions — big touch targets, always reachable */}
        <div className="grid grid-cols-2 gap-3 border-t border-white/10 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="flex h-13 min-h-12 items-center justify-center gap-2 rounded-2xl border border-red-400/40 bg-red-500/15 text-xs font-black uppercase text-red-200 disabled:opacity-50"
          >
            <Ban className="size-4" aria-hidden="true" />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="flex h-13 min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-xs font-black uppercase text-emerald-950 disabled:opacity-50"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Message sender + history ─────────────────────────────────────────── */

function MessagePanel({
  message,
  setMessage,
  confirming,
  setConfirming,
  sending,
  progress,
  recipientCount,
  onSend,
  messages,
}: {
  message: string;
  setMessage: (value: string) => void;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  sending: boolean;
  progress: string;
  recipientCount: number;
  onSend: () => void;
  messages: AdminMessage[];
}) {
  /**
   * CLEAR A MESSAGE — removes one row from the history.
   *
   * The list is mirrored into local state so the row disappears the moment the
   * delete succeeds, instead of waiting for the 10s console poll to notice. The
   * delete itself has to run on the SERVER: the anon key has insert + select on
   * `app_messages` and no delete, so a browser-side call fails with
   * `42501 permission denied` (verified against the live database).
   *
   * Two taps, because the button destroys a record of what was actually sent to
   * real people and that cannot be undone. `clearing` is the id currently being
   * deleted, so only the row being worked on shows a spinner.
   */
  const [history, setHistory] = useState(messages);
  const [clearing, setClearing] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);

  useEffect(() => {
    setHistory(messages);
  }, [messages]);

  const clearMessage = async (id: string) => {
    setClearing(id);
    const result = await deleteBroadcast(id);
    setClearing(null);
    setConfirmClear(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not delete that message.");
      return;
    }
    setHistory((current) => current.filter((item) => item.id !== id));
    toast.success("Message removed from the history.");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      toast.error("Write a message first.");
      return;
    }
    setConfirming(true);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-card/50 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <MessageSquare className="size-4 text-primary" aria-hidden="true" />
          Message users
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          One email to every registered user. Sent messages are saved in the database with the date, recipient count and sender.
        </p>
        <form onSubmit={submit} className="mt-4">
          <label htmlFor="admin-broadcast" className="sr-only">
            Message
          </label>
          <textarea
            id="admin-broadcast"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={7}
            placeholder="Type your message here…"
            className="w-full resize-y rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {recipientCount} registered user{recipientCount === 1 ? "" : "s"} will receive this.
            </p>
            <button
              type="submit"
              disabled={sending}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-6 text-xs font-black uppercase text-primary-foreground disabled:opacity-50"
            >
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              Send to all users
            </button>
          </div>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Message history ({history.length})
        </h3>
        {history.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No messages sent yet" hint="Everything you send is recorded here and stored in the database." />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {history.map((item) => (
              <li key={item.id} className="rounded-2xl border border-white/10 bg-card/50 p-4">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{formatDateTime(item.sentAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {item.recipients} recipient{item.recipients === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">by {item.sender}</span>
                </div>
                <div className="mt-3 border-t border-white/10 pt-3">
                  {confirmClear === item.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mr-auto text-[11px] leading-4 text-muted-foreground">
                        Delete this message from the history? This cannot be undone.
                      </p>
                      <button
                        type="button"
                        onClick={() => void clearMessage(item.id)}
                        disabled={clearing === item.id}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-500 px-3 text-[11px] font-black uppercase text-red-950 disabled:opacity-60"
                      >
                        {clearing === item.id ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        ) : null}
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(null)}
                        disabled={clearing === item.id}
                        className="inline-flex h-8 items-center rounded-lg border border-white/10 px-3 text-[11px] font-black uppercase text-muted-foreground disabled:opacity-60"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClear(item.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-400/40 bg-red-500/10 px-3 text-[11px] font-black uppercase text-red-200"
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      Clear message
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Confirmation — nothing is emailed until the admin confirms here. */}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirm sending">
          <button type="button" aria-label="Cancel" onClick={() => setConfirming(false)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#0C1013] p-5 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15">
              <Send className="size-6 text-primary" aria-hidden="true" />
            </div>
            <h4 className="mt-4 text-lg font-black">Send to all users?</h4>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This emails {Math.max(recipientCount - 1, 0)} registered user{Math.max(recipientCount - 1, 0) === 1 ? "" : "s"} right away. It cannot be undone.
            </p>
            <div className="mt-3 max-h-28 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3 text-left text-xs leading-5 text-muted-foreground">
              {message.trim()}
            </div>
            {progress ? <p className="mt-3 text-xs text-primary">{progress}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="h-12 rounded-2xl border border-white/10 bg-white/5 text-xs font-black uppercase disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={sending}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-xs font-black uppercase text-primary-foreground disabled:opacity-50"
              >
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Send now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
