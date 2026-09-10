export type TradingState = "idle" | "bubble" | "active"

export type TradingConfig = {
  /** Parsed from the license key, e.g. "SNIPER KILLER EA" */
  robotName: string
  /** Accent color used for the bubble border + glow (user selected) */
  selectedColor: string
  /** Broker name from the broker connection */
  brokerName: string
  /** Account type from the MT5 connection */
  accountType: string
  /** Brand name from settings: "BotLogic" | "EA Migrate" | ... */
  brandName: string
  /** Robot face image (swap for the user's uploaded image / selected robot) */
  robotImage: string
  /** Trading stats shown in the active screen */
  lot: string
  openTrades: number
  perSignal: number
  executed: number
}

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  robotName: "SNIPER KILLER EA",
  selectedColor: "#EF4444",
  brokerName: "Headway",
  accountType: "MT5",
  brandName: "EAConnect",
  robotImage: "/robot-face.png",
  lot: "0.01",
  openTrades: 29,
  perSignal: 5,
  executed: 29,
}

/**
 * Parse a robot name out of a license key.
 * Real keys look like "SNIPER-KILLER-EA-2K9F-...". We take the leading
 * alpha segments (before the first numeric/short token) and title-case them.
 */
export function parseRobotName(licenseKey: string | undefined | null): string | null {
  if (!licenseKey) return null
  const parts = licenseKey.trim().toUpperCase().split(/[-_\s]+/)
  const nameParts: string[] = []
  for (const part of parts) {
    // stop at the first token that looks like a serial segment (has a digit)
    if (/\d/.test(part)) break
    if (part.length === 0) continue
    nameParts.push(part)
  }
  if (nameParts.length === 0) return null
  return nameParts.join(" ")
}
