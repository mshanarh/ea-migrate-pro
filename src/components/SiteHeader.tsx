import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 glow-ring">
            <Bot className="size-4 text-primary" />
          </span>
          <span className="text-sm font-bold tracking-[0.18em] uppercase">
            EA <span className="text-primary">Migrate</span> Pro
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/builder"
            className="hidden rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            EA Builder
          </Link>
          <Button asChild size="sm" className="rounded-full">
            <Link to="/builder">Start building</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
