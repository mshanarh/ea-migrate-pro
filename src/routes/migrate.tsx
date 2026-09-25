import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  migratePreview,
  migrateRun,
  type MigratePreviewResult,
  type MigrateRunResult,
} from "@/lib/migrate-upstash.server";

export const Route = createFileRoute("/migrate")({
  ssr: false,
  head: () => ({ meta: [{ title: "One-time Migration — EA Migrate Pro" }] }),
  component: MigratePage,
});

/**
 * TEMPORARY one-time migration tool (Upstash + old localStorage → Supabase).
 * Delete this route once every legacy mentor appears in the admin console.
 */

function MigratePage() {
  const [preview, setPreview] = useState<MigratePreviewResult | null>(null);
  const [result, setResult] = useState<MigrateRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    setBusy(true);
    setResult(null);
    try {
      setPreview(await migratePreview());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Local mirror of the old console's approvals kept in THIS browser.
  let localRows: Array<{ email: string; status: string }> = [];
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("eamp.store.v1") : null;
    if (raw) {
      const store = JSON.parse(raw) as { payments?: Array<{ email: string; paid: boolean }> };
      localRows = (store.payments ?? [])
        .filter((row) => typeof row.email === "string")
        .map((row) => ({ email: row.email.toLowerCase(), status: row.paid ? "approved" : "pending" }));
    }
  } catch {
    /* ignore malformed local store */
  }
  const localOnly = localRows.filter(
    (row) => !preview?.rows.some((source) => source.email === row.email),
  );

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await migrateRun();
      setResult(outcome);
      if (outcome.ok) toast.success(`Migrated ${outcome.inserted} emails to Supabase`);
      else toast.error("Migration finished with errors — see the report");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Migration failed");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const rows = preview?.rows ?? [];
  const missing = rows.filter((row) => !row.alreadyApproved);

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">One-time tool</p>
        <h1 className="mt-1 text-2xl font-bold">Legacy → Supabase migration</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Reads every mentor from the old Upstash store (and this browser's local records) and
          inserts any missing emails into <span className="font-mono">mentor_approvals</span> with
          their original status. Existing Supabase decisions are never overwritten. Delete this
          page when done.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
          <span className={`rounded-full px-3 py-1 ${preview?.upstashConfigured ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>
            Upstash {preview?.upstashConfigured ? "reachable" : "missing"}
          </span>
          <span className={`rounded-full px-3 py-1 ${preview?.supabaseConfigured ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>
            Supabase {preview?.supabaseConfigured ? "connected" : "missing"}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-white/70"
            disabled={busy}
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        {preview?.error && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {preview.error}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="mt-5 flex items-center justify-between">
              <p className="text-sm font-bold">
                {rows.length} legacy records ·{" "}
                <span className="text-white/55">{missing.length} need migration</span>
              </p>
            </div>
            <ul className="mt-3 space-y-2">
              {rows.map((row) => (
                <li key={row.email} className="flex items-center gap-3 rounded-xl bg-[#151515] p-3 text-sm">
                  <Database className="size-4 shrink-0 text-white/35" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{row.email}</p>
                    <p className="text-xs text-white/50">
                      {row.status} · {row.licenses} keys · {row.eas} EAs · role {row.role}
                    </p>
                  </div>
                  {row.alreadyApproved ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-300">
                      <CheckCircle2 className="size-4" /> in Supabase
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-300">
                      will migrate
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {localOnly.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-bold">
              {localOnly.length} local-only record{localOnly.length > 1 ? "s" : ""} in this browser
            </p>
            <ul className="mt-2 space-y-1 text-xs text-white/55">
              {localOnly.map((row) => (
                <li key={row.email} className="font-mono">
                  {row.email} — {row.status}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-white/40">
              These live only in this browser's localStorage. The migrate button also upserts them
              (as pending) so nothing stays device-bound.
            </p>
          </div>
        )}

        {confirming ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-500 text-sm font-bold text-black disabled:opacity-60"
            >
              <Upload className="size-4" /> {busy ? "Migrating…" : "Yes — MIGRATE ALL TO SUPABASE"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-12 rounded-full border border-white/20 px-6 text-sm font-bold text-white/70"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || rows.length === 0}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-500 text-sm font-bold text-black disabled:opacity-50"
          >
            <Upload className="size-4" /> MIGRATE ALL TO SUPABASE
          </button>
        )}

        {result && (
          <div className={`mt-5 rounded-2xl border p-4 text-sm ${result.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
            <p className="font-bold">
              {result.inserted} inserted · {result.skipped} already present · {result.failed} failed
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {result.errors.slice(0, 10).map((message) => (
                  <li key={message} className="font-mono">{message}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs opacity-80">
              Open /admin and confirm all users appear — then delete this page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
