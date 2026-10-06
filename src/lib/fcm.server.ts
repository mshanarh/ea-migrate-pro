/**
 * SERVER-ONLY FCM sender. Imported by /api/trade-notify (and nothing in the
 * browser bundle — firebase-admin must never be Vite-inlined).
 *
 * Env: FIREBASE_SERVICE_ACCOUNT_JSON — the whole service-account JSON as one
 * string (Vercel project settings). The raw PRIVATE KEY needs its newlines
 * intact; both `\\n` escapes and literal newlines are accepted here because
 * pasting a JSON blob into a web form often flattens them.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const NOT_CONFIGURED = "Push is not configured on the server (FIREBASE_SERVICE_ACCOUNT_JSON).";

function app(): App | null {
  const raw = (process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "").trim();
  if (!raw) return null;
  const existing = getApps()[0];
  if (existing) return existing;
  try {
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return initializeApp({
      credential: cert({
        ...(parsed.project_id ? { projectId: parsed.project_id } : {}),
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    });
  } catch (error) {
    console.error("[fcm] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:", error);
    return null;
  }
}

export function fcmConfigured(): boolean {
  return (process.env["FIREBASE_SERVICE_ACCOUNT_JSON"] ?? "").trim().length > 0;
}

/**
 * Send one push. Returns FCM's message id, or an error string — never throws,
 * because a dead push must not roll back the trade row that triggered it.
 */
export async function sendPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  const application = app();
  if (!application) return { ok: false, error: NOT_CONFIGURED };
  if (!token.trim()) return { ok: false, error: "Empty device token" };
  try {
    const messageId = await getMessaging(application).send({
      token: token.trim(),
      notification: { title, body },
      data,
      android: { priority: "high" },
      webpush: { fcmOptions: { link: "/app/notifications" } },
    });
    return { ok: true, messageId };
  } catch (error) {
    // NOT_FOUND / UNREGISTERED tokens are routine (app uninstalled) — the
    // caller logs them and moves on instead of failing the webhook.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[fcm] send failed for ${token.slice(0, 12)}…: ${detail}`);
    return { ok: false, error: detail };
  }
}
