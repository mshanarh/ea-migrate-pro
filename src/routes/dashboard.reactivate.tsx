import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Check, Copy, Lock, RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OWNER_EMAILS, useCurrentAccount } from "@/lib/auth-store";
import { getReactivationEnabled, getUserByEmail } from "@/lib/supabase-users";

export const Route = createFileRoute("/dashboard/reactivate")({
  ssr: false,
  component: ReactivateClientPage,
});

/**
 * CLIENT ACCESS — Re-activate Client (its OWN dedicated page, like every
 * other portal page — never crammed onto the Generate Key screen).
 *
 * What it does: release a paid client's device binding so they can sign in
 * on a new phone/laptop WITHOUT touching their licence key, subscription
 * or expiry dates.
 *
 * WHO CAN USE IT:
 *  • ADMINS (owner emails / admin role) are ALWAYS unlocked — reactivation
 *    is never locked for them, no admin toggle needed.
 *  • Mentors must be unlocked by an admin (users.reactivation_enabled,
 *    the 🔒 next to Approve in the admin console).
 */

const GUARANTEES = [
  {
    icon: ShieldCheck,
    title: "Paid clients only",
    body: "Unpaid emails are refused — reactivation works only for emails that have paid.",
  },
  {
    icon: Users,
    title: "Your clients only",
    body: "Only emails registered on the platform can be released; anything else is rejected.",
  },
  {
    icon: CalendarClock,
    title: "Dates protected",
    body: "Expiry dates, licence keys and the subscription are never touched.",
  },
];

function ReactivateClientPage() {
  const account = useCurrentAccount();
  // Admins bypass the per-mentor lock entirely.
  const isAdmin = !!account && (account.role === "admin" || OWNER_EMAILS.includes(account.email));
  const [cloudAllowed, setCloudAllowed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Mentors: load the cloud lock. Admins skip it — always unlocked.
  useEffect(() => {
    if (!account || isAdmin) return;
    let cancelled = false;
    void getReactivationEnabled(account.email).then((allowed) => {
      if (!cancelled) setCloudAllowed(allowed);
    });
    return () => {
      cancelled = true;
    };
  }, [account, isAdmin]);

  if (!account) return null;
  const allowed = isAdmin || cloudAllowed;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/reactivate`);
      setCopied(true);
      toast.success("Page link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — copy the URL from the address bar.");
    }
  };

  /**
   * RE-ACTIVATE a client — enforced by the CLOUD row, not by UI state:
   *   • the email must be PAID (unpaid → "reactivation works only for paid users")
   *   • the email must exist in users (a forged/foreign email → "not your email")
   *   • releasing a device never touches expiry dates or the subscription
   * Admins skip the lock re-check — reactivation is automatically unlocked
   * for admin accounts.
   */
  const handleReactivateClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = clientEmail.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusy(true);
    setError("");
    if (!isAdmin) {
      // Re-check the permission at action time (the admin may have re-locked).
      const stillAllowed = await getReactivationEnabled(account.email);
      if (!stillAllowed) {
        setBusy(false);
        setCloudAllowed(false);
        setError("Locked by your admin — reactivation is not enabled for your account.");
        return;
      }
    }
    // Verify the client: paid + real user, through the same cloud rules the
    // app's own reactivation uses. A "device id" is not needed for the
    // mentor tool — the release simply clears the binding so the client can
    // sign in fresh anywhere.
    const user = await getUserByEmail(cleanEmail);
    if (!user) {
      setBusy(false);
      setError("Not reactivated — this is not your client's registered email. Reactivation works only for the email the client registered with.");
      return;
    }
    if (!user.is_paid) {
      setBusy(false);
      setError("Not reactivated — this email has not paid. Reactivation works only for paid users.");
      return;
    }
    // Clear the cloud device binding (set device fields to null).
    const { supabase } = await import("@/lib/supabase");
    const { error: updateError } = await supabase!
      .from("users")
      .update({ device_email: null, device_id: null })
      .eq("email", cleanEmail);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setClientEmail("");
    toast.success(`${cleanEmail} reactivated — they can sign in on a new device now.`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Client access</p>
      <h1 className="mt-1 text-3xl font-bold">Re-activate Client</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Release a paid client's device so they can sign in on a new one — keys, dates and subscriptions stay exactly as they are.
      </p>

      <div className="panel mt-6 p-6">
        {/* Header card with Copy link + lock badge */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <RefreshCcw className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Client access</p>
              <h2 className="text-xl font-bold">Re-activate Client</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {allowed ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase text-emerald-300">
                <ShieldCheck className="size-3" /> Unlocked{isAdmin ? " · Admin" : ""}
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase text-amber-300">
                <Lock className="size-3" /> Locked
              </span>
            )}
            <Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={() => void copyLink()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy link
            </Button>
          </div>
        </div>

        {/* Three guarantees */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {GUARANTEES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon className="size-5" />
              </span>
              <p className="mt-3 text-sm font-bold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        {/* Info banner — expiry dates are safe */}
        <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-primary">
            <CalendarClock className="size-4" /> Expiry dates are protected
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Re-activating only clears the old device binding. The client keeps their licence key, their EA and the exact time left on
            their subscription — they simply sign in on the new device and continue where they stopped.
          </p>
        </div>

        {allowed ? (
          <form className="mt-5 space-y-3" onSubmit={(event) => void handleReactivateClient(event)}>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Client email</span>
              <input
                type="email"
                required
                value={clientEmail}
                onChange={(event) => {
                  setClientEmail(event.target.value);
                  setError("");
                }}
                placeholder="user@example.com"
                className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/30 focus:border-primary/60"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-400/10 p-3 text-sm font-semibold text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy} className="h-14 w-full rounded-full text-base font-bold">
              <RefreshCcw className="size-4" /> {busy ? "Reactivating…" : "Re-activate"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Paid clients only · dates protected · the previous device is signed out.
            </p>
          </form>
        ) : (
          <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-300">
              <Lock className="size-4" /> Locked by your admin
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Ask your admin to unlock reactivation for your account. Once unlocked, you can release a paid client's device here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
