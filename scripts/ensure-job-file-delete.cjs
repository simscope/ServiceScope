const fs = require('fs');
const path = require('path');

const detailPath = path.resolve(__dirname, '..', 'src/components/JobDetailPanel.tsx');
let source = fs.readFileSync(detailPath, 'utf8');

source = source.replace(
`  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`,
`  function removeAttachment(attachmentId: string) {
    const nextJob = {
      ...draft,
      attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId),
    };

    setDraft(nextJob);
    setSaved(false);
    onSave(nextJob);
  }`,
);

fs.writeFileSync(detailPath, source);

const storePath = path.resolve(__dirname, '..', 'src/services/jobsStore.ts');
let store = fs.readFileSync(storePath, 'utf8');

store = store.replace(
`async function syncAttachments(companyId: string, job: ServiceJob) {
  await supabaseRequest(\`job_attachments?company_id=\${sqlEq(companyId)}&job_id=\${sqlEq(job.id)}\`, { method: 'DELETE' });
  const rows: Omit<JobAttachmentRow, 'created_at' | 'uploaded_by_user_id'>[] = [];
  for (const attachment of job.attachments ?? []) {
    let storagePath = attachment.storagePath ?? '';
    const bucket = attachment.storageBucket || JOB_FILES_BUCKET;
    if (!storagePath && (attachment.file || attachment.dataUrl)) {
      const blob = attachment.file ?? dataUrlToBlob(attachment.dataUrl ?? '');
      storagePath = \`${companyId}/\${job.id}/\${attachment.id}-\${safeFileName(attachment.name)}\`;
      await uploadSupabaseStorageFile(bucket, storagePath, blob, attachment.mimeType || blob.type || 'application/octet-stream');
    }
    if (storagePath) rows.push({ id: attachment.id, company_id: companyId, job_id: job.id, name: attachment.name || 'File', mime_type: attachment.mimeType || 'application/octet-stream', size_bytes: Number(attachment.sizeBytes) || 0, kind: attachment.kind || 'file', storage_bucket: bucket, storage_path: storagePath });
  }
  if (rows.length) await supabaseRequest<JobAttachmentRow[]>('job_attachments?select=*', { method: 'POST', select: true, body: rows });
}`,
`async function syncAttachments(companyId: string, job: ServiceJob) {
  const existingAttachments = await supabaseRequest<JobAttachmentRow[]>(\`job_attachments?company_id=\${sqlEq(companyId)}&job_id=\${sqlEq(job.id)}&select=id,company_id,job_id,uploaded_by_user_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path,created_at&limit=200\`);
  const keptStorageKeys = new Set((job.attachments ?? []).map((attachment) => \`${attachment.storageBucket || JOB_FILES_BUCKET}:\${attachment.storagePath ?? ''}\`).filter((key) => !key.endsWith(':')));
  const removedByBucket = existingAttachments.reduce((acc, attachment) => {
    const key = \`${attachment.storage_bucket}:\${attachment.storage_path}\`;
    if (!attachment.storage_path || keptStorageKeys.has(key)) return acc;
    const paths = acc.get(attachment.storage_bucket) ?? [];
    paths.push(attachment.storage_path);
    acc.set(attachment.storage_bucket, paths);
    return acc;
  }, new Map<string, string[]>());

  for (const [bucket, paths] of removedByBucket) {
    await deleteSupabaseStorageFiles(bucket, paths);
  }

  await supabaseRequest(\`job_attachments?company_id=\${sqlEq(companyId)}&job_id=\${sqlEq(job.id)}\`, { method: 'DELETE' });
  const rows: Omit<JobAttachmentRow, 'created_at' | 'uploaded_by_user_id'>[] = [];
  for (const attachment of job.attachments ?? []) {
    let storagePath = attachment.storagePath ?? '';
    const bucket = attachment.storageBucket || JOB_FILES_BUCKET;
    if (!storagePath && (attachment.file || attachment.dataUrl)) {
      const blob = attachment.file ?? dataUrlToBlob(attachment.dataUrl ?? '');
      storagePath = \`${companyId}/\${job.id}/\${attachment.id}-\${safeFileName(attachment.name)}\`;
      await uploadSupabaseStorageFile(bucket, storagePath, blob, attachment.mimeType || blob.type || 'application/octet-stream');
    }
    if (storagePath) rows.push({ id: attachment.id, company_id: companyId, job_id: job.id, name: attachment.name || 'File', mime_type: attachment.mimeType || 'application/octet-stream', size_bytes: Number(attachment.sizeBytes) || 0, kind: attachment.kind || 'file', storage_bucket: bucket, storage_path: storagePath });
  }
  if (rows.length) await supabaseRequest<JobAttachmentRow[]>('job_attachments?select=*', { method: 'POST', select: true, body: rows });
}`,
);

fs.writeFileSync(storePath, store);
console.log('Job file delete saves immediately and removes deleted files from storage.');
