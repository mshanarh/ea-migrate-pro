import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * THE AUTH SHELL — mentor sign in / register.
 *
 * Cyber Mint / Neon Profit Emerald on deep obsidian: #00F5A0 → #10B981 accents
 * over #0A0A0A, with feathered mint halos behind the card instead of a flat
 * background. The accent is published as the primary + glow tokens on this
 * subtree, so every `text-primary` / `bg-primary` / `glow-ring` utility used by
 * the forms below is the same mint without repeating the hex everywhere.
 *
 * The logo is the dynamic BrandLogo: a logo uploaded in Settings → App logo
 * shows here automatically, with the built-in mascot as the only fallback.
 */

const AUTH_ACCENT = {
  /* Tailwind's `@theme inline` compiles text-primary / bg-primary / border-primary
     to var(--primary), so overriding the source token here rethemes every
     utility the forms use — including Button's default variant. */
  "--primary": "#00F5A0",
  "--primary-foreground": "#021810",
  "--ring": "#10B981",
  "--glow": "0 0 50px rgba(0,245,160,.32), 0 0 100px rgba(16,185,129,.18)",
  "--glow-soft": "0 0 30px rgba(0,245,160,.3), 0 0 70px rgba(16,185,129,.16)",
  "--gradient-brand": "linear-gradient(100deg, #00F5A0, #10B981)",
} as CSSProperties;

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
          ? "bg-[#00F5A0] font-black text-[#021810] shadow-[0_0_24px_rgba(0,245,160,.4)]"
          : "text-[#00F5A0]/70 hover:text-[#00F5A0]"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#0A0A0A] text-white"
      style={AUTH_ACCENT}
    >
      {/* Feathered obsidian ambience — mint light bleeding down from the top
          and a soft halo behind the card, no flat grey wash. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(0,245,160,.22),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 left-1/2 h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,.16),transparent_65%)] blur-2xl"
      />

      <main className="relative mx-auto w-full max-w-md px-5 pt-12 pb-16">
        <div className="flex flex-col items-center text-center">
          <Link
            to="/"
            className="flex size-20 items-center justify-center rounded-full border border-[#00F5A0]/25 bg-white/5 p-2 shadow-[0_0_36px_rgba(0,245,160,.28)] transition-transform duration-300 hover:scale-105"
          >
            <BrandLogo alt="EA Migrate" className="size-full object-contain" />
          </Link>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white">
            EA <span className="text-[#00F5A0]">Migrate</span>
          </h1>
          <p className="mt-2 text-xs font-semibold tracking-[0.28em] text-[#00F5A0] uppercase">
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
        <span className="text-xs font-bold tracking-[0.16em] text-[#00F5A0] uppercase">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
