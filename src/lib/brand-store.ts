import { useSyncExternalStore } from "react";
import { deleteImageBlob } from "@/lib/media-store";

/**
 * App brand (logo) state.
 *
 * The logo shown across the ENTIRE app (headers, portals, landing page,
 * welcome gate, footer, favicon) reads from this one store. A custom logo is
 * uploaded once from Settings → App logo (any image from the phone), stored as
 * a Blob in IndexedDB via media-store, and only the tiny `idb-image:<id>`
 * reference is persisted. Until a custom logo is uploaded, the built-in
 * mascot is used — so nothing ever renders broken.
 */

const KEY = "eamp.brand.v1";

type BrandState = {
  /** Tiny media-store reference for the uploaded logo, or null for the built-in mascot. */
  logoRef: string | null;
};

let state: BrandState = { logoRef: null };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<BrandState>;
      state = { logoRef: typeof saved.logoRef === "string" ? saved.logoRef : null };
    }
  } catch {
    /* ignore malformed data */
  }
}

function persist() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: BrandState = { logoRef: null };

export function useBrand() {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => serverSnapshot,
  );
}

/** The logo every part of the app renders when no custom one is uploaded. */
export const DEFAULT_LOGO = "/botlogic-mascot.png";

export function setCustomLogo(ref: string) {
  load();
  state = { logoRef: ref };
  persist();
}

export async function clearCustomLogo() {
  load();
  const previous = state.logoRef;
  state = { logoRef: null };
  persist();
  if (previous) await deleteImageBlob(previous);
}

/** Keeps the browser tab icon in sync with the app logo. */
export function applyFavicon(url: string | null) {
  if (typeof document === "undefined") return;
  const links = document.querySelectorAll<HTMLLinkElement>("link[rel='icon'], link[rel='apple-touch-icon']");
  links.forEach((link) => {
    if (url) link.href = url;
  });
}
