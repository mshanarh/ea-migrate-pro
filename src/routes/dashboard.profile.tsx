import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCurrentAccount, updateProfile } from "@/lib/auth-store";

export const Route = createFileRoute("/dashboard/profile")({
  ssr: false,
  component: Profile,
});

function Profile() {
  const account = useCurrentAccount();
  const [form, setForm] = useState({
    firstName: account?.firstName ?? "",
    displayName: account?.displayName ?? "",
    whatsapp: account?.whatsapp ?? "",
    password: account?.password ?? "",
  });

  if (!account) return null;

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="block">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-2 h-12 w-full rounded-full border border-border/70 bg-card/60 px-5 text-sm outline-none focus:border-primary"
      />
    </label>
  );

  return (
    <div className="max-w-lg">
      <p className="text-xs font-bold tracking-[0.22em] text-primary uppercase">Account</p>
      <h1 className="mt-1 text-3xl font-bold">Profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Update the details shown on your mentor portal.
      </p>

      <form
        className="panel mt-6 space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          updateProfile(account.id, form);
          toast.success("Profile updated");
        }}
      >
        {field("First name", "firstName")}
        {field("Display name", "displayName")}
        {field("WhatsApp number", "whatsapp")}
        {field("Password", "password", "password")}

        <div className="rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          Email: <span className="text-foreground">{account.email}</span>
          <br />
          Username: <span className="text-foreground">{account.username}</span>
          <br />
          Status:{" "}
          <span className="font-semibold text-primary uppercase">{account.status}</span>
        </div>

        <button className="h-12 w-full rounded-full bg-primary text-sm font-bold text-primary-foreground glow-ring">
          Save changes
        </button>
      </form>
    </div>
  );
}
