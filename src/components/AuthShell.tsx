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
          : "text-[#38BDF8]/80 hover:text-[#38BDF8]"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white hero-glow">
      <main className="mx-auto w-full max-w-md px-5 pt-12 pb-16">
        <div className="flex flex-col items-center text-center">
          <Link to="/" className="flex size-16 items-center justify-center rounded-2xl border border-[#38BDF8]/20 bg-[#1A2332] shadow-[0_0_24px_rgb(0_168_255_/_0.2)]">
            <img
              src="/ea-migrate-platform-robot.jpg"
              alt="EA Migrate Pro"
              className="size-16 object-contain"
            />
          </Link>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-white">
            EA <span className="text-[#38BDF8]">Migrate</span> Pro
          </h1>
          <p className="mt-2 text-xs font-semibold tracking-[0.28em] text-[#38BDF8]/80 uppercase">
            Premium MQL bot management
          </p>
        </div>

        <div className="mt-8 flex gap-1 rounded-full border border-white/10 bg-[#111111] p-1.5">
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
        <span className="text-xs font-bold tracking-[0.16em] text-[#38BDF8] uppercase">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
