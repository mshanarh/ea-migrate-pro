import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, Check, KeyRound, LogOut, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  addLicense,
  generateKey,
  setLicenseLimit,
  removeLicense,
  setStatus,
  signOut,
  toggleLicense,
  useCurrentAccount,
  useStore,
  type Account,
} from "@/lib/auth-store";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin Console — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Approve mentor portals and issue licence keys across the EA Migrate Pro network.",
      },
      { property: "og:title", content: "Admin Console — EA Migrate Pro" },
      {
        property: "og:description",
        content: "Approve mentor portals and issue licence keys.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminConsole,
});

function AdminConsole() {
  const account = useCurrentAccount();
  const store = useStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!account) navigate({ to: "/signin" });
  }, [account, navigate]);

  if (!account) return null;

  if (account.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
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
  }

  const mentors = store.accounts.filter((a) => a.role === "mentor");
  const pending = mentors.filter((a) => a.status === "pending");
  const approved = mentors.filter((a) => a.status === "approved");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 glow-ring">
              <Bot className="size-4 text-primary" />
            </span>
            <span className="text-base font-bold uppercase">
              EA <span className="text-primary">Migrate</span> Admin
            </span>
          </Link>
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
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Control room</p>
        <h1 className="mt-1 text-3xl font-bold">Admin console</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Approve mentor portals and set how many licence keys each mentor may create.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Pending portals", value: pending.length },
            { label: "Approved mentors", value: approved.length },
            {
              label: "Licences issued",
              value: mentors.reduce((n, m) => n + m.licenses.length, 0),
            },
          ].map((s) => (
            <div key={s.label} className="panel p-5 glow-ring">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-4xl font-bold text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-lg font-bold">Pending approval</h2>
        {pending.length === 0 ? (
          <p className="panel mt-3 p-6 text-sm text-muted-foreground">
            No portals waiting for review.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((m) => (
              <li key={m.id} className="panel flex flex-wrap items-center gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{m.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {m.email} · {m.whatsapp || "no WhatsApp"}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setStatus(m.id, "approved");
                    toast.success(`${m.displayName} approved`);
                  }}
                  className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground"
                >
                  <Check className="size-4" /> Approve
                </button>
                <button
                  onClick={() => {
                    setStatus(m.id, "rejected");
                    toast(`${m.displayName} rejected`);
                  }}
                  className="flex h-10 items-center gap-2 rounded-full border border-border/70 px-4 text-sm font-semibold text-muted-foreground"
                >
                  <X className="size-4" /> Reject
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mt-10 text-lg font-bold">All mentor portals</h2>
        <div className="mt-3 space-y-3">
          {mentors.length === 0 ? (
            <p className="panel p-6 text-sm text-muted-foreground">No mentors registered yet.</p>
          ) : (
            mentors.map((m) => <MentorCard key={m.id} mentor={m} />)
          )}
        </div>
      </main>
    </div>
  );
}

function MentorCard({ mentor }: { mentor: Account }) {
  const [plan, setPlan] = useState("Standard");
  const [key, setKey] = useState(generateKey());
  const [limit, setLimit] = useState(String(mentor.licenseLimit));

  const saveLimit = () => {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid license limit of 0 or more.");
      return;
    }
    const nextLimit = Math.floor(value);
    setLicenseLimit(mentor.id, nextLimit);
    setLimit(String(nextLimit));
    toast.success("License limit saved");
  };

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{mentor.displayName}</p>
          <p className="truncate text-sm text-muted-foreground">{mentor.email}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
            mentor.status === "approved"
              ? "bg-primary/15 text-primary"
              : mentor.status === "rejected"
                ? "bg-destructive/15 text-destructive"
                : "bg-secondary text-muted-foreground"
          }`}
        >
          {mentor.status}
        </span>
        <select
          value={mentor.status}
          onChange={(e) => setStatus(mentor.id, e.target.value as Account["status"])}
          className="h-10 rounded-full border border-border/70 bg-card/60 px-4 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="mt-4 rounded-2xl bg-secondary/45 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">License allowance</p>
            <p className="text-xs text-muted-foreground">
              {mentor.licenses.length} of {mentor.licenseLimit} licenses used
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              aria-label="License limit"
              className="h-11 w-28 rounded-xl border border-border/70 bg-card/60 px-3 text-sm"
            />
            <button
              onClick={saveLimit}
              className="h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
            >
              Set limit
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="h-11 rounded-full border border-border/70 bg-card/60 px-4 text-sm"
        >
          <option>Standard</option>
          <option>Pro</option>
          <option>Lifetime</option>
        </select>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          className="h-11 min-w-[200px] flex-1 rounded-full border border-border/70 bg-card/60 px-4 font-mono text-sm"
        />
        <button
          onClick={() => setKey(generateKey())}
          className="h-11 rounded-full border border-border/70 px-4 text-sm font-semibold text-muted-foreground"
        >
          New key
        </button>
        <button
          onClick={() => {
            const result = addLicense(mentor.id, plan, key);
            if (result.error) {
              toast.error(result.error);
              return;
            }
            setKey(generateKey());
            toast.success("Licence added");
          }}
          className="flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground"
        >
          <KeyRound className="size-4" /> Add licence
        </button>
      </div>

      {mentor.licenses.length > 0 && (
        <ul className="mt-4 space-y-2">
          {mentor.licenses.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3"
            >
              <span className="flex-1 font-mono text-sm text-primary">{l.key}</span>
              <span className="text-xs text-muted-foreground uppercase">{l.plan}</span>
              <button
                onClick={() => toggleLicense(mentor.id, l.id)}
                className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold"
              >
                {l.active ? "Pause" : "Activate"}
              </button>
              <button
                onClick={() => removeLicense(mentor.id, l.id)}
                aria-label="Remove licence"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
