import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell, Field } from "@/components/AuthShell";
import { register } from "@/lib/auth-store";
import { syncRegister } from "@/lib/account-sync.server";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your mentor portal — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Register a mentor portal on EA Migrate Pro to build, licence and host custom MT4/MT5 Expert Advisors.",
      },
      { property: "og:title", content: "Create your mentor portal — EA Migrate Pro" },
      {
        property: "og:description",
        content: "Register a mentor portal and start issuing Expert Advisor licences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignUp,
});

const inputClass = "h-14 rounded-full border-white/10 bg-[#1A2332] px-5 text-white placeholder:text-white/35 focus:border-[#38BDF8] focus:ring-[#38BDF8]";

function SignUp() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    displayName: "",
    email: "",
    username: "",
    password: "",
    confirm: "",
    whatsapp: "",
  });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AuthShell active="signup">
      <form
        className="mt-8 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          if (form.password !== form.confirm) return setError("Passwords do not match.");
          if (!agree) return setError("Please accept the terms to continue.");
          setError("");
          const res = register({
            firstName: form.firstName,
            displayName: form.displayName,
            email: form.email,
            username: form.username,
            password: form.password,
            whatsapp: form.whatsapp,
          });
          if (res.error) return setError(res.error);
          setSaving(true);
          try {
            // Wait for the cross-device write before leaving the page. The old
            // fire-and-forget call could be interrupted by the redirect in production.
            if (res.account) {
              const synced = await syncRegister({ data: { account: res.account } });
              if (synced.enabled && !synced.ok) {
                console.error("[signup] Shared registration sync failed");
              }
            }
            navigate({ to: "/dashboard" });
          } catch (syncError) {
            console.error("[signup] Shared registration sync unavailable", syncError);
            navigate({ to: "/dashboard" });
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="First name">
          <Input required value={form.firstName} onChange={set("firstName")} placeholder="Enter your first name" className={inputClass} />
        </Field>
        <Field label="Display name">
          <Input required value={form.displayName} onChange={set("displayName")} placeholder="Name shown on the robot app" className={inputClass} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={set("email")} placeholder="Enter your email address" className={inputClass} />
        </Field>
        <Field label="Username">
          <Input required value={form.username} onChange={set("username")} placeholder="Choose a username" className={inputClass} />
        </Field>
        <Field label="Password">
          <Input type="password" required value={form.password} onChange={set("password")} placeholder="Create a password" className={inputClass} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" required value={form.confirm} onChange={set("confirm")} placeholder="Confirm your password" className={inputClass} />
        </Field>
        <Field label="WhatsApp number">
          <Input required value={form.whatsapp} onChange={set("whatsapp")} placeholder="e.g. +27 71 234 5678" className={inputClass} />
        </Field>

        <label className="flex items-center gap-3 pt-1 text-sm">
          <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} />
          <span>
            I agree to the <span className="text-primary">Terms</span> and{" "}
            <span className="text-primary">Privacy Policy</span>
          </span>
        </label>

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        <Button type="submit" size="lg" disabled={saving} className="h-14 w-full rounded-full text-base font-bold uppercase glow-ring">
          <UserPlus className="size-5" /> {saving ? "Saving account..." : "Create account"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already registered?{" "}
          <Link to="/signin" className="text-primary">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
