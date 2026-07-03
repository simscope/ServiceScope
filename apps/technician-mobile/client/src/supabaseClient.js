import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
export const FUNCTIONS_URL =
  process.env.REACT_APP_SUPABASE_FUNCTIONS_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '');

export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;
export const functionsUrl = FUNCTIONS_URL;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error('[Config] Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY.');
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const supabase = client;
export default client;
