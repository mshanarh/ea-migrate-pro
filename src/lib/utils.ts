import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The MT5 ORDER COMMENT for a robot — the EA name EXACTLY as configured.
 *
 * "sniper killer ea v2+" goes to the broker as "sniper killer ea v2+". No
 * character stripping, no space collapsing, no trimming, no 31-character cap
 * and no brand fallback: the trader's name is authoritative and the app never
 * rewrites it. Only null/undefined collapses to "" (there is no name to
 * send); the bridge applies its own server-side default for an empty comment.
 *
 * This replaced `sanitizeBotName`, which stripped punctuation, collapsed
 * spaces and capped the name at 31 characters BEFORE the request left the
 * app — so an order carried a name the trader never configured and nothing
 * said so. If a broker now rejects, truncates or rewrites the comment, that
 * is surfaced (requested vs actual, logged and recorded) instead of hidden —
 * see `friendlyTradeError`, `recordTrade` and `ExecutedTrade.meta`.
 *
 * Shared by the scanner and the auto-trade engine so both send the exact
 * same stamp.
 */
export function mt5OrderComment(name: string | null | undefined): string {
  return name ?? "";
}
