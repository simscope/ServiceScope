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
const EMAIL_FILES_BUCKET = 'email-files';

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

function parseEmailName(value: string) {
  const name = value.replace(/<[^>]+>/g, '').replace(/[\"']/g, '').trim();
  return name || parseEmailAddress(value);
}

function isLikelyLead(subject: string, body: string) {
  const text = `${subject} ${body}`.toLowerCase();
  const leadTerms = [
    'service request', 'repair', 'broken', 'not working', 'maintenance', 'estimate',
    'quote', 'appointment', 'technician', 'hvac', 'plumbing', 'appliance', 'emergency',
    'service call', 'need help', 'schedule',
  ];
  return leadTerms.some((term) => text.includes(term));
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

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
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

function htmlFromPayload(payload: GmailMessage['payload'] | undefined): string {
  if (!payload) return '';

  if (payload.body?.data && payload.mimeType === 'text/html') {
    return decodeBase64Url(payload.body.data);
  }

  const parts = payload.parts ?? [];
  const htmlPart = parts.find((part) => part.mimeType === 'text/html' && part.body?.data);
  if (htmlPart?.body?.data) {
    return decodeBase64Url(htmlPart.body.data);
  }

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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const result = await response.json().catch(() => ({}));
    if (response.ok || (response.status < 500 && response.status !== 429 && response.status !== 546)) {
      return { ok: response.ok, status: response.status, result };
    }

    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  return { ok: false, status: 546, result: { error: { message: 'Gmail temporarily unavailable.' } } };
}

async function deleteStoredEmailFiles(adminClient: ReturnType<typeof createClient>, companyId: string, connectionId: string) {
  const { data: messages, error: messagesError } = await adminClient
    .from('email_messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('email_connection_id', connectionId);

  if (messagesError) throw new Error(messagesError.message);
  const messageIds = (messages ?? []).map((message: { id: string }) => message.id);
  if (!messageIds.length) return;

  const { data: attachments, error: attachmentsError } = await adminClient
    .from('email_message_attachments')
    .select('storage_bucket,storage_path')
    .eq('company_id', companyId)
    .in('email_message_id', messageIds);

  if (attachmentsError) throw new Error(attachmentsError.message);

  const pathsByBucket = new Map<string, string[]>();
  for (const attachment of attachments ?? []) {
    const bucket = attachment.storage_bucket;
    const path = attachment.storage_path;
    if (!bucket || !path) continue;

    const paths = pathsByBucket.get(bucket) ?? [];
    paths.push(path);
    pathsByBucket.set(bucket, paths);
  }

  for (const [bucket, paths] of pathsByBucket) {
    const { error } = await adminClient.storage.from(bucket).remove(paths);
    if (error) throw new Error(error.message);
  }
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
  const messages = await mapWithConcurrency(messageRefs, 2, async (message: { id: string }) => {
    const full = await gmailFetch(`messages/${message.id}?format=full`, accessToken);
    if (!full.ok) {
      if (full.status === 546 || full.status === 429 || full.status >= 500) return null;
      throw new Error(full.result.error?.message || `Gmail message fetch failed with ${full.status}`);
    }
    return full.result as GmailMessage;
  });

  return messages.filter((message) => message !== null) as GmailMessage[];
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
    .select('id, provider, address, token_encrypted, refresh_token_encrypted, import_leads_from_email')
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
      const bodyHtml = htmlFromPayload(message.payload);
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
          body,
          body_html: bodyHtml,
          unread: message.labelIds?.includes('UNREAD') ?? false,
          received_at: folder === 'inbox' ? new Date(header(message, 'Date') || Date.now()).toISOString() : null,
          sent_at: folder === 'sent' ? new Date(header(message, 'Date') || Date.now()).toISOString() : null,
          created_at: now,
        },
        attachments: collectAttachments(message.payload),
      };
    });

    await deleteStoredEmailFiles(adminClient, companyId, connection.id);
    await adminClient.from('email_messages').delete().eq('company_id', companyId).eq('email_connection_id', connection.id);

    if (syncMessages.length) {
      const { data: insertedMessages, error: insertError } = await adminClient
        .from('email_messages')
        .insert(syncMessages.map((message) => message.row))
        .select('id, provider_message_id');
      if (insertError) throw new Error(insertError.message);

      const insertedByProviderId = new Map((insertedMessages ?? []).map((message: { id: string; provider_message_id: string }) => [message.provider_message_id, message.id]));

      if (connection.import_leads_from_email) {
        const emailLeadRows = syncMessages
          .filter((message) => message.folder === 'inbox' && isLikelyLead(String(message.row.subject ?? ''), String(message.row.body ?? '')))
          .map((message) => {
            const fromHeader = String(message.row.from_email ?? '');
            const body = String(message.row.body ?? '');
            const phone = body.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? '';
            return {
              company_id: companyId,
              source: 'email',
              client_name: parseEmailName(fromHeader),
              client_phone: phone,
              client_email: parseEmailAddress(fromHeader).toLowerCase() || null,
              address: '',
              message: `${String(message.row.subject ?? '(No subject)')}\n\n${body}`.trim().slice(0, 5000),
              status: 'new',
              external_source: 'gmail',
              external_id: message.providerMessageId,
              metadata: { provider: 'google', provider_message_id: message.providerMessageId },
            };
          });

        if (emailLeadRows.length) {
          const { error: emailLeadError } = await adminClient
            .from('job_inbox')
            .upsert(emailLeadRows, { onConflict: 'company_id,external_source,external_id', ignoreDuplicates: true });
          if (emailLeadError) throw new Error(emailLeadError.message);
        }
      }

      const attachmentRows = [];

      for (const message of syncMessages) {
        const emailMessageId = insertedByProviderId.get(message.providerMessageId);
        if (!emailMessageId) continue;

        for (const attachment of message.attachments) {
          const attachmentResponse = await gmailFetch(
            `messages/${message.providerMessageId}/attachments/${attachment.attachmentId}`,
            accessToken,
          );

          if (!attachmentResponse.ok) {
            throw new Error(attachmentResponse.result.error?.message || `Gmail attachment fetch failed with ${attachmentResponse.status}`);
          }

          const attachmentBytes = base64UrlToBytes(String(attachmentResponse.result.data ?? ''));
          const storagePath = `${companyId}/${emailMessageId}/${crypto.randomUUID()}-${safeFileName(attachment.fileName)}`;
          const { error: uploadError } = await adminClient.storage
            .from(EMAIL_FILES_BUCKET)
            .upload(storagePath, attachmentBytes, {
              contentType: attachment.mimeType,
              upsert: true,
            });

          if (uploadError) throw new Error(uploadError.message);

          attachmentRows.push({
            email_message_id: emailMessageId,
            company_id: companyId,
            file_name: attachment.fileName,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes || attachmentBytes.byteLength,
            content_base64: null,
            content_id: attachment.contentId || null,
            gmail_attachment_id: attachment.attachmentId,
            storage_bucket: EMAIL_FILES_BUCKET,
            storage_path: storagePath,
            is_inline: attachment.isInline,
          });
        }
      }

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
