const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const jobsStorePath = path.join(root, 'src/services/jobsStore.ts');
const panelPath = path.join(root, 'src/components/JobDetailPanel.tsx');

let store = fs.readFileSync(jobsStorePath, 'utf8');
store = store.replace(
  "import { getSupabasePublicStorageUrl, sqlEq, sqlIn, supabaseRequest, uploadSupabaseStorageFile } from './supabaseRest';",
  "import { deleteSupabaseStorageFiles, getSupabasePublicStorageUrl, sqlEq, sqlIn, supabaseRequest, uploadSupabaseStorageFile } from './supabaseRest';",
);

const syncStart = store.indexOf('async function syncAttachments(companyId: string, job: ServiceJob) {');
const syncEndMarker = '\n\nexport async function saveServiceJob';
const syncEnd = store.indexOf(syncEndMarker, syncStart);
if (syncStart !== -1 && syncEnd !== -1 && !store.includes('const existingAttachmentRows = await supabaseRequest<JobAttachmentRow[]>')) {
  const nextSync = `async function syncAttachments(companyId: string, job: ServiceJob) {
  const attachments = job.attachments ?? [];
  const existingAttachmentRows = await supabaseRequest<JobAttachmentRow[]>(\`job_attachments?company_id=\${sqlEq(companyId)}&job_id=\${sqlEq(job.id)}&select=*\`);
  const nextAttachmentIds = new Set(attachments.map((attachment) => attachment.id).filter(Boolean));
  const removedAttachmentRows = existingAttachmentRows.filter((row) => !nextAttachmentIds.has(row.id));
  const removedStorageByBucket = removedAttachmentRows.reduce((groups, row) => {
    if (!row.storage_bucket || !row.storage_path) return groups;
    const paths = groups.get(row.storage_bucket) ?? [];
    paths.push(row.storage_path);
    groups.set(row.storage_bucket, paths);
    return groups;
  }, new globalThis.Map<string, string[]>());

  for (const [bucket, paths] of removedStorageByBucket.entries()) {
    await deleteSupabaseStorageFiles(bucket, paths);
  }

  await supabaseRequest(\`job_attachments?company_id=\${sqlEq(companyId)}&job_id=\${sqlEq(job.id)}\`, { method: 'DELETE' });
  const rows: Omit<JobAttachmentRow, 'created_at' | 'uploaded_by_user_id'>[] = [];
  for (const attachment of attachments) {
    let storagePath = attachment.storagePath ?? '';
    const bucket = attachment.storageBucket || JOB_FILES_BUCKET;
    if (!storagePath && (attachment.file || attachment.dataUrl)) {
      const blob = attachment.file ?? dataUrlToBlob(attachment.dataUrl ?? '');
      storagePath = \`\${companyId}/\${job.id}/\${attachment.id}-\${safeFileName(attachment.name)}\`;
      await uploadSupabaseStorageFile(bucket, storagePath, blob, attachment.mimeType || blob.type || 'application/octet-stream');
    }
    if (storagePath) rows.push({ id: attachment.id, company_id: companyId, job_id: job.id, name: attachment.name || 'File', mime_type: attachment.mimeType || 'application/octet-stream', size_bytes: Number(attachment.sizeBytes) || 0, kind: attachment.kind || 'file', storage_bucket: bucket, storage_path: storagePath });
  }
  if (rows.length) await supabaseRequest<JobAttachmentRow[]>('job_attachments?select=*', { method: 'POST', select: true, body: rows });
}`;
  store = store.slice(0, syncStart) + nextSync + store.slice(syncEnd);
}
fs.writeFileSync(jobsStorePath, store);

let panel = fs.readFileSync(panelPath, 'utf8');
const simpleRemove = `  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`;
const selectableRemove = `  function removeAttachment(attachmentId: string) {
    setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`;
const savedRemove = `  function removeAttachment(attachmentId: string) {
    const nextAttachments = (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId);
    const nextJob = { ...draft, attachments: nextAttachments };

    if (typeof setSelectedAttachmentIds === 'function') {
      setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));
    }
    setDraft(nextJob);
    setSaved(false);
    onSave(nextJob);
  }`;
if (!panel.includes('const nextAttachments = (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId);')) {
  if (panel.includes(selectableRemove)) panel = panel.replace(selectableRemove, savedRemove);
  else if (panel.includes(simpleRemove)) panel = panel.replace(simpleRemove, savedRemove);
}
fs.writeFileSync(panelPath, panel);

console.log('Job attachment delete sync patch applied.');
