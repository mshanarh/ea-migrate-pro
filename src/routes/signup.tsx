import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign Up — EA Migrate Pro" },
      {
        name: "description",
        content:
          "Create your EA Migrate Pro account to build, host and run custom MT4/MT5 Expert Advisors 24/7.",
      },
      { property: "og:title", content: "Sign Up — EA Migrate Pro" },
      {
        property: "og:description",
        content: "Create an account and start building custom Expert Advisors in minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignUp,
});

function SignUp() {
  const [notice, setNotice] = useState("");

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-14">
        <h1 className="text-3xl font-bold">
          Create your <span className="text-primary">account</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up in under a minute and start building your first robot.
        </p>

        <form
          className="panel mt-8 space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice("Accounts aren't switched on yet — tell me when to enable sign-ups.");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required placeholder="Your name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required placeholder="you@email.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required placeholder="••••••••" />
          </div>
          <Button type="submit" size="lg" className="h-12 w-full rounded-full">
            Sign up
          </Button>
          {notice && <p className="text-center text-sm text-primary">{notice}</p>}
          <p className="text-center text-sm text-muted-foreground">
            Already registered?{" "}
            <Link to="/signin" className="text-primary">
              Sign in
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
