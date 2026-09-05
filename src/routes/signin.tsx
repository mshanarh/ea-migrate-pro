import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/SiteHeader";

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
  const [notice, setNotice] = useState("");

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-14">
        <h1 className="text-3xl font-bold">
          Mentor <span className="text-primary">Sign In</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Welcome back. Enter your details to reach your EA dashboard.
        </p>

        <form
          className="panel mt-8 space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice("Accounts aren't switched on yet — tell me when to enable logins.");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required placeholder="you@email.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required placeholder="••••••••" />
          </div>
          <Button type="submit" size="lg" className="h-12 w-full rounded-full">
            Sign in
          </Button>
          {notice && <p className="text-center text-sm text-primary">{notice}</p>}
          <p className="text-center text-sm text-muted-foreground">
            No account yet?{" "}
            <Link to="/signup" className="text-primary">
              Sign up
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
