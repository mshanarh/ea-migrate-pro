import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppState } from "@/lib/app-store";
import { useBackgroundPicture } from "@/lib/background-picture";

/**
 * The app-wide background picture layer.
 *
 * Layering: this renders as a fixed z-0 sibling of the root content wrapper
 * (which carries zIndex 1), so every screen's content — cards, text, nav —
 * paints ABOVE the picture automatically. While the layer shows, a body flag
 * lets the screens' own solid backgrounds step aside (styles.css), so the
 * picture is never dimmed, blurred or scrimmed; text contrast belongs to the
 * text itself (shadows), not to a layer over the picture.
 *
 * SCOPE — the toggle is authoritative on EVERY interface:
 *   • OFF (default) → nothing paints here, every screen sits on clean black.
 *     This includes the nav screens (Home, Metatrader, Scanner): an OFF
 *     switch must never leave a picture on screen.
 *   • ON → the picture shows on every app interface. Home runs its own
 *     themed backdrop (theme VideoBackdrop + hero card), so this layer stays
 *     off there to avoid duplicate decoders — that backdrop follows the very
 *     same store, so Home blacks out too.
 *   • All of it reads ONE persisted store (`background-picture.ts`), so a flip
 *     in Settings repaints the current screen the same second and every screen
 *     navigated to afterwards — no reload, no second copy of the flag.
 *   • Auth forms (login/activate) are forms, not interfaces — never.
 */

/** Home owns its own theme backdrop layers (they read the same toggle). */
const HOME = "/app/home";
/** Auth forms never get the picture layer. */
const NEVER = ["/app/login", "/app/activate"];

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function AppBackground() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mediaDim = useBackgroundPicture();
  const { robots, activeRobotId } = useAppState();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const excluded = NEVER.some((prefix) => matchesPath(pathname, prefix));
  const ownsItsOwnLayers = matchesPath(pathname, HOME);
  // The toggle decides for every interface, nav screens included.
  const show = mounted && !excluded && !ownsItsOwnLayers && mediaDim;

  // Trace so the live value and this layer's decision are visible in console.
  useEffect(() => {
    console.log(
      `[bg-picture] toggle=${mediaDim ? "ON" : "OFF"} path=${pathname} layer=${show ? "ON" : "OFF"}${ownsItsOwnLayers ? " (home paints its own backdrop, same store)" : ""}`,
    );
  }, [mediaDim, pathname, show, ownsItsOwnLayers]);

  // Let the screens' solid backgrounds step aside while the picture shows.
  useEffect(() => {
    if (!show) return;
    document.body.classList.add("eamp-app-bg");
    return () => document.body.classList.remove("eamp-app-bg");
  }, [show]);

  if (!show) return null;

  const robot = robots.find((candidate) => candidate.id === activeRobotId) ?? robots[0];
  const image = robot?.image || "/logo.png";
  return (
    <div
      aria-hidden
      data-eamp-bg-layer
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black"
    >
      <img src={image} alt="" className="size-full object-cover" />
    </div>
  );
}

export default AppBackground;
