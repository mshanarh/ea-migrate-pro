import { useState, useEffect, useCallback } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, ShieldCheck, Loader2 } from "lucide-react";
import { appSignOut, getAppState, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { OWNER_EMAILS } from "@/lib/auth-store";
import { getUserByEmail, reactivateEmail } from "@/lib/portal-store";

/** Reactivation is admin-only: only biyasentobeko222@gmail.com (the sole admin)
 * may access this page. The route guard and the API call both verify admin status. */

export const Route = createFileRoute("/app/admin/reactivate")({
  ssr: false,
  beforeLoad: () => {
    // Same gates as the rest of the app, cloud-verified.
    const apply = (access: AppAccessCheck) => {
      if (access.action === "signin") throw redirect({ href: "/app/login" });
      if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
      if (access.action === "pay") {
        // Don't send to checkout — this is an admin page. Just redirect to login.
        throw redirect({ href: "/app/login" });
      }
    };
    const email = getAppState().email;
    const cached = peekAccessVerdict(email);
    if (cached) {
      apply(cached);
      return;
    }
    return requireVerifiedAccess(email).then(apply);
  },
  head: () => ({
    meta: [
      { title: "Reactivate — Admin — EA Migrate" },
      { name: "description", content: "Reactivate paid accounts by clearing their device binding." },
    ],
  }),
  component: ReactivationPage,
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ReactivationPage() {
  const app = useAppState();
  const [emailInput, setEmailInput] = useState("");
  const [reactivating, setReactivating] = useState(false);
  const [recentReactivations, setRecentReactivations] = useState<Array<{
    email: string;
    reactivatedAt: string;
  }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Verify this is an admin — only OWNER_EMAILS (biyasentobeko222@gmail.com) may access.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const me = app.email ? await getUserByEmail(app.email) : null;
      const owner = OWNER_EMAILS.includes((app.email ?? "").trim().toLowerCase());
      if (!cancelled) setIsAdmin(Boolean(me?.is_admin) || owner);
      // Load past reactivations from localStorage
      if (!cancelled) {
        try {
          const saved = window.localStorage.getItem("eamp.reactivations");
          if (saved) {
            const parsed = JSON.parse(saved) as Array<{ email: string; reactivatedAt: string }>;
            setRecentReactivations(Array.isArray(parsed) ? parsed.slice(0, 50).reverse() : []);
          }
        } catch {
          // ignore corrupt data
        }
      }
      setLoadingHistory(false);
    };
    void boot();
    return () => { cancelled = true; };
  }, [app.email]);

  const performReactivation = useCallback(async () => {
    if (!emailInput.trim() || reactivating || !isAdmin) return;
    const email = emailInput.trim().toLowerCase();
    setReactivating(true);
    try {
      // Server-side unbind (KV). The admin's own address authorises it.
      const result = await reactivateEmail(email, app.email ?? undefined);
      if (!result.ok) {
        toast.error(result.error ?? "Reactivation failed");
        return;
      }
      toast.success(`${email} reactivated at ${formatDate(result.clearedAt ?? new Date().toISOString())}`);
      // Record in localStorage for the history list
      const record = { email, reactivatedAt: result.clearedAt ?? new Date().toISOString() };
      try {
        const existing = window.localStorage.getItem("eamp.reactivations");
        let list = existing ? JSON.parse(existing) : [];
        if (Array.isArray(list)) {
          list.push(record);
          if (list.length > 200) list = list.slice(-200);
          window.localStorage.setItem("eamp.reactivations", JSON.stringify(list));
        }
      } catch {
        // ignore
      }
      setRecentReactivations((prev) => [record, ...prev].slice(0, 50));
      setEmailInput("");
    } finally {
      setReactivating(false);
    }
  }, [emailInput, reactivating, isAdmin]);

  // Admin check — only the platform owner may access this page.
  if (loadingHistory && isAdmin === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 pt-safe pb-safe-base text-white">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-semibold text-white/60">Loading…</p>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 pt-safe pb-safe-base text-white">
        <ShieldCheck className="size-12 text-primary" />
        <h1 className="text-2xl font-bold">Admins only</h1>
        <p className="text-sm text-white/60 text-center max-w-md">
          This page is for administrators only. Only biyasentobeko222@gmail.com may access it.
        </p>
        <a
          href="/app/admin"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white/80 transition hover:border-white/35 hover:text-white"
        >
          <ArrowLeft className="size-4" /> Back to admin
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Admin</p>
          <h1 className="mt-1 text-3xl font-bold flex items-center gap-2">
            <RotateCcw className="size-7" /> Reactivate Accounts
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Clear a paid account's device binding so they can sign in again.
            This does NOT mark an unpaid email as paid — it only clears the used/bound state.
          </p>
        </div>
        <a
          href="/app/admin"
          className="h-11 shrink-0 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
        >
          <ArrowLeft className="size-4 mr-1" /> Admin
        </a>
      </div>

      {/* Reactivation form */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:rounded-[20px]">
        <h2 className="text-lg font-semibold">Reactivate an account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the email of a paid account that is blocked on another device.
          This clears their device binding so they can sign in again on this device.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); void performReactivation(); }}
          className="mt-5 space-y-4"
        >
          <div>
            <label
              htmlFor="reactivate-email"
              className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground"
            >
              Email
            </label>
            <input
              id="reactivate-email"
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="customer@email.com"
              className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-black/40 px-5 text-lg text-white outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <button
            type="submit"
            disabled={!emailInput.trim() || reactivating}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-[0_0_30px_rgba(8,168,239,.34)] transition-transform active:scale-[.98] disabled:cursor-wait disabled:opacity-70"
          >
            {reactivating ? (
              <>
                <Loader2 className="size-6 animate-spin" /> Reactivating…
              </>
            ) : (
              <>
                <RotateCcw className="size-6" /> Reactivate Account
              </>
            )}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Unlimited reactivations. No token cost. Only clears device binding — does not change payment status.
        </p>
      </div>

      {/* Past reactivations */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:rounded-[20px]">
        <h2 className="text-lg font-semibold">Past reactivations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A log of accounts that have been reactivated, most recent first.
        </p>
        {loadingHistory ? (
          <p className="mt-4 text-sm text-white/50">Loading…</p>
        ) : recentReactivations.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground/70">
            No reactivations yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {recentReactivations.map((record, index) => (
              <li
                key={`${record.email}-${record.reactivatedAt}-${index}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm"
              >
                <span className="truncate font-medium text-white">{record.email}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {formatDate(record.reactivatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
