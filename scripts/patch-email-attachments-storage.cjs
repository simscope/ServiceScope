const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appTypesPath = path.join(root, 'src/appTypes.ts');
const messagesPath = path.join(root, 'src/services/mailboxMessages.ts');
const syncPath = path.join(root, 'supabase/functions/mailbox-sync/index.ts');
const sendPath = path.join(root, 'supabase/functions/mailbox-send/index.ts');
const emailPagePath = path.join(root, 'src/components/portal/EmailPage.tsx');

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }
function write(filePath, content) { fs.writeFileSync(filePath, content); }

let appTypes = read(appTypesPath);
appTypes = appTypes.replace(
  `export type EmailAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  isInline: boolean;
  contentId?: string;
};`,
  `export type EmailAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  isInline: boolean;
  contentId?: string;
  gmailAttachmentId?: string;
  storageBucket?: string;
  storagePath?: string;
};`,
);
write(appTypesPath, appTypes);

let messages = read(messagesPath);
messages = messages.replace(
  `import { getSupabaseAccessToken, isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';`,
  `import { getSupabaseAccessToken, getSupabasePublicStorageUrl, isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';`,
);
messages = messages.replace(
  `  content_base64: string;
  content_id: string | null;
  is_inline: boolean;`,
  `  content_base64: string | null;
  content_id: string | null;
  gmail_attachment_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  is_inline: boolean;`,
);
messages = messages.replace(
  `function toDataUrl(mimeType: string, value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return \`data:\${mimeType || 'application/octet-stream'};base64,\${padded}\`;
}`,
  `function toDataUrl(mimeType: string, value?: string | null) {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return \`data:\${mimeType || 'application/octet-stream'};base64,\${padded}\`;
}

function attachmentUrl(attachment: DbEmailAttachment) {
  if (attachment.storage_bucket && attachment.storage_path) {
    return getSupabasePublicStorageUrl(attachment.storage_bucket, attachment.storage_path);
  }

  return toDataUrl(attachment.mime_type, attachment.content_base64);
}`,
);
messages = messages.replace(
  `        \`email_message_attachments?select=id,email_message_id,file_name,mime_type,size_bytes,content_base64,content_id,is_inline&company_id=\${sqlEq(companyId)}&email_message_id=\${sqlIn(messageIds)}&limit=200\`,`,
  `        \`email_message_attachments?select=id,email_message_id,file_name,mime_type,size_bytes,content_base64,content_id,gmail_attachment_id,storage_bucket,storage_path,is_inline&company_id=\${sqlEq(companyId)}&email_message_id=\${sqlIn(messageIds)}&limit=200\`,`,
);
messages = messages.replace(
  `      dataUrl: toDataUrl(attachment.mime_type, attachment.content_base64),
      isInline: attachment.is_inline,
      contentId: attachment.content_id ?? undefined,`,
  `      dataUrl: attachmentUrl(attachment),
      isInline: attachment.is_inline,
      contentId: attachment.content_id ?? undefined,
      gmailAttachmentId: attachment.gmail_attachment_id ?? undefined,
      storageBucket: attachment.storage_bucket ?? undefined,
      storagePath: attachment.storage_path ?? undefined,`,
);
write(messagesPath, messages);

let sync = read(syncPath);
sync = sync.replace(
  `const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;`,
  `// Incoming Gmail attachment bytes stay in Gmail. We store only Gmail attachment IDs and metadata.`,
);
sync = sync.replace(
  `            attachments: collectAttachments(message.payload).filter((attachment) => attachment.sizeBytes <= MAX_ATTACHMENT_BYTES),`,
  `            attachments: collectAttachments(message.payload),`,
);
const oldSyncBlock = `      const attachmentInputs = syncMessages.flatMap((message) =>
        message.attachments.map((attachment) => ({ message, attachment })),
      );
      const attachmentRows = (
        await mapWithConcurrency(
          attachmentInputs,
          3,
          async ({ message, attachment }) => ({
            email_message_id: insertedByProviderId.get(message.providerMessageId),
            company_id: companyId,
            file_name: attachment.fileName,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
            content_base64: await fetchGmailAttachment(message.providerMessageId, attachment.attachmentId, accessToken),
            content_id: attachment.contentId || null,
            is_inline: attachment.isInline,
          }),
        )
      ).filter((row) => row.email_message_id);`;
const newSyncBlock = `      const attachmentInputs = syncMessages.flatMap((message) =>
        message.attachments.map((attachment) => ({ message, attachment })),
      );
      const attachmentRows = attachmentInputs.map(({ message, attachment }) => ({
        email_message_id: insertedByProviderId.get(message.providerMessageId),
        company_id: companyId,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        gmail_attachment_id: attachment.attachmentId,
        content_id: attachment.contentId || null,
        storage_bucket: null,
        storage_path: null,
        is_inline: attachment.isInline,
      })).filter((row) => row.email_message_id);`;
sync = sync.replace(oldSyncBlock, newSyncBlock);
write(syncPath, sync);

let send = read(sendPath);
if (!send.includes(`const EMAIL_FILES_BUCKET = 'email-files';`)) {
  send = send.replace(
    `const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;`,
    `const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const EMAIL_FILES_BUCKET = 'email-files';`,
  );
}
if (!send.includes('function base64ToBytes')) {
  send = send.replace(
    `function normalizeBase64(value: string) {
  const base64 = value.includes(',') ? value.split(',').pop() ?? '' : value;
  return base64.replace(/\s/g, '');
}`,
    `function normalizeBase64(value: string) {
  const base64 = value.includes(',') ? value.split(',').pop() ?? '' : value;
  return base64.replace(/\s/g, '');
}

function base64ToBytes(value: string) {
  const normalized = normalizeBase64(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeStorageFileName(value: string) {
  return (value.trim() || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}`,
  );
}
const oldSendBlock = `    const messageId = insertedMessage?.id;
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
    }`;
const newSendBlock = `    const messageId = insertedMessage?.id;
    if (messageId && attachments.length) {
      const attachmentRows = await Promise.all(
        attachments.map(async (attachment) => {
          const fileName = attachment.fileName?.trim() || 'attachment';
          const mimeType = attachment.mimeType?.trim() || 'application/octet-stream';
          const storagePath = \`\${companyId}/\${messageId}/\${crypto.randomUUID()}-\${safeStorageFileName(fileName)}\`;
          const { error: storageError } = await adminClient.storage
            .from(EMAIL_FILES_BUCKET)
            .upload(storagePath, base64ToBytes(attachment.contentBase64 ?? ''), {
              contentType: mimeType,
              upsert: true,
            });

          if (storageError) throw new Error(storageError.message);

          return {
            email_message_id: messageId,
            company_id: companyId,
            file_name: fileName,
            mime_type: mimeType,
            size_bytes: attachment.sizeBytes ?? 0,
            content_base64: null,
            content_id: null,
            gmail_attachment_id: null,
            storage_bucket: EMAIL_FILES_BUCKET,
            storage_path: storagePath,
            is_inline: false,
          };
        }),
      );
      const { error: attachmentError } = await adminClient.from('email_message_attachments').insert(attachmentRows);
      if (attachmentError) throw new Error(attachmentError.message);
    }`;
send = send.replace(oldSendBlock, newSendBlock);
write(sendPath, send);

let emailPage = read(emailPagePath);
const oldAttachmentGrid = `                  {openedMessage.attachments.map((attachment) => (
                    <a className="email-attachment-item" href={attachment.dataUrl} download={attachment.fileName} target="_blank" rel="noreferrer" key={attachment.id}>
                      {attachment.mimeType.startsWith('image/') ? (
                        <img src={attachment.dataUrl} alt={attachment.fileName} />
                      ) : (
                        <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                      )}
                      <small>{attachment.fileName}</small>
                    </a>
                  ))}`;
const newAttachmentGrid = `                  {openedMessage.attachments.map((attachment) => (
                    attachment.dataUrl ? (
                      <a className="email-attachment-item" href={attachment.dataUrl} download={attachment.fileName} target="_blank" rel="noreferrer" key={attachment.id}>
                        {attachment.mimeType.startsWith('image/') ? (
                          <img src={attachment.dataUrl} alt={attachment.fileName} />
                        ) : (
                          <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                        )}
                        <small>{attachment.fileName}</small>
                      </a>
                    ) : (
                      <div className="email-attachment-item disabled" key={attachment.id} title="Attachment stays in Gmail until it is saved to a job or downloaded on demand.">
                        <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                        <small>{attachment.fileName}</small>
                      </div>
                    )
                  ))}`;
emailPage = emailPage.replace(oldAttachmentGrid, newAttachmentGrid);
write(emailPagePath, emailPage);

console.log('Email attachments storage patch applied.');
