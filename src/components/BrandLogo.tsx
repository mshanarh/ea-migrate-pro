import { useEffect, useState } from "react";
import { DEFAULT_LOGO, applyFavicon, useBrand } from "@/lib/brand-store";
import { loadImageUrl } from "@/lib/media-store";

/**
 * BrandLogo — the ONE component every part of the app uses for the logo
 * (landing header, hero card, footer, auth shells, portals, welcome gate,
 * theme header, favicon).
 *
 * - If the user uploaded a custom logo (Settings → App logo), that image is
 *   shown everywhere, instantly, on this device.
 * - Otherwise the built-in mascot renders, so nothing ever looks broken.
 * - Also keeps the browser tab icon in sync with whatever is displayed.
 *
 * Rendering: the logo renders BARE (plain <img>, no background chip). The
 * mascot PNG is fully transparent — any dark box behind it shows as a black
 * square "stuck" to the logo. Callers decide the fit (object-cover /
 * object-contain) through className, exactly like a plain image.
 */

export function BrandLogo({
  className,
  style,
  alt = "EA Migrate Pro logo",
}: {
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}) {
  const { logoRef } = useBrand();
  const [customUrl, setCustomUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    if (logoRef) {
      loadImageUrl(logoRef)
        .then((url) => {
          if (cancelled) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          created = url;
          setCustomUrl(url);
          setErrored(false);
        })
        .catch(() => {
          if (!cancelled) setCustomUrl(null);
        });
    } else {
      setCustomUrl(null);
    }
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [logoRef]);

  const src = !errored && customUrl ? customUrl : DEFAULT_LOGO;

  // The tab icon follows the same source every logo spot shows.
  useEffect(() => {
    applyFavicon(errored ? null : customUrl);
  }, [customUrl, errored]);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setErrored(true)}
    />
  );
}
