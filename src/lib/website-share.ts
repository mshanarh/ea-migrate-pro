import type { MentorWebsite } from "@/lib/auth-store";

export function websiteSlug(username: string, robotName: string) {
  const slug = (username + "-" + robotName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "your-robot";
}

export function buildWebsiteLink(username: string, website: MentorWebsite) {
  const origin = typeof window === "undefined" ? "https://ea-migrate-pro.com" : window.location.origin;
  const url = new URL("/mentor/" + websiteSlug(username, website.robotName), origin);
  url.searchParams.set("data", encodeWebsiteForLink(website));
  return url.toString();
}

export function encodeWebsiteForLink(website: MentorWebsite) {
  const bytes = new TextEncoder().encode(JSON.stringify(website));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeWebsiteFromLink(encoded: string | null) {
  if (!encoded) return null;
  try {
    const padding = "===".slice(0, (4 - (encoded.length % 4)) % 4);
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as MentorWebsite;
  } catch {
    return null;
  }
}
