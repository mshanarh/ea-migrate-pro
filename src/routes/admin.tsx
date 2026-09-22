import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LogOut,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_EXEMPT_EMAILS,
  maskEaId,
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
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Console — EA Migrate Pro" }] }),
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
  // Tabbed mentor list: the console opens on Pending so new sign-ups waiting
  // for approval are the first thing the admin sees.
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [limit, setLimit] = useState(0);
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
      if (local.role !== "mentor" || local.status === "pending") continue;
      const remote = cloud.accounts.find(
        (candidate) => candidate.email.toLowerCase() === local.email.toLowerCase(),
      );
      if (remote && remote.status !== local.status) {
        void syncAdminUpdate({
          data: {
            adminEmail: account.email,
            targetEmail: local.email,
            patch: { status: local.status },
          },
        });
      }
    }
  }, [account, cloud.enabled, cloud.accounts]);

  // Poll the shared cloud store every 3s: a registration from ANY device
  // appears here within seconds. Cloud-only records are merged into the local
  // store so admin actions work on them immediately.
  const pollCloud = useCallback(async () => {
    try {
      const result = await syncListAccounts();
      setCloud({ enabled: result.enabled, accounts: result.accounts });
      if (result.enabled && result.accounts.length > 0) hydrateFromCloud(result.accounts);
    } catch {
      /* transient network error — keep the last snapshot */
    }
  }, []);

  useEffect(() => {
    void pollCloud();
    const timer = setInterval(() => void pollCloud(), 3000);
    return () => clearInterval(timer);
  }, [pollCloud]);

  const pushCloudUpdate = useCallback(
    (targetEmail: string, patch: AdminPatch) => {
      if (!account) return;
      const fail = () =>
        toast.error(`Could not save ${targetEmail} to the shared store — the change may be lost.`);
      void syncAdminUpdate({ data: { adminEmail: account.email, targetEmail, patch } })
        .then((result) => {
          if (result.enabled && !result.ok) fail();
        })
        .catch(fail);
    },
    [account],
  );

  if (!account) return null;
  if (account.role !== "admin")
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Admins only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This console is restricted to EA Migrate Pro administrators.
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

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/15 glow-ring">
              <BrandLogo className="size-full object-cover object-[50%_18%]" />
            </span>
            <span className="truncate text-sm font-bold uppercase sm:text-base">
              EA <span className="text-primary">Migrate</span> Admin
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {cloud.enabled ? (
              <span className="hidden sm:block">
                <LiveBadge enabled />
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

        {!cloud.enabled && (
          <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
            <p className="font-bold uppercase tracking-wide text-amber-300">Local-only mode</p>
            <p className="mt-1 leading-relaxed">
              No shared registration store is connected, so approvals are saved on{" "}
              <strong>this device only</strong>. Approve from the same phone/browser you use every
              time — or ask the workspace owner to connect Upstash Redis (Settings → Environment) to
              sync every device live.
            </p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            { label: "Pending portals", value: pending.length },
            { label: "Approved users", value: approved.length },
            { label: "Keys issued", value: totalLicenses },
            { label: "Paid emails", value: paidCount },
          ].map((stat) => (
            <div key={stat.label} className="panel p-4 glow-ring sm:p-5">
              <p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
              <p className="mt-1.5 text-2xl font-bold sm:mt-2 sm:text-3xl">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* ---------------- mentor list ---------------- */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Users className="size-4 text-primary" /> Mentor users
              </h2>
              <span className="text-xs text-muted-foreground">EA data stays private</span>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2">
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
                  <p className="text-sm font-semibold">License keys</p>
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
                            Linked to: {maskEaId(license.eaId || "legacy")} · Expiry:{" "}
                            {license.expiry || license.plan}
                          </p>
                          <div className="mt-3 flex gap-3">
                            <button
                              type="button"
                              onClick={() => toggleLicense(selected.id, license.id)}
                              className="text-xs font-semibold text-primary"
                            >
                              {license.active ? "Pause" : "Activate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLicense(selected.id, license.id)}
                              aria-label="Remove license"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
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
                          onClick={() => setEmailPaymentStatus(email, true)}
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
                          onClick={() => setEmailPaymentStatus(email, false)}
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

/** Small pulsing badge showing that live cross-device sync is active. */
function LiveBadge({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <span className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
      </span>
      Live sync
    </span>
  );
}
