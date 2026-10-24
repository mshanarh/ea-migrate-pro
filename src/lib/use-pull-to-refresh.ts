import { useRef, useState } from "react";

/**
 * PULL-TO-REFRESH for the EA config.
 *
 * The app's shell scrolls inside `.app-scroll-area`, so a downward drag only
 * counts while that container is at the top. Releasing past the threshold runs
 * the refresh — the same server fetch the screens run on mount, so pull-to-
 * refresh and the Refresh button can never disagree.
 */
export function usePullToRefresh(onRefresh: () => unknown, threshold = 64) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const scrollTop = (element: HTMLElement): number => {
    const scroller = element.querySelector(".app-scroll-area") as HTMLElement | null;
    return scroller ? scroller.scrollTop : element.scrollTop;
  };

  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || scrollTop(event.currentTarget) > 4) {
      startY.current = null;
      setPull(0);
      return;
    }
    startY.current = event.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (startY.current === null) return;
    const y = event.touches[0]?.clientY ?? startY.current;
    setPull(Math.max(0, Math.min(120, y - startY.current)));
  };

  const onTouchEnd = () => {
    const pulled = pull;
    startY.current = null;
    setPull(0);
    if (pulled >= threshold) void onRefresh();
  };

  return {
    pull,
    pulling: pull >= threshold,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
