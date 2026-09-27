import { useEffect, useState } from "react";
import { BadgePercent, ShieldCheck, Timer, Wallet } from "lucide-react";
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
 * Broker promo popup for the landing page: celebrates the visitor's arrival
 * (🎉), recommends Headway as EA Migrate's broker, and links to the partner
 * signup URL. Shows once per day per device so it never nags.
 */
const PROMO_LINK = "https://headway.partners/user/signup?hwp=f37cd5";
const PROMO_KEY = "ea_migrate_broker_promo";
const DAY_MS = 24 * 60 * 60 * 1000;

const HIGHLIGHTS = [
  {
    icon: BadgePercent,
    title: "Ultra-tight spreads",
    text: "Raw, competitive pricing on 476+ instruments — more of every move stays yours.",
  },
  {
    icon: Timer,
    title: "Fast & secure withdrawals",
    text: "Withdrawals processed quickly with bank-grade security and FSCA regulation.",
  },
  {
    icon: Wallet,
    title: "Bonus on your first deposit",
    text: "Start with a trading boost — Headway rewards your first top-up.",
  },
  {
    icon: ShieldCheck,
    title: "Built for EA trading",
    text: "MetaTrader 4 & 5, EAs allowed, stable execution — plug EA Migrate straight in.",
  },
];

export function BrokerPromoPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const last = Number(window.localStorage.getItem(PROMO_KEY) ?? 0);
      if (Number.isFinite(last) && Date.now() - last < DAY_MS) return;
      window.localStorage.setItem(PROMO_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — still show once per visit */
    }
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md border-primary/30 p-0 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border/60 bg-primary/5 px-6 py-5">
          <img
            src="/headway-logo.png"
            alt="Headway broker logo"
            className="size-14 shrink-0 rounded-2xl object-contain"
            loading="lazy"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              🎉 Recommended for EA Migrate
            </p>
            <DialogTitle className="mt-1 text-xl font-bold leading-tight">
              Meet your edge: <span className="text-primary">Headway</span>
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              The broker EA Migrate traders trust.
            </DialogDescription>
          </div>
        </div>

        <div className="px-6 pb-2">
          <ul className="grid gap-4 py-4">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-border/60 px-6 py-5">
          <a href={PROMO_LINK} target="_blank" rel="noopener noreferrer sponsored" className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full text-base font-semibold")}>
            Open a Headway account
          </a>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Sign-up link takes you straight to Headway's registration page.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
