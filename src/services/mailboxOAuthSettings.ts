import type { EmailConnection, EmailProvider } from '../appTypes';
import { getSupabaseAccessToken, isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

export const mailboxOAuthRedirectUrl = `${supabaseUrl}/functions/v1/mailbox-oauth-callback`;

type DbEmailConnection = {
  provider: EmailProvider;
  address: string;
  status: EmailConnection['status'];
  last_sync_at: string | null;
  sync_range_days: number | null;
  auto_link_job_number: boolean;
  auto_link_client_email: boolean;
  create_task_from_unread: boolean;
  sender_name: string | null;
  reply_to: string | null;
  signature: string | null;
  imap_host: string | null;
  imap_port: string | null;
  smtp_host: string | null;
  smtp_port: string | null;
  security: EmailConnection['security'] | null;
  username: string | null;
};

type DbMailboxOAuthSettings = {
  provider: Extract<EmailProvider, 'google' | 'microsoft'>;
  client_id: string;
  redirect_url: string;
};

export type StoredMailboxOAuthSettings = {
  provider: Extract<EmailProvider, 'google' | 'microsoft'>;
  clientId: string;
  redirectUrl: string;
  clientSecretSaved: true;
};

function syncRangeFromDays(days: number | null): EmailConnection['syncRange'] {
  if (days === 7) return '7';
  if (days === 90) return '90';
  return '30';
}

export async function loadMailboxEmailConnection(companyId: string): Promise<EmailConnection | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const rows = await supabaseRequest<DbEmailConnection[]>(
    `email_connections?select=provider,address,status,last_sync_at,sync_range_days,auto_link_job_number,auto_link_client_email,create_task_from_unread,sender_name,reply_to,signature,imap_host,imap_port,smtp_host,smtp_port,security,username&company_id=${sqlEq(companyId)}&limit=1`,
    { select: true },
  );
  const row = rows[0];
  if (!row) return null;

  return {
    provider: row.provider,
    address: row.address,
    status: row.status,
    oauthClientId: '',
    oauthClientSecretSaved: false,
    oauthRedirectUrl: mailboxOAuthRedirectUrl,
    lastSync: row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'Not synced',
    syncRange: syncRangeFromDays(row.sync_range_days),
    autoLinkJobNumber: row.auto_link_job_number,
    autoLinkClientEmail: row.auto_link_client_email,
    createTaskFromUnread: row.create_task_from_unread,
    senderName: row.sender_name ?? '',
    replyTo: row.reply_to ?? '',
    signature: row.signature ?? '',
    imapHost: row.imap_host ?? '',
    imapPort: row.imap_port ?? '',
    smtpHost: row.smtp_host ?? '',
    smtpPort: row.smtp_port ?? '',
    security: row.security ?? 'ssl',
    username: row.username ?? '',
  };
}

export async function loadMailboxOAuthSettings(companyId: string): Promise<StoredMailboxOAuthSettings[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const rows = await supabaseRequest<DbMailboxOAuthSettings[]>(
    `mailbox_oauth_settings?select=provider,client_id,redirect_url&company_id=${sqlEq(companyId)}&order=updated_at.desc`,
    { select: true },
  );

  return rows.map((row) => ({
    provider: row.provider,
    clientId: row.client_id,
    redirectUrl: row.redirect_url,
    clientSecretSaved: true,
  }));
}

export async function saveMailboxOAuthSettings(input: {
  companyId: string;
  provider: Extract<EmailProvider, 'google' | 'microsoft'>;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before saving mailbox settings.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-oauth-settings`, {
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
    throw new Error(result.error || `Mailbox OAuth settings failed with ${response.status}`);
  }

  return result as { ok: true; provider: string; redirectUrl: string };
}
