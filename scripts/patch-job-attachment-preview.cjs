const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const panelFile = path.join(root, 'src/components/JobDetailPanel.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

let content = fs.readFileSync(panelFile, 'utf8');

if (!content.includes('previewAttachment')) {
  content = content.replace(
    "  const [uploadError, setUploadError] = useState('');",
    "  const [uploadError, setUploadError] = useState('');\n  const [previewAttachment, setPreviewAttachment] = useState<JobAttachment | null>(null);\n  const [previewUrl, setPreviewUrl] = useState('');",
  );
}

if (!content.includes('function openAttachmentPreview')) {
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

  function closeAttachmentPreview() {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewAttachment(null);
    setPreviewUrl('');
  }

  function openAttachmentPreview(attachment: JobAttachment) {
    const url = attachmentPreviewUrl(attachment);
    if (!url) {
      setUploadError('File preview is not available. Save the job and reload attachments.');
      return;
    }

    setUploadError('');
    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }
`,
  );
}

// Replace older popup preview function if it was inserted by a previous build.
content = content.replace(
  /  function attachmentPreviewUrl\(attachment: JobAttachment\) \{\n    if \(attachment\.file\) return URL\.createObjectURL\(attachment\.file\);\n    return attachment\.dataUrl \|\| '';\n  \}\n\n  function openAttachmentInBrowser\(attachment: JobAttachment\) \{[\s\S]*?  \}\n/,
  `  function attachmentPreviewUrl(attachment: JobAttachment) {
    if (attachment.file) return URL.createObjectURL(attachment.file);
    return attachment.dataUrl || '';
  }

  function closeAttachmentPreview() {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewAttachment(null);
    setPreviewUrl('');
  }

  function openAttachmentPreview(attachment: JobAttachment) {
    const url = attachmentPreviewUrl(attachment);
    if (!url) {
      setUploadError('File preview is not available. Save the job and reload attachments.');
      return;
    }

    setUploadError('');
    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }
`,
);

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
              <button className="job-file-preview-button" type="button" onClick={() => openAttachmentPreview(attachment)}>
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
                <button className="secondary-button compact" type="button" onClick={() => openAttachmentPreview(attachment)}>
                  Open
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                  Remove
                </button>
              </div>
            </article>`;
content = content.replace(oldCard, newCard);
content = content.replaceAll('openAttachmentInBrowser(attachment)', 'openAttachmentPreview(attachment)');

if (!content.includes('job-attachment-preview-modal')) {
  content = content.replace(
    `      {invoiceEditorOpen ? (`,
    `      {previewAttachment && previewUrl ? (
        <div className="email-message-modal-backdrop" role="dialog" aria-modal="true" onClick={closeAttachmentPreview}>
          <section className="email-message-modal job-attachment-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="email-message-modal-toolbar">
              <div>
                <p className="eyebrow">Attachment preview</p>
                <h2>{previewAttachment.name}</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={closeAttachmentPreview}>Close</button>
            </div>
            {previewAttachment.kind === 'photo' ? (
              <img className="job-attachment-preview-image" src={previewUrl} alt={previewAttachment.name} />
            ) : (
              <iframe className="job-attachment-preview-frame" src={previewUrl} title={previewAttachment.name} />
            )}
          </section>
        </div>
      ) : null}

      {invoiceEditorOpen ? (`,
  );
}

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

.job-attachment-preview-modal {
  width: min(1100px, 96vw);
  max-height: 92vh;
}

.job-attachment-preview-image {
  display: block;
  width: 100%;
  max-height: 76vh;
  object-fit: contain;
  border-radius: 12px;
  background: #0f172a;
}

.job-attachment-preview-frame {
  width: 100%;
  height: 76vh;
  border: 1px solid #dbe5de;
  border-radius: 12px;
  background: #ffffff;
}
`;
  fs.writeFileSync(cssFile, css);
}

console.log('Job attachment in-page preview patch applied.');
