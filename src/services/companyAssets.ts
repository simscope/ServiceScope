import { getSupabaseAccessToken, isSupabaseConfigured } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

function extensionFromFile(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export async function uploadCompanyLogo(companyId: string, file: File) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before uploading a logo.');
  }

  const path = `${companyId}/logo-${Date.now()}.${extensionFromFile(file)}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/company-logos/${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Logo upload failed with ${response.status}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/company-logos/${path}`;
}
