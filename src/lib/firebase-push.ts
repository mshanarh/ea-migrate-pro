/** Client push registration — firebase/messaging in the browser.
 * Needs Vite-inlined public Firebase web config on Vercel:
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
 *   VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID,
 *   VITE_FIREBASE_VAPID_KEY (same value as FIREBASE_VAPID_KEY; public, not secret).
 * With no config every call fails soft so the app never breaks over push. */
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

/** Ask permission, get the FCM token, POST it to /api/device/register. */
export async function ensurePushRegistered(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!pushConfigured) return { ok: false, error: "push-not-configured" };
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { ok: false, error: "unsupported" };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, error: permission };
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config);
    const token = await getToken(getMessaging(app), vapidKey ? { vapidKey } : undefined);
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
    return { ok: response.ok && reply?.ok === true };
  } catch (error) {
    console.warn("[push] registration failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}
