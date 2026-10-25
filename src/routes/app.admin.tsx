import { useCallback, useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { DraggableBotPopup } from "@/components/app/DraggableBotPopup";
import { Check, RadioTower, RotateCcw, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { appSignOut, getAppState, leaveForCheckout, useAppState } from "@/lib/app-store";
import { peekAccessVerdict, requireVerifiedAccess, type AppAccessCheck } from "@/lib/payment-gate";
import { OWNER_EMAILS } from "@/lib/auth-store";
import { countAdminsAnon, getUserByEmail, listUsersAnon, setUserFlagAnon } from "@/lib/portal-store";
import { portalStoreConfigured } from "@/lib/portal-store";
import { setAdminActor, setUserPaid as writePaymentLedger } from "@/lib/admin-store";
import { getBridgeUrl, setBridgeUrl } from "@/lib/bridge-client";
import type { UserRow } from "@/lib/portal-store";

export const Route = createFileRoute("/app/admin")({
  ssr: false,
  beforeLoad: () => {
    // Same gates as the rest of the app, cloud-verified: no email →
    // /app/login; an unpaid one → the checkout card on that page. An
    // external URL is not a valid router location, so the hop to Whop is
    // done by the login page itself.
    //
    // PAINT FIRST — the cached verdict renders synchronously and the cloud is
    // re-asked behind the screen (see peekAccessVerdict).
    const apply = (access: AppAccessCheck) => {
      if (access.action === "signin") throw redirect({ href: "/app/login" });
      // Access revoked by the owner (Set unpaid) — the gate signed the session
      // out; hand them the first page with the notice.
      if (access.action === "deactivate") throw redirect({ href: "/app/login?deactivated=1" });
      if (access.action === "pay") {
        leaveForCheckout();
        throw redirect({ href: "/app/login?pay=1" });
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
      { title: "Admin — EA Migrate" },
      { name: "description", content: "Approve users and manage admins from the Supabase user table." },
    ],
  }),
  component: AppAdmin,
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function AppAdmin() {
  const app = useAppState();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  // The user list is the most sensitive screen in the app, and nothing on it
  // may paint before the cloud confirms this session is allowed through —
  // that confirmation already happened in this route's own beforeLoad (one
  // requireVerifiedAccess resolution per navigation, awaited before this
  // component mounts). Start at "ok" so the verified screen opens instantly
  // instead of flashing "Checking your access…" on every visit; the effect
  // below remains the mid-session re-check and still redirects on a denial.
  const [access, setAccess] = useState<"checking" | "ok">("ok");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let result: { action: "pass" | "signin" | "pay" | "deactivate" | "retry" };
      try {
        result = await requireVerifiedAccess(app.email);
      } catch {
        result = { action: "pay" };
      }
      if (cancelled) return;
      if (result.action === "pass") {
        setAccess("ok");
        return;
      }
      // DEACTIVATED — this session's own account was set to unpaid. The gate
      // already signed it out; land it on the first page with the notice.
      if (result.action === "deactivate") {
        window.location.replace("/app/login?deactivated=1");
        return;
      }
      if (result.action === "retry") {
        // A source was unreadable — show the plain retry line, not the plans.
        window.location.replace("/app/login?verify=1");
        return;
      }
      if (result.action === "pay") {
        leaveForCheckout();
        window.location.replace("/app/login?pay=1");
        return;
      }
      window.location.replace("/app/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [app.email]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const anon = await listUsersAnon();
    const result = { enabled: portalStoreConfigured, users: anon.users, ...(anon.error ? { error: anon.error } : {}) };
    if (result.enabled && !result.error) {
      setUsers(result.users);
      setError(null);
    } else {
      setError(result.error ?? "Could not load users");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (!portalStoreConfigured) {
        setLoading(false);
        return;
      }
      // UI-level admin check: only admins see the controls. PLATFORM OWNERS
      // are admins BEFORE the database is consulted (the same rule
      // registerWithEmail applies) — their raw users row can lag (is_admin
      // false on a row created before the flag existed), which used to wall
      // the owner off this page so registered users never showed up.
      const me = app.email ? await getUserByEmail(app.email) : null;
      const owner = OWNER_EMAILS.includes((app.email ?? "").trim().toLowerCase());
      if (!cancelled) setIsAdmin(Boolean(me?.is_admin) || owner);
      await refresh();
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [app.email, refresh]);

  /**
 * Patch one row on screen after a confirmed write.
 *
 * Both toggles used to end with `await refresh()`, so the button came back the
 * instant the database committed but the row kept showing the OLD flag until
 * the whole list came back — which reads as a slow button. The value is known,
 * so paint it directly; the refresh below is only for external changes.
 */
  const patchUser = useCallback((email: string, patch: Partial<UserRow>) => {
    const target = email.trim().toLowerCase();
    setUsers((current) =>
      current.map((user) => (user.email.trim().toLowerCase() === target ? { ...user, ...patch } : user)),
    );
  }, []);

  /**
   * PAYMENT GOES THROUGH THE LEDGER, NOT THE MIRROR.
   *
   * `users.is_paid` is only a mirror. The app's access gate never reads it —
   * payment-gate.ts opens the app from /api/check-access, which answers from
   * the KV registration record and the `paid_emails` ledger. This button used
   * to write the mirror alone, so it toasted "approved" while the person was
   * still sent to checkout: marked paid, app never opened. It now writes the
   * same record the console's own Mark paid button does (KV + both mirrors, see
   * api/_handlers/admin-approve.ts), so being marked paid here really does open
   * the app and land the customer on the activation-code step.
   *
   * A refused write is reported instead of silently falling back to the mirror:
   * the mirror cannot open the app, and a success toast for it is the lie that
   * caused this bug.
   */
  const setPaid = async (user: UserRow, value: boolean) => {
    setBusyEmail(user.email);
    setAdminActor(app.email ?? "");
    const result = await writePaymentLedger(user.email, value);
    setBusyEmail(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update user");
      return;
    }
    toast.success(value ? `${user.email} approved` : `${user.email} set to unpaid`);
    patchUser(user.email, { is_paid: value });
    // DEACTIVATING THIS SESSION'S OWN EMAIL — the signed-in account just
    // lost its access, so kick it out to the first page right away (other
    // people's sessions are thrown out by the access gate on their own
    // device the next time it checks).
    if (!value && user.email.trim().toLowerCase() === (app.email ?? "").trim().toLowerCase()) {
      appSignOut();
      window.location.replace("/app/login?deactivated=1");
    }
  };

  const setAdmin = async (user: UserRow, value: boolean) => {
    setBusyEmail(user.email);
    const result = await setUserFlagAnon(user.email, { is_admin: value });
    setBusyEmail(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update user");
      return;
    }
    toast.success(value ? `${user.email} is now an admin` : `Admin removed from ${user.email}`);
    patchUser(user.email, { is_admin: value });
  };

  if (access !== "ok") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 pt-safe pb-safe-base text-white">
        <img src="/logo.png" alt="" className="size-16 rounded-2xl border border-white/10 bg-white/5 object-contain p-1" />
        <p className="text-sm font-semibold text-white/60">Checking your access…</p>
      </div>
    );
  }

  if (!portalStoreConfigured) {
    return (
      <Panel title="Account store is not connected">
        <p className="text-sm leading-6 text-white/60">
          Set <Key>KV_REST_API_URL</Key> and <Key>KV_REST_API_TOKEN</Key> in Settings → Environment. Every
          account, payment, licence key and device binding lives in that one store.
        </p>
      </Panel>
    );
  }

  if (isAdmin === false) {
    return (
      <Panel title="Admins only">
        <p className="text-sm leading-6 text-white/60">
          The signed-in email is not an admin in the Supabase <span className="font-mono">users</span> table.
          Ask an existing admin to press “Make Admin” for your email.
        </p>
        <OwnerBootstrap
          email={app.email}
          onClaimed={() => {
            setIsAdmin(true);
            void refresh();
          }}
        />
      </Panel>
    );
  }

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Supabase</p>
          <h1 className="mt-1 text-3xl font-bold">Registered users</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everyone who entered their email at <span className="font-mono">/app/login</span> — approve payment
            or grant admin, straight from the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/app/admin/reactivate"
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
          >
            <RotateCcw className="size-3.5" /> Reactivate
          </a>
          <button
            type="button"
            onClick={() => void refresh()}
            className="h-11 shrink-0 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
          >
            Refresh
          </button>
        </div>
      </div>

      <BridgeUrlPanel actorEmail={app.email ?? ""} />

      {error && (
        <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-white/50">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="mt-8 text-sm text-white/50">No registered users yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {users.map((user) => (
            <li
              key={user.id}
              className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{user.email}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Registered {formatDate(user.created_at)} ·{" "}
                  <span className={user.is_paid ? "font-semibold text-emerald-300" : "font-semibold text-amber-300"}>
                    {user.is_paid ? "Paid" : "Unpaid"}
                  </span>{" "}
                  ·{" "}
                  <span className={user.is_admin ? "font-semibold text-primary" : ""}>
                    {user.is_admin ? "Admin" : "User"}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {user.is_paid ? (
                  <AdminButton icon={<UserX className="size-4" />} label="Set unpaid" busy={busyEmail === user.email} onClick={() => void setPaid(user, false)} />
                ) : (
                  <AdminButton icon={<UserCheck className="size-4" />} label="Approve" primary busy={busyEmail === user.email} onClick={() => void setPaid(user, true)} />
                )}
                {user.is_admin ? (
                  <AdminButton icon={<ShieldOff className="size-4" />} label="Remove admin" busy={busyEmail === user.email} onClick={() => void setAdmin(user, false)} />
                ) : (
                  <AdminButton icon={<ShieldCheck className="size-4" />} label="Make Admin" busy={busyEmail === user.email} onClick={() => void setAdmin(user, true)} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
      <DraggableBotPopup />
    </>
  );
}

/**
 * THE TRADING BRIDGE'S ADDRESS — editable here, applied without a redeploy.
 *
 * The bridge runs behind a cloudflared quick tunnel whose hostname changes on
 * every restart. It used to be a build-time constant in the app, so a new
 * tunnel meant a code change and a deploy before any quote or order could go
 * through again. The address now lives in KV (`/api/bridge-config`) and the app
 * reads it at start-up; saving here re-points every device at the new tunnel on
 * its next launch.
 */
function BridgeUrlPanel({ actorEmail }: { actorEmail: string }) {
  const [value, setValue] = useState(getBridgeUrl());
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const reply = await fetch("/api/bridge-config", { cache: "no-store", headers: { accept: "application/json" } });
        const payload = (await reply.json().catch(() => null)) as { ok?: boolean; url?: unknown } | null;
        if (cancelled) return;
        if (payload && payload.ok === true && typeof payload.url === "string" && payload.url.trim()) {
          setValue(payload.url.trim());
          setSaved(payload.url.trim());
          setNote(null);
          return;
        }
        if (!reply.ok) setNote("Bridge settings store is unavailable — this device keeps its current address.");
      } catch {
        if (!cancelled) setNote("Bridge settings store is unreachable — this device keeps its current address.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!actorEmail.trim()) {
      toast.error("Sign in as an admin to change the bridge address.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const reply = await fetch("/api/bridge-config", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-email": actorEmail },
        body: JSON.stringify({ url: value.trim() }),
      });
      const payload = (await reply.json().catch(() => null)) as { ok?: boolean; url?: unknown; error?: string } | null;
      if (!reply.ok || !payload || payload.ok !== true) {
        toast.error(payload?.error ?? "Could not save the bridge address.");
        setNote("Save refused by the server — nothing changed.");
        return;
      }
      const url = typeof payload.url === "string" ? payload.url : normalizeBridgeInput(value);
      const applied = setBridgeUrl(url);
      if (applied) {
        setValue(applied);
        setSaved(applied);
      }
      toast.success("Bridge address saved — devices pick it up on their next launch.");
    } catch {
      toast.error("Bridge settings store is unreachable — nothing changed.");
      setNote("Bridge settings store is unreachable — nothing changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mt-6 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <RadioTower className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Trading bridge</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The address the app calls for prices, candles and orders. The tunnel hostname changes whenever
            cloudflared restarts — paste the new one here and it applies to every device on its next launch, no deploy
            needed.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://your-tunnel.trycloudflare.com"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-white/12 bg-white/[0.04] px-4 font-mono text-xs outline-none placeholder:text-white/25 focus:border-primary/60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !value.trim()}
          className="h-12 shrink-0 rounded-2xl bg-primary px-5 text-xs font-black uppercase text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save address"}
        </button>
      </div>
      {note && <p className="mt-2 text-xs leading-relaxed text-amber-300">{note}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">
        In use now: <span className="font-mono text-white/70">{saved ?? getBridgeUrl()}</span>
      </p>
    </section>
  );
}

/** The same http(s) rule the endpoint applies, so the UI shows what was stored. */
function normalizeBridgeInput(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

/**
 * One-click bootstrap for the platform owner while the users table has no
 * admin. Invisible for everyone else; refuses once any admin exists.
 */
function OwnerBootstrap({ email, onClaimed }: { email: string | null; onClaimed: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!email) return null;
  const claim = async () => {
    setBusy(true);
    if (!OWNER_EMAILS.includes(email.toLowerCase())) {
      toast.error("Only the platform owner can bootstrap the first admin");
      setBusy(false);
      return;
    }
    if ((await countAdminsAnon()) > 0) {
      toast.error("An admin already exists");
      setBusy(false);
      return;
    }
    const result = await setUserFlagAnon(email, { is_admin: true });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? "Could not claim admin");
      return;
    }
    toast.success("You are now the first admin.");
    onClaimed();
  };
  return (
    <button
      type="button"
      onClick={() => void claim()}
      disabled={busy}
      className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.02] disabled:cursor-wait disabled:opacity-60"
    >
      <ShieldCheck className="size-4" /> {busy ? "Claiming…" : "I am the platform owner — make me the first admin"}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/12 glow-ring">
        <Check className="size-7 text-primary" />
      </span>
      <h1 className="mt-5 text-2xl font-bold">{title}</h1>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-white/85">{children}</span>;
}

function AdminButton({
  icon,
  label,
  onClick,
  busy,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors disabled:cursor-wait disabled:opacity-60 ${
        primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-white/15 text-white/75 hover:border-white/35 hover:text-white"
      }`}
    >
      {icon} {busy ? "Saving…" : label}
    </button>
  );
}
