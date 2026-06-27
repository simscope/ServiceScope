const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const panelFile = path.join(root, 'src/components/JobDetailPanel.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

let content = fs.readFileSync(panelFile, 'utf8');

if (!content.includes('function sanitizeAttachmentDownloadName')) {
  content = content.replace(
    `function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
`,
    `function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function sanitizeAttachmentDownloadName(name: string) {
  const cleanName = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cleanName || 'job-attachment';
}
`,
  );
}

if (!content.includes('selectedAttachmentIds')) {
  content = content.replace(
    "  const [previewUrl, setPreviewUrl] = useState('');",
    "  const [previewUrl, setPreviewUrl] = useState('');\n  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);",
  );
  content = content.replace(
    "  const [uploadError, setUploadError] = useState('');",
    "  const [uploadError, setUploadError] = useState('');\n  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);",
  );
}

content = content.replace(
  `    setSelectedInvoiceIds([]);
    setSaved(false);`,
  `    setSelectedInvoiceIds([]);
    setSelectedAttachmentIds([]);
    setSaved(false);`,
);

if (!content.includes('const selectedAttachments =')) {
  content = content.replace(
    "  const allInvoicesSelected = invoices.length > 0 && selectedInvoiceIds.length === invoices.length;",
    "  const allInvoicesSelected = invoices.length > 0 && selectedInvoiceIds.length === invoices.length;\n  const attachments = draft.attachments ?? [];\n  const selectedAttachments = attachments.filter((attachment) => selectedAttachmentIds.includes(attachment.id));\n  const allAttachmentsSelected = attachments.length > 0 && selectedAttachments.length === attachments.length;",
  );
}

if (!content.includes('async function downloadSelectedAttachments')) {
  const marker = `  function openAttachmentPreview(attachment: JobAttachment) {
    const url = attachmentPreviewUrl(attachment);
    if (!url) {
      setUploadError('File preview is not available. Save the job and reload attachments.');
      return;
    }

    setUploadError('');
    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }
`;
  const replacement = `${marker}
  function toggleAttachmentSelection(attachmentId: string, checked: boolean) {
    setSelectedAttachmentIds((ids) => (checked ? Array.from(new Set([...ids, attachmentId])) : ids.filter((id) => id !== attachmentId)));
  }

  function toggleAllAttachments(checked: boolean) {
    setSelectedAttachmentIds(checked ? attachments.map((attachment) => attachment.id) : []);
  }

  async function downloadAttachment(attachment: JobAttachment) {
    const sourceUrl = attachmentPreviewUrl(attachment);
    if (!sourceUrl) {
      throw new Error(`${attachment.name}: file is not available for download yet.`);
    }

    const blob = attachment.file ?? await fetch(sourceUrl).then((response) => {
      if (!response.ok) throw new Error(`${attachment.name}: download failed.`);
      return response.blob();
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = sanitizeAttachmentDownloadName(attachment.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  async function downloadSelectedAttachments() {
    if (!selectedAttachments.length) return;
    setUploadError('');

    try {
      for (const attachment of selectedAttachments) {
        await downloadAttachment(attachment);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Selected files could not be downloaded.');
    }
  }
`;
  content = content.replace(marker, replacement);
}

content = content.replace(
  `  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`,
  `  function removeAttachment(attachmentId: string) {
    setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }`,
);

const baseHeader = `        {uploadError ? <p className="file-upload-error">{uploadError}</p> : null}
        <div className="job-files-grid">`;
const headerReplacement = `        {uploadError ? <p className="file-upload-error">{uploadError}</p> : null}
        {attachments.length ? (
          <div className="job-files-download-toolbar">
            <label>
              <input type="checkbox" checked={allAttachmentsSelected} onChange={(event) => toggleAllAttachments(event.target.checked)} />
              Select all files
            </label>
            <span>{selectedAttachments.length} selected</span>
            <button className="secondary-button compact" type="button" onClick={downloadSelectedAttachments} disabled={!selectedAttachments.length}>
              Download selected
            </button>
            <button className="secondary-button compact" type="button" onClick={() => setSelectedAttachmentIds([])} disabled={!selectedAttachments.length}>
              Clear
            </button>
          </div>
        ) : null}
        <div className="job-files-grid">`;
if (!content.includes('job-files-download-toolbar')) {
  content = content.replace(baseHeader, headerReplacement);
}

// Patch the card after the preview patch has converted the original card.
content = content.replace(
  `            <article className="job-file-card" key={attachment.id}>
              <button className="job-file-preview-button" type="button" onClick={() => openAttachmentPreview(attachment)}>` ,
  `            <article className={\`job-file-card ${selectedAttachmentIds.includes(attachment.id) ? 'selected' : ''}\`} key={attachment.id}>
              <label className="job-file-select" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedAttachmentIds.includes(attachment.id)} onChange={(event) => toggleAttachmentSelection(attachment.id, event.target.checked)} />
                Select
              </label>
              <button className="job-file-preview-button" type="button" onClick={() => openAttachmentPreview(attachment)}>`
);
content = content.replace(
  `                <button className="secondary-button compact" type="button" onClick={() => openAttachmentPreview(attachment)}>
                  Open
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>` ,
  `                <button className="secondary-button compact" type="button" onClick={() => openAttachmentPreview(attachment)}>
                  Open
                </button>
                <button className="secondary-button compact" type="button" onClick={() => downloadAttachment(attachment)}>
                  Download
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>`
);

// Fallback for the original unpatched card if preview patch target changed.
content = content.replace(
  `            <article className="job-file-card" key={attachment.id}>
              {attachment.kind === 'photo' && attachment.dataUrl ? (`,
  `            <article className={\`job-file-card ${selectedAttachmentIds.includes(attachment.id) ? 'selected' : ''}\`} key={attachment.id}>
              <label className="job-file-select" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedAttachmentIds.includes(attachment.id)} onChange={(event) => toggleAttachmentSelection(attachment.id, event.target.checked)} />
                Select
              </label>
              {attachment.kind === 'photo' && attachment.dataUrl ? (`,
);
content = content.replace(
  `              <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                Remove
              </button>`,
  `              <div className="job-file-actions">
                <button className="secondary-button compact" type="button" onClick={() => downloadAttachment(attachment)}>
                  Download
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                  Remove
                </button>
              </div>`,
);

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('Job attachment selectable downloads')) {
  css += `

/* Job attachment selectable downloads */
.job-files-download-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 12px;
  border: 1px solid #dce4dd;
  border-radius: 10px;
  background: #fbfdfb;
  padding: 10px;
}

.job-files-download-toolbar label,
.job-file-select {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #17201b;
  font-size: 12px;
  font-weight: 900;
}

.job-files-download-toolbar span {
  color: #526157;
  font-size: 12px;
  font-weight: 800;
}

.job-file-card {
  position: relative;
}

.job-file-card.selected {
  border-color: #60a5fa;
  background: #f8fbff;
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.1);
}

.job-file-select {
  align-self: start;
  justify-self: start;
  border-radius: 999px;
  background: #eef6ff;
  color: #1e3a8a;
  padding: 5px 8px;
}

.job-file-select input,
.job-files-download-toolbar input {
  width: 16px;
  height: 16px;
  margin: 0;
}
`;
  fs.writeFileSync(cssFile, css);
}

fs.writeFileSync(panelFile, content);
console.log('Job attachment selectable download patch applied.');
