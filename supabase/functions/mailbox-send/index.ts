import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MailboxSendRequest = {
  companyId?: string;
  to?: string[];
  subject?: string;
  body?: string;
  jobNumber?: string;
  attachments?: Array<{
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    contentBase64?: string;
  }>;
};

const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
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

function base64FromUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toBase64Url(value: string) {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeBase64(value: string) {
  const base64 = value.includes(',') ? value.split(',').pop() ?? '' : value;
  return base64.replace(/\s/g, '');
}

function encodeHeader(value: string) {
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${base64FromUtf8(value)}?=`;
}

function foldBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

function makeRawEmail(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
  attachments: NonNullable<MailboxSendRequest['attachments']>;
}) {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    `Subject: ${encodeHeader(input.subject || '(No subject)')}`,
    'MIME-Version: 1.0',
  ];

  if (!input.attachments.length) {
    return toBase64Url(
      base64FromUtf8(
        [
          ...headers,
          'Content-Type: text/plain; charset="UTF-8"',
          'Content-Transfer-Encoding: base64',
          '',
          foldBase64(base64FromUtf8(input.body)),
        ].join('\r\n'),
      ),
    );
  }

  const boundary = `servicescope-${crypto.randomUUID()}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(base64FromUtf8(input.body)),
  ];

  for (const attachment of input.attachments) {
    const fileName = attachment.fileName?.trim() || 'attachment';
    const safeFileName = fileName.replace(/"/g, '');
    const mimeType = attachment.mimeType?.trim() || 'application/octet-stream';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${safeFileName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeFileName}"`,
      '',
      foldBase64(normalizeBase64(attachment.contentBase64 ?? '')),
    );
  }

  parts.push(`--${boundary}--`, '');
  return toBase64Url(base64FromUtf8(parts.join('\r\n')));
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

async function sendGmail(raw: string, accessToken: string) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Mailbox send is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as MailboxSendRequest;
  const companyId = payload.companyId?.trim();
  const to = (payload.to ?? []).map((item) => item.trim()).filter(Boolean);
  const subject = payload.subject?.trim() || '(No subject)';
  const body = payload.body ?? '';
  const attachments = (payload.attachments ?? []).filter((attachment) => attachment.contentBase64);
  const totalAttachmentBytes = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0);

  if (!companyId || !to.length) {
    return jsonResponse({ error: 'Company and recipient are required.' }, 400);
  }

  if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'Attachments are too large for one email. Keep total files under 8 MB.' }, 400);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) {
    return jsonResponse({ error: sessionError.message }, 401);
  }

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canSend =
    callerKind === 'owner' ||
    (callerKind === 'company' &&
      callerCompanyId === companyId &&
      (callerRole === 'admin' || callerRole === 'manager' || callerRole === 'dispatcher'));

  if (!canSend) {
    return jsonResponse({ error: 'Current login cannot send from this mailbox.' }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: connection, error: connectionError } = await adminClient
    .from('email_connections')
    .select('id, provider, address, token_encrypted, refresh_token_encrypted')
    .eq('company_id', companyId)
    .eq('status', 'connected')
    .maybeSingle();

  if (connectionError || !connection) {
    return jsonResponse({ error: connectionError?.message || 'Connected mailbox was not found.' }, 400);
  }

  if (connection.provider !== 'google') {
    return jsonResponse({ error: 'Only Google mailbox sending is implemented right now.' }, 400);
  }

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
  const now = new Date().toISOString();

  try {
    const raw = makeRawEmail({
      from: connection.address,
      to,
      subject,
      body,
      attachments,
    });

    let sent = await sendGmail(raw, accessToken);
    if (!sent.ok && sent.status === 401 && refreshTokenPayload.refresh_token) {
      const refreshed = await refreshGoogleToken(settings.client_id, settings.client_secret, refreshTokenPayload.refresh_token);
      accessToken = refreshed.access_token;
      await adminClient
        .from('email_connections')
        .update({
          token_encrypted: toByteaHex({ ...token, ...refreshed, refreshed_at: now }),
          updated_at: now,
        })
        .eq('id', connection.id);
      sent = await sendGmail(raw, accessToken);
    }

    if (!sent.ok) {
      throw new Error(sent.result.error?.message || `Gmail send failed with ${sent.status}`);
    }

    const { data: insertedMessage, error: insertError } = await adminClient
      .from('email_messages')
      .insert({
        company_id: companyId,
        email_connection_id: connection.id,
        folder: 'sent',
        provider_message_id: sent.result.id ?? crypto.randomUUID(),
        from_email: connection.address,
        to_email: to.join(', '),
        subject,
        preview: body.slice(0, 240),
        body,
        body_html: '',
        unread: false,
        sent_at: now,
        created_at: now,
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const messageId = insertedMessage?.id;
    if (messageId && attachments.length) {
      const { error: attachmentError } = await adminClient.from('email_message_attachments').insert(
        attachments.map((attachment) => ({
          email_message_id: messageId,
          company_id: companyId,
          file_name: attachment.fileName?.trim() || 'attachment',
          mime_type: attachment.mimeType?.trim() || 'application/octet-stream',
          size_bytes: attachment.sizeBytes ?? 0,
          content_base64: normalizeBase64(attachment.contentBase64 ?? ''),
          content_id: null,
          is_inline: false,
        })),
      );
      if (attachmentError) throw new Error(attachmentError.message);
    }

    return jsonResponse({ ok: true, id: sent.result.id ?? messageId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Mailbox send failed.' }, 400);
  }
});
