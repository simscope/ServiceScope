const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const panelFile = path.join(root, 'src/components/JobDetailPanel.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');
let content = fs.readFileSync(panelFile, 'utf8');

if (!content.includes('function sanitizeAttachmentDownloadName')) {
  content = content.replace(
    "function readFileAsDataUrl(file: File) {\n  return new Promise<string>((resolve, reject) => {\n    const reader = new FileReader();\n    reader.onload = () => resolve(String(reader.result ?? ''));\n    reader.onerror = () => reject(new Error('Could not read file'));\n    reader.readAsDataURL(file);\n  });\n}\n",
    "function readFileAsDataUrl(file: File) {\n  return new Promise<string>((resolve, reject) => {\n    const reader = new FileReader();\n    reader.onload = () => resolve(String(reader.result ?? ''));\n    reader.onerror = () => reject(new Error('Could not read file'));\n    reader.readAsDataURL(file);\n  });\n}\n\nfunction sanitizeAttachmentDownloadName(name: string) {\n  const cleanName = name.trim().replace(/[^a-zA-Z0-9._ -]+/g, '-');\n  return cleanName || 'job-attachment';\n}\n"
  );
}

if (!content.includes('selectedAttachmentIds')) {
  if (content.includes("  const [previewUrl, setPreviewUrl] = useState('');")) {
    content = content.replace("  const [previewUrl, setPreviewUrl] = useState('');", "  const [previewUrl, setPreviewUrl] = useState('');\n  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);");
  } else {
    content = content.replace("  const [uploadError, setUploadError] = useState('');", "  const [uploadError, setUploadError] = useState('');\n  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);");
  }
}

content = content.replace("  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);\n  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);", "  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);");
content = content.replace("    setSelectedInvoiceIds([]);\n    setSaved(false);", "    setSelectedInvoiceIds([]);\n    setSelectedAttachmentIds([]);\n    setSaved(false);");

if (!content.includes('const selectedAttachments =')) {
  content = content.replace(
    "  const allInvoicesSelected = invoices.length > 0 && selectedInvoiceIds.length === invoices.length;",
    "  const allInvoicesSelected = invoices.length > 0 && selectedInvoiceIds.length === invoices.length;\n  const attachments = draft.attachments ?? [];\n  const selectedAttachments = attachments.filter((attachment) => selectedAttachmentIds.includes(attachment.id));\n  const allAttachmentsSelected = attachments.length > 0 && selectedAttachments.length === attachments.length;"
  );
}

if (!content.includes('async function downloadSelectedAttachments')) {
  const marker = "  function openAttachmentPreview(attachment: JobAttachment) {\n    const url = attachmentPreviewUrl(attachment);\n    if (!url) {\n      setUploadError('File preview is not available. Save the job and reload attachments.');\n      return;\n    }\n\n    setUploadError('');\n    setPreviewAttachment(attachment);\n    setPreviewUrl(url);\n  }\n";
  const helper = marker + "\n  function toggleAttachmentSelection(attachmentId: string, checked: boolean) {\n    setSelectedAttachmentIds((ids) => (checked ? Array.from(new Set([...ids, attachmentId])) : ids.filter((id) => id !== attachmentId)));\n  }\n\n  function toggleAllAttachments(checked: boolean) {\n    setSelectedAttachmentIds(checked ? attachments.map((attachment) => attachment.id) : []);\n  }\n\n  async function downloadAttachment(attachment: JobAttachment) {\n    const sourceUrl = attachmentPreviewUrl(attachment);\n    if (!sourceUrl) throw new Error(attachment.name + ': file is not available for download yet.');\n    const blob = attachment.file ?? await fetch(sourceUrl).then((response) => {\n      if (!response.ok) throw new Error(attachment.name + ': download failed.');\n      return response.blob();\n    });\n    const objectUrl = URL.createObjectURL(blob);\n    const anchor = document.createElement('a');\n    anchor.href = objectUrl;\n    anchor.download = sanitizeAttachmentDownloadName(attachment.name);\n    document.body.appendChild(anchor);\n    anchor.click();\n    anchor.remove();\n    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);\n  }\n\n  async function downloadSelectedAttachments() {\n    if (!selectedAttachments.length) return;\n    setUploadError('');\n    try {\n      for (const attachment of selectedAttachments) {\n        await downloadAttachment(attachment);\n        await new Promise((resolve) => window.setTimeout(resolve, 250));\n      }\n    } catch (error) {\n      setUploadError(error instanceof Error ? error.message : 'Selected files could not be downloaded.');\n    }\n  }\n";
  content = content.replace(marker, helper);
}

content = content.replace("  function removeAttachment(attachmentId: string) {\n    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });\n  }", "  function removeAttachment(attachmentId: string) {\n    setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));\n    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });\n  }");

if (!content.includes('job-files-download-toolbar')) {
  content = content.replace("        {uploadError ? <p className=\"file-upload-error\">{uploadError}</p> : null}\n        <div className=\"job-files-grid\">", "        {uploadError ? <p className=\"file-upload-error\">{uploadError}</p> : null}\n        {attachments.length ? (\n          <div className=\"job-files-download-toolbar\">\n            <label>\n              <input type=\"checkbox\" checked={allAttachmentsSelected} onChange={(event) => toggleAllAttachments(event.target.checked)} />\n              Select all files\n            </label>\n            <span>{selectedAttachments.length} selected</span>\n            <button className=\"secondary-button compact\" type=\"button\" onClick={downloadSelectedAttachments} disabled={!selectedAttachments.length}>\n              Download selected\n            </button>\n            <button className=\"secondary-button compact\" type=\"button\" onClick={() => setSelectedAttachmentIds([])} disabled={!selectedAttachments.length}>\n              Clear\n            </button>\n          </div>\n        ) : null}\n        <div className=\"job-files-grid\">");
}

content = content.replace("            <article className=\"job-file-card\" key={attachment.id}>\n              <button className=\"job-file-preview-button\" type=\"button\" onClick={() => openAttachmentPreview(attachment)}>", "            <article className={'job-file-card ' + (selectedAttachmentIds.includes(attachment.id) ? 'selected' : '')} key={attachment.id}>\n              <label className=\"job-file-select\" onClick={(event) => event.stopPropagation()}>\n                <input type=\"checkbox\" checked={selectedAttachmentIds.includes(attachment.id)} onChange={(event) => toggleAttachmentSelection(attachment.id, event.target.checked)} />\n                Select\n              </label>\n              <button className=\"job-file-preview-button\" type=\"button\" onClick={() => openAttachmentPreview(attachment)}>");

content = content.replace("                <button className=\"secondary-button compact\" type=\"button\" onClick={() => openAttachmentPreview(attachment)}>\n                  Open\n                </button>\n                <button className=\"secondary-button compact\" type=\"button\" onClick={() => removeAttachment(attachment.id)}>", "                <button className=\"secondary-button compact\" type=\"button\" onClick={() => openAttachmentPreview(attachment)}>\n                  Open\n                </button>\n                <button className=\"secondary-button compact\" type=\"button\" onClick={() => downloadAttachment(attachment)}>\n                  Download\n                </button>\n                <button className=\"secondary-button compact\" type=\"button\" onClick={() => removeAttachment(attachment.id)}>");

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('Job attachment selectable downloads')) {
  css += "\n\n/* Job attachment selectable downloads */\n.job-files-download-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:10px 0 12px;border:1px solid #dce4dd;border-radius:10px;background:#fbfdfb;padding:10px}.job-files-download-toolbar label,.job-file-select{display:inline-flex;align-items:center;gap:7px;color:#17201b;font-size:12px;font-weight:900}.job-files-download-toolbar span{color:#526157;font-size:12px;font-weight:800}.job-file-card{position:relative}.job-file-card.selected{border-color:#60a5fa;background:#f8fbff;box-shadow:0 8px 22px rgba(37,99,235,.1)}.job-file-select{align-self:start;justify-self:start;border-radius:999px;background:#eef6ff;color:#1e3a8a;padding:5px 8px}.job-file-select input,.job-files-download-toolbar input{width:16px;height:16px;margin:0}\n";
  fs.writeFileSync(cssFile, css);
}

fs.writeFileSync(panelFile, content);
console.log('Job attachment selectable download patch applied.');
