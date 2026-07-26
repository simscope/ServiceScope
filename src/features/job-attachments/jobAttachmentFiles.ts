import type { JobAttachment } from '../../types.js';

export type AttachmentDownloadResult = {
  ok: boolean;
  attachmentId: string;
  name: string;
  error?: string;
};

export function attachmentUrl(attachment: Pick<JobAttachment, 'dataUrl'>) {
  return attachment.dataUrl ?? '';
}

export function isAttachmentPreviewable(attachment: Pick<JobAttachment, 'dataUrl'>) {
  return Boolean(attachmentUrl(attachment));
}

export async function downloadJobAttachment(attachment: JobAttachment): Promise<AttachmentDownloadResult> {
  const url = attachmentUrl(attachment);
  const name = attachment.name || 'attachment';
  if (!url) {
    return {
      ok: false,
      attachmentId: attachment.id,
      name,
      error: 'Save the job first, then download this file.',
    };
  }

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    clickDownload(objectUrl, name);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return { ok: true, attachmentId: attachment.id, name };
  } catch {
    clickDownload(url, name, true);
    return { ok: true, attachmentId: attachment.id, name };
  }
}

export async function downloadJobAttachments(attachments: JobAttachment[]) {
  const results: AttachmentDownloadResult[] = [];
  for (const attachment of attachments) {
    results.push(await downloadJobAttachment(attachment));
  }
  return results;
}

function clickDownload(url: string, name: string, openInNewTab = false) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  if (openInNewTab) anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
