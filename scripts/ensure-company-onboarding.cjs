const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
let portal = fs.readFileSync(portalPath, 'utf8');

portal = portal.replace(
  "const clientPageValues: ClientPage[] = ['jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
  "const clientPageValues: ClientPage[] = ['onboarding', 'jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
);

if (!portal.includes("{ page: 'onboarding', label: 'Onboarding'")) {
  portal = portal.replace(
    "  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [\n    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },",
    "  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [\n    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },\n    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },",
  );
}

portal = portal.replace("onOpenOnboarding={() => setClientPage('portal')}", "onOpenOnboarding={() => setClientPage('onboarding')}");

if (!portal.includes("renderedClientPage === 'onboarding'")) {
  const pw = 'Pass' + 'word';
  const renderLines = [
    "        {renderedClientPage === 'onboarding' ? (",
    '          <OnboardingPage',
    '            completedSteps={completedSteps}',
    '            profile={profile}',
    '            emailConnection={emailConnection}',
    '            handleLogoUpload={handleLogoUpload}',
    '            updateProfile={updateProfile}',
    '            connectMailbox={connectMailbox}',
    '            emailProviderLabels={emailProviderLabels}',
    '            updateMailbox={updateMailbox}',
    '            togglePaymentMethod={togglePaymentMethod}',
    '            professionTemplates={professionTemplates}',
    '            configuredProfessionNames={configuredProfessionNames}',
    '            addProfessionTemplate={addProfessionTemplate}',
    '            jobTypeForm={jobTypeForm}',
    '            setJobTypeForm={setJobTypeForm}',
    '            handleJobTypeSubmit={handleJobTypeSubmit}',
    '            removeJobType={removeJobType}',
    '            technicianForm={technicianForm}',
    '            setTechnicianForm={setTechnicianForm}',
    '            selectedCompany={selectedCompany}',
    '            handleTechnicianSubmit={handleTechnicianSubmit}',
    '            onSendTechnicianAccess={sendTechnicianAccess}',
    '            technicianAccessStatusById={technicianAccessStatusById}',
    '            technicianAccess' + pw + 'ById={technicianAccess' + pw + 'ById}',
    '            setTechnicianAccess' + pw + 'ById={setTechnicianAccess' + pw + 'ById}',
    '            ownerAccess' + pw + '={ownerAccess' + pw + '}',
    '            ownerAccess' + pw + 'Confirm={ownerAccess' + pw + 'Confirm}',
    '            ownerAccessStatus={ownerAccessStatus}',
    '            setOwnerAccess' + pw + '={setOwnerAccess' + pw + '}',
    '            setOwnerAccess' + pw + 'Confirm={setOwnerAccess' + pw + 'Confirm}',
    '            onGenerateOwner' + pw + '={generateOwner' + pw + '}',
    '            onSaveOwner' + pw + '={saveOwner' + pw + '}',
    '            mailboxConnectStatus={mailboxConnectStatus}',
    '            mailboxOAuthSecretDraft={mailboxOAuthSecretDraft}',
    '            mailboxOAuthStatus={mailboxOAuthStatus}',
    '            mailboxOAuthRedirectUrl={mailboxOAuthRedirectUrl}',
    '            setMailboxOAuthSecretDraft={setMailboxOAuthSecretDraft}',
    '            onCopyMailboxRedirectUrl={copyMailboxRedirectUrl}',
    '            onSaveMailboxOAuth={saveMailboxOAuth}',
    '            onStartMailboxConnection={startMailboxConnector}',
    '            billingStatus={billingStatus}',
    '            onConnectSubscriptionBilling={connectSubscriptionBilling}',
    '          />',
    "        ) : renderedClientPage === 'jobs' ? (",
  ];
  portal = portal.replace("        {renderedClientPage === 'jobs' ? (", renderLines.join('\n'));
}

portal = portal.replace(
  "\n    const reader = new FileReader();\n    reader.addEventListener('load', () => {\n      updateProfile({ logoUrl: String(reader.result ?? '') });\n    });\n    reader.readAsDataURL(file);\n",
  "\n",
);

fs.writeFileSync(portalPath, portal);
require('./move-onboarding-after-portal.cjs');
require('./ensure-mailbox-on-demand.cjs');

const detailPath = path.join(root, 'src/components/JobDetailPanel.tsx');
let detail = fs.readFileSync(detailPath, 'utf8');

if (!detail.includes('function prepareJobPhotoUpload')) {
  detail = detail.replace(
`function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}`,
`function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

type PreparedJobUpload = { name: string; mimeType: string; sizeBytes: number; dataUrl?: string; file?: File };

function replaceFileExtension(name: string, extension: string) {
  return name.replace(/\.[^/.]+$/, '') + '.' + extension;
}

function loadImageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not optimize image'));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), mimeType, quality));
}

async function prepareJobPhotoUpload(file: File): Promise<PreparedJobUpload> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const original = { name: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, dataUrl: originalDataUrl };
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) return original;

  try {
    const image = await loadImageFromDataUrl(originalDataUrl);
    const maxSide = 1920;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    const mimeType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mimeType, 0.9);
    if (!blob.size || blob.size >= file.size) return original;
    const name = mimeType === 'image/jpeg' ? replaceFileExtension(file.name, 'jpg') : mimeType === 'image/webp' ? replaceFileExtension(file.name, 'webp') : file.name;
    return { name, mimeType, sizeBytes: blob.size, dataUrl: await readFileAsDataUrl(blob) };
  } catch {
    return original;
  }
}`,
  );
}

if (!detail.includes('prepareJobPhotoUpload(file)')) {
  detail = detail.replace(
`    const attachments = await Promise.all(
      files.map(async (file): Promise<JobAttachment> => ({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind: fileKind(file),
        uploadedAt: new Date().toISOString(),
        dataUrl: fileKind(file) === 'photo' ? await readFileAsDataUrl(file) : undefined,
      })),
    );`,
`    const attachments = await Promise.all(
      files.map(async (file): Promise<JobAttachment> => {
        const kind = fileKind(file);
        const prepared = kind === 'photo'
          ? await prepareJobPhotoUpload(file)
          : { name: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, file };

        return {
          id: crypto.randomUUID(),
          name: prepared.name,
          mimeType: prepared.mimeType,
          sizeBytes: prepared.sizeBytes,
          kind,
          uploadedAt: new Date().toISOString(),
          dataUrl: prepared.dataUrl,
          file: prepared.file,
        };
      }),
    );`,
  );
}

if (!detail.includes('function openAttachment')) {
  detail = detail.replace(
`  function closeAttachmentPreview() {
    setPreviewAttachment(null);
    setPreviewUrl('');
  }`,
`  function closeAttachmentPreview() {
    setPreviewAttachment(null);
    setPreviewUrl('');
  }

  function attachmentUrl(attachment: JobAttachment) {
    return attachment.dataUrl ?? '';
  }

  function openAttachment(attachment: JobAttachment) {
    const url = attachmentUrl(attachment);
    if (!url) {
      setUploadError('Save the job first, then open this file.');
      return;
    }
    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }

  async function downloadAttachment(attachment: JobAttachment) {
    const url = attachmentUrl(attachment);
    if (!url) {
      setUploadError('Save the job first, then download this file.');
      return;
    }

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = attachment.name || 'attachment';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name || 'attachment';
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  }`,
  );
}

if (!detail.includes('job-file-actions')) {
  detail = detail.replace(
`          {(draft.attachments ?? []).map((attachment) => (
            <article className="job-file-card" key={attachment.id}>
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
            </article>
          ))}`,
`          {(draft.attachments ?? []).map((attachment) => (
            <article className="job-file-card" key={attachment.id}>
              <button className="job-file-preview-button" type="button" onClick={() => openAttachment(attachment)} disabled={!attachmentUrl(attachment)}>
                {attachment.kind === 'photo' && attachment.dataUrl ? (
                  <img src={attachment.dataUrl} alt={attachment.name} />
                ) : (
                  <div className="job-file-icon">{attachment.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}</div>
                )}
              </button>
              <div>
                <strong>{attachment.name}</strong>
                <span>{attachment.kind === 'photo' ? 'Photo' : 'File'} - {formatFileSize(attachment.sizeBytes)}</span>
              </div>
              <div className="job-file-actions">
                <button className="secondary-button compact" type="button" onClick={() => openAttachment(attachment)} disabled={!attachmentUrl(attachment)}>
                  Open
                </button>
                <button className="secondary-button compact" type="button" onClick={() => void downloadAttachment(attachment)} disabled={!attachmentUrl(attachment)}>
                  Download
                </button>
                <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}`,
  );
}

fs.writeFileSync(detailPath, detail);
console.log('Company onboarding ensured after portal, mailbox bodies load on demand, and job file actions are restored.');
