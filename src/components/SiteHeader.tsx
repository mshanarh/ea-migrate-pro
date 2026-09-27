import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, ChevronDown, Smartphone, Apple, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const LIGHT_KEY = "ea_migrate_light";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [apkOpen, setApkOpen] = useState(false);
  const [light, setLight] = useState(false);
  const navigate = useNavigate();

  // Restore the visitor's choice (the toggle is opt-in — dark stays default).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LIGHT_KEY) === "1") {
        document.documentElement.classList.add("light-mode");
        setLight(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleLight = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light-mode", next);
    try {
      if (next) window.localStorage.setItem(LIGHT_KEY, "1");
      else window.localStorage.removeItem(LIGHT_KEY);
    } catch {
      /* ignore */
    }
  };

  const close = () => setOpen(false);
  const openIosApp = () => {
    close();
    navigate({ to: "/app" });
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between overflow-hidden px-5">
        <Link to="/" className="group flex min-w-0 items-center gap-1.5 transition-transform duration-200 ease-out hover:scale-[1.01]">
          <img
            src="/logo.png"
            alt="EA Migrate"
            className="logo-spin size-12 min-w-[40px] shrink-0 rounded-full border border-border/60 object-cover"
          />
          <span className="text-base font-bold tracking-tight whitespace-nowrap uppercase transition-transform duration-200 ease-out group-hover:-translate-x-0.5">
            EA <span className="text-primary">Migrate</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
            onClick={toggleLight}
            className="plat-pressable flex size-11 items-center justify-center rounded-xl border border-border/70 bg-card/60 text-muted-foreground transition-colors hover:text-primary"
          >
            {light ? <Moon className="size-5" /> : <Sun className="size-5" />}
          </button>

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
      </div>
    </header>
  );
}
