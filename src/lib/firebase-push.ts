/** Client push registration — firebase/messaging in the browser.
 * Needs Vite-inlined public Firebase web config on Vercel:
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
 *   VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID,
 *   VITE_FIREBASE_VAPID_KEY (same value as FIREBASE_VAPID_KEY; public, not secret).
 * With no config every call fails soft so the app never breaks over push.
 *
 * MESSAGING CHANNEL.
 *   - Web push uses the browser's firebase/messaging web SDK + a service
 *     worker (public/sw.js) for foreground + background delivery.
 *   - Android push currently delivers through the NATIVE overlay bridge
 *     (window.EAMigrate.showTradeNotification) which posts a local heads-up
 *     via the app's own notification channel; FCM token registration is still
 *     wired up here so the server can reach the device through FCM when the
 *     wrapper supports it.
 */
import { getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";

const env = import.meta.env as Record<string, string | undefined>;
// undefined entries are stripped so the object satisfies
// exactOptionalPropertyTypes when passed to initializeApp.
const config = Object.fromEntries(
  Object.entries({
    apiKey: env["VITE_FIREBASE_API_KEY"],
    authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"],
    projectId: env["VITE_FIREBASE_PROJECT_ID"],
    messagingSenderId: env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
    appId: env["VITE_FIREBASE_APP_ID"],
  }).filter(([, value]) => typeof value === "string" && value.length > 0),
) as Record<string, string>;
const vapidKey = env["VITE_FIREBASE_VAPID_KEY"];

export const pushConfigured = Boolean(config["apiKey"] && config["projectId"] && config["appId"]);

/**
 * Ask permission (if still undecided), get the FCM token, POST it to
 * /api/device/register with the user's email, and log FCM_TOKEN_REGISTERED.
 *
 * Returns the browser permission string as `error` so callers can mirror the
 * live state (e.g. show the denied banner after a one-shot denial).
 */
export async function ensurePushRegistered(
  email: string,
): Promise<PushRegistrationResult> {
  if (!pushConfigured) return { ok: false, error: "push-not-configured" };
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { ok: false, error: "unsupported" };
  }

  // If the browser already decided, do not re-prompt — just register / refresh
  // the token that is already allowed.
  const existing = Notification.permission;
  if (existing === "granted") {
    return registerToken(email);
  }
  // denied / unsupported: do not touch the permission state here; the banner
  // is the only recovery path. Return the live state back to the caller.
  if (existing !== "default") {
    return { ok: false, error: existing };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log(`FCM_PERMISSION_${permission.toUpperCase()}`);
      return { ok: false, error: permission };
    }
    const registered = await registerToken(email);
    if (registered.ok) {
      console.log("FCM_TOKEN_REGISTERED");
    }
    return registered;
  } catch (error) {
    console.warn("[push] registration failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * Get the current FCM token (creating it if needed) and upsert it into
 * device_tokens via /api/device/register.
 */
async function registerToken(email: string): Promise<PushRegistrationResult> {
  try {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, vapidKey ? { vapidKey } : undefined);
    if (!token) return { ok: false, error: "no-token" };

    const response = await fetch("/api/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        fcm_token: token,
        device_name: navigator.userAgent.slice(0, 120),
      }),
    });
    const reply = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    if (!response.ok || reply?.ok !== true) {
      return { ok: false, error: "device-register-failed" };
    }
    return { ok: true };
  } catch (error) {
    console.warn("[push] token registration failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

export type PushRegistrationResult =
  | { ok: true }
  | { ok: false; error: string };
