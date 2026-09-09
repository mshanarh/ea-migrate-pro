import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { connectMt, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/metatrader")({
  ssr: false,
  head: () => ({ meta: [{ title: "Connect MetaTrader 5 — EA Migrate Pro" }, { name: "description", content: "Link any broker's MT5 account to run your EA." }] }),
  component: MetaTrader,
});

function MetaTrader() {
  const app = useAppState();
  const [broker, setBroker] = useState(app.mt?.broker ?? "Headway");
  const [server, setServer] = useState(app.mt?.server ?? "");
  const [accountType, setAccountType] = useState(app.mt?.accountType ?? "Standard");
  const [loginId, setLoginId] = useState(app.mt?.loginId ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const field = "h-14 w-full rounded-2xl border border-border/60 bg-card/70 px-5 text-sm outline-none";
  const label = "text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase";
  return <AppFrame><div className="flex items-center gap-4"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground glow-ring">5</span><div><h1 className="text-2xl font-bold">MetaTrader 5</h1><p className="text-sm text-muted-foreground">Works with any broker that provides an MT5 server.</p></div></div><div className="panel mt-6 p-5"><p className="text-xs font-bold tracking-[0.18em] text-primary uppercase">MT5 only</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter the broker and server exactly as shown in your MT5 login window. No broker list limits your account.</p></div><form className="mt-6 space-y-5" onSubmit={(e) => { e.preventDefault(); if (!broker.trim() || !server.trim() || !loginId.trim()) { toast.error("Enter your broker, server, and login ID."); return; } connectMt({ platform: "MT5", broker: broker.trim(), server: server.trim(), accountType, loginId: loginId.trim() }); toast.success("MT5 account connected"); }}><div className="space-y-2"><p className={label}>Broker</p><input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Any broker, e.g. Headway" className={field} /></div><div className="space-y-2"><p className={label}>MT5 server</p><input value={server} onChange={(e) => setServer(e.target.value)} placeholder="e.g. BrokerName-MT5Real" className={field} /></div><div className="space-y-2"><p className={label}>Account type</p><select value={accountType} onChange={(e) => setAccountType(e.target.value)} className={field}><option>Standard</option><option>Raw Spread</option><option>Cent</option><option>Demo</option></select></div><div className="space-y-2"><p className={label}>Login ID</p><input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="MT5 account number" className={field} /></div><div className="space-y-2"><p className={label}>Password</p><div className="relative"><input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={field} autoComplete="off" /><button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute top-1/2 right-5 -translate-y-1/2 text-muted-foreground">{show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div><p className="text-xs text-muted-foreground">Your password is used only for this session and is not saved in browser storage.</p></div><button type="submit" className="h-16 w-full rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring">Connect MT5 account</button></form></AppFrame>;
}
