import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Bot, Mail } from "lucide-react";
import { appSignIn } from "@/lib/app-store";

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
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6">
      <span className="flex size-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-primary to-primary/40 glow-ring">
        <Bot className="size-12 text-primary-foreground" />
      </span>
      <h1 className="mt-8 text-4xl font-bold">Login</h1>
      <p className="mt-2 text-sm text-muted-foreground">Enter your email to continue</p>

      <form
        className="mt-10 w-full space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) return;
          appSignIn(email);
          navigate({ to: "/app/activate" });
        }}
      >
        <div className="flex h-16 items-center gap-3 rounded-full border border-border/60 bg-card/70 px-6">
          <Mail className="size-5 text-muted-foreground" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="submit"
          className="flex h-16 w-full items-center justify-center gap-3 rounded-full bg-primary text-base font-bold text-primary-foreground glow-ring"
        >
          Proceed <ArrowRight className="size-5" />
        </button>
      </form>
    </div>
  );
}
