import type { EmailComposeAttachment } from '../appTypes';
import { getSupabaseAccessToken, isSupabaseConfigured } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

export async function sendMailboxEmail(input: {
  companyId: string;
  to: string[];
  subject: string;
  body: string;
  jobNumber: string;
  attachments: EmailComposeAttachment[];
}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before sending email.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-send`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Mailbox send failed with ${response.status}`);
  }

  return result as { ok: true; id: string };
}
