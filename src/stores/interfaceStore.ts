import { useSyncExternalStore } from "react";

export const INTERFACE_IDS = ["spectre-grid", "blue-orbit", "red-halo", "predator-oval", "skyline-stack", "neon-edge", "void-pulse", "eclipse-core", "crimson-nexus", "neon-phantom"] as const;
export type InterfaceId = (typeof INTERFACE_IDS)[number];

const STORAGE_KEY = "selected_interface";
const DEFAULT_INTERFACE: InterfaceId = "spectre-grid";
let selected: InterfaceId = DEFAULT_INTERFACE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && INTERFACE_IDS.includes(saved as InterfaceId)) selected = saved as InterfaceId;
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSelected(value: InterfaceId) {
  selected = value;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, value);
  listeners.forEach((listener) => listener());
}

export function useInterfaceStore() {
  return {
    selected: useSyncExternalStore(subscribe, () => {
      load();
      return selected;
    }, () => DEFAULT_INTERFACE),
    setSelected,
  };
}
