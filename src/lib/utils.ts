import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize a robot name into an MT5 ORDER COMMENT — the bot name ONLY.
 *
 * MT5 accepts 31 characters of letters, digits and spaces and refuses the
 * rest, so punctuation/symbols are stripped, runs of spaces collapse, the
 * result is trimmed and capped at 31. Returns "" when there is no name:
 * there is deliberately NO brand fallback ("Eamigrate", "EA MIGRATE", …) —
 * the bridge applies its own server-side default for an empty comment.
 * Shared by the scanner and the auto-trade engine so both send the exact
 * same stamp.
 */
export function sanitizeBotName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
}
