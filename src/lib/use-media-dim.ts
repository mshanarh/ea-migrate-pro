import { useEffect, useState } from "react";

/** Read the mediaDim preference from localStorage, with SSR guard. */
export function useMediaDim(): boolean {
  const [mediaDim, setMediaDim] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cached = localStorage.getItem("mediaDim");
      if (cached !== null) setMediaDim(cached === "true");
    } catch {
      /* ignore */
    }
  }, []);

  return mediaDim;
}