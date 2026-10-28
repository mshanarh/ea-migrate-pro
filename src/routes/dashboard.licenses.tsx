import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addLicense,
  generateKey,
  removeLicense,
  useCurrentAccount,
  type ExpertAdvisor,
  type License,
} from "@/lib/auth-store";
import { portalDeleteLicenseKey, portalRemoveLicense, portalUpsertLicense } from "@/lib/portal-cloud";
import { issueLicenseKeyInKv, removeLicenseKeyInKv } from "@/lib/license-cloud";
import { inlineVideoForCloud } from "@/lib/media-store";
import { linkEaVideo } from "@/lib/ea-video-key";
import { sendPortalEmail } from "@/lib/send-email";

export const Route = createFileRoute("/dashboard/licenses")({ ssr: false, component: Licenses });

const EXPIRY_OPTIONS = ["Lifetime", "1 Year", "6 Months", "3 Months", "1 Month", "1 Week"];

/**
 * The platform's default key allowance. Approving an account grants this many
 * keys, and an approved account with no `limit:` row falls back to it here —
 * which is what removes "Your admin has not set a key allowance yet".
 */
const DEFAULT_LICENSE_LIMIT = 2000;

/**
 * ONE BACKGROUND STEP OF A CREATED KEY — saving it to the cloud, or emailing
 * it to the client. The key itself is ALREADY created when the result screen
 * appears; these two run behind it and report live on the card.
 */
type StepState = "pending" | "done" | "error";

type KeyResult = {
  key: string;
  clientName: string;
  email: string;
  eaName: string;
  expiry: string;
  imageUrl: string | null;
  emailed: boolean;
  /** Set when the key email failed — the exact reason shows on the result card. */
  deliveryError?: string | undefined;
  /** "Saving key to cloud…" — pending while the write is in flight. */
  cloud: StepState;
  /** The cloud write's failure reason (shown as a retry note). */
  cloudError?: string | undefined;
  /** "Emailing key to client…" — pending while the send is in flight. */
  mail: StepState;
};

/**
 * A BACKGROUND STEP'S LIVE STATUS — spinner → green tick, or a red retry note.
 *
 * Nothing here blocks the result: the key is already in the mentor's hands
 * (shown in full above) while these two land, and a failure keeps the copy on
 * screen with the exact reason and a Retry button instead of hiding the key or
 * claiming it was delivered.
 */
function StepRow({
  pendingLabel,
  doneLabel,
  step,
  error,
  onRetry,
}: {
  pendingLabel: string;
  doneLabel: string;
  step: StepState;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const tone =
    step === "error"
      ? "border-red-400/40 bg-red-400/10"
      : step === "done"
        ? "border-emerald-400/30 bg-emerald-400/10"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-left ${tone}`} role="status" aria-live="polite">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        {step === "pending" ? (
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
        ) : step === "done" ? (
          <Check className="size-4 text-emerald-300" aria-hidden="true" />
        ) : (
          <AlertCircle className="size-4 text-red-300" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-bold ${
            step === "error" ? "text-red-200" : step === "done" ? "text-emerald-200" : "text-white/85"
          }`}
        >
          {step === "pending" ? pendingLabel : step === "done" ? doneLabel : `${pendingLabel.replace(/…$/, "")} failed`}
        </p>
        {step === "error" && error ? (
          <p className="mt-1 break-words text-xs leading-relaxed text-red-200/90">{error}</p>
        ) : null}
      </div>
      {step === "error" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-red-300/40 bg-red-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-red-100 hover:bg-red-400/20"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

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
  /**
   * THE FORM'S OWN BUSY FLAG — set synchronously on submit, before the cap
   * lookups, the key generation or any write. The button says "Generating the
   * key…" from that first click, not from whichever await finishes first.
   */
  const [submitting, setSubmitting] = useState(false);
  /**
   * WHAT THE BACKGROUND STEPS NEED TO RETRY: the created licence and its EA.
   * The result screen keeps the key when a step fails, and its Retry button
   * re-runs only that step — recreating a key to retry a send would spend
   * another key from the mentor's allowance.
   */
  const backgroundRef = useRef<{ license: License; ea: ExpertAdvisor } | null>(null);
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

  /**
   * SAVE THE KEY TO THE CLOUD — a BACKGROUND step of the result screen.
   *
   * Upstash KV is the primary store (see src/lib/license-cloud.ts) and is what
   * the app resolves the key from. The Supabase mirror is attempted only when
   * KV cannot answer, so nothing regresses on a deployment without KV. Either
   * way the outcome lands on the result card, not in front of it.
   */
  const saveKeyToCloud = async (license: License, ea: ExpertAdvisor, keyExpiry: string) => {
    setResult((current) => (current ? { ...current, cloud: "pending", cloudError: undefined } : current));
    const fail = (message: string) => {
      setResult((current) => (current ? { ...current, cloud: "error", cloudError: message } : current));
      toast.error(message);
    };
    const done = () =>
      setResult((current) => (current ? { ...current, cloud: "done", cloudError: undefined } : current));
    try {
      const kv = await issueLicenseKeyInKv({
        key: license.key,
        mentorEmail: account.email,
        clientEmail: license.clientEmail ?? "",
        clientName: license.name ?? "",
        eaName: ea.name,
        eaId: ea.id,
        expiry: keyExpiry,
        // The EA's symbols travel with the key so the robot this activates
        // gets its real Quotes list even though nothing read Supabase.
        ...(ea.symbols?.length ? { symbols: ea.symbols } : {}),
        ...(ea.image ? { image: ea.image } : {}),
      });
      if (kv.enabled) {
        if (kv.ok) {
          done();
          // THE ROBOT VIDEO, LINKED TO THIS NEW KEY (and every key of the EA).
          // Runs behind the result card: the key already exists, so a video
          // failure must be visible without blocking the key.
          void linkEaVideo({
            mentorEmail: account.email,
            id: ea.id,
            name: ea.name,
            video: ea.video,
          })
            .then((link) => {
              if (link.status === "failed") {
                toast.error("Key created — but the robot video is NOT linked", {
                  description: link.error,
                  duration: 14000,
                });
              }
            })
            .catch((error: unknown) => {
              console.warn("[licenses] robot video link failed:", error);
            });
          return;
        }
        fail(
          `The key was NOT saved to the cloud: ${kv.error ?? "unknown error"}. It may not activate on the app until this succeeds.`,
        );
        return;
      }
      // No KV here — carry the EA PICTURE (and video) into the legacy cloud
      // record, which is how the client's phone gets the robot's real image
      // even when the full account mirror has not run there yet.
      const video = await inlineVideoForCloud(ea.video);
      const push = await portalUpsertLicense(account.email, license, {
        ...(ea.image ? { image: ea.image } : {}),
        ...(video ? { video } : {}),
      });
      if (push.enabled && !push.ok) {
        fail(`The key was NOT saved to the cloud: ${push.error ?? "unknown error"}. It may not activate on the app until this succeeds.`);
        return;
      }
      done();
    } catch (error) {
      fail(
        `The key was NOT saved to the cloud: ${
          error instanceof Error ? error.message : "network error"
        }. It may not activate on the app until this succeeds.`,
      );
    }
  };

  /**
   * EMAIL THE KEY — the second BACKGROUND step. The exact delivery failure is
   * shown on the result card (with a Retry) instead of a blocking alert: the
   * key is already created and visible, so nothing is lost by failing here.
   */
  const emailKeyToClient = async (licenseKey: string, recipient: string, eaName: string, keyExpiry: string) => {
    setResult((current) =>
      current ? { ...current, mail: "pending", emailed: false, deliveryError: undefined } : current,
    );
    const fail = (message: string) => {
      setResult((current) =>
        current ? { ...current, mail: "error", emailed: false, deliveryError: message } : current,
      );
      toast.error(message, { duration: 10000 });
    };
    try {
      const send = await sendPortalEmail({
        data: {
          type: "license_approved",
          email: recipient,
          licenseKey,
          eaName,
          expiry: keyExpiry,
        },
      });
      if (!send.success) {
        fail(send.error ?? "Email could not be sent — the key is still saved.");
        return;
      }
      setResult((current) =>
        current ? { ...current, mail: "done", emailed: true, deliveryError: undefined } : current,
      );
    } catch (sendError) {
      fail(
        sendError instanceof Error ? sendError.message : "Email could not be sent — the key is still saved.",
      );
    }
  };

  const submitLicense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    /**
     * IMMEDIATE, SYNCHRONOUS FEEDBACK — before the cap lookups, the key
     * generation or any write. The button and the form react to the TAP.
     */
    setSubmitting(true);
    try {
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
    //
    // FAST BY CONSTRUCTION: both reads run together under a ~4s deadline, so a
    // dead Upstash cannot hold the button. When the cap read loses that race
    // the page's own `allowed` value stands in (it is refreshed every 15s and
    // is what the mentor already sees), and when the count read loses it the
    // local `used` stands in. The key is never blocked by a lookup failure.
    try {
      const { licenseAllowanceForEmail } = await import("@/lib/admin-store");
      // Same three-step resolution the page renders from, so what the button
      // allows can never disagree with the allowance shown above it.
      const { cap, used: liveUsed } = await licenseAllowanceForEmail({
        email: account.email,
        fallbackCap: allowed,
        localUsed: used,
      });
      if (cap !== null && liveUsed >= cap) {
        setFormError(
          cap === 0
            ? "Your administrator has not allowed you any license keys yet."
            : `You have used all ${cap} of your license keys. Ask your administrator to raise your limit.`,
        );
        return;
      }
    } catch {
      /* never block key creation on a limit lookup failure */
    }
    const key = generateKey();
    const recipient = clientEmail.trim() || account.email;
    // `limitAlreadyChecked` — this function enforced the cap above. Without
    // it addLicense would repeat the identical two lookups before writing the
    // key, doubling the wait for a verdict that cannot change.
    const result2 = await addLicense(account.id, expiry, key, {
      name: keyName.trim(),
      clientEmail: clientEmail.trim() || undefined,
      eaId: selectedEa.id,
      eaNameHash: selectedEa.eaNameHash,
      expiry,
    }, { limitAlreadyChecked: true });
    if (result2.error) {
      setFormError(result2.error);
      return;
    }
    // PUBLISH THE KEY SO THE APP CAN FIND IT — a key that lives only in this
    // device's localStorage is invisible to the app ("That license key was not
    // found" for the owner's own email).
    //
    // UPSTASH KV IS THE PRIMARY STORE NOW (see src/lib/license-cloud.ts). The
    // Supabase portal record used to be the only destination, and once that
    // project passed its egress cap every key was reported as "NOT saved to the
    // cloud" while remaining unusable on the phone. KV holds the key, its
    // owner, its client and its EA details, and it is the same store the app
    // resolves the key from — so a successful write here is a key that works.
    // The Supabase mirror is still attempted, but ONLY when KV could not answer
    // (no store configured / unreachable), so nothing regresses on a deployment
    // without KV and no failure message can be raised over a key that IS saved.
    const created = result2.license;
    if (!created) {
      setFormError("Could not create the key — please try again.");
      return;
    }
    /**
     * THE KEY EXISTS — SHOW IT NOW.
     *
     * The cloud write and the email used to be awaited HERE, so the mentor sat
     * on the form until the last round trip finished and never saw the key
     * while a slow KV/email call was in flight. Both now run behind the result
     * screen and report their own status on it (StepRow below): the key is in
     * the mentor's hands the instant `addLicense` returns.
     */
    backgroundRef.current = { license: created, ea: selectedEa };
    const clientName = keyName.trim();
    const keyExpiry = expiry;
    setResult({
      key,
      clientName,
      email: recipient,
      eaName: selectedEa.name,
      expiry: keyExpiry,
      imageUrl: selectedEa.image ?? null,
      emailed: false,
      cloud: "pending",
      mail: "pending",
    });
    setMode("result");
    setCopied(false);
    resetForm();
    toast.success("License key created");
    void saveKeyToCloud(created, selectedEa, keyExpiry);
    void emailKeyToClient(key, recipient, selectedEa.name, keyExpiry);
    } finally {
      setSubmitting(false);
    }
  };

  const retryCloudSave = () => {
    const background = backgroundRef.current;
    if (!background || !result) return;
    void saveKeyToCloud(background.license, background.ea, result.expiry);
  };

  const retryEmail = () => {
    if (!result) return;
    void emailKeyToClient(result.key, result.email, result.eaName, result.expiry);
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
    // Delete EVERY copy, or the key resurrects: the KV store the app resolves
    // from, the mentor's cloud portal record, and the legacy license_keys row.
    // Best-effort per target with clear failure messages.
    const [kv, record, row] = await Promise.allSettled([
      removeLicenseKeyInKv(key),
      portalRemoveLicense(account.email, licenseId),
      portalDeleteLicenseKey(key),
    ]);
    const kvOk = kv.status === "fulfilled" && (!kv.value.enabled || kv.value.ok);
    const recordOk = record.status === "fulfilled" && (!record.value.enabled || record.value.ok);
    const rowOk = row.status === "fulfilled" && (!row.value.enabled || row.value.ok);
    if (!kvOk) toast.error(`Licence store delete failed: ${kv.status === "fulfilled" ? kv.value.error ?? "unknown error" : "network error"} — the key may still activate.`);
    if (!recordOk) toast.error(`Cloud record delete failed: ${record.status === "fulfilled" ? record.value.error : "network error"} — the key may come back on restore.`);
    if (!rowOk) toast.error(`Cloud key delete failed: ${row.status === "fulfilled" ? row.value.error : "network error"} — the key may still activate.`);
    if (kvOk && recordOk && rowOk) toast.success("License key deleted everywhere");
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

          {/* LIVE BACKGROUND STATUS — the key above is already created; these
              two steps report as they land, or name the reason and offer Retry. */}
          <div className="mt-6 space-y-3">
            <StepRow
              pendingLabel="Saving key to cloud…"
              doneLabel="Key saved to cloud"
              step={result.cloud}
              error={result.cloudError}
              onRetry={retryCloudSave}
            />
            <StepRow
              pendingLabel="Emailing key to client…"
              doneLabel="Key emailed to client"
              step={result.mail}
              error={result.deliveryError}
              onRetry={retryEmail}
            />
          </div>

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
              disabled={submitting}
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="Client name"
              className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60"
            />
            <input
              type="email"
              disabled={submitting}
              value={clientEmail}
              onChange={(event) => setClientEmail(event.target.value)}
              placeholder={`Client email (optional — defaults to ${account.email})`}
              className="h-16 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-base outline-none placeholder:text-white/35 focus:border-primary/60"
            />
            <select
              required
              disabled={submitting}
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
                  disabled={submitting}
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
              disabled={remaining === 0 || account.eas.length === 0 || submitting}
              className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#38bdf8] to-[#0284c7] text-lg font-black text-white shadow-[0_0_40px_rgba(0,168,255,0.35)] transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  Generating the key…
                </>
              ) : (
                "Generate Key"
              )}
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
