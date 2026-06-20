import { getSupabaseAccessToken, isSupabaseConfigured } from './supabaseRest';

export type AccessActionMode = 'create' | 'reset';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

type AccessInviteInput = {
  email: string;
  password: string;
  name?: string;
  companyId?: string;
  role?: string;
  mode: AccessActionMode;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

export async function saveUserAccess(input: AccessInviteInput) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  if (input.password.trim().length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Your secure login session expired. Sign in again, then save access.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/access-invite`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Current login cannot manage access. Sign out, sign in as the platform owner or company admin, then try again.');
    }

    throw new Error(result.error || `Access update failed with ${response.status}`);
  }

  return result as { ok: true; action: 'access_created' | 'access_updated' | 'password_reset'; email: string };
}
