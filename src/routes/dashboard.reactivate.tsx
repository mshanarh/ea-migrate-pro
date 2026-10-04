import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  Coins,
  Copy,
  ExternalLink,
  Lock,
  PlusCircle,
  RefreshCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OWNER_EMAILS, isPaymentExemptEmail, useCurrentAccount } from "@/lib/auth-store";
import { emailHasLicenseKey, getReactivationEnabled, getUserByEmail } from "@/lib/supabase-users";

export const Route = createFileRoute("/dashboard/reactivate")({
  ssr: false,
  component: ReactivateClientPage,
});

// Configure your Whop checkout link for tokens here — set the
// VITE_TOKEN_CHECKOUT_URL env var in Vercel (or edit the fallback below).
const TOKEN_CHECKOUT_URL = (import.meta.env["VITE_TOKEN_CHECKOUT_URL"] as string | undefined) || "https://whop.com/checkout/plan_pAzDfC1tIC9p3";
const TOKEN_PRICE_ZAR = 100;
/** Admins never run out: their balance is pinned to 1,000,000 tokens. */
const ADMIN_TOKEN_BALANCE = 1_000_000;

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

function getStoredTokens(email: string): number {
  if (typeof window === "undefined") return 0;
  const key = `eamp.tokens.${email.toLowerCase()}`;
  const stored = window.localStorage.getItem(key);
  return stored !== null ? Number(stored) : 0;
}

function setStoredTokens(email: string, amount: number) {
  if (typeof window === "undefined") return;
  const key = `eamp.tokens.${email.toLowerCase()}`;
  window.localStorage.setItem(key, Math.max(0, amount).toString());
}

function ReactivateClientPage() {
  const account = useCurrentAccount();
  const isAdmin = !!account && (account.role === "admin" || OWNER_EMAILS.includes(account.email));
  const [cloudAllowed, setCloudAllowed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Token state
  const [tokens, setTokens] = useState(0);
  const [selectedTokens, setSelectedTokens] = useState<number>(1);

  useEffect(() => {
    if (!account) return;
    // ADMINS: pin the balance to 1,000,000 — reactivation is never
    // token-limited for the platform owner.
    if (isAdmin) {
      setStoredTokens(account.email, ADMIN_TOKEN_BALANCE);
      setTokens(ADMIN_TOKEN_BALANCE);
      return;
    }
    setTokens(getStoredTokens(account.email));
  }, [account, isAdmin]);

  // Mentors: load cloud lock
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
  /**
   * ADMIN-ONLY — releasing a device is a platform decision.
   *
   * The nav entry is already hidden from mentors (PortalLayout marks this item
   * `adminOnly`), but the URL still resolves and a bookmark still works. This
   * is the guard that actually stops it: without it, hiding a menu item would
   * be the only thing standing between a mentor and the power to release any
   * account on the platform.
   */
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="panel mt-6 p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Lock className="size-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold">Admins only</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Re-activating a client is handled by the platform admins. If a paid client needs a new
                device, message support on WhatsApp and an admin will release it.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
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

  const handleBuyTokens = () => {
    window.open(TOKEN_CHECKOUT_URL, "_blank");
  };

  const handleClaimTokens = (amountToAdd: number) => {
    const updated = tokens + amountToAdd;
    setStoredTokens(account.email, updated);
    setTokens(updated);
    toast.success(`Success! Added ${amountToAdd} token(s). Current balance: ${updated}`);
  };

  const handleReactivateClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = clientEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    // Check token balance (admins can bypass if balance is 0)
    if (tokens < 1 && !isAdmin) {
      setError("No reactivation tokens left. Each reactivation costs 1 token (R100). Please purchase tokens above.");
      return;
    }

    setBusy(true);
    setError("");

    if (!isAdmin) {
      const stillAllowed = await getReactivationEnabled(account.email);
      if (!stillAllowed) {
        setBusy(false);
        setCloudAllowed(false);
        setError("Locked by your admin — reactivation is not enabled for your account.");
        return;
      }
    }

    const user = await getUserByEmail(cleanEmail);
    if (!user) {
      setBusy(false);
      setError("Not reactivated — this is not your client's registered email. Reactivation works only for registered clients.");
      return;
    }
    // PAID means any of: users.is_paid (set by the admin console's Paid
    // button, which now writes the cloud), a license key issued to this
    // email (the key IS the payment), or a platform admin/owner email —
    // an admin's device can always be released so THEY are also asked to
    // reactivate after delete + reinstall.
    const paid =
      user.is_paid ||
      isPaymentExemptEmail(cleanEmail) ||
      OWNER_EMAILS.includes(cleanEmail) ||
      (await emailHasLicenseKey(cleanEmail));
    if (!paid) {
      setBusy(false);
      setError("Not reactivated — this email has not paid. Reactivation works only for paid users.");
      return;
    }

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

    // Deduct 1 token
    if (tokens > 0) {
      const updated = tokens - 1;
      setStoredTokens(account.email, updated);
      setTokens(updated);
    }

    setClientEmail("");
    toast.success(`${cleanEmail} reactivated! 1 token deducted. Remaining tokens: ${Math.max(0, tokens - 1)}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Client access</p>
      <h1 className="mt-1 text-3xl font-bold">Re-activate Client</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Release a paid client's device so they can sign in on a new one — keys, dates and subscriptions stay exactly as they are.
      </p>

      {/* TOKEN BALANCE & TOP UP CARD */}
      <div className="mt-6 rounded-3xl border border-primary/30 bg-primary/[0.04] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Coins className="size-6" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Reactivation Tokens</p>
              <h3 className="text-2xl font-black">{tokens} Token{tokens === 1 ? "" : "s"} Available</h3>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/90">
              R{TOKEN_PRICE_ZAR} per token
            </span>
            <p className="mt-1 text-[11px] text-muted-foreground">1 Token = 1 Client Reactivation</p>
          </div>
        </div>

        {/* PACKAGE SELECTOR & PURCHASE BUTTONS */}
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold text-muted-foreground">Select Quantity:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 5, 10].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => setSelectedTokens(qty)}
                className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold transition ${
                  selectedTokens === qty
                    ? "border-primary bg-primary text-black"
                    : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                }`}
              >
                {qty} {qty === 1 ? "Token" : "Tokens"} (R{qty * TOKEN_PRICE_ZAR})
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleBuyTokens}
              className="gap-2 rounded-xl bg-primary font-bold text-black hover:bg-primary/90"
            >
              <ExternalLink className="size-4" /> Pay R{selectedTokens * TOKEN_PRICE_ZAR} on Whop
            </Button>
            {isAdmin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleClaimTokens(ADMIN_TOKEN_BALANCE)}
                className="gap-1 text-xs text-amber-300"
              >
                <PlusCircle className="size-3.5" /> Admin — refill to 1,000,000
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="panel mt-6 p-6">
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
              <RefreshCcw className="size-4" /> {busy ? "Reactivating…" : "Re-activate (Cost: 1 Token)"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Paid clients only · costs 1 token · previous device is signed out.
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
