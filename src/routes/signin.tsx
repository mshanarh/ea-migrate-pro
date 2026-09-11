import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, LogIn, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AuthShell, Field } from "@/components/AuthShell";
import { resetPassword, signIn, useStore } from "@/lib/auth-store";

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
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const navigate = useNavigate();
  const store = useStore();

  const openReset = () => {
    setResetEmail(email);
    setResetError("");
    setNewPassword("");
    setConfirmPassword("");
    setResetOpen(true);
  };

  return (
    <AuthShell active="signin">
      <form
        className="mt-8 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const res = signIn(email, password);
          if (res.error) return setError(res.error);
          const account = store.accounts.find(
            (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
          );
          navigate({ to: res.role === "admin" || account?.role === "admin" ? "/admin" : "/dashboard" });
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
            className="h-14 rounded-full border-white/10 bg-[#1A2332] px-5 text-white placeholder:text-white/35 focus:border-[#38BDF8] focus:ring-[#38BDF8]"
          />
        </Field>

        <Field
          label="Password"
          right={
            <button type="button" onClick={openReset} className="text-xs text-primary hover:underline">
              Forgot password?
            </button>
          }
        >
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="h-14 rounded-full border-white/10 bg-[#1A2332] px-5 text-white placeholder:text-white/35 focus:border-[#38BDF8] focus:ring-[#38BDF8]"
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

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="rounded-3xl border-white/10 bg-[#111111] p-6 text-white sm:max-w-md">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/12">
              <KeyRound className="size-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl font-bold">Reset password</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">Set a new password for your mentor account.</p>
            </div>
            <button type="button" onClick={() => setResetOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="size-5" />
            </button>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setResetError("");
              if (newPassword !== confirmPassword) {
                setResetError("Passwords do not match.");
                return;
              }
              const result = resetPassword(resetEmail, newPassword);
              if (result.error) {
                setResetError(result.error);
                return;
              }
              setEmail(resetEmail.trim());
              setPassword("");
              setResetOpen(false);
              toast.success("Password reset. Sign in with your new password.");
            }}
          >
            <Field label="Email address">
              <div className="flex h-14 items-center gap-3 rounded-full border border-white/10 bg-[#1A2332] px-5">
                <Mail className="size-4 text-muted-foreground" />
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </Field>
            <Field label="New password">
              <Input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="h-14 rounded-full border-white/10 bg-[#1A2332] px-5 text-white placeholder:text-white/35 focus:border-[#38BDF8] focus:ring-[#38BDF8]"
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your new password"
                className="h-14 rounded-full border-white/10 bg-[#1A2332] px-5 text-white placeholder:text-white/35 focus:border-[#38BDF8] focus:ring-[#38BDF8]"
              />
            </Field>
            {resetError && <p className="text-center text-sm text-destructive">{resetError}</p>}
            <Button type="submit" className="h-14 w-full rounded-full text-base font-bold uppercase glow-ring">
              Reset password
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}
