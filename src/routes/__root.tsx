import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

/**
 * THE PUSH PROMPT IS NOT FIRST-PAINT WORK — and neither is Firebase.
 *
 * `PushPermissionBanner` imports `@/lib/firebase/app` + `firebase/messaging`,
 * which is one of the largest single pieces the entry chunk used to carry. It
 * is a dialog that appears AFTER the screen is up, so it is loaded on the next
 * tick after first paint instead of blocking the download of the app itself.
 * The banner itself is unchanged — it still renders in the same place.
 */
const PushPermissionBanner = lazy(() =>
  import("@/components/PushPermissionBanner").then((module) => ({
    default: module.PushPermissionBanner,
  })),
);

import appCss from "../styles.css?url";

/**
 * Platform-adaptive UI: stamps `platform-android` / `platform-ios` on <html>
 * BEFORE first paint, so the CSS layer (fonts, radii, safe areas) is already
 * correct when the app appears — no flash of the wrong platform styling.
 * Detection logic mirrors src/lib/platform.ts exactly.
 */
const PLATFORM_PREPAINT_SCRIPT = `
(function () {
  try {
    var ua = navigator.userAgent || "";
    var uaData = navigator.userAgentData;
    var classicIos = /iPad|iPhone|iPod/.test(ua);
    var ipadAsMac = ua.indexOf("Macintosh") !== -1 && navigator.maxTouchPoints > 1;
    var isIos = classicIos || ipadAsMac || (uaData && /^ios$/i.test(uaData.platform || "")) || (uaData && uaData.platform === "macOS" && navigator.maxTouchPoints > 1);
    document.documentElement.classList.add(isIos ? "platform-ios" : "platform-android");
  } catch (e) {
    document.documentElement.classList.add("platform-android");
  }
  // Register the pass-through service worker early (no caching — keeps the
  // no-stale-bundle guarantee and iOS “Add to Home screen” working).
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    }
  } catch (e) {}
  // BOOT WATCHDOG — THE SPLASH MAY NEVER BE THE LAST THING ON SCREEN.
  //
  // The SPA shell ships with the router's pending splash painted in the
  // static HTML, so ANY failure before the first render left that black
  // "Loading…" card sitting there forever with nothing to press. A reload
  // cannot fix that either — it just shows the same card again.
  //
  // The app stamps data-app-boot on <html> the moment it mounts (see
  // RootComponent). If, 8 seconds later, that stamp is still missing (the
  // bundle threw on import, a chunk 404'd, the gate never answered), this
  // replaces the splash with a retry card. location.reload() re-fetches the
  // document, so a stale chunk or a transient failure is recoverable by hand.
  //
  // This grants nothing: it is a message and a button, never a way into the app.
  //
  // TWO TRIGGERS, ONE CARD:
  //   1. the 8-second deadline below, and
  //   2. an UNCAUGHT BOOT ERROR (window.onerror / unhandledrejection) while the
  //      app is still unmounted — a module-level throw means nothing will ever
  //      mount, so waiting the full 8 seconds just leaves the user staring at
  //      the spinner. This is exactly the failure class that took production
  //      down ("Cannot read properties of undefined (reading 'bind')" while the
  //      app-store chunk evaluated): the error is caught the instant it throws
  //      and the same pressable retry card paints ~0.8s later.
  try {
    var bootCardShown = false;
    var paintBootRetry = function () {
      try {
        if (bootCardShown) return;
        var html = document.documentElement;
        if (!html || html.getAttribute("data-app-boot") === "1") return;
        bootCardShown = true;
        document.body.innerHTML =
          '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#000;color:#fff;font-family:system-ui,sans-serif;padding:24px;text-align:center">' +
          '<img src="/logo.png" alt="" style="width:56px;height:56px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);object-fit:contain;padding:4px"/>' +
          '<p style="margin:0;font-size:16px;font-weight:600">Could not verify access</p>' +
          '<p style="margin:0;font-size:13px;line-height:1.5;color:rgba(255,255,255,.6);max-width:320px">The app did not finish starting. Check your connection, then tap retry.</p>' +
          '<button id="eamp-boot-retry" type="button" style="margin-top:4px;border:0;border-radius:999px;background:#fff;color:#000;font-size:13px;font-weight:800;letter-spacing:.08em;padding:12px 28px">TAP TO RETRY</button>' +
          "</div>";
        var retry = document.getElementById("eamp-boot-retry");
        if (retry) {
          retry.onclick = function () {
            try {
              window.location.reload();
            } catch (e) {}
          };
        }
      } catch (e) {}
    };
    var bootWatchdog = setTimeout(paintBootRetry, 8000);
    void bootWatchdog;
    // A boot error is reported by the listener installed below too; this one
    // only decides whether the splash has to become a pressable card.
    window.addEventListener("error", function (event) {
      try {
        // Resource failures (a missing image, a slow font) carry no error
        // object — they are never a reason to replace the screen.
        if (!event || !event.error) return;
        setTimeout(paintBootRetry, 800);
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (event) {
      try {
        if (!event || !event.reason) return;
        setTimeout(paintBootRetry, 800);
      } catch (e) {}
    });
  } catch (e) {}
  // Runtime error reporting: in the Android wrapper the page's crashes are
  // forwarded to logcat via the EAMigrate bridge so a black screen is never
  // undiagnosable; elsewhere they land in the console.
  try {
    var report = function (kind, msg) {
      try {
        var line = kind + ": " + msg;
        console.error("[EAMIGRATE-REPORT] " + line);
        if (window.EAMigrate && typeof window.EAMigrate.reportError === "function") {
          window.EAMigrate.reportError(line);
        }
      } catch (e) {}
    };
    // BELT-AND-BRACES bridge wrap: a recreated Android activity leaves the
    // old injected object throwing "Java bridge method can't be invoked on a
    // non-injected object" on ANY call (this is what crashed the dashboard
    // with setAutoPip). Every method of window.EAMigrate is wrapped so the
    // worst a stale bridge can do is nothing — never an uncaught throw. The
    // app's own callNative/queryNative already do this; this covers any
    // other call site too.
    var wrapBridge = function () {
      var bridge = window.EAMigrate;
      if (!bridge || bridge.__eampSafe) return;
      var safe = {};
      safe.__eampSafe = true;
      for (var key in bridge) {
        (function (k) {
          var fn = bridge[k];
          if (typeof fn === "function") {
            safe[k] = function () {
              try {
                return fn.apply(bridge, arguments);
              } catch (e) {
                return undefined; // stale bridge — degrade, never crash
              }
            };
          } else {
            safe[k] = fn;
          }
        })(key);
      }
      window.EAMigrate = safe;
    };
    wrapBridge();
    var bridgePoll = 0;
    var bridgeTimer = setInterval(function () {
      try { wrapBridge(); } catch (e) {}
      if (++bridgePoll > 100) clearInterval(bridgeTimer); // ~30s, then callNative covers it
    }, 300);
    window.addEventListener("error", function (ev) {
      report("ERROR", (ev && ev.message) || "unknown");
    });
    window.addEventListener("unhandledrejection", function (ev) {
      var r = ev && ev.reason;
      report("PROMISE", (r && (r.message || String(r))) || "unknown rejection");
    });
  } catch (e) {}
})();
`;
import { Toaster } from "@/components/ui/sonner";
import { BackgroundEffects } from "@/components/BackgroundEffects";
import { ColourCycleTap, AccentVarSync } from "@/components/ColourCycleTap";
import { InterfaceThemeSync } from "@/components/app/InterfaceThemeSync";
import { AppBackground } from "@/components/app/AppBackground";
import { RobotVideoLayer } from "@/components/app/RobotVideoLayer";
import { applyColourMatrixFromStorage } from "@/components/app/BackAnimationSection";
import { loadBridgeConfig } from "@/lib/bridge-client";
import { applyShellScope, shellScopeFor } from "@/lib/shell-scope";
import { speakTradeExecution, unlockBotVoice } from "@/lib/bot-voice";
import { EXECUTION_EVENT } from "@/lib/execution-events";
import { reportLovableError } from "../lib/lovable-error-reporting";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#000000" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "EA Migrate" },
      { name: "application-name", content: "EA Migrate" },
      { title: "EA Migrate — Build Custom Forex EAs" },
      {
        name: "description",
        content:
          "Design, test and deploy custom MT4/MT5 Expert Advisors without writing code.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "EA Migrate" },
      { property: "og:title", content: "EA Migrate — Build Custom Forex EAs" },
      {
        property: "og:description",
        content: "Design, test and deploy custom MT4/MT5 Expert Advisors without writing code.",
      },
      { property: "og:image", content: "/logo.png" },
      { property: "og:image:alt", content: "EA Migrate robot logo" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "EA Migrate — Build Custom Forex EAs" },
      {
        name: "twitter:description",
        content: "Design, test and deploy custom MT4/MT5 Expert Advisors without writing code.",
      },
      { name: "twitter:image", content: "/logo.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=DM+Sans:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: PLATFORM_PREPAINT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="m-0 p-0 bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  /**
   * THE PORTAL IS A SEPARATE DESIGN — see src/lib/shell-scope.ts.
   *
   * The app's customization publishing (font, accent, interface style, colour
   * cycle, app background) is mounted for APP ROUTES ONLY, and `data-portal`
   * plus a token reset goes on <html> for the mentor portal. A font or accent
   * chosen inside the Android app therefore cannot repaint the portal — the
   * two shells never share those tokens.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  /**
   * WHICH DESIGN OWNS THIS ROUTE — app, mentor portal, or public marketing.
   * Only the app publishes the user's saved font, accent and interface tokens;
   * the portal has its own hardcoded tokens (src/styles.css) and the landing
   * page keeps the stylesheet's brand fonts and colours.
   */
  const shellScope = shellScopeFor(pathname);
  const portalShell = shellScope === "portal";
  const appShell = shellScope === "app";

  // TELL THE SHELL'S BOOT WATCHDOG THIS APP ACTUALLY RENDERED.
  // The inline script in PLATFORM_PREPAINT_SCRIPT replaces the pre-rendered
  // splash with a retry card if this stamp is still missing after 8s (see the
  // comment there). Setting it here — on the very first mount, before any
  // route guard has answered — keeps a legitimately slow access check on the
  // router's own splash, which resolves into the app or the sign-in screen.
  useEffect(() => {
    document.documentElement.setAttribute("data-app-boot", "1");
  }, []);

  // Re-apply the persisted Colour Matrix body class on every mount/route load.
  useEffect(() => {
    applyColourMatrixFromStorage();
  }, []);

  // Put the document into the right shell BEFORE it paints, and undo every app
  // customization token whenever we leave the app — a saved Orbitron face and a
  // solar-orange accent must never repaint the landing page or the portal.
  useEffect(() => {
    applyShellScope(shellScope);
  }, [shellScope]);

  // READ THE BRIDGE'S CURRENT ADDRESS once per app start. The tunnel hostname
  // changes whenever cloudflared restarts, so the address is an admin setting
  // read at runtime (KV via /api/bridge-config) instead of a build constant.
  // A missing endpoint or an offline start keeps the address already cached.
  useEffect(() => {
    void loadBridgeConfig();
  }, []);

  // FIRST GESTURE ARMS THE VOICE. Browsers refuse speechSynthesis before the
  // page has been touched, which silently swallowed the first announcement of
  // a run; the Android wrapper's native engine is primed the same way.
  useEffect(() => {
    const arm = () => {
      unlockBotVoice();
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  // DYNAMIC TRADE VOICE — one listener for the whole app.
  //
  // Every confirmed execution on the shared bus is announced once, with the
  // broker's own symbol, direction, lot size, entry, stop loss and take
  // profit. The announcer itself decides what counts as a trade (a signal
  // or a request is never spoken) and refuses to repeat one, so the voice
  // stays accurate no matter which screen the run started from.
  useEffect(() => {
    const handler = (event: Event) => {
      speakTradeExecution((event as CustomEvent).detail);
    };
    window.addEventListener(EXECUTION_EVENT, handler);
    return () => window.removeEventListener(EXECUTION_EVENT, handler);
  }, []);

  // DEFERRED UNTIL AFTER FIRST PAINT — see PushPermissionBanner above. The
  // timeout (rather than a bare rAF) is deliberate: it waits for the first
  // paint AND for the browser's idle slot, so the permission dialog never
  // competes with the screen people actually asked for.
  const [pushReady, setPushReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPushReady(true), 250);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {portalShell ? null : (
        <>
          {/* Animated background sits behind everything; content lifts above it. */}
          <BackgroundEffects />
          {/* Invisible centre-tap surface for the interface colour cycle. */}
          <ColourCycleTap />
          {/* APP ROUTES ONLY — the landing page is a marketing page, not the app.
              Mounting these at every route is what put the saved font (Orbitron
              by default) and accent (solar orange) on the public site. */}
          {appShell ? (
            <>
              {/* Live --accent / --accent-deep / --accent-soft tokens for every screen. */}
              <AccentVarSync />
              {/* Publishes the selected Main Interface definition to <html> so Home,
                  Metatrader, Quotes, Scanner, Settings and the popups all repaint. */}
              <InterfaceThemeSync />
            </>
          ) : null}
          {/* The app-wide background picture layer — under the content wrapper below. */}
          <AppBackground />
          {/* THE ONE robot-video player: mounted once so navigation moves the
              element between hosts instead of restarting it (Home plays always,
              Settings-type pages while the Robot Video switch is ON, never on
              Metatrader / Scanner / Fundamentals). */}
          <RobotVideoLayer />
        </>
      )}
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        {pushReady ? (
          <Suspense fallback={null}>
            <PushPermissionBanner />
          </Suspense>
        ) : null}
        <Toaster position="top-center" />
      </div>
    </QueryClientProvider>
  );
}
