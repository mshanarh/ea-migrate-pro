import { useEffect, useState } from "react";
import { Apple, ArrowLeft, ChevronRight, Flame, Smartphone, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * BLACK FRIDAY — 50% OFF, IN THREE TAPS.
 *
 * 1. The offer splash: the deal, the deadline and a live countdown.
 * 2. The platform choice: the customer tells us iOS or Android — the two builds
 *    are different apps, and quoting the wrong one is how a deal turns into a
 *    support ticket.
 * 3. The discounted prices for THAT platform, with a WhatsApp CTA that already
 *    names the platform and the plan so the owner never has to ask.
 *
 * Nothing here grants app access: the prices are the bank-transfer offer and
 * the CTA opens WhatsApp. The access gate is untouched.
 */

/** Deadline: 18 November 2026, 23:59:59 SAST (UTC+2). */
const DEADLINE_ISO = "2026-11-18T23:59:59+02:00";
const DEADLINE_MS = new Date(DEADLINE_ISO).getTime();

/** The owner's WhatsApp number, in wa.me format (country code, no + or spaces). */
const WHATSAPP_NUMBER = "27704950612";

type PlatformId = "ios" | "android";

const PLATFORMS: Array<{
  id: PlatformId;
  icon: typeof Apple;
  title: string;
  subtitle: string;
}> = [
  {
    id: "ios",
    icon: Apple,
    title: "iOS / iPhone & iPad",
    subtitle: "High-speed WebKit VPS client",
  },
  {
    id: "android",
    icon: Smartphone,
    title: "Android App / APK",
    subtitle: "Native low-latency WebView wrapper",
  },
];

/**
 * One module-level flag so the landing page can show ONE promo at a time — the
 * broker popup checks it before opening on top of this one.
 */
let promoShowing = false;
export function isBlackFridayPromoShowing(): boolean {
  return promoShowing;
}

function splitRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Seconds remaining, ticking once a second. */
function useCountdown() {
  const [remaining, setRemaining] = useState(() => DEADLINE_MS - Date.now());
  useEffect(() => {
    const tick = () => setRemaining(DEADLINE_MS - Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return splitRemaining(remaining);
}

function TimePill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="min-w-11 rounded-xl border border-primary/40 bg-primary/10 px-2 py-1.5 text-center text-lg font-black tabular-nums text-primary shadow-[0_0_18px_rgba(0,245,160,.18)]">
        {value}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function whatsappLink(platform: PlatformId, plan: "Monthly" | "Lifetime") {
  const name = platform === "ios" ? "iOS" : "Android";
  const text = `Hi Ntobeko, I want the Black Friday 50% Off deal for ${name} - ${plan}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function BlackFridayPromoPopup() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [platform, setPlatform] = useState<PlatformId | null>(null);
  const countdown = useCountdown();

  // Shows once per load, after the page has settled.
  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(true), 800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    promoShowing = open;
    return () => {
      promoShowing = false;
    };
  }, [open]);

  const close = () => setOpen(false);

  const choosePlatform = (id: PlatformId) => {
    setPlatform(id);
    setStep(3);
  };

  const platformLabel = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md border-primary/30 p-0 overflow-hidden bg-background">
        {/* ── Header ── */}
        <div className="relative border-b border-border/60 bg-[linear-gradient(135deg,rgba(0,245,160,.16),rgba(0,0,0,.9))] px-5 py-4">
          <div className="flex items-center gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step === 3 ? 2 : 1)}
                aria-label="Back to the previous step"
                className="mr-1 flex size-7 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:text-primary"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">
              <Flame className="size-3.5" aria-hidden="true" />
              Black Friday Exclusive — 50% Off
            </span>
          </div>

          <DialogHeader className="mt-3 space-y-1 text-left">
            <DialogTitle className="text-lg font-black leading-tight tracking-tight">
              {step === 1 ? (
                <>
                  Half price on <span className="text-primary">app access</span>
                </>
              ) : step === 2 ? (
                "Select your mobile platform"
              ) : (
                <>
                  {platformLabel} · <span className="text-primary">50% off applied</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {step === 1
                ? "Half-price cloud VPS & mobile app access for both Monthly (PM) and Lifetime plans."
                : step === 2
                  ? "Choose where you will trade with EA Migrate Pro:"
                  : "Lock in the Black Friday price before the timer runs out."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── Step 1: the offer + countdown ── */}
        {step === 1 ? (
          <div className="px-5 py-4">
            <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-3">
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Tag className="size-3.5 text-primary" aria-hidden="true" />
                Valid until 18 November
              </div>
              <div className="mt-3 flex items-start justify-center gap-1.5">
                <TimePill value={pad(countdown.days)} label="Days" />
                <span className="pt-1.5 text-lg font-black text-primary/50" aria-hidden="true">:</span>
                <TimePill value={pad(countdown.hours)} label="Hours" />
                <span className="pt-1.5 text-lg font-black text-primary/50" aria-hidden="true">:</span>
                <TimePill value={pad(countdown.minutes)} label="Minutes" />
                <span className="pt-1.5 text-lg font-black text-primary/50" aria-hidden="true">:</span>
                <TimePill value={pad(countdown.seconds)} label="Seconds" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] text-sm font-black text-[#021810] shadow-[0_10px_30px_rgba(0,245,160,.3)] transition hover:brightness-110 active:scale-[0.99]"
            >
              Claim 50% Off Access
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <p className="mt-2.5 text-center text-[10px] text-muted-foreground">
              Monthly ZAR 350 → 175 · Lifetime ZAR 500 → 250
            </p>
          </div>
        ) : null}

        {/* ── Step 2: platform ── */}
        {step === 2 ? (
          <div className="grid gap-2.5 px-5 py-4">
            {PLATFORMS.map(({ id, icon: Icon, title, subtitle }) => (
              <button
                key={id}
                type="button"
                onClick={() => choosePlatform(id)}
                className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/50 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 active:scale-[0.995]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{title}</span>
                  <span className="block text-[11px] text-muted-foreground">{subtitle}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}

        {/* ── Step 3: discounted prices for the chosen platform ── */}
        {step === 3 && platform ? (
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2">
              <span className="text-[11px] font-bold">
                Selected: <span className="text-primary">{platformLabel}</span>{" "}
                <span className="text-muted-foreground">(50% off applied)</span>
              </span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="shrink-0 text-[10px] font-black uppercase tracking-wide text-primary hover:underline"
              >
                Change
              </button>
            </div>

            <div className="grid gap-2.5">
              {/* Monthly */}
              <div className="rounded-2xl border border-border/60 bg-card/50 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">Monthly Subscription</p>
                    <span className="mt-0.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-muted-foreground">
                      Per Month / PM
                    </span>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-black uppercase text-primary">
                    50% Off
                  </span>
                </div>
                <p className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground line-through">ZAR 350</span>
                  <span className="text-2xl font-black text-white">ZAR 175</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">/ month</span>
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Cancel anytime • Up to 3 EAs • 24/7 Cloud VPS
                </p>
                <a
                  href={whatsappLink(platform, "Monthly")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 flex h-10 w-full items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground transition hover:brightness-110"
                >
                  Get Monthly at ZAR 175
                </a>
              </div>

              {/* Lifetime */}
              <div className="rounded-2xl border border-primary/50 bg-primary/5 p-3.5 shadow-[0_0_34px_rgba(0,245,160,.14)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">Lifetime Access</p>
                    <span className="mt-0.5 inline-block rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary">
                      Best Value / Lifetime
                    </span>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-black uppercase text-primary">
                    50% Off
                  </span>
                </div>
                <p className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground line-through">ZAR 500</span>
                  <span className="text-2xl font-black text-white">ZAR 250</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">one-time</span>
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Pay once, trade forever • Unlimited EAs • 24/7 Cloud VPS
                </p>
                <a
                  href={whatsappLink(platform, "Lifetime")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 flex h-10 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#00F5A0] to-[#10B981] text-xs font-black text-[#021810] transition hover:brightness-110"
                >
                  Get Lifetime at ZAR 250
                </a>
              </div>
            </div>

            <p className="mt-3 text-center text-[10px] leading-relaxed text-muted-foreground">
              ⚡ Instant setup after payment. Offer expires midnight 18 November.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={close}
          className={cn(
            "border-t border-border/60 px-5 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.14em]",
            "text-muted-foreground transition-colors hover:text-foreground",
          )}
        >
          No thanks, keep browsing
        </button>
      </DialogContent>
    </Dialog>
  );
}
