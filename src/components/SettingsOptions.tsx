import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";

export type Option = { label: string; description: string };

export function OptionScreen({
  title,
  options,
  value,
  onSelect,
  columns = 1,
  numbered = false,
}: {
  title: string;
  options: Option[];
  value: string;
  onSelect: (v: string) => void;
  columns?: 1 | 2;
  numbered?: boolean;
}) {
  return (
    <AppFrame>
      <div className="flex items-center gap-4">
        <Link
          to="/app/settings"
          aria-label="Back to settings"
          className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-card/60"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>

      <div className={`mt-6 grid gap-3 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {options.map((o, i) => {
          const active = o.label === value;
          return (
            <button
              key={o.label}
              onClick={() => onSelect(o.label)}
              className={`flex items-center gap-4 rounded-3xl border p-4 text-left transition-colors ${
                active
                  ? "border-primary/60 bg-primary/10 glow-ring"
                  : "border-border/50 bg-card/60"
              }`}
            >
              {numbered && (
                <span
                  className={`flex size-11 items-center justify-center rounded-2xl font-bold ${
                    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block font-semibold ${active ? "text-primary" : ""}`}>
                  {o.label}
                </span>
                <span className="block text-sm text-muted-foreground">{o.description}</span>
              </span>
              {active && <Check className="size-5 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </AppFrame>
  );
}
