type SupabaseMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type SupabaseRequestOptions = {
  method?: SupabaseMethod;
  body?: unknown;
  prefer?: string;
  select?: boolean;
};

type SupabaseAuthResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
  };
};

type ViteEnv = {
  DEV?: boolean;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseHttpBaseUrl = viteEnv.DEV && supabaseUrl ? '/supabase' : supabaseUrl;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';
const AUTH_TOKEN_STORAGE_KEY = 'servicescope.supabaseAccessToken';
export const SUPABASE_AUTH_EXPIRED_CODE = 'SERVICESCOPE_AUTH_EXPIRED';

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function setSupabaseAccessToken(token: string | null) {
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function getSupabaseAccessToken() {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export async function signInWithSupabasePassword(email: string, password: string) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(`${supabaseHttpBaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase sign in failed with ${response.status}`);
  }

  const auth = (await response.json()) as SupabaseAuthResponse;
  setSupabaseAccessToken(auth.access_token);
  return auth;
}

export async function supabaseRequest<T>(path: string, options: SupabaseRequestOptions = {}): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const accessToken = getSupabaseAccessToken();

  const response = await fetch(`${supabaseHttpBaseUrl}/rest/v1/${path}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer ?? (options.select ? 'return=representation' : 'return=minimal'),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const message = await response.text();
    const tokenExpired =
      response.status === 401 ||
      message.toLowerCase().includes('jwt expired') ||
      message.toLowerCase().includes('invalid jwt');

    if (tokenExpired) {
      setSupabaseAccessToken(null);
      const error = new Error('Your session expired. Sign in again.');
      error.name = SUPABASE_AUTH_EXPIRED_CODE;
      throw error;
    }

    throw new Error(message || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export function sqlEq(value: string) {
  return `eq.${encodeURIComponent(value)}`;
}
