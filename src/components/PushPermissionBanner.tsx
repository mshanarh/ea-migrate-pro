/**
 * Mounted at the root so it covers every logged-in app screen.
 *
 * Three states, in priority order:
 *   1. "default"  → dialog: "Enable Trade Notifications?" with a button that
 *      calls requestPermission(). On grant, getToken() + save to Supabase
 *      device_tokens and log `FCM_TOKEN_REGISTERED`.
 *   2. "denied"   → banner "Notifications blocked - Tap to Enable" with a
 *      button that opens Android app-notification settings (via the native
 *      bridge when inside the wrapper) or guides to App Info.
 *   3. "granted"  → nothing: the token was already registered elsewhere.
 *
 * Nothing renders when signed out or when push is not configured.
 */
import { useEffect, useState } from "react";
import { useCurrentAccount } from "@/lib/auth-store";
import {
  ensurePushRegistered,
  pushConfigured,
} from "@/lib/firebase-push";
import { callNative } from "@/lib/native-bridge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function PushPermissionBanner() {
  const account = useCurrentAccount() as { email?: string } | null | undefined;
  const email = typeof account?.email === "string" ? account.email : "";
  const [permission, setPermission] = useState<PermissionState>("default");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [justDenied, setJustDenied] = useState(false);

  // Keep the local copy in sync with the live permission state.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);
  }, []);

  // On app load after login: if the browser has not decided yet, open the
  // dialog immediately so the user is not left wondering why alerts are quiet.
  useEffect(() => {
    if (!email || permission !== "default" || !pushConfigured) return;
    setDialogOpen(true);
  }, [email, permission, pushConfigured]);

  const openAndroidSettings = () => {
    // Inside the Android wrapper, hand off to the native bridge which scopes
    // the settings intent to THIS app (the only reliable recovery path after a
    // runtime denial).
    if (callNative("openNotificationSettings")) return;
    // Web / unknown wrapper: guide the user to the app's notification settings.
    if (typeof window !== "undefined" && window.open) {
      window.open("android-settings", "_blank", "noopener");
    }
  };

  const handleRequestPermission = async () => {
    setRegisterError(null);
    setRegistering(true);
    try {
      const result = await ensurePushRegistered(email);
      if (result.ok) {
        setPermission("granted");
        setDialogOpen(false);
        console.log("FCM_TOKEN_REGISTERED");
        return;
      }
      // The helper already attempted requestPermission() internally; mirror
      // the resulting browser permission so the UI reflects reality.
      if ("Notification" in window) {
        setPermission(Notification.permission as PermissionState);
      }
      if (result.error === "granted" || result.error === "denied" || result.error === "default") {
        setPermission(result.error as PermissionState);
        if (result.error === "denied") setJustDenied(true);
        setDialogOpen(false);
        return;
      }
      setRegisterError(result.error ?? "Could not enable notifications");
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : "Could not enable notifications");
    } finally {
      setRegistering(false);
    }
  };

  // Granted — nothing to show.
  if (!email || permission === "granted" || permission === "unsupported") return null;

  // Denied — persistent banner with a way back into settings.
  if (permission === "denied") {
    return (
      <div className="fixed inset-x-3 bottom-20 z-[80] flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121216]/95 px-4 py-3 shadow-xl backdrop-blur">
        <p className="text-xs font-semibold leading-4 text-white/85">
          Notifications blocked - Tap to Enable
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openAndroidSettings}
          className="shrink-0 rounded-full border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/10"
        >
          Enable
        </Button>
      </div>
    );
  }

  // "default" — ask the user.
  if (!pushConfigured) return null;

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm border border-white/10 bg-[#121216] pt-safe text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Enable Trade Notifications?</DialogTitle>
            <DialogDescription className="text-sm text-white/70">
              Get a push alert the moment one of your robots fills a trade — even when the app is closed.
            </DialogDescription>
          </DialogHeader>

          {registerError && (
            <p className="mt-2 text-xs font-medium text-red-300">{registerError}</p>
          )}

          <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                if ("Notification" in window) setPermission(Notification.permission as PermissionState);
              }}
              className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10"
            >
              Not now
            </Button>
            <Button
              type="button"
              onClick={handleRequestPermission}
              disabled={registering}
              className="rounded-full bg-[#F97316] text-black hover:bg-[#ea580c]"
            >
              {registering
                ? "Requesting…"
                : justDenied
                  ? "Request again"
                  : "Enable notifications"}
            </Button>
          </DialogFooter>
          <p className="mt-3 text-[11px] text-white/40">
            Trade alerts also arrive through the app&apos;s native notification channel while you trade.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
