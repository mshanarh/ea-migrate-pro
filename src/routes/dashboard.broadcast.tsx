import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useCurrentAccount } from "@/lib/auth-store";
import { sendPortalEmail } from "@/lib/send-email";
import { listUsersAnon } from "@/lib/supabase-users";
import { portalListAccounts } from "@/lib/portal-cloud";

export const Route = createFileRoute("/dashboard/broadcast")({
  ssr: false,
  component: Broadcast,
});

/**
 * BROADCAST — type one message, press Send, and every mentor (portal account)
 * receives it by email. Two-tap confirm so a stray tap can't mass-mail, and a
 * live progress line while the sends run one by one.
 */
function Broadcast() {
  const account = useCurrentAccount();
  const [message, setMessage] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const send = async () => {
    if (busy) return;
    const text = message.trim();
    if (!text) {
      toast.error("Write a message first.");
      return;
    }
    if (!armed) {
      setArmed(true);
      toast.info("Tap SEND again to email all mentors", { duration: 5000 });
      window.setTimeout(() => setArmed((current) => (current ? current : false)), 6000);
      return;
    }
    setArmed(false);
    setBusy(true);
    // Recipients: every mentor portal account + every registered user (both
    // audiences are "the mentors" in practice — the console shows them merged).
    const recipients = new Set<string>();
    try {
      const [portal, users] = await Promise.all([portalListAccounts(), listUsersAnon()]);
      for (const entry of portal.accounts ?? []) {
        if (entry.email) recipients.add(String(entry.email).trim().toLowerCase());
      }
      for (const user of users.users ?? []) {
        if (user.email) recipients.add(String(user.email).trim().toLowerCase());
      }
    } catch {
      /* fall through with whatever we collected */
    }
    recipients.delete(account?.email?.trim().toLowerCase() ?? "");
    const list = Array.from(recipients).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (list.length === 0) {
      setBusy(false);
      toast.error("No recipients found — check the cloud connection.");
      return;
    }
    let sent = 0;
    const failed: string[] = [];
    let index = 0;
    for (const email of list) {
      index += 1;
      setProgress(`Sending ${index}/${list.length} — ${email}`);
      try {
        const result = await sendPortalEmail({ data: { type: "broadcast", email, message: text } });
        if (result.success) sent += 1;
        else failed.push(email);
      } catch {
        failed.push(email);
      }
    }
    setBusy(false);
    setProgress("");
    if (failed.length === 0) {
      toast.success(`Message sent to all ${sent} mentors.`);
      setMessage("");
    } else {
      toast.error(`Sent ${sent}/${list.length}. Failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`, { duration: 8000 });
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Messaging</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Broadcast to mentors</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Write one message and email it to every mentor and registered user at once.
      </p>

      <div className="panel mt-6 p-5">
        <label htmlFor="broadcast-message" className="text-sm font-semibold">
          Message
        </label>
        <textarea
          id="broadcast-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={8}
          placeholder="Hi team — new update is live. Re-download the app and re-scan your pairs…"
          className="mt-3 w-full rounded-2xl border border-border/70 bg-card/60 p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{busy ? progress : `${message.trim().length} characters`}</p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className={
              armed
                ? "flex h-12 items-center gap-2 rounded-full bg-emerald-500 px-7 text-sm font-black text-white transition-transform active:scale-[0.98]"
                : "flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            }
          >
            <Send className="size-4" />
            {busy ? "Sending…" : armed ? "Tap again to send to ALL" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
