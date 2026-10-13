/**
 * The client half of /api/ea-media — the EA PICTURE (and symbol list) for the
 * signed-in inbox, resolved on the server so a 6.4 MB mentor row never lands
 * on the phone.
 *
 * WHY A SERVER ROUND-TRIP INSTEAD OF READING SUPABASE FROM HERE:
 *   - `portal_accounts.data` is TEXT with the demo video inline, so a read
 *     that touches a mentor row moves 6.4 MB and a whole-table read dies on
 *     the statement timeout (measured: "canceling statement due to statement
 *     timeout").
 *   - the browser's projected read `data->licenses` answers NULL for every
 *     row (the column is text, so the JSON operator extracts nothing) — which
 *     is exactly why the home screen never found a picture and the card fell
 *     back to the platform logo.
 *   - rpc `ea_media_for_email` times out for the same reason.
 * The endpoint does one narrow LIKE scan, caches the answer in KV, and hands
 * back a few dozen kilobytes.
 *
 * `null` means "the endpoint is not here" (no /api on this host, or it
 * answered with something that is not our JSON) — the caller then falls back
 * to its own Supabase path, which is the pre-existing behaviour.
 */

/** One EA's public details — the same shape /api/ea-media returns. */
export type EaMediaEntry = { eaId?: string; name?: string; image?: string; symbols?: string[] };

/**
 * The server searches for up to 20 s (see SEARCH_BUDGET_MS in
 * api/ea-media.ts) before giving up, so the client has to outlive that — and
 * the home screen never waits on this call anyway: it paints immediately and
 * repaints when the answer lands.
 */
const DEADLINE_MS = 25_000;

type ReplyBody = { ok?: boolean; media?: unknown; error?: string };

function toEntries(value: unknown): EaMediaEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: EaMediaEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as EaMediaEntry;
    entries.push({
      ...(typeof candidate.eaId === "string" && candidate.eaId ? { eaId: candidate.eaId } : {}),
      ...(typeof candidate.name === "string" && candidate.name ? { name: candidate.name } : {}),
      ...(typeof candidate.image === "string" && candidate.image ? { image: candidate.image } : {}),
      ...(Array.isArray(candidate.symbols) && candidate.symbols.length > 0
        ? { symbols: candidate.symbols.filter((symbol): symbol is string => typeof symbol === "string") }
        : {}),
    });
  }
  return entries;
}

/**
 * Ask the server for the media of these robots.
 *
 * Returns the entries it knows about (possibly empty — "nothing matched"), or
 * `null` when there is no such endpoint here so the caller can fall back.
 * Never throws: a dead endpoint must never break the home screen.
 */
export async function fetchEaMedia(args: {
  email: string;
  eaIds?: string[];
  names?: string[];
}): Promise<EaMediaEntry[] | null> {
  if (typeof window === "undefined") return null;
  const email = args.email.trim().toLowerCase();
  if (!email) return null;
  const eaIds = (args.eaIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  const names = (args.names ?? []).filter(
    (name): name is string => typeof name === "string" && name.trim().length > 0,
  );
  if (eaIds.length === 0 && names.length === 0) return null;

  let response: Response | null = null;
  try {
    response = await fetch("/api/ea-media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, eaIds, names }),
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
  } catch {
    return null;
  }
  // 404/405 is what a host serving only `dist/` answers — no function here.
  if (response.status === 404 || response.status === 405) return null;

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* the static SPA or a crash page: no JSON to read */
  }
  // HTML where JSON was contracted: the rewrite caught this path.
  if (!parsed || typeof parsed !== "object" || typeof (parsed as ReplyBody).ok !== "boolean") return null;

  const body = parsed as ReplyBody;
  if (!body.ok) {
    console.warn(`[ea-media] endpoint failed: ${body.error ?? response.status}`);
    return null;
  }
  return toEntries(body.media);
}
