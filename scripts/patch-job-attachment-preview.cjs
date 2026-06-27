const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const panelFile = path.join(root, 'src/components/JobDetailPanel.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

let content = fs.readFileSync(panelFile, 'utf8');

if (!content.includes('function openAttachmentInBrowser')) {
  content = content.replace(
    `  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }
`,
    `  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }

  function attachmentPreviewUrl(attachment: JobAttachment) {
    if (attachment.file) return URL.createObjectURL(attachment.file);
    return attachment.dataUrl || '';
  }

  function openAttachmentInBrowser(attachment: JobAttachment) {
    const url = attachmentPreviewUrl(attachment);
    if (!url) {
      setUploadError('File preview is not available. Save the job and reload attachments.');
      return;
    }

    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!previewWindow) {
      setUploadError('Browser blocked the preview window. Allow popups for this site.');
      return;
    }

    if (attachment.file) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
`,
  );
}

const oldCard = `            <article className="job-file-card" key={attachment.id}>
              {attachment.kind === 'photo' && attachment.dataUrl ? (
                <img src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <div className="job-file-icon">PDF</div>
              )}
              <div>
                <strong>{attachment.name}</strong>
                <span>{attachment.kind === 'photo' ? 'Photo' : 'File'} - {formatFileSize(attachment.sizeBytes)}</span>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                Remove
              </button>
            </article>`;
const newCard = `            <article className="job-file-card" key={attachment.id}>
              <button className="job-file-preview-button" type="button" onClick={() => openAttachmentInBrowser(attachment)}>
                {attachment.kind === 'photo' && attachment.dataUrl ? (
                  <img src={attachment.dataUrl} alt={attachment.name} />
                ) : (
                  <div className="job-file-icon">{attachment.mimeType === 'application/pdf' || /\\.pdf$/i.test(attachment.name) ? 'PDF' : 'FILE'}</div>
                )}
              </button>
              <div>
                <strong>{attachment.name}</strong>
                <span>{attachment.kind === 'photo' ? 'Photo' : 'File'} - {formatFileSize(attachment.sizeBytes)}</span>
              </div>
              <div className="job-file-actions">
                <button className="secondary-button compact" type="button" onClick={() => openAttachmentInBrowser(attachment)}>
                  Open
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                  Remove
                </button>
              </div>
            </article>`;
content = content.replace(oldCard, newCard);
fs.writeFileSync(panelFile, content);

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('Job attachment browser preview')) {
  css += `

/* Job attachment browser preview */
.job-file-preview-button {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: inherit;
}

.job-file-preview-button img,
.job-file-preview-button .job-file-icon {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.job-file-preview-button:hover img,
.job-file-preview-button:hover .job-file-icon {
  transform: scale(1.015);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
}

.job-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
`;
  fs.writeFileSync(cssFile, css);
}

console.log('Job attachment browser preview patch applied.');
