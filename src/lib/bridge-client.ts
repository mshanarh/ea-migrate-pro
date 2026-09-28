/**
 * MT5 bridge connection details for DIRECT browser → bridge calls.
 *
 * The production app is a static Vite site (no server functions), so the
 * scanner's Execute flow, the live-price lookup for SL/TP and the
 * MetaTrader TEST CONNECTION hit the bridge straight from the browser. The
 * bridge allows CORS from the app's origins (verified).
 *
 * ⚠️ The trycloudflare URL is ephemeral: restarting `cloudflared` mints a
 * new one — update BRIDGE_URL here (one line) when that happens.
 */
export const BRIDGE_URL = "https://camping-geology-operates-consistency.trycloudflare.com";
export const BRIDGE_KEY = "my_secret_bridge_key_2026";
