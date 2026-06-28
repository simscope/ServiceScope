import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MailboxSyncRequest = {
  companyId?: string;
  limit?: number;
};

type GmailMessage = {
  id: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    mimeType?: string;
    body?: {
      data?: string;
      attachmentId?: string;
      size?: number;
    };
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
  };
};

type GmailPart = NonNullable<GmailMessage['payload']> & {
  filename?: string;
  partId?: string;
};

type SyncAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentId: string;
  contentId: string;
  isInline: boolean;
};

type SyncMessage = {
  providerMessageId: string;
  folder: 'inbox' | 'sent';
  row: Record<string, unknown>;
  attachments: SyncAttachment[];
};

const DEFAULT_MESSAGES_PER_FOLDER = 20;
const MAX_MESSAGES_PER_FOLDER = 40;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function findServiceKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findServiceKey(item);
      if (found) return found;
    }
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      typeof item === 'string' &&
      (normalizedKey.includes('service') || normalizedKey.includes('secret')) &&
      item.startsWith('eyJ')
    ) {
      return item;
    }

    const nested = findServiceKey(item);
    if (nested) return nested;
  }

  return null;
}

function getServiceRoleKey() {
  const directKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (directKey) return directKey;

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secretKeys) return null;

  try {
    return findServiceKey(JSON.parse(secretKeys));
  } catch {
    return null;
  }
}

function byteaJson(value: unknown) {
  if (typeof value !== 'string') return {};
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((part) => parseInt(part, 16)) ?? []);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function toByteaHex(value: unknown) {
  const text = JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function normalizeContentId(value: string) {
  return value.trim().replace(/^</, '').replace(/>$/, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function textFromPayload(payload: GmailMessage['payload'] | undefined): string {
  if (!payload) return '';

  if (payload.body?.data && (payload.mimeType === 'text/plain' || !payload.parts?.length)) {
    return decodeBase64Url(payload.body.data);
  }

  const parts = payload.parts ?? [];
  const plainPart = parts.find((part) => part.mimeType === 'text/plain' && part.body?.data);
  if (plainPart?.body?.data) {
    return decodeBase64Url(plainPart.body.data);
  }

  for (const part of parts) {
    const nested = textFromPayload(part);
    if (nested) return nested;
  }

  const htmlPart = parts.find((part) => part.mimeType === 'text/html' && part.body?.data);
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

function collectAttachments(payload: GmailMessage['payload'] | undefined, attachments: SyncAttachment[] = []) {
  if (!payload) return attachments;

  const part = payload as GmailPart;
  const attachmentId = part.body?.attachmentId;
  const fileName = part.filename?.trim();
  const mimeType = part.mimeType ?? 'application/octet-stream';
  const contentId = normalizeContentId(part.headers?.find((item) => item.name.toLowerCase() === 'content-id')?.value ?? '');
  const disposition = part.headers?.find((item) => item.name.toLowerCase() === 'content-disposition')?.value.toLowerCase() ?? '';
  const isInline = Boolean(contentId) || disposition.includes('inline');

  if (attachmentId && (fileName || contentId)) {
    attachments.push({
      fileName: fileName || `${contentId || attachmentId}`,
      mimeType,
      sizeBytes: part.body?.size ?? 0,
      attachmentId,
      contentId,
      isInline,
    });
  }

  for (const child of payload.parts ?? []) {
    collectAttachments(child, attachments);
  }

  return attachments;
}

async function refreshGoogleToken(clientId: string, clientSecret: string, refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error_description || result.error || 'Google token refresh failed.');
  }

  return result as { access_token: string; expires_in?: number; token_type?: string };
}

async function gmailFetch(path: string, accessToken: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function clampMessageLimit(value: unknown) {
  const parsed = Math.trunc(Number(value) || DEFAULT_MESSAGES_PER_FOLDER);
  return Math.min(MAX_MESSAGES_PER_FOLDER, Math.max(5, parsed));
}

async function listGmailMessages(accessToken: string, labelId: 'INBOX' | 'SENT', limit: number) {
  const list = await gmailFetch(`messages?maxResults=${limit}&labelIds=${labelId}`, accessToken);
  if (!list.ok) {
    throw new Error(list.result.error?.message || `Gmail list failed with ${list.status}`);
  }

  const messageRefs = Array.isArray(list.result.messages) ? list.result.messages : [];
  return await mapWithConcurrency(messageRefs, 2, async (message: { id: string }) => {
    const full = await gmailFetch(`messages/${message.id}?format=full`, accessToken);
    if (!full.ok) {
      throw new Error(full.result.error?.message || `Gmail message fetch failed with ${full.status}`);
    }
    return full.result as GmailMessage;
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Mailbox sync is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as MailboxSyncRequest;
  const companyId = payload.companyId?.trim();
  const messageLimit = clampMessageLimit(payload.limit);
  if (!companyId) return jsonResponse({ error: 'Company is required.' }, 400);

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) return jsonResponse({ error: sessionError.message }, 401);

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canAccessMailbox =
    callerKind === 'owner' ||
    (callerKind === 'company' && callerCompanyId === companyId && ['admin', 'manager', 'dispatcher'].includes(callerRole));

  if (!canAccessMailbox) return jsonResponse({ error: 'Current login cannot sync this mailbox.' }, 403);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: connection, error: connectionError } = await adminClient
    .from('email_connections')
    .select('id, provider, address, token_encrypted, refresh_token_encrypted')
    .eq('company_id', companyId)
    .eq('status', 'connected')
    .maybeSingle();

  if (connectionError || !connection) return jsonResponse({ error: connectionError?.message || 'Connected mailbox was not found.' }, 400);
  if (connection.provider !== 'google') return jsonResponse({ error: 'Only Google mailbox sync is implemented right now.' }, 400);

  const { data: settings, error: settingsError } = await adminClient
    .from('mailbox_oauth_settings')
    .select('client_id, client_secret')
    .eq('company_id', companyId)
    .eq('provider', 'google')
    .maybeSingle();

  if (settingsError || !settings?.client_id || !settings.client_secret) {
    return jsonResponse({ error: settingsError?.message || 'Google OAuth settings were not found.' }, 400);
  }

  const token = byteaJson(connection.token_encrypted) as { access_token?: string };
  const refreshTokenPayload = byteaJson(connection.refresh_token_encrypted) as { refresh_token?: string };
  let accessToken = token.access_token ?? '';

  try {
    let inbox = await gmailFetch('messages?maxResults=1&labelIds=INBOX', accessToken);
    if (!inbox.ok && inbox.status === 401 && refreshTokenPayload.refresh_token) {
      const refreshed = await refreshGoogleToken(settings.client_id, settings.client_secret, refreshTokenPayload.refresh_token);
      accessToken = refreshed.access_token;
      await adminClient
        .from('email_connections')
        .update({
          token_encrypted: toByteaHex({ ...token, ...refreshed, refreshed_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);
      inbox = await gmailFetch('messages?maxResults=1&labelIds=INBOX', accessToken);
    }

    if (!inbox.ok) throw new Error(inbox.result.error?.message || `Gmail access failed with ${inbox.status}`);

    const inboxMessages = await listGmailMessages(accessToken, 'INBOX', messageLimit);
    const sentMessages = await listGmailMessages(accessToken, 'SENT', messageLimit);
    const now = new Date().toISOString();
    const syncMessages: SyncMessage[] = [
      ...inboxMessages.map((message) => ({ message, folder: 'inbox' as const })),
      ...sentMessages.map((message) => ({ message, folder: 'sent' as const })),
    ].map(({ message, folder }) => {
      const body = textFromPayload(message.payload);
      return {
        providerMessageId: message.id,
        folder,
        row: {
          company_id: companyId,
          email_connection_id: connection.id,
          folder,
          provider_message_id: message.id,
          from_email: parseEmailAddress(header(message, 'From')),
          to_email: parseEmailAddress(header(message, 'To')),
          subject: header(message, 'Subject') || '(No subject)',
          preview: message.snippet || body.slice(0, 240),
          body: null,
          body_html: null,
          unread: message.labelIds?.includes('UNREAD') ?? false,
          received_at: folder === 'inbox' ? new Date(header(message, 'Date') || Date.now()).toISOString() : null,
          sent_at: folder === 'sent' ? new Date(header(message, 'Date') || Date.now()).toISOString() : null,
          created_at: now,
        },
        attachments: collectAttachments(message.payload),
      };
    });

    await adminClient.from('email_messages').delete().eq('company_id', companyId).eq('email_connection_id', connection.id);

    if (syncMessages.length) {
      const { data: insertedMessages, error: insertError } = await adminClient
        .from('email_messages')
        .insert(syncMessages.map((message) => message.row))
        .select('id, provider_message_id');
      if (insertError) throw new Error(insertError.message);

      const insertedByProviderId = new Map((insertedMessages ?? []).map((message: { id: string; provider_message_id: string }) => [message.provider_message_id, message.id]));
      const attachmentRows = syncMessages.flatMap((message) =>
        message.attachments.map((attachment) => ({
          email_message_id: insertedByProviderId.get(message.providerMessageId),
          company_id: companyId,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          content_base64: null,
          content_id: attachment.contentId || null,
          gmail_attachment_id: attachment.attachmentId,
          storage_bucket: null,
          storage_path: null,
          is_inline: attachment.isInline,
        })),
      ).filter((row) => row.email_message_id);

      if (attachmentRows.length) {
        const { error: attachmentError } = await adminClient.from('email_message_attachments').insert(attachmentRows);
        if (attachmentError) throw new Error(attachmentError.message);
      }
    }

    await adminClient.from('email_connections').update({ last_sync_at: now, updated_at: now }).eq('id', connection.id);

    return jsonResponse({ ok: true, count: syncMessages.length, inbox: inboxMessages.length, sent: sentMessages.length });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Mailbox sync failed.' }, 400);
  }
});
