import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthShell, Field } from "@/components/AuthShell";
import { signIn, useStore } from "@/lib/auth-store";

export const Route = createFileRoute("/signin")({
  head: () => ({
    meta: [
      { title: "Mentor Sign In — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Sign in to EA Migrate Pro to manage your Expert Advisors, licences and hosted MT4/MT5 sessions.",
      },
      { property: "og:title", content: "Mentor Sign In — EA Migrate Pro" },
      {
        property: "og:description",
        content: "Access your EA Migrate Pro dashboard, licences and hosted terminals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const store = useStore();

  return (
    <AuthShell active="signin">
      <form
        className="mt-8 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const res = signIn(email, password);
          if (res.error) return setError(res.error);
          const account = store.accounts.find(
            (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
          );
          navigate({ to: account?.role === "admin" ? "/admin" : "/dashboard" });
        }}
      >
        <Field label="Email address">
          <Input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email address"
            className="h-14 rounded-full border-primary/25 bg-card/70 px-5"
          />
        </Field>

        <Field
          label="Password"
          right={<span className="text-xs text-muted-foreground">Forgot password?</span>}
        >
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="h-14 rounded-full border-primary/25 bg-card/70 px-5"
          />
        </Field>

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        <Button type="submit" size="lg" className="h-14 w-full rounded-full text-base font-bold uppercase glow-ring">
          <LogIn className="size-5" /> Sign in
        </Button>

        <div className="flex justify-center gap-6 text-sm text-muted-foreground">
          <Link to="/admin" className="hover:text-primary">
            Admin login
          </Link>
          <Link to="/" className="hover:text-primary">
            Back home
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
