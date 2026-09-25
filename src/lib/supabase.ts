/**
 * Shared Supabase client for the browser (Vite exposes VITE_* vars).
 * The anon key is public by design; all writes that change money or
 * admin state go through the server functions in supabase.server.ts
 * with the service-role key, which bypasses RLS.
 */
import { createClient } from "@supabase/supabase-js";

export type UserRow = {
  id: string;
  email: string;
  is_paid: boolean;
  is_admin: boolean;
  created_at: string;
};

export type UserSessionRow = {
  id: string;
  email: string;
  license_key: string | null;
  created_at: string;
};

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

/** False while credentials are missing — every call short-circuits safely. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
