import { createClient } from '@supabase/supabase-js';

// Vite exposes VITE_ prefixed values to the browser. Only use Supabase's
// publishable key here; NEVER put a secret/service-role key in this file.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const cloudConfigured = Boolean(url && publishableKey);

export const supabase = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
