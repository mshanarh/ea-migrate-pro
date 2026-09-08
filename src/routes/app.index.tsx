import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Mail } from "lucide-react";
import { appSignIn, useAppState } from "@/lib/app-store";

export const Route = createFileRoute("/app/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "App Login — EA Migrate Pro" },
      { name: "description", content: "Sign in with your email to activate your EA licence key." },
      { property: "og:title", content: "App Login — EA Migrate Pro" },
      { property: "og:description", content: "Sign in with your email to activate your EA licence key." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppLogin,
});

function AppLogin() {
  const app = useAppState();
  const [email, setEmail] = useState(app.email ?? "");
  const navigate = useNavigate();

  useEffect(() => {
    if (app.email && app.robots.length > 0) navigate({ to: "/app/home", replace: true });
  }, [app.email, app.robots.length, navigate]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6">
      <span className="flex size-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-primary to-primary/40 glow-ring"><img src="/botlogic-mascot.jpg?v=2" alt="EA Migrate Pro" className="size-24 object-contain" /></span>
      <h1 className="mt-8 text-4xl font-bold">{app.email ? "Welcome back" : "Login"}</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">{app.email ? "Your EA workspace is saved on this device." : "Enter your email to continue"}</p>
      <form className="mt-10 w-full space-y-4" onSubmit={(event) => { event.preventDefault(); if (!email.trim()) return; appSignIn(email); navigate({ to: "/app/activate" }); }}>
        <div className="flex h-16 items-center gap-3 rounded-full border border-border/60 bg-card/70 px-6"><Mail className="size-5 text-muted-foreground" /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground" /></div>
        <button type="submit" className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring">{app.email ? "Continue" : "Proceed"} <ArrowRight className="size-5" /></button>
      </form>
    </div>
  );
}
