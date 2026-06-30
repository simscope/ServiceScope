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
console.log('Job file delete saves immediately.');
