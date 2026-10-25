import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * THREE SHELLS, THREE DESIGNS.
 *
 * The app publishes the user's font, accent and interface tokens on <html>.
 * Those tokens belong to /app ONLY: the public landing page must keep the
 * stylesheet's brand look (Inter, `--primary: #00a8ff`, `--ring: #38bdf8`) and
 * the mentor portal keeps its own block. Getting this wrong is what made the
 * landing page render in the saved font and the saved accent.
 *
 * The saved PREFERENCE is never touched here — only the inline properties — so
 * stepping into the portal and back cannot change what the user picked.
 */
import { applyShellScope, isAppPath, isPortalPath, shellScopeFor } from "../src/lib/shell-scope";

function root(): HTMLElement {
  return document.documentElement;
}

/** What the app's sync components publish, and what a stale shell would leak. */
function publishAppTokens(): void {
  root().style.setProperty("--app-font", "'Orbitron', system-ui, sans-serif");
  root().style.setProperty("--primary", "#FF9500");
  root().style.setProperty("--accent", "#FF9500");
  root().style.setProperty("--ring", "#FF9500");
  root().setAttribute("data-if-styled", "true");
}

beforeEach(() => {
  root().removeAttribute("style");
  root().removeAttribute("data-portal");
  root().removeAttribute("data-marketing");
  root().removeAttribute("data-if-styled");
  root().removeAttribute("data-app-font");
});

describe("shell scope", () => {
  it("sends the landing page to the marketing shell, never the app", () => {
    expect(shellScopeFor("/")).toBe("marketing");
    expect(shellScopeFor("/news")).toBe("marketing");
    expect(shellScopeFor("/app/home")).toBe("app");
    expect(shellScopeFor("/dashboard")).toBe("portal");
    expect(isAppPath("/")).toBe(false);
    expect(isAppPath("/app/settings")).toBe(true);
    expect(isPortalPath("/admin")).toBe(true);
  });

  it("strips the app's font and accent from the landing page", () => {
    publishAppTokens();

    applyShellScope("marketing");

    expect(root().getAttribute("data-marketing")).toBe("true");
    expect(root().hasAttribute("data-portal")).toBe(false);
    // Back to the stylesheet's own values — Inter and the brand blue.
    expect(root().style.getPropertyValue("--app-font")).toBe("");
    expect(root().style.getPropertyValue("--primary")).toBe("");
    expect(root().style.getPropertyValue("--accent")).toBe("");
    expect(root().style.getPropertyValue("--ring")).toBe("");
    expect(root().hasAttribute("data-if-styled")).toBe(false);
    expect(root().hasAttribute("data-app-font")).toBe(false);
  });

  it("stamps the portal and strips the app's tokens there too", () => {
    publishAppTokens();

    applyShellScope("portal");

    expect(root().getAttribute("data-portal")).toBe("true");
    expect(root().getAttribute("data-marketing")).toBeNull();
    expect(root().style.getPropertyValue("--primary")).toBe("");
    expect(root().style.getPropertyValue("--app-font")).toBe("");
  });

  it("leaves the app's own tokens alone inside the app", () => {
    publishAppTokens();

    applyShellScope("app");

    expect(root().hasAttribute("data-portal")).toBe(false);
    expect(root().hasAttribute("data-marketing")).toBe(false);
    // The app's sync components own these — the shell must not wipe them.
    expect(root().style.getPropertyValue("--app-font")).toContain("Orbitron");
    expect(root().style.getPropertyValue("--primary")).toBe("#FF9500");
  });

  it("does not touch the stored preference when leaving the app", async () => {
    window.localStorage.setItem("ea_migrate_font", "Orbitron");
    window.localStorage.setItem("ea_migrate_color", "solar-orange");
    const { getCustomization } = await import("../src/lib/app-customization");

    applyShellScope("portal");
    applyShellScope("marketing");

    expect(window.localStorage.getItem("ea_migrate_font")).toBe("Orbitron");
    expect(window.localStorage.getItem("ea_migrate_color")).toBe("solar-orange");
    expect(getCustomization().font).toBe("Orbitron");
  });
});

// Keep the module's own constants honest without importing the app theme file.
void vi;
