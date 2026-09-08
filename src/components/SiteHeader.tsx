import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, ChevronDown, Smartphone, Apple } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [apkOpen, setApkOpen] = useState(false);
  const navigate = useNavigate();

  const close = () => setOpen(false);
  const openIosApp = () => {
    close();
    navigate({ to: "/app" });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/ea-migrate-platform-robot.jpg"
            alt="EA Migrate Pro"
            className="size-10 object-contain"
          />
          <span className="text-base font-bold tracking-tight uppercase">
            EA <span className="text-primary">Migrate</span> Pro
          </span>
        </Link>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              aria-label="Open menu"
              className="flex size-11 items-center justify-center rounded-xl border border-border/70 bg-card/60"
            >
              <Menu className="size-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="top" className="border-border/60 bg-background/95 p-5 pt-16">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
              <Button asChild size="lg" className="h-14 rounded-2xl text-base font-semibold">
                <Link to="/signin" onClick={close}>
                  Mentor Sign In
                </Link>
              </Button>

              <Button
                asChild
                size="lg"
                variant="secondary"
                className="h-14 rounded-2xl text-base font-semibold"
              >
                <Link to="/signup" onClick={close}>
                  Sign Up
                </Link>
              </Button>

              <button
                onClick={() => setApkOpen((v) => !v)}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-secondary text-base font-semibold"
              >
                Download apk
                <ChevronDown
                  className={`size-4 transition-transform ${apkOpen ? "rotate-180" : ""}`}
                />
              </button>
              {apkOpen && (
                <div className="flex flex-col gap-2 px-2">
                  <a
                    href="#download"
                    onClick={close}
                    className="flex h-12 items-center gap-2 rounded-xl border border-border/70 px-4 text-sm"
                  >
                    <Smartphone className="size-4 text-primary" /> Android APK
                  </a>
                  <button
                    type="button"
                    onClick={openIosApp}
                    className="flex h-12 items-center gap-2 rounded-xl border border-border/70 px-4 text-left text-sm"
                  >
                    <Apple className="size-4 text-primary" /> iOS App
                  </button>
                </div>
              )}

              <a
                href="/#how"
                onClick={close}
                className="flex h-14 items-center justify-center rounded-2xl bg-secondary text-base font-semibold"
              >
                How it works
              </a>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
