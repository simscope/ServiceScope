import { getSupabaseAccessToken, isSupabaseConfigured } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

export async function deleteJobFile(companyId: string, jobId: string, attachmentId: string) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before deleting this file.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/job-file-delete`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyId, jobId, attachmentId }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Job file delete failed with ${response.status}`);
  }

  return result as { ok: true };
}
