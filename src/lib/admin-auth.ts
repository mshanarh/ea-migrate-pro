/**
 * ── Admin console identity ─────────────────────────────────────────────
 * The database refuses admin writes from an anonymous caller: approving a
 * user, changing a licence limit or recording a message can only happen
 * through SECURITY DEFINER functions that check `auth.jwt() ->> 'email'`
 * against the admin_emails table. That JWT only exists if the console is
 * signed in with Supabase Auth — so this module owns that sign-in.
 *
 * Why this exists rather than a hidden password in the bundle: the console
 * and the app share the same public anon key. Anything secret shipped in
 * frontend code is public. A real session (signed in by Supabase) is the
 * only thing a normal user cannot forge, so it is what the database trusts.
 *
 * The session is kept in localStorage by supabase-js, so the admin stays
 * signed in on their phone without being asked every time.
 */
import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

/** False when Supabase credentials are missing — the console stays locked. */
export const adminAuthConfigured = Boolean(url && anonKey);

/**
 * Separate client instance: the shared app client deliberately runs with
 * persistSession:false (the app never uses Supabase Auth), while the admin
 * console needs the session persisted between reloads.
 */
const authClient =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

export type AdminAuthState = {
  session: Session | null;
  email: string | null;
  loading: boolean;
  /** A real error from Supabase, ready to show the admin. */
  error: string | null;
};

let cachedSession: Session | null = null;
let cacheLoaded = false;

/** Reads the stored session (safe to call on every render). */
export async function getAdminSession(): Promise<Session | null> {
  if (!authClient) return null;
  if (cacheLoaded) return cachedSession;
  try {
    const { data } = await authClient.auth.getSession();
    cachedSession = data.session ?? null;
  } catch {
    cachedSession = null;
  }
  cacheLoaded = true;
  return cachedSession;
}

export function subscribeToAdminSession(onChange: (session: Session | null) => void): () => void {
  if (!authClient) return () => {};
  const { data } = authClient.auth.onAuthStateChange((_event, session) => {
    cachedSession = session;
    cacheLoaded = true;
    onChange(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function adminSignIn(email: string, password: string): Promise<{ error?: string }> {
  if (!authClient) return { error: "Supabase is not connected." };
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) return { error: "Enter your admin email and password." };
  const { data, error } = await authClient.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  if (error) {
    // Never echo which half was wrong — that would confirm which emails
    // have console accounts.
    return { error: "That email and password combination was not recognised." };
  }
  cachedSession = data.session ?? null;
  cacheLoaded = true;
  return {};
}

export async function adminSignOut(): Promise<void> {
  if (!authClient) return;
  try {
    await authClient.auth.signOut();
  } catch {
    /* the local session is cleared regardless */
  }
  cachedSession = null;
  cacheLoaded = true;
}