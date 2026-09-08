import { Link } from "@tanstack/react-router";

export function AuthShell({
  active,
  children,
}: {
  active: "signin" | "signup";
  children: React.ReactNode;
}) {
  const tab = (to: "/signin" | "/signup", label: string, key: "signin" | "signup") => (
    <Link
      to={to}
      className={`flex h-12 flex-1 items-center justify-center rounded-full text-sm font-bold tracking-wide uppercase transition-colors ${
        active === key
          ? "bg-primary text-primary-foreground glow-ring"
          : "text-primary/80 hover:text-primary"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen hero-glow">
      <main className="mx-auto w-full max-w-md px-5 pt-12 pb-16">
        <div className="flex flex-col items-center text-center">
          <Link to="/" className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 glow-ring">
            <img
              src="/botlogic-mascot.png"
              alt="EA Migrate Pro"
              className="size-16 object-contain"
            />
          </Link>
          <h1 className="mt-5 text-4xl font-bold tracking-tight">
            EA <span className="text-primary">Migrate</span> Pro
          </h1>
          <p className="mt-2 text-xs font-semibold tracking-[0.28em] text-primary/80 uppercase">
            Premium MQL bot management
          </p>
        </div>

        <div className="mt-8 flex gap-1 rounded-full border border-primary/25 bg-card/60 p-1.5">
          {tab("/signin", "Sign in", "signin")}
          {tab("/signup", "Register", "signup")}
        </div>

        {children}
      </main>
    </div>
  );
}

export function Field({
  label,
  children,
  right,
}: {
  label: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
