import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

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
import { applyColourMatrixFromStorage } from "@/components/app/BackAnimationSection";
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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

  // Re-apply the persisted Colour Matrix body class on every mount/route load.
  useEffect(() => {
    applyColourMatrixFromStorage();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Animated background sits behind everything; content lifts above it. */}
      <BackgroundEffects />
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="top-center" />
      </div>
    </QueryClientProvider>
  );
}
