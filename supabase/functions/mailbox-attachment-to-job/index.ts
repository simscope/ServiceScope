import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type CopyAttachmentRequest = {
  companyId?: string;
  emailAttachmentId?: string;
  jobId?: string;
  jobNumber?: string;
};

const JOB_FILES_BUCKET = 'job-files';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    if (typeof item === 'string' && (normalizedKey.includes('service') || normalizedKey.includes('secret')) && item.startsWith('eyJ')) return item;
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

function safeFileName(value: string) {
  return (value.trim() || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return jsonResponse({ error: 'Function is missing Supabase environment.' }, 500);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Missing authenticated caller.' }, 401);

  const payload = (await request.json().catch(() => ({}))) as CopyAttachmentRequest;
  const companyId = payload.companyId?.trim();
  const emailAttachmentId = payload.emailAttachmentId?.trim();
  if (!companyId || !emailAttachmentId || (!payload.jobId && !payload.jobNumber)) return jsonResponse({ error: 'Company, email attachment, and job are required.' }, 400);

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) return jsonResponse({ error: sessionError.message }, 401);

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canCopy = callerKind === 'owner' || (callerKind === 'company' && callerCompanyId === companyId && ['admin', 'manager', 'dispatcher'].includes(callerRole));
  if (!canCopy) return jsonResponse({ error: 'Current login cannot copy attachments for this company.' }, 403);

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: job, error: jobError } = payload.jobId
      ? await adminClient.from('jobs').select('id').eq('company_id', companyId).eq('id', payload.jobId).maybeSingle()
      : await adminClient.from('jobs').select('id').eq('company_id', companyId).eq('job_number', payload.jobNumber).maybeSingle();
    if (jobError || !job) throw new Error(jobError?.message || 'Job was not found.');

    const { data: attachment, error: attachmentError } = await adminClient
      .from('email_message_attachments')
      .select('id,email_message_id,company_id,file_name,mime_type,size_bytes,gmail_attachment_id,storage_bucket,storage_path')
      .eq('company_id', companyId)
      .eq('id', emailAttachmentId)
      .maybeSingle();
    if (attachmentError || !attachment) throw new Error(attachmentError?.message || 'Email attachment was not found.');

    let bytes: Uint8Array;
    if (attachment.storage_bucket && attachment.storage_path) {
      const { data: blob, error: downloadError } = await adminClient.storage.from(attachment.storage_bucket).download(attachment.storage_path);
      if (downloadError || !blob) throw new Error(downloadError?.message || 'Stored email attachment could not be downloaded.');
      bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
      if (!attachment.gmail_attachment_id) throw new Error('This email attachment has no Gmail attachment id or storage path.');
      const { data: message, error: messageError } = await adminClient
        .from('email_messages')
        .select('provider_message_id,email_connection_id')
        .eq('company_id', companyId)
        .eq('id', attachment.email_message_id)
        .maybeSingle();
      if (messageError || !message) throw new Error(messageError?.message || 'Email message was not found.');

      const { data: connection, error: connectionError } = await adminClient
        .from('email_connections')
        .select('id,provider,token_encrypted,refresh_token_encrypted')
        .eq('company_id', companyId)
        .eq('id', message.email_connection_id)
        .maybeSingle();
      if (connectionError || !connection) throw new Error(connectionError?.message || 'Mailbox connection was not found.');
      if (connection.provider !== 'google') throw new Error('Only Gmail attachments can be copied on demand right now.');

      const { data: settings, error: settingsError } = await adminClient
        .from('mailbox_oauth_settings')
        .select('client_id,client_secret')
        .eq('company_id', companyId)
        .eq('provider', 'google')
        .maybeSingle();
      if (settingsError || !settings?.client_id || !settings.client_secret) throw new Error(settingsError?.message || 'Google OAuth settings were not found.');

      const token = byteaJson(connection.token_encrypted) as { access_token?: string };
      const refreshTokenPayload = byteaJson(connection.refresh_token_encrypted) as { refresh_token?: string };
      let accessToken = token.access_token ?? '';
      let gmailAttachment = await gmailFetch(`messages/${message.provider_message_id}/attachments/${attachment.gmail_attachment_id}`, accessToken);
      if (!gmailAttachment.ok && gmailAttachment.status === 401 && refreshTokenPayload.refresh_token) {
        const refreshed = await refreshGoogleToken(settings.client_id, settings.client_secret, refreshTokenPayload.refresh_token);
        accessToken = refreshed.access_token;
        await adminClient
          .from('email_connections')
          .update({ token_encrypted: toByteaHex({ ...token, ...refreshed, refreshed_at: new Date().toISOString() }), updated_at: new Date().toISOString() })
          .eq('id', connection.id);
        gmailAttachment = await gmailFetch(`messages/${message.provider_message_id}/attachments/${attachment.gmail_attachment_id}`, accessToken);
      }
      if (!gmailAttachment.ok) throw new Error(gmailAttachment.result.error?.message || `Gmail attachment fetch failed with ${gmailAttachment.status}`);
      bytes = base64UrlToBytes(String(gmailAttachment.result.data ?? ''));
    }

    const jobAttachmentId = crypto.randomUUID();
    const fileName = attachment.file_name || 'attachment';
    const mimeType = attachment.mime_type || 'application/octet-stream';
    const storagePath = `${companyId}/${job.id}/${jobAttachmentId}-${safeFileName(fileName)}`;
    const { error: uploadError } = await adminClient.storage.from(JOB_FILES_BUCKET).upload(storagePath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { error: insertError } = await adminClient.from('job_attachments').insert({
      id: jobAttachmentId,
      company_id: companyId,
      job_id: job.id,
      name: fileName,
      mime_type: mimeType,
      size_bytes: attachment.size_bytes ?? bytes.byteLength,
      kind: mimeType.startsWith('image/') ? 'photo' : 'file',
      storage_bucket: JOB_FILES_BUCKET,
      storage_path: storagePath,
    });
    if (insertError) throw new Error(insertError.message);

    return jsonResponse({ ok: true, id: jobAttachmentId, storagePath });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Attachment could not be copied to job.' }, 400);
  }
});
