import { useEffect, useState } from "react";

const KEY = "mediaDim";
/** The Settings toggle dispatches this so open screens refresh with no reload. */
const REFRESH_EVENT = "eamp:bg-effects";

function readMediaDim(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The persisted "Background Picture" preference. DEFAULT OFF: when off, the
 * full-screen interfaces keep a clean solid black background and the
 * background picture/video is not rendered at all; when on, the media shows
 * clearly (no dim, blur or gradient layers on top of it). Small cards and
 * thumbnails are never affected — only the full-screen backdrops read this.
 *
 * Live-updates when the Settings toggle changes it (the toggle writes the
 * key and dispatches the background-effects refresh event), so turning it on
 * shows the picture immediately — no app restart.
 */
export function useMediaDim(): boolean {
  const [mediaDim, setMediaDim] = useState(false);

  useEffect(() => {
    const refresh = () => setMediaDim(readMediaDim());
    refresh();
    window.addEventListener(REFRESH_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(REFRESH_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return mediaDim;
}
