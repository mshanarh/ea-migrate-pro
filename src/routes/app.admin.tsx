import { useCallback, useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { getAppState, requireAppAccess, useAppState, WHOP_CHECKOUT_URL } from "@/lib/app-store";
import { getUserByEmail } from "@/lib/supabase-users";
import { supabaseConfigured } from "@/lib/supabase";
import { adminClaimFirstAdmin, adminListUsers, adminSetUserAdmin, adminSetUserPaid } from "@/lib/supabase.server";
import type { UserRow } from "@/lib/supabase";

export const Route = createFileRoute("/app/admin")({
  ssr: false,
  beforeLoad: () => {
    // Same gates as the rest of the app: no email → /app/login, unpaid → checkout.
    const access = requireAppAccess(getAppState().email);
    if (access.action === "signin") throw redirect({ href: "/app/login" });
    if (access.action === "pay") throw redirect({ href: WHOP_CHECKOUT_URL });
  },
  head: () => ({
    meta: [
      { title: "Admin — EA Migrate Pro" },
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

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await adminListUsers();
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
      if (!supabaseConfigured) {
        setLoading(false);
        return;
      }
      // UI-level admin check: only DB admins see the controls.
      const me = app.email ? await getUserByEmail(app.email) : null;
      if (!cancelled) setIsAdmin(Boolean(me?.is_admin));
      await refresh();
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [app.email, refresh]);

  const setPaid = async (user: UserRow, value: boolean) => {
    setBusyEmail(user.email);
    const result = await adminSetUserPaid({ data: { email: user.email, value } });
    setBusyEmail(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update user");
      return;
    }
    toast.success(value ? `${user.email} approved` : `${user.email} set to unpaid`);
    await refresh();
  };

  const setAdmin = async (user: UserRow, value: boolean) => {
    setBusyEmail(user.email);
    const result = await adminSetUserAdmin({ data: { email: user.email, value } });
    setBusyEmail(null);
    if (!result.ok) {
      toast.error(result.error ?? "Could not update user");
      return;
    }
    toast.success(value ? `${user.email} is now an admin` : `Admin removed from ${user.email}`);
    await refresh();
  };

  if (!supabaseConfigured) {
    return (
      <Panel title="Supabase is not connected">
        <p className="text-sm leading-6 text-white/60">
          Add <Key>VITE_SUPABASE_URL</Key> and <Key>VITE_SUPABASE_ANON_KEY</Key> in Settings → Environment,
          plus <Key>SUPABASE_SERVICE_ROLE_KEY</Key> for the approve / make-admin buttons, then run the SQL in{" "}
          <span className="font-mono text-white/80">supabase/schema.sql</span>.
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
        <button
          type="button"
          onClick={() => void refresh()}
          className="h-11 shrink-0 rounded-full border border-primary/40 bg-primary/10 px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
        >
          Refresh
        </button>
      </div>

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
  );
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
    const result = await adminClaimFirstAdmin({ data: { email } });
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
