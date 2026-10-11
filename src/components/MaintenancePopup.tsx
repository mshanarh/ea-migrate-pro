import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Landing-page maintenance notice.
 *
 * Shown to every visitor while EA Migrate is still under maintenance.
 * It is intentionally a simple dismissible dialog so the rest of the
 * landing page stays usable, and it can be removed/disabled once the
 * platform is back.
 */
export function MaintenancePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md border-amber-500/40 p-0 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border/60 bg-amber-500/5 px-6 py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
            <Wrench className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
              Maintenance in progress
            </p>
            <DialogTitle className="mt-1 text-xl font-bold leading-tight">
              EA Migrate is still under maintenance
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              We&apos;re finishing up a few backend updates. The site will be back shortly.
            </DialogDescription>
          </div>
        </div>

        <div className="border-t border-border/60 px-6 py-5">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-left">
            <p className="text-sm text-muted-foreground">
              Sign-ups, logins and trading features may be temporarily unavailable while we wrap up the
              current round of work.
            </p>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              onClick={close}
              className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full text-base font-semibold")}
            >
              I understand
            </button>
            <p className="text-center text-xs text-muted-foreground">
              You can keep browsing for now.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
