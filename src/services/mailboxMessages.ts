import type { EmailAttachment, EmailMessage } from '../appTypes';
import { getSupabaseAccessToken, getSupabasePublicStorageUrl, isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

type DbEmailMessage = {
  id: string;
  folder: EmailMessage['folder'];
  from_email: string | null;
  to_email: string | null;
  subject: string;
  preview: string;
  unread: boolean;
  received_at: string | null;
  sent_at: string | null;
};

type DbEmailAttachment = {
  id: string;
  email_message_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  content_base64: string | null;
  gmail_attachment_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  content_id: string | null;
  is_inline: boolean;
};

type MailboxMessageDetailResponse = {
  ok?: boolean;
  body?: string;
  bodyHtml?: string;
  attachments?: Array<{
    id?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl?: string;
    isInline: boolean;
    contentId?: string;
    gmailAttachmentId?: string;
  }>;
  error?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';
const DEFAULT_MAILBOX_LIMIT = 50;
const MAX_MAILBOX_LIMIT = 100;

function formatMessageDate(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function makePreview(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function toDataUrl(mimeType: string, value?: string | null) {
  if (!value) return undefined;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return `data:${mimeType || 'application/octet-stream'};base64,${padded}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function inlineCidImages(bodyHtml: string, attachments: EmailAttachment[]) {
  return attachments.reduce((html, attachment) => {
    if (!attachment.contentId || !attachment.dataUrl) return html;
    return html.replace(new RegExp(`cid:${escapeRegExp(attachment.contentId)}`, 'gi'), attachment.dataUrl);
  }, bodyHtml);
}

function clampMailboxLimit(limit = DEFAULT_MAILBOX_LIMIT) {
  return Math.min(MAX_MAILBOX_LIMIT, Math.max(1, Math.floor(Number(limit) || DEFAULT_MAILBOX_LIMIT)));
}

function sqlIn(values: string[]) {
  return `in.(${values.map((value) => encodeURIComponent(value)).join(',')})`;
}

export async function loadMailboxMessages(companyId: string, limit = DEFAULT_MAILBOX_LIMIT): Promise<EmailMessage[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const safeLimit = clampMailboxLimit(limit);
  const rows = await supabaseRequest<DbEmailMessage[]>(
    `email_messages?select=id,folder,from_email,to_email,subject,preview,unread,received_at,sent_at&company_id=${sqlEq(companyId)}&order=received_at.desc.nullslast&order=sent_at.desc.nullslast&limit=${safeLimit}`,
    { select: true },
  );
  const messageIds = rows.map((row) => row.id);
  const attachments = messageIds.length
    ? await supabaseRequest<DbEmailAttachment[]>(
        `email_message_attachments?select=id,email_message_id,file_name,mime_type,size_bytes,content_base64,content_id,gmail_attachment_id,storage_bucket,storage_path,is_inline&company_id=${sqlEq(companyId)}&email_message_id=${sqlIn(messageIds)}&limit=200`,
        { select: true },
      )
    : [];
  const attachmentsByMessageId = attachments.reduce((acc, attachment) => {
    const list = acc.get(attachment.email_message_id) ?? [];
    list.push({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      dataUrl: attachment.storage_bucket && attachment.storage_path
        ? getSupabasePublicStorageUrl(attachment.storage_bucket, attachment.storage_path)
        : attachment.content_base64
          ? toDataUrl(attachment.mime_type, attachment.content_base64)
          : undefined,
      isInline: attachment.is_inline,
      contentId: attachment.content_id ?? undefined,
      gmailAttachmentId: attachment.gmail_attachment_id ?? undefined,
      storageBucket: attachment.storage_bucket ?? undefined,
      storagePath: attachment.storage_path ?? undefined,
    });
    acc.set(attachment.email_message_id, list);
    return acc;
  }, new Map<string, EmailMessage['attachments']>());

  return rows.map((row) => {
    const messageAttachments = attachmentsByMessageId.get(row.id) ?? [];

    return {
      id: row.id,
      folder: row.folder,
      from: row.from_email ?? '',
      to: row.to_email ?? '',
      subject: row.subject,
      preview: makePreview(row.preview),
      body: '',
      bodyHtml: '',
      attachments: messageAttachments,
      jobNumber: '',
      receivedAt: formatMessageDate(row.received_at ?? row.sent_at),
      unread: row.unread,
    };
  });
}

export async function loadMailboxMessageDetail(emailMessageId: string): Promise<Pick<EmailMessage, 'body' | 'bodyHtml' | 'attachments'>> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before opening this email.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-message-detail`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ emailMessageId }),
  });

  const result = (await response.json().catch(() => ({}))) as MailboxMessageDetailResponse;
  if (!response.ok) {
    throw new Error(result.error || `Mailbox message failed with ${response.status}`);
  }

  const attachments = (result.attachments ?? []).map((attachment, index) => ({
    id: attachment.id || attachment.gmailAttachmentId || `${emailMessageId}-${index}`,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    dataUrl: attachment.dataUrl,
    isInline: attachment.isInline,
    contentId: attachment.contentId,
    gmailAttachmentId: attachment.gmailAttachmentId,
  }));

  return {
    body: result.body ?? '',
    bodyHtml: inlineCidImages(result.bodyHtml ?? '', attachments),
    attachments,
  };
}

export async function syncMailboxMessages(companyId: string, limit = 25) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before syncing mailbox messages.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-sync`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyId, limit: clampMailboxLimit(limit) }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Mailbox sync failed with ${response.status}`);
  }

  return result as { ok: true; count: number; inbox: number; sent: number };
}
