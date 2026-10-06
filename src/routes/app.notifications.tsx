/** /app/notifications — the last 50 trade_notifications for the logged-in
 * email, live via Supabase postgres_changes (anon SELECT policy; rows are
 * filtered to this email client-side — see supabase/trade-notifications.sql). */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Bell, TrendingDown, TrendingUp } from "lucide-react";
import { useCurrentAccount } from "@/lib/auth-store";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
});

type Row = {
  id: string;
  email: string | null;
  symbol: string | null;
  action: string | null;
  volume: number | null;
  price: number | null;
  profit: number | null;
  time: string | null;
};

const env = import.meta.env as Record<string, string | undefined>;
function db(): SupabaseClient | null {
  const url = env["VITE_SUPABASE_URL"];
  const key = env["VITE_SUPABASE_ANON_KEY"] ?? env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function NotificationsPage() {
  const account = useCurrentAccount() as { email?: string } | null | undefined;
  const email = typeof account?.email === "string" ? account.email.toLowerCase() : "";
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");

  useEffect(() => {
    const client = db();
    if (!client || !email) {
      setState("offline");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await client
        .from("trade_notifications")
        .select("*")
        .eq("email", email)
        .order("time", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setRows((data as Row[] | null) ?? []);
        setState(error ? "offline" : "ready");
      }
    })();
    const channel = client
      .channel(`trade-notifications:${email}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trade_notifications" },
        (payload) => {
          const row = payload.new as Row;
          if (row.email?.toLowerCase() === email) setRows((old) => [row, ...old].slice(0, 50));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [email]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-[#0A0A0C] px-5 pb-24 pt-12 text-white">
      <div className="mb-6 flex items-center gap-3">
        <Bell className="size-6 text-[#38BDF8]" />
        <h1 className="text-2xl font-black tracking-tight">Trade alerts</h1>
      </div>
      {state === "loading" && (
        <p className="text-sm text-white/50">Loading your recent trades…</p>
      )}
      {state === "offline" && (
        <p className="text-sm text-white/50">Notifications are not available right now.</p>
      )}
      {state === "ready" && rows.length === 0 && (
        <p className="text-sm text-white/50">
          No trade notifications yet — they appear here the moment an EA reports a trade.
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((row) => {
          const up = (row.profit ?? 0) >= 0;
          return (
            <li
              key={row.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div>
                <p className="text-sm font-black">
                  {row.action} {row.symbol}
                </p>
                <p className="text-xs text-white/55">
                  {row.volume ?? 0} lot @ {row.price ?? 0} ·{" "}
                  {row.time ? new Date(row.time).toLocaleString() : ""}
                </p>
              </div>
              <span
                className={`flex items-center gap-1 text-sm font-black ${
                  up ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}${" "}
                {(row.profit ?? 0).toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
