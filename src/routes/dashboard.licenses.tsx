import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, KeyRound, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addLicense, generateKey, removeLicense, useCurrentAccount } from "@/lib/auth-store";
import { portalDeleteLicenseKey, portalRemoveLicense, portalUpsertLicense } from "@/lib/portal-cloud";
import { inlineVideoForCloud } from "@/lib/media-store";
import { sendPortalEmail } from "@/lib/send-email";

export const Route = createFileRoute("/dashboard/licenses")({ ssr: false, component: Licenses });

const EXPIRY_OPTIONS = ["Lifetime", "1 Year", "6 Months", "3 Months", "1 Month", "1 Week"];

/**
 * The platform's default key allowance. Approving an account grants this many
 * keys, and an approved account with no `limit:` row falls back to it here —
 * which is what removes "Your admin has not set a key allowance yet".
 */
const DEFAULT_LICENSE_LIMIT = 2000;

type KeyResult = {
  key: string;
  clientName: string;
  email: string;
  eaName: string;
  expiry: string;
  imageUrl: string | null;
  emailed: boolean;
  /** Set when the key email failed — the exact reason shows on the result card. */
  deliveryError?: string;
};

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="max-w-full truncate rounded-full border border-[#2E5FA3]/70 bg-[#0E1522] px-5 py-2 text-sm font-semibold text-[#D7E4F5]">
      {children}
    </span>
  );
}

/** Keys show IN FULL exactly once — on the creation result card. The saved
 *  list only ever displays a masked reference (EMP••••-••XZ), never the key. */
function maskKey(key: string): string {
  const tail = key.slice(-2);
  return `${key.slice(0, 3)}••••-••${tail}`;
}

function Licenses() {
  const account = useCurrentAccount();
  const [mode, setMode] = useState<"list" | "form" | "result">("list");
  const [result, setResult] = useState<KeyResult | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [eaId, setEaId] = useState("");
  const [expiry, setExpiry] = useState("Lifetime");
  const [formError, setFormError] = useState("");
  // Two-tap delete confirmation (Android WebView has no window.confirm).
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  // The admin console writes the key allowance to the database
  // (app_settings "limit:<email>"). This page used to read the allowance from
  // the account's LOCAL licenseLimit, which the console never updates — so a
  // mentor who had been granted 500 keys still saw "no allowance set" and the
  // Generate button stayed disabled. The database value wins; the local one is
  // the fallback for the brief moment before the first read lands AND for an
  // approved account whose `limit:` row has not been written yet.
  const [cloudLimit, setCloudLimit] = useState<number | null>(null);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const read = async () => {
      try {
        const { getLicenseCapForEmail } = await import("@/lib/admin-store");
        const cap = await getLicenseCapForEmail(account.email);
        if (!cancelled) setCloudLimit(cap);
      } catch {
        /* keep the local fallback on a read failure — never lock anyone out */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [account?.email]);
  if (!account) return null;

  const used = account.licenses.length;
  /**
   * THE ALLOWANCE, RESOLVED IN THREE STEPS — the account must never be told
   * "your admin has not set a key allowance yet" while it is APPROVED.
   *
   *   1. app_settings `limit:<email>` — the admin console's value, read live
   *      and authoritative whenever the row exists (an explicit 0 means the
   *      admin really did block key creation, so it is honoured).
   *   2. account.licenseLimit — the portal's own record, which carries the
   *      real allowance for approved accounts. It used to be ignored unless
   *      > 0, so a missing database row turned into the bogus "0 keys" dead
   *      end that looked like the admin had blocked the account.
   *   3. APPROVED WITH NOTHING SET ANYWHERE → the platform default (2000).
   *      Approval is the admin's decision to let somebody create keys; the
   *      absence of a `limit:` row must not contradict it. `allowed` is a
   *      real number from here on, so the error message below cannot fire for
   *      an approved account.
   */
  const allowed = (() => {
    if (typeof cloudLimit === "number") return cloudLimit;
    const local = Number(account.licenseLimit);
    if (Number.isFinite(local) && local > 0) return local;
    return account.status === "approved" ? DEFAULT_LICENSE_LIMIT : null;
  })();
  const remaining = allowed === null ? 0 : Math.max(allowed - used, 0);
  const selectedEa = account.eas.find((ea) => ea.id === eaId);
  const resetForm = () => {
    setKeyName("");
    setClientEmail("");
    setEaId("");
    setExpiry("Lifetime");
    setFormError("");
  };

  const submitLicense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!keyName.trim()) {
      setFormError("Client name is required.");
      return;
    }
    if (!selectedEa) {
      setFormError("Choose an Expert Advisor.");
      return;
    }
    // ADMIN LICENSE CAP — the dashboard sets a maximum number of keys per
    // user; this is where a USER creates one. The cap and the current usage
    // are read live from the database, so the limit the admin set is the
    // limit that actually applies. A cap of 0 means no keys at all.
    try {
      const { getLicenseCapForEmail, countKeysForEmail } = await import("@/lib/admin-store");
      // Same three-step resolution the page renders from, so what the button
      // allows can never disagree with the allowance shown above it.
      const cap = (await getLicenseCapForEmail(account.email)) ?? allowed;
      if (cap !== null) {
        const used = await countKeysForEmail(account.email);
        if (used >= cap) {
          setFormError(
            cap === 0
              ? "Your administrator has not allowed you any license keys yet."
              : `You have used all ${cap} of your license keys. Ask your administrator to raise your limit.`,
          );
          return;
        }
      }
    } catch {
      /* never block key creation on a limit lookup failure */
    }
    const key = generateKey();
    const recipient = clientEmail.trim() || account.email;
    const result2 = await addLicense(account.id, expiry, key, {
      name: keyName.trim(),
      clientEmail: clientEmail.trim() || undefined,
      eaId: selectedEa.id,
      eaNameHash: selectedEa.eaNameHash,
      expiry,
    });
    if (result2.error) {
      setFormError(result2.error);
      return;
    }
    // Push the new key to the CLOUD portal record immediately — a key that
    // lives only in this device's localStorage is invisible to the app
    // ("That license key was not found" for the owner's own email).
    const created = result2.license;
    if (created) {
      // Carry the EA PICTURE (and video) with the key into the cloud record —
      // this is how the client's phone gets the robot's real image even when
      // the full account mirror has not run there yet.
      void inlineVideoForCloud(selectedEa.video)
        .then((video) =>
          portalUpsertLicense(account.email, created, {
            ...(selectedEa.image ? { image: selectedEa.image } : {}),
            ...(video ? { video } : {}),
          }),
        )
        .then((push) => {
        if (push.enabled && !push.ok) {
          toast.error(`The key was NOT saved to the cloud: ${push.error ?? "unknown error"}. It may not activate on the app until this succeeds.`);
        }
      });
    }
    // Email the key immediately — awaited so "Emailed to client" is real.
    // The license_approved flow also saves the key into the Supabase
    // license_keys table (server-side) before sending.
    setSending(true);
    let emailed = false;
    let deliveryError: string | null = null;
    try {
      const send = await sendPortalEmail({
        data: {
          type: "license_approved",
          email: recipient,
          licenseKey: key,
          eaName: selectedEa.name,
          expiry,
        },
      });
      emailed = send.success;
      if (!send.success) {
        // Surface the EXACT delivery failure on screen — the admin must see
        // the real reason (missing key, Brevo rejection, network) right away.
        deliveryError = send.error ?? "Email could not be sent — the key is still saved.";
        toast.error(deliveryError, { duration: 10000 });
        window.alert(`Email delivery failed:\n\n${deliveryError}\n\nThe license key itself was created and is shown below.`);
      }
    } catch (sendError) {
      deliveryError = sendError instanceof Error ? sendError.message : "Email could not be sent — the key is still saved.";
      toast.error(deliveryError, { duration: 10000 });
      window.alert(`Email delivery failed:\n\n${deliveryError}\n\nThe license key itself was created and is shown below.`);
    } finally {
      setSending(false);
    }
    setResult({
      key,
      clientName: keyName.trim(),
      email: recipient,
      eaName: selectedEa.name,
      expiry,
      imageUrl: selectedEa.image ?? null,
      emailed,
      ...(deliveryError ? { deliveryError } : {}),
    });
    setMode("result");
    setCopied(false);
    resetForm();
    toast.success("License key created");
  };

  /**
   * DELETE a key everywhere: the mentor's portal record AND the cloud
   * license_keys row the app activates against. A local-only removal left
   * the key working forever — this makes delete mean delete.
   */
  const handleDeleteKey = async (licenseId: string, key: string) => {
    // window.confirm is silently suppressed inside the Android WebView — a
    // confirm() dialog here made delete look dead (nothing happened).
    // In-app two-tap confirmation instead: first tap arms, second tap within
    // 4s deletes. Works identically in every browser and the wrapper.
    if (armedDelete !== licenseId) {
      setArmedDelete(licenseId);
      toast.info("Tap delete again to confirm", { description: `${maskKey(key)} will stop working immediately.`, duration: 4000 });
      window.setTimeout(() => setArmedDelete((current) => (current === licenseId ? null : current)), 4000);
      return;
    }
    setArmedDelete(null);
    removeLicense(account.id, licenseId);
    // Delete BOTH copies: the mentor's cloud portal record (or the key
    // resurrects on restore) and the license_keys row the app activates
    // against. Best-effort per target with clear failure messages.
    const [record, row] = await Promise.allSettled([portalRemoveLicense(account.email, licenseId), portalDeleteLicenseKey(key)]);
    const recordOk = record.status === "fulfilled" && (!record.value.enabled || record.value.ok);
    const rowOk = row.status === "fulfilled" && (!row.value.enabled || row.value.ok);
    if (!recordOk) toast.error(`Cloud record delete failed: ${record.status === "fulfilled" ? record.value.error : "network error"} — the key may come back on restore.`);
    if (!rowOk) toast.error(`Cloud key delete failed: ${row.status === "fulfilled" ? row.value.error : "network error"} — the key may still activate.`);
    if (recordOk && rowOk) toast.success("License key deleted everywhere");
  };

  const copyKey = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.key);
      setCopied(true);
      toast.success("License key copied");
    } catch {
      toast.error("Copy failed — select the key manually.");
    }
  };

  const startAnother = () => {
    setResult(null);
    setMode("form");
  };

  /* ---------------- Result card (Algohost-style) ---------------- */
  if (mode === "result" && result) {
    return (
      <div className="max-w-2xl">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setMode("list");
          }}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="panel mt-6 px-6 py-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-28 items-center justify-center rounded-3xl bg-primary/15 text-primary shadow-[0_0_60px_rgba(0,168,255,0.35)]">
              <KeyRound className="size-14" />
            </span>
            <h1 className="mt-6 text-4xl font-black">Generate License</h1>
            <p className="mt-2 text-sm font-bold uppercase tracking-[0.24em] text-white/45">Key Created</p>
          </div>

          {result.imageUrl ? (
            <img
              src={result.imageUrl}
              alt={result.eaName}
              className="mt-8 aspect-square w-full max-w-sm self-center rounded-3xl border border-white/10 object-cover"
            />
          ) : (
            <div className="mt-8 flex aspect-square w-full max-w-sm items-center justify-center self-center rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent">
              <KeyRound className="size-20 text-primary/70" />
            </div>
          )}

          <div className="mt-8 flex items-center gap-3 rounded-full border-2 border-primary bg-primary/10 px-6 py-4">
            <span className="min-w-0 flex-1 truncate text-center font-mono text-xl font-bold tracking-[0.12em] text-white">
              {result.key}
            </span>
            <Button type="button" size="icon" variant="secondary" className="size-10 shrink-0 rounded-full" onClick={copyKey} aria-label="Copy license key">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Pill>{result.email}</Pill>
            <Pill>{result.expiry}</Pill>
            <Pill>{result.eaName}</Pill>
          </div>

          <p className={`mt-6 flex items-center justify-center gap-2 text-sm font-bold ${result.emailed ? "text-primary" : "text-amber-400"}`}>
            <Mail className="size-4" />
            {result.emailed ? "Emailed to client" : "Saved — email delivery failed"}
          </p>
          {result.deliveryError && (
            <div className="mt-3 rounded-2xl border border-red-400/40 bg-red-400/10 p-4 text-left" role="alert">
              <p className="text-xs font-black uppercase tracking-wide text-red-300">Delivery failure reason</p>
              <p className="mt-1 break-words text-sm leading-relaxed text-red-200">{result.deliveryError}</p>
            </div>
          )}

          <Button
            type="button"
            className="mt-8 h-16 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-lg font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.35)]"
            onClick={startAnother}
            disabled={remaining === 0}
          >
            {remaining === 0 ? "Key limit reached" : "Generate Another License"}
          </Button>

          <p className="mt-6 text-center text-sm text-white/55">
            Total keys generated: <span className="font-bold text-white">{used}</span>
          </p>
        </div>
      </div>
    );
  }

  /* ---------------- Create form ---------------- */
  if (mode === "form") {
    return (
      <div className="max-w-2xl">
        <button
          type="button"
          onClick={() => setMode("list")}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="panel mt-6 px-6 py-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-28 items-center justify-center rounded-3xl bg-primary/15 text-primary shadow-[0_0_60px_rgba(0,168,255,0.35)]">
              <KeyRound className="size-14" />
            </span>
            <h1 className="mt-6 text-4xl font-black">Generate License</h1>
            <p className="mt-2 text-sm font-bold uppercase tracking-[0.24em] text-white/45">Create new license key</p>
          </div>
          <form className="mt-8 space-y-4" onSubmit={(event) => void submitLicense(event)}>
            <input
              required
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="Client name"
              className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60"
            />
            <input
              type="email"
              value={clientEmail}
              onChange={(event) => setClientEmail(event.target.value)}
              placeholder={`Client email (optional — defaults to ${account.email})`}
              className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60"
            />
            <select
              required
              value={eaId}
              onChange={(event) => setEaId(event.target.value)}
              className="h-16 w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none focus:border-primary/60"
            >
              <option value="">Select an EA</option>
              {account.eas.map((ea) => (
                <option key={ea.id} value={ea.id}>
                  {ea.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-3 pt-1">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setExpiry(option)}
                  className={`h-12 rounded-2xl px-5 text-sm font-bold transition-colors ${
                    expiry === option ? "bg-primary text-primary-foreground glow-ring" : "border border-white/10 bg-white/[0.04] text-white/70 hover:border-primary/40"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            {account.eas.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Create an EA profile first from{" "}
                <Link to="/dashboard/eas" className="font-semibold text-primary">
                  Manage EAs
                </Link>
                .
              </p>
            )}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <button
              type="submit"
              disabled={remaining === 0 || account.eas.length === 0 || sending}
              className="h-16 w-full rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-lg font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.35)] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Creating & emailing key…" : "Generate Key"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-white/55">
            Total keys generated: <span className="font-bold text-white">{used}</span>
          </p>
        </div>
      </div>
    );
  }

  /* ---------------- Key list ---------------- */
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Workspace</p>
      <h1 className="mt-1 text-3xl font-bold">Generate Key</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Create client keys from the allowance set by your admin. Keys are emailed instantly to the client.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-primary/25 bg-primary/5 p-5">
        <div className="flex gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Keys used</p>
            <p className="mt-1 text-2xl font-bold">{used}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total allowed</p>
            <p className="mt-1 text-2xl font-bold">{allowed === null ? "Not set" : allowed}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Keys remaining</p>
            <p className="mt-1 text-2xl font-bold text-primary">{remaining}</p>
          </div>
        </div>
        <Button size="lg" className="h-12 rounded-full" disabled={remaining === 0} onClick={() => setMode("form")}>
          <Plus className="size-4" /> Generate key
        </Button>
      </div>
      {account.eas.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Create an EA profile before generating a key.</p>}
      {allowed === null && <p className="mt-3 text-sm text-muted-foreground">Your admin has not set a key allowance yet. Once they set one it appears here automatically.</p>}
      {allowed !== null && remaining === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {allowed === 0
            ? "Your administrator has not allowed you any license keys yet. Ask them to set your key allowance."
            : `You have used all ${allowed} key${allowed === 1 ? "" : "s"} allowed for this account.`}
        </p>
      )}

      {/* Re-activate Client lives on its own page: /dashboard/reactivate */}
      {account.licenses.length === 0 ? (
        <div className="panel mt-6 flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/12">
            <KeyRound className="size-6 text-primary" />
          </span>
          <p className="font-semibold">No license keys yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Your generated keys will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {account.licenses.map((license) => (
            <li key={license.id} className="panel flex items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="font-semibold">{license.name || "Client license key"}</p>
                <p className="break-all font-mono text-sm text-primary">{maskKey(license.key)}</p>
                <p className="text-sm text-muted-foreground">
                  {account.eas.find((ea) => ea.id === license.eaId)?.name || "Private EA"} · {license.expiry || license.plan} ·{" "}
                  {license.clientEmail || account.email}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={
                    license.active
                      ? "rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase text-primary"
                      : "rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase text-muted-foreground"
                  }
                >
                  {license.active ? "Active" : "Paused"}
                </span>
                <button
                  type="button"
                  aria-label={`Delete license key ${maskKey(license.key)}`}
                  onClick={() => void handleDeleteKey(license.id, license.key)}
                  className={`flex size-9 items-center justify-center rounded-full border transition-colors ${
                    armedDelete === license.id
                      ? "border-destructive bg-destructive text-white"
                      : "border-destructive/30 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                  }`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
