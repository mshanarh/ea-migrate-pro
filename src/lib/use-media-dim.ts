import { useBackgroundPicture } from "./background-picture";

/**
 * The persisted "Background Picture" preference, now served from ONE shared
 * store (`background-picture.ts`) so every screen reads the same live value.
 *
 * Kept as a named export because the background layer was written against it;
 * the implementation no longer reads localStorage on mount, which is what made
 * the Settings toggle invisible to screens that were already open.
 */
export function useMediaDim(): boolean {
  return useBackgroundPicture();
}
