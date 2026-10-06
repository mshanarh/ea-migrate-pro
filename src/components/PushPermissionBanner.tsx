/** Mounted at the root so it covers every logged-in app screen.
 *  "default"  → asks permission and registers the FCM token.
 *  "denied"   → banner "Enable notifications to get trade alerts" with a
 *               button that opens app settings (where the OS-level toggle lives).
 *  Nothing renders when signed out or already granted. */
import { useEffect, useState } from "react";
import { useCurrentAccount } from "@/lib/auth-store";
import { ensurePushRegistered, pushConfigured } from "@/lib/firebase-push";

type Permission = "default" | "granted" | "denied" | "unsupported";

export function PushPermissionBanner() {
  const account = useCurrentAccount() as { email?: string } | null | undefined;
  const email = typeof account?.email === "string" ? account.email : "";
  const [permission, setPermission] = useState<Permission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as Permission);
    // On app load after login: ask once and register the token.
    if (email && Notification.permission === "default" && pushConfigured) {
      void ensurePushRegistered(email).then(() => {
        if ("Notification" in window) setPermission(Notification.permission as Permission);
      });
    }
  }, [email]);

  if (!email || permission !== "denied") return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-[80] flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121216]/95 px-4 py-3 shadow-xl backdrop-blur">
      <p className="text-xs font-semibold leading-4 text-white/85">
        Enable notifications to get trade alerts
      </p>
      <a
        href="/app/settings"
        className="shrink-0 rounded-full bg-[#38BDF8] px-3 py-1.5 text-[11px] font-black text-black"
      >
        Open settings
      </a>
    </div>
  );
}
