import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../domain/types';

export type CloudPortfolio = {
  user_id: string;
  schema_version: number;
  revision: number;
  state: AppState;
  updated_at: string;
};

function readPublicConfig() {
  // Only explicitly named public URL/anon key are referenced. Never read or
  // bundle service-role keys, database passwords, or the full env object.
  const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '';
  const anonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return { url: url.trim(), anonKey: anonKey.trim() };
}

export function createSupabaseClient(): SupabaseClient | null {
  const { url, anonKey } = readPublicConfig();
  if (!url || !anonKey) return null;
  try {
    return createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    return null;
  }
}

export function signupEnabled(): boolean {
  return import.meta.env.NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED === 'true';
}
