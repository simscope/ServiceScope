const fs = require('fs');
const path = require('path');

const detailPath = path.resolve(__dirname, '..', 'src/components/JobDetailPanel.tsx');
let source = fs.readFileSync(detailPath, 'utf8');

if (!source.includes("../services/jobFiles")) {
  source = source.replace(
    "import { money } from '../utils/format';",
    "import { money } from '../utils/format';\nimport { deleteJobFile } from '../services/jobFiles';",
  );
}

const removeAttachmentBody = `  async function removeAttachment(attachmentId: string) {
    const attachment = (draft.attachments ?? []).find((item) => item.id === attachmentId);
    const companyId = draft.companyId || job.companyId;
    const nextJob = {
      ...draft,
      attachments: (draft.attachments ?? []).filter((item) => item.id !== attachmentId),
    };

    setDraft(nextJob);
    setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));
    setSaved(false);
    setUploadError('');

    try {
      if (companyId && draft.id && attachment?.storagePath) {
        await deleteJobFile(companyId, draft.id, attachmentId, attachment.storageBucket, attachment.storagePath);
      }
      await Promise.resolve(onSave(nextJob));
      setSaved(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'File could not be deleted.');
    }
  }`;

source = source.replace(
`  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`,
removeAttachmentBody,
);

source = source.replace(
`  function removeAttachment(attachmentId: string) {
    const nextJob = {
      ...draft,
      attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId),
    };

    setDraft(nextJob);
    setSaved(false);
    onSave(nextJob);
  }`,
removeAttachmentBody,
);

fs.writeFileSync(detailPath, source);
console.log('Job file delete uses direct bucket delete and saves immediately.');
