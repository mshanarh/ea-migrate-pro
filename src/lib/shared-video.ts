/**
 * THE ONE ROBOT-VIDEO PLAYER — a single shared <video> for the whole app.
 *
 * WHY: every screen used to mount its OWN <video>, so switching tabs stacked
 * decoders and every navigation restarted the clip at 0:00. This module owns
 * the ONE element; screens register a HOST (a plain div) and the element is
 * MOVED into the winning host. It is never destroyed, so its position and its
 * playback survive navigation, and there is never more than one decoder.
 *
 * HOSTS
 *   "card"   — the Home big screen's media slot (the landing interface). Plays
 *              on-screen, always, whatever the switches say.
 *   "screen" — a fixed full-screen layer BEHIND the page content. Home uses it
 *              when the active interface theme has no big media slot;
 *              Settings-type pages use it while the Robot Video switch is ON,
 *              see-through (opacity) so text, buttons and cards read on top.
 * A card host always beats a screen host, so Home keeps its in-card video.
 *
 * ROUTE RULES (videoLayerMode)
 *   /app/home                        → "home"      always plays
 *   Metatrader / Scanner / Fundamentals → "none"   plain black, no video, ever
 *   every other /app page            → "background" only while the persisted
 *                                                Robot Video switch is ON
 *   outside the app                  → "none"
 *
 * FAILURE: if the element itself cannot load (bad ref, evicted blob, decode
 * error) the hosts let go of it — the interface falls back to its normal
 * background and the layer surfaces the retryable "Could not load your robot
 * video" line. Nothing here can block boot, navigation or trading: every path
 * is a plain DOM move or an async source resolution that swallows its errors.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { loadVideoUrl } from "@/lib/media-store";
import { isRobotVideoUltra, isRobotVideoStopped, subscribeRobotVideoStopped } from "@/lib/video-playback";
import { isAppPath } from "@/lib/shell-scope";

export type VideoHostKind = "card" | "screen";

export type VideoHostOptions = {
  /** 0–1. Full strength on Home; see-through on the background screens. */
  opacity: number;
  /** Screen hosts ask CSS to open the screens' own solid backgrounds up. */
  transparentScreen?: boolean;
};

/** What the full-screen layer does on this route (see the rules above). */
export type VideoLayerMode = "none" | "home" | "background";

export type SharedVideoState = {
  /** The raw ref the app state holds (idb-video:, data: or http:). */
  sourceRef: string | null;
  /** A source has been resolved onto the element — hosts may show it. */
  ready: boolean;
  /** The element failed to load — fall back to the normal background. */
  failed: boolean;
};

type RegisteredHost = {
  id: string;
  kind: VideoHostKind;
  el: HTMLElement;
  getOptions: () => VideoHostOptions;
};

const EMPTY_STATE: SharedVideoState = { sourceRef: null, ready: false, failed: false };

/** Screens that must NEVER show the video — plain black, whatever is toggled. */
const VIDEO_NEVER_PATHS = ["/app/metatrader", "/app/scanner", "/app/fundamentals"];
/** Home always plays — it is the only route that ignores the switches. */
const HOME_PATH = "/app/home";

let videoEl: HTMLVideoElement | null = null;
let parkEl: HTMLDivElement | null = null;
/** The object URL this module minted for the current source (revoked on swap). */
let objectUrl: string | null = null;
const hosts = new Map<string, RegisteredHost>();
const listeners = new Set<() => void>();
/** Bumped whenever a new source wins, so a slow lookup cannot land late. */
let generation = 0;
let state: SharedVideoState = EMPTY_STATE;

function setState(next: SharedVideoState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/* ── route rules (pure — unit-tested) ─────────────────────────────────────── */

function pathMatches(pathname: string, prefix: string): boolean {
  const path = (pathname || "/").split(/[?#]/, 1)[0] ?? "/";
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The placement rule for this route. `videoAuto` is the persisted "Robot
 * Video" switch from Settings; Home never consults it.
 */
export function videoLayerMode(pathname: string, videoAuto: boolean): VideoLayerMode {
  if (!isAppPath(pathname)) return "none";
  // The bare /app is a redirect, not an interface — it paints nothing.
  if ((pathname || "/").split(/[?#]/, 1)[0] === "/app") return "none";
  if (VIDEO_NEVER_PATHS.some((prefix) => pathMatches(pathname, prefix))) return "none";
  if (pathMatches(pathname, HOME_PATH)) return "home";
  return videoAuto ? "background" : "none";
}

/* ── the element ─────────────────────────────────────────────────────────── */

function tryPlay(el: HTMLVideoElement): void {
  try {
    const attempt = el.play();
    // Muted + playsinline autoplays everywhere; a refusal is never an error.
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
  } catch {
    /* autoplay refused this tick — the next reconcile retries */
  }
}

function tryPause(el: HTMLVideoElement): void {
  try {
    el.pause();
  } catch {
    /* ignore */
  }
}

function ensureVideo(): HTMLVideoElement {
  if (videoEl) return videoEl;
  const el = document.createElement("video");
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.autoplay = true;
  el.playsInline = true;
  el.preload = "auto";
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.setAttribute("autoplay", "");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-eamp-robot-video", "");
  // CRISP BY DEFAULT — no blur, no downscale, no filter washing the clip out.
  el.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;" +
    "filter:none;image-rendering:auto;backface-visibility:hidden;transform:translateZ(0);";
  el.addEventListener("error", () => {
    if (!state.sourceRef) return;
    // A load failure is a real, retryable error — never a silent blank.
    setState({ sourceRef: state.sourceRef, ready: false, failed: true });
    reconcile();
  });
  videoEl = el;
  return el;
}

/** Off-screen holder: parked elements keep their position, never their paint. */
function park(): HTMLDivElement {
  if (!parkEl) {
    parkEl = document.createElement("div");
    parkEl.hidden = true;
    parkEl.setAttribute("data-eamp-video-park", "");
    document.body.appendChild(parkEl);
  }
  return parkEl;
}

/* ── hosts ───────────────────────────────────────────────────────────────── */

function pickHost(): RegisteredHost | null {
  let screen: RegisteredHost | null = null;
  for (const host of hosts.values()) {
    if (host.kind === "card") return host; // the Home big screen always wins
    if (!screen) screen = host;
  }
  return screen;
}

function setScreenClass(on: boolean): void {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("eamp-app-video", on);
}

/** Move the ONE element into the right host (or park it) and keep it playing. */
function reconcile(): void {
  if (typeof document === "undefined") return;
  const el = videoEl;
  if (!el) {
    setScreenClass(false);
    return;
  }
  // A HOME double-press stop wins over EVERY host — Home's big screen included.
  // Stopped means parked and paused, so nothing keeps playing behind the user.
  const allowed = !isRobotVideoStopped();
  const host = allowed && state.ready && !state.failed ? pickHost() : null;
  if (!host) {
    if (el.parentElement !== park()) park().appendChild(el);
    el.style.opacity = "1";
    el.removeAttribute("data-eamp-video-ultra");
    tryPause(el);
    setScreenClass(false);
    return;
  }
  if (el.parentElement !== host.el) host.el.appendChild(el);
  const options = host.getOptions();
  el.style.opacity = String(options.opacity);
  el.toggleAttribute("data-eamp-video-ultra", isRobotVideoUltra());
  setScreenClass(host.kind === "screen" && options.transparentScreen === true);
  tryPlay(el);
}

export type VideoHostRegistration = {
  id: string;
  kind: VideoHostKind;
  el: HTMLElement | null;
  getOptions: () => VideoHostOptions;
};

/** A screen wants the player (a ref callback — fires on mount and unmount). */
export function attachVideoHost(registration: VideoHostRegistration): void {
  if (!registration.el) {
    detachVideoHost(registration.id);
    return;
  }
  hosts.set(registration.id, {
    id: registration.id,
    kind: registration.kind,
    el: registration.el,
    getOptions: registration.getOptions,
  });
  reconcile();
}

export function detachVideoHost(id: string): void {
  if (hosts.delete(id)) reconcile();
}

/* ── source ──────────────────────────────────────────────────────────────── */

function releaseObjectUrl(): void {
  if (!objectUrl) return;
  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    /* ignore */
  }
  objectUrl = null;
}

function loadSource(ref: string): void {
  generation += 1;
  const token = generation;
  const el = ensureVideo();
  setState({ sourceRef: ref, ready: false, failed: false });
  reconcile();
  void (async () => {
    let target = ref;
    try {
      // idb-video: refs resolve through the media store; plain data/http URLs
      // come back as null and pass straight through.
      const resolved = await loadVideoUrl(ref);
      if (resolved) {
        releaseObjectUrl();
        if (resolved.startsWith("blob:")) objectUrl = resolved;
        target = resolved;
      }
    } catch {
      target = ref; // let the element's own error event report the failure
    }
    if (token !== generation) return; // a newer source won the race
    if (el.getAttribute("src") === target) {
      try {
        el.load();
      } catch {
        /* not implemented (tests) — the src is already correct */
      }
    } else {
      el.src = target;
    }
    setState({ sourceRef: ref, ready: true, failed: false });
    reconcile();
  })();
}

/**
 * Point the player at the active robot's video. The SAME source never
 * reloads, which is what keeps playback from restarting on every navigation.
 */
export function setSharedVideoSource(ref: string | null | undefined): void {
  const next = ref ?? null;
  if (next === state.sourceRef) return;
  if (!next) {
    generation += 1;
    releaseObjectUrl();
    if (videoEl) {
      try {
        videoEl.removeAttribute("src");
        videoEl.load();
      } catch {
        /* ignore */
      }
      tryPause(videoEl);
    }
    setState(EMPTY_STATE);
    reconcile();
    return;
  }
  loadSource(next);
}

/** Manual retry after a load failure — a fresh resolve, a fresh element load. */
export function retrySharedVideo(): void {
  const ref = state.sourceRef;
  if (!ref) return;
  loadSource(ref);
}

/* ── React glue ──────────────────────────────────────────────────────────── */

export function getSharedVideoState(): SharedVideoState {
  return state;
}

export function subscribeSharedVideo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSharedVideo(): SharedVideoState {
  return useSyncExternalStore(subscribeSharedVideo, getSharedVideoState, () => EMPTY_STATE);
}

let hostSeq = 0;

/**
 * Register a host for the shared element. Returns a ref callback: give it to
 * the host div and the element moves in/out automatically. `options` is read
 * live, so give the host a `key` when its options change shape.
 */
export function useVideoHost(
  kind: VideoHostKind,
  options: VideoHostOptions,
): (el: HTMLElement | null) => void {
  const idRef = useRef<string>("");
  if (!idRef.current) {
    hostSeq += 1;
    idRef.current = `eamp-video-host-${hostSeq}`;
  }
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const kindRef = useRef(kind);
  kindRef.current = kind;

  const setEl = useCallback((el: HTMLElement | null) => {
    attachVideoHost({
      id: idRef.current,
      kind: kindRef.current,
      el,
      getOptions: () => optionsRef.current,
    });
  }, []);

  useEffect(
    () => () => {
      detachVideoHost(idRef.current);
    },
    [],
  );

  return setEl;
}

/* ── test support ────────────────────────────────────────────────────────── */

/**
 * A HOME double-press must stop playback on every host at once, so the store
 * change re-runs placement: the element parks itself, paused, immediately.
 */
if (typeof window !== "undefined") {
  subscribeRobotVideoStopped(() => reconcile());
}

/** Test-only: drop every host, source and body class so cases stay isolated. */
export function resetSharedVideoForTests(): void {
  hosts.clear();
  generation += 1;
  releaseObjectUrl();
  if (videoEl) {
    tryPause(videoEl);
    videoEl.removeAttribute("src");
    videoEl.remove();
    videoEl = null;
  }
  if (parkEl) {
    parkEl.remove();
    parkEl = null;
  }
  state = EMPTY_STATE;
  setScreenClass(false);
  listeners.forEach((listener) => listener());
}
