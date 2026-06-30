import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MailboxMessageDetailRequest = {
  emailMessageId?: string;
};

type GmailMessage = {
  id: string;
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

type GmailAttachment = {
  data?: string;
  size?: number;
};

type SyncAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentId: string;
  contentId: string;
  isInline: boolean;
  dataUrl?: string;
};

const MAX_DETAIL_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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

function normalizeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}

function decodeBase64Url(value: string) {
  const binary = atob(normalizeBase64Url(value));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeContentId(value: string) {
  return value.trim().replace(/^</, '').replace(/>$/, '');
}

function textFromPayload(payload: GmailMessage['payload'] | undefined): string {
  if (!payload) return '';

  if (payload.body?.data && (payload.mimeType === 'text/plain' || !payload.parts?.length)) {
    return decodeBase64Url(payload.body.data);
  }

  const parts = payload.parts ?? [];
  const plainPart = parts.find((part) => part.mimeType === 'text/plain' && part.body?.data);
  if (plainPart?.body?.data) return decodeBase64Url(plainPart.body.data);

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

function htmlFromPayload(payload: GmailMessage['payload'] | undefined): string {
  if (!payload) return '';

  if (payload.body?.data && payload.mimeType === 'text/html') {
    return decodeBase64Url(payload.body.data);
  }

  const parts = payload.parts ?? [];
  const htmlPart = parts.find((part) => part.mimeType === 'text/html' && part.body?.data);
  if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);

  for (const part of parts) {
    const nested = htmlFromPayload(part);
    if (nested) return nested;
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

  for (const child of payload.parts ?? []) collectAttachments(child, attachments);
  return attachments;
}

async function refreshGoogleToken(clientId: string, clientSecret: string, refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_description || result.error || 'Google token refresh failed.');
  return result as { access_token: string; expires_in?: number; token_type?: string };
}

async function gmailFetch(path: string, accessToken: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Mailbox detail is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Missing authenticated caller.' }, 401);

  const payload = (await request.json().catch(() => ({}))) as MailboxMessageDetailRequest;
  const emailMessageId = payload.emailMessageId?.trim();
  if (!emailMessageId) return jsonResponse({ error: 'Email message is required.' }, 400);

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) return jsonResponse({ error: sessionError.message }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: messageRow, error: messageError } = await adminClient
    .from('email_messages')
    .select('id, company_id, email_connection_id, provider_message_id')
    .eq('id', emailMessageId)
    .maybeSingle();

  if (messageError || !messageRow) return jsonResponse({ error: messageError?.message || 'Email message was not found.' }, 404);

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canAccessMailbox =
    callerKind === 'owner' ||
    (callerKind === 'company' && callerCompanyId === messageRow.company_id && ['admin', 'manager', 'dispatcher'].includes(callerRole));
  if (!canAccessMailbox) return jsonResponse({ error: 'Current login cannot open this email.' }, 403);

  const { data: connection, error: connectionError } = await adminClient
    .from('email_connections')
    .select('id, provider, token_encrypted, refresh_token_encrypted')
    .eq('id', messageRow.email_connection_id)
    .eq('company_id', messageRow.company_id)
    .eq('status', 'connected')
    .maybeSingle();

  if (connectionError || !connection) return jsonResponse({ error: connectionError?.message || 'Connected mailbox was not found.' }, 400);
  if (connection.provider !== 'google') return jsonResponse({ error: 'Only Google mailbox detail is implemented right now.' }, 400);

  const { data: settings, error: settingsError } = await adminClient
    .from('mailbox_oauth_settings')
    .select('client_id, client_secret')
    .eq('company_id', messageRow.company_id)
    .eq('provider', 'google')
    .maybeSingle();
  if (settingsError || !settings?.client_id || !settings.client_secret) {
    return jsonResponse({ error: settingsError?.message || 'Google OAuth settings were not found.' }, 400);
  }

  const token = byteaJson(connection.token_encrypted) as { access_token?: string };
  const refreshTokenPayload = byteaJson(connection.refresh_token_encrypted) as { refresh_token?: string };
  let accessToken = token.access_token ?? '';

  try {
    let full = await gmailFetch(`messages/${messageRow.provider_message_id}?format=full`, accessToken);
    if (!full.ok && full.status === 401 && refreshTokenPayload.refresh_token) {
      const refreshed = await refreshGoogleToken(settings.client_id, settings.client_secret, refreshTokenPayload.refresh_token);
      accessToken = refreshed.access_token;
      await adminClient
        .from('email_connections')
        .update({ token_encrypted: toByteaHex({ ...token, ...refreshed, refreshed_at: new Date().toISOString() }), updated_at: new Date().toISOString() })
        .eq('id', connection.id);
      full = await gmailFetch(`messages/${messageRow.provider_message_id}?format=full`, accessToken);
    }

    if (!full.ok) throw new Error(full.result.error?.message || `Gmail message fetch failed with ${full.status}`);

    const message = full.result as GmailMessage;
    const attachments = collectAttachments(message.payload);
    const attachmentsWithData = await Promise.all(
      attachments.map(async (attachment) => {
        if (!attachment.attachmentId || attachment.sizeBytes > MAX_DETAIL_ATTACHMENT_BYTES) return attachment;
        const file = await gmailFetch(`messages/${message.id}/attachments/${attachment.attachmentId}`, accessToken);
        if (!file.ok) return attachment;
        const attachmentData = file.result as GmailAttachment;
        return {
          ...attachment,
          dataUrl: attachmentData.data ? `data:${attachment.mimeType || 'application/octet-stream'};base64,${normalizeBase64Url(attachmentData.data)}` : undefined,
        };
      }),
    );

    return jsonResponse({
      ok: true,
      body: textFromPayload(message.payload),
      bodyHtml: htmlFromPayload(message.payload),
      attachments: attachmentsWithData.map((attachment) => ({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        isInline: attachment.isInline,
        contentId: attachment.contentId || undefined,
        gmailAttachmentId: attachment.attachmentId,
        dataUrl: attachment.dataUrl,
      })),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Mailbox message failed.' }, 400);
  }
});
