import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, CheckCircle2, ChevronRight, CreditCard, LogOut, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_EXEMPT_EMAILS, maskEaId, paymentStatusForEmail, removeLicense, setEmailPaymentStatus, setLicenseLimit, setStatus, signOut, toggleLicense, useCurrentAccount, useStore, hydrateFromCloud, type Account } from "@/lib/auth-store";
import { syncAdminUpdate, syncListAccounts, syncSetPayment, type AdminPatch, type PublicAccount } from "@/lib/account-sync.server";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/admin")({ ssr: false, head: () => ({ meta: [{ title: "Admin Console — EA Migrate Pro" }] }), component: AdminConsole });

/** Local Account minus password — cloud records arrive without it. */
type AdminViewAccount = Omit<Account, "password">;

function AdminConsole() {
  const account = useCurrentAccount();
  const store = useStore();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tabbed mentor list: the console opens on Pending so new sign-ups waiting
  // for approval are the first thing the admin sees.
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [limit, setLimit] = useState(0);
  const [cloud, setCloud] = useState<{ enabled: boolean; accounts: PublicAccount[] }>({ enabled: false, accounts: [] });
  // Hooks must run before any early return — merging local + cloud mentors.
  const mentors: AdminViewAccount[] = useMemo(() => {
    const known = new Set(store.accounts.map((candidate) => candidate.email.toLowerCase()));
    const cloudOnly = cloud.accounts.filter((candidate) => !known.has(candidate.email.toLowerCase()) && candidate.role === "mentor");
    return [...store.accounts.filter((candidate) => candidate.role === "mentor"), ...cloudOnly];
  }, [cloud.accounts, store.accounts]);
  useEffect(() => { if (!account) navigate({ to: "/signin" }); }, [account, navigate]);
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
  if (!account) return null;
  if (account.role !== "admin") return <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-6 text-center text-white"><div><h1 className="text-2xl font-bold">Admins only</h1><p className="mt-2 text-sm text-muted-foreground">This console is restricted to EA Migrate Pro administrators.</p><Link to="/dashboard" className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground">Back to portal</Link></div></div>;

  const selected = mentors.find((mentor) => mentor.id === selectedId) ?? null;
  const pending = mentors.filter((mentor) => mentor.status === "pending");
  const approved = mentors.filter((mentor) => mentor.status === "approved");
  const rejected = mentors.filter((mentor) => mentor.status === "rejected");
  const visibleMentors = tab === "pending" ? pending : tab === "approved" ? approved : rejected;
  const totalLicenses = mentors.reduce((total, mentor) => total + mentor.licenses.length, 0);
  const paymentEmails = Array.from(new Set([...PAYMENT_EXEMPT_EMAILS, ...store.payments.map((payment) => payment.email), ...mentors.map((mentor) => mentor.email)])).sort();
  const paidCount = paymentEmails.filter((email) => paymentStatusForEmail(email) !== "unpaid").length;
  const selectMentor = (mentor: AdminViewAccount) => { setSelectedId(mentor.id); setLimit(mentor.licenseLimit); };
  const saveLimit = () => { if (!selected) return; setLicenseLimit(selected.id, limit); pushCloudUpdate(selected.email, { licenseLimit: limit }); toast.success("Maximum keys updated"); };
  // Mirror admin changes to the shared cloud store so they reach the mentor's
  // device too (no-op when KV is not configured).
  const pushCloudUpdate = (targetEmail: string, patch: AdminPatch) => {
    if (!account) return;
    void syncAdminUpdate({ data: { adminEmail: account.email, targetEmail, patch } });
  };

  return <div className="min-h-screen bg-[#0A0A0A] text-white"><header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"><Link to="/" className="flex items-center gap-2"><span className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-primary/15 glow-ring"><BrandLogo className="size-full object-cover object-[50%_18%]" /></span><span className="text-base font-bold uppercase">EA <span className="text-primary">Migrate</span> Admin</span></Link><div className="flex items-center gap-3">{cloud.enabled ? <LiveBadge enabled /> : <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">Shared registration sync unavailable</span>}</div><button onClick={() => { signOut(); navigate({ to: "/signin" }); }} className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card/60" aria-label="Log out"><LogOut className="size-4" /></button></div></header><main className="mx-auto max-w-6xl px-5 py-8"><p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Privacy control room</p><h1 className="mt-1 text-3xl font-bold">Admin console</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Manage mentor approval, admin-set key allowances, payment status, and one-device activation records.</p><div className="mt-6 grid gap-4 sm:grid-cols-4">{[{ label: "Pending portals", value: pending.length }, { label: "Approved users", value: approved.length }, { label: "Keys issued", value: totalLicenses }, { label: "Paid emails", value: paidCount }].map((stat) => <div key={stat.label} className="panel p-5 glow-ring"><p className="text-sm text-muted-foreground">{stat.label}</p><p className="mt-2 text-3xl font-bold">{stat.value}</p></div>)}</div><div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-4 text-primary" /> Mentor users</h2><span className="text-xs text-muted-foreground">EA data stays private</span></div><div className="mb-3 grid grid-cols-3 gap-2">{([["pending", "Pending", pending], ["approved", "Approved", approved], ["rejected", "Rejected", rejected]] as const).map(([key, label, list]) => <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? "flex h-10 items-center justify-center gap-2 rounded-2xl border border-primary/60 bg-primary/15 text-xs font-bold uppercase tracking-wide text-primary" : "flex h-10 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"}>{label}<span className={tab === key ? "rounded-full bg-primary/20 px-2 py-0.5 text-[10px]" : "rounded-full bg-secondary px-2 py-0.5 text-[10px]"}>{list.length}</span></button>)}</div><div className="space-y-3">{visibleMentors.length === 0 && <p className="rounded-2xl border border-border/60 bg-secondary/30 p-6 text-center text-sm text-muted-foreground">No {tab} users right now.</p>}{visibleMentors.map((mentor) => { const remaining = Math.max(mentor.licenseLimit - mentor.licenses.length, 0); const payment = paymentStatusForEmail(mentor.email); return <button key={mentor.id} type="button" onClick={() => selectMentor(mentor)} className={selected?.id === mentor.id ? "panel flex w-full items-center gap-4 border-primary/60 bg-primary/5 p-5 text-left" : "panel flex w-full items-center gap-4 p-5 text-left hover:border-primary/30"}><div className="min-w-0 flex-1"><p className="truncate font-semibold">{mentor.email}</p><p className="mt-1 text-xs text-muted-foreground">{mentor.eas.length} EAs · {mentor.licenses.filter((license) => license.active).length} active keys · {mentor.licenseLimit} allowed · {remaining} left</p></div><span className={payment === "unpaid" ? "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground" : "rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold uppercase text-emerald-300"}>{payment === "admin" ? "Admin" : payment}</span><span className={mentor.status === "approved" ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary" : mentor.status === "rejected" ? "rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold uppercase text-destructive" : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"}>{mentor.status}</span>{!knownLocally(mentor) && <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-300">New</span>}<ChevronRight className="size-4 text-muted-foreground" /></button>; })}</div></section><section className="panel p-5">{!selected ? <div className="flex min-h-56 items-center justify-center text-center"><p className="max-w-xs text-sm text-muted-foreground">Select a mentor to manage approval and the exact key allowance available on their dashboard.</p></div> : <><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">User record</p><h2 className="mt-1 break-all text-lg font-semibold">{selected.email}</h2></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close user details" className="text-muted-foreground"><X className="size-5" /></button></div><div className="mt-4 grid grid-cols-3 gap-2"><MiniStat label="EAs" value={selected.eas.length} icon={<Bot className="size-4" />} /><MiniStat label="Active keys" value={selected.licenses.filter((license) => license.active).length} icon={<CheckCircle2 className="size-4" />} /><MiniStat label="Payment" value={paymentStatusForEmail(selected.email) === "unpaid" ? "Unpaid" : "Paid"} icon={<CreditCard className="size-4" />} /></div><div className="mt-5 flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Portal status</span><select value={selected.status} onChange={(event) => { const next = event.target.value as Account["status"]; setStatus(selected.id, next); pushCloudUpdate(selected.email, { status: next }); }} className="h-10 rounded-full border border-border/70 bg-card/60 px-4 text-sm"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>{selected.status === "pending" && <><button type="button" onClick={() => { setStatus(selected.id, "approved"); pushCloudUpdate(selected.email, { status: "approved" }); setSelectedId(null); toast.success(`${selected.email} approved`); }} className="h-10 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground">Approve</button><button type="button" onClick={() => { setStatus(selected.id, "rejected"); pushCloudUpdate(selected.email, { status: "rejected" }); setSelectedId(null); toast.success(`${selected.email} rejected`); }} className="h-10 rounded-full bg-destructive/20 px-5 text-sm font-bold text-destructive">Reject</button></>}{selected.status === "rejected" && <button type="button" onClick={() => { setStatus(selected.id, "approved"); pushCloudUpdate(selected.email, { status: "approved" }); toast.success(`${selected.email} approved`); }} className="h-10 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground">Move to Approved</button>}{selected.status === "approved" && <button type="button" onClick={() => { setStatus(selected.id, "rejected"); pushCloudUpdate(selected.email, { status: "rejected" }); toast.success(`${selected.email} rejected`); }} className="h-10 rounded-full bg-destructive/20 px-5 text-sm font-bold text-destructive">Revoke access</button>}</div><div className="mt-4 rounded-2xl bg-secondary/45 p-4"><p className="text-sm font-semibold">Max keys allowed</p><p className="mt-1 text-xs text-muted-foreground">Available keys are no longer fixed at 100. This is the allowance shown to the mentor.</p><div className="mt-3 flex gap-2"><input type="number" min="0" step="1" value={limit} onChange={(event) => setLimit(Number(event.target.value))} className="h-11 w-28 rounded-xl border border-border/70 bg-card/60 px-3 text-sm" aria-label="Maximum keys allowed" /><button type="button" onClick={saveLimit} className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Save</button></div></div><div className="mt-5"><p className="text-sm font-semibold">License keys</p>{selected.licenses.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No keys created.</p> : <ul className="mt-3 space-y-2">{selected.licenses.map((license) => <li key={license.id} className="rounded-2xl bg-secondary/50 p-4"><div className="flex flex-wrap items-center gap-2"><span className="flex-1 font-mono text-sm text-primary">{license.key}</span><span className={license.active ? "rounded-full bg-primary/15 px-2 py-1 text-[10px] font-semibold uppercase text-primary" : "rounded-full bg-background/60 px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground"}>{license.active ? "Active" : "Paused"}</span></div><p className="mt-2 text-xs text-muted-foreground">Linked to: {maskEaId(license.eaId || "legacy")} · Expiry: {license.expiry || license.plan}</p><div className="mt-3 flex gap-3"><button type="button" onClick={() => toggleLicense(selected.id, license.id)} className="text-xs font-semibold text-primary">{license.active ? "Pause" : "Activate"}</button><button type="button" onClick={() => removeLicense(selected.id, license.id)} aria-label="Remove license" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button></div></li>)}</ul>}</div></>}</section></div><section className="panel mt-6 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><CreditCard className="size-4 text-primary" /> Payment status</h2><p className="mt-1 text-sm text-muted-foreground">Whop return status and admin exemptions visible by email.</p></div><ShieldCheck className="size-5 text-primary" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{paymentEmails.map((email) => { const status = paymentStatusForEmail(email); const record = store.payments.find((payment) => payment.email === email); return <div key={email} className="rounded-2xl border border-border/60 bg-secondary/30 p-4"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-semibold">{email}</span><span className={status === "unpaid" ? "text-xs font-bold uppercase text-muted-foreground" : "text-xs font-bold uppercase text-emerald-300"}>{status === "admin" ? "Admin — free" : status}</span></div><p className="mt-2 text-xs text-muted-foreground">{record?.paidAt && status === "paid" ? "Paid on " + new Date(record.paidAt).toLocaleString() : status === "admin" ? "Payment bypass enabled" : "Unpaid — app access blocked"}</p>{status !== "admin" && <div className="mt-3 flex gap-2"><button type="button" onClick={() => setEmailPaymentStatus(email, true)} className={status === "paid" ? "h-9 flex-1 rounded-xl bg-emerald-400/20 text-xs font-bold uppercase text-emerald-300" : "h-9 flex-1 rounded-xl bg-secondary text-xs font-bold uppercase text-muted-foreground hover:text-foreground"}>Paid</button><button type="button" onClick={() => setEmailPaymentStatus(email, false)} className={status === "unpaid" ? "h-9 flex-1 rounded-xl bg-destructive/20 text-xs font-bold uppercase text-destructive" : "h-9 flex-1 rounded-xl bg-secondary text-xs font-bold uppercase text-muted-foreground hover:text-foreground"}>Unpaid</button></div>}</div>; })}</div></section></main></div>;
}

function MiniStat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) { return <div className="rounded-2xl bg-secondary/45 p-3"><div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div><p className="mt-1 text-lg font-bold">{value}</p></div>; }

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
