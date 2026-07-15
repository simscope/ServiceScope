type SupabaseMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type SupabaseRequestOptions = {
  method?: SupabaseMethod;
  body?: unknown;
  prefer?: string;
  select?: boolean;
  timeoutMs?: number;
};

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';
const AUTH_TOKEN_STORAGE_KEY = 'servicescope.supabaseAccessToken';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
export const SUPABASE_AUTH_EXPIRED_CODE = 'SERVICESCOPE_AUTH_EXPIRED';

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

type PersistedSupabaseSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabasePublicStorageUrl(bucket: string, path: string) {
  if (!supabaseUrl || !bucket || !path) return '';
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function setSupabaseAccessToken(token: string | null) {
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function getSupabaseAccessToken() {
  const saved = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!saved) return null;

  try {
    const session = JSON.parse(saved) as PersistedSupabaseSession;
    return session.accessToken || null;
  } catch {
    // Keeps existing browser sessions valid while upgrading from the old token-only format.
    return saved;
  }
}

function saveSupabaseSession(auth: SupabaseAuthResponse) {
  const session: PersistedSupabaseSession = {
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    expiresAt: auth.expires_in ? Date.now() + auth.expires_in * 1000 : undefined,
  };
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, JSON.stringify(session));
}

export function setSupabaseAuthTokens(accessToken: string, refreshToken?: string | null, expiresIn?: number | string | null) {
  const parsedExpiresIn = Number(expiresIn);
  const session: PersistedSupabaseSession = {
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresAt: Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0
      ? Date.now() + parsedExpiresIn * 1000
      : undefined,
  };
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, JSON.stringify(session));
}

function readPersistedSupabaseSession(): PersistedSupabaseSession | null {
  const saved = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!saved) return null;

  try {
    const session = JSON.parse(saved) as PersistedSupabaseSession;
    return session.accessToken ? session : null;
  } catch {
    return { accessToken: saved };
  }
}

function makeSupabaseHeaders(contentType?: string) {
  const accessToken = getSupabaseAccessToken();
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function readSupabaseError(response: Response) {
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

export async function signInWithSupabasePassword(email: string, password: string) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
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
  saveSupabaseSession(auth);
  return auth;
}

export async function restoreSupabaseAccessToken() {
  const saved = readPersistedSupabaseSession();
  if (!saved) return false;

  // Refresh shortly before expiry. Legacy token-only sessions remain usable until Supabase rejects them.
  if (!saved.refreshToken || !saved.expiresAt || saved.expiresAt > Date.now() + 60_000) return true;

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: saved.refreshToken }),
  });

  if (!response.ok) {
    setSupabaseAccessToken(null);
    return false;
  }

  saveSupabaseSession((await response.json()) as SupabaseAuthResponse);
  return true;
}

export async function supabaseRequest<T>(path: string, options: SupabaseRequestOptions = {}): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: {
        ...makeSupabaseHeaders('application/json'),
        Prefer: options.prefer ?? (options.select ? 'return=representation' : 'return=minimal'),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Supabase request timed out. Database is overloaded or not accepting connections.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    await readSupabaseError(response);
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

export async function supabaseRpc<T>(name: string, body: Record<string, unknown>, options: Pick<SupabaseRequestOptions, 'timeoutMs'> = {}): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...makeSupabaseHeaders('application/json'),
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Supabase request timed out. Database is overloaded or not accepting connections.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    await readSupabaseError(response);
  }

  const text = await response.text();
  return text ? JSON.parse(text) as T : undefined as T;
}

export async function uploadSupabaseStorageFile(bucket: string, path: string, file: Blob, contentType = 'application/octet-stream') {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      ...makeSupabaseHeaders(contentType),
      'x-upsert': 'true',
    },
    body: file,
  });

  if (!response.ok) {
    await readSupabaseError(response);
  }
}

export async function downloadSupabaseStorageFile(bucket: string, path: string) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'GET',
    headers: makeSupabaseHeaders(),
  });

  if (!response.ok) {
    await readSupabaseError(response);
  }

  return response.blob();
}

export async function deleteSupabaseStorageFiles(bucket: string, paths: string[]) {
  const cleanPaths = paths.filter(Boolean);
  if (!cleanPaths.length) return;

  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE',
    headers: makeSupabaseHeaders('application/json'),
    body: JSON.stringify({ prefixes: cleanPaths }),
  });

  if (!response.ok) {
    await readSupabaseError(response);
  }
}

export function sqlEq(value: string) {
  return `eq.${encodeURIComponent(value)}`;
}

export function sqlIn(values: string[]) {
  return `in.(${values.map((value) => encodeURIComponent(value)).join(',')})`;
}
