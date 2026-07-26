import { readFile } from 'node:fs/promises';
import {
  buildAssistantChannelDrafts,
  buildAssistantExportText,
  buildAssistantJobContext,
  buildAssistantJobSummary,
  generateDeterministicAssistantDescription,
  hydrateAssistantDraftTexts,
  regenerateAssistantChannelDraft,
  scrubAssistantText,
} from '../.tmp/ai-assistant-tests/features/ai-assistant/assistantModel.js';
import {
  attachmentUrl,
  downloadJobAttachments,
} from '../.tmp/ai-assistant-tests/features/job-attachments/jobAttachmentFiles.js';

const assert = {
  equal(actual, expected, message = `Expected ${String(actual)} to equal ${String(expected)}`) {
    if (actual !== expected) throw new Error(message);
  },
  notEqual(actual, expected, message = `Expected ${String(actual)} not to equal ${String(expected)}`) {
    if (actual === expected) throw new Error(message);
  },
  match(value, pattern, message = `Expected value to match ${pattern}`) {
    if (!pattern.test(value)) throw new Error(message);
  },
  doesNotMatch(value, pattern, message = `Expected value not to match ${pattern}`) {
    if (pattern.test(value)) throw new Error(message);
  },
  ok(value, message = 'Expected value to be truthy') {
    if (!value) throw new Error(message);
  },
};

const [
  appTypes,
  navigationHook,
  clientNavigation,
  renderer,
  businessRenderer,
  jobDetailPanel,
  assistantModel,
  assistantPage,
  styles,
] = await Promise.all([
  readFile('src/appTypes.ts', 'utf8'),
  readFile('src/features/navigation/useClientPageFeature.ts', 'utf8'),
  readFile('src/features/navigation/clientNavigation.tsx', 'utf8'),
  readFile('src/components/portal/ClientPageRenderer.tsx', 'utf8'),
  readFile('src/components/portal/ClientBusinessPageRenderer.tsx', 'utf8'),
  readFile('src/components/JobDetailPanel.tsx', 'utf8'),
  readFile('src/features/ai-assistant/assistantModel.ts', 'utf8'),
  readFile('src/components/portal/AiAssistantPage.tsx', 'utf8'),
  readFile('src/styles/base.css', 'utf8'),
]);
const attachmentHelper = await readFile('src/features/job-attachments/jobAttachmentFiles.ts', 'utf8');

assert.match(appTypes, /'aiAssistant'/);
assert.match(navigationHook, /'aiAssistant'/);
assert.match(navigationHook, /\/ai-assistant/);
assert.match(clientNavigation, /label: 'AI Assistant'/);
assert.match(renderer, /'aiAssistant'/);
assert.match(businessRenderer, /renderedClientPage === 'aiAssistant'/);
assert.match(businessRenderer, /job\.id === aiAssistantJobId/);
assert.match(businessRenderer, /materials=\{materials\}/);
assert.doesNotMatch(assistantPage, /summary\.jobNumber/);
assert.doesNotMatch(assistantPage, /<span>Job<\/span>/);
assert.doesNotMatch(assistantPage, /localStorage/);

assert.match(jobDetailPanel, /Open in AI Assistant/);
assert.match(jobDetailPanel, /canOpenJobInAiAssistant\(draft\.status\)/);
assert.doesNotMatch(jobDetailPanel, /Create social post/);
assert.doesNotMatch(jobDetailPanel, /socialPost(Open|Draft|Status)/);
assert.doesNotMatch(styles, /social-post/);

assert.match(assistantModel, /AI_ASSISTANT_SUPPORTED_STATUSES[^]*'Completed'[^]*'Warranty'/);
assert.match(assistantModel, /export function scrubPrivateJobValues/);
assert.match(assistantModel, /export function assistantPhotoAttachments/);
assert.match(assistantModel, /export function buildAssistantJobContext/);
assert.match(assistantModel, /export function buildAssistantChannelDrafts/);
assert.match(assistantModel, /export function buildAssistantExportText/);
assert.match(assistantModel, /export function hydrateAssistantDraftTexts/);
assert.match(assistantModel, /export function regenerateAssistantChannelDraft/);
assert.match(assistantModel, /'Technician-entered fact'/);
assert.match(assistantModel, /'Installed material'/);
assert.match(assistantModel, /'Attachment metadata'/);
assert.match(assistantModel, /Instagram/);
assert.match(assistantModel, /Facebook/);
assert.match(assistantModel, /LinkedIn/);
assert.match(assistantModel, /Google Business/);
assert.match(assistantModel, /Blog \/ Case Study/);
assert.match(assistantModel, /Short Video/);
assert.match(assistantModel, /Diagnosis missing/);
assert.match(assistantModel, /Repair performed missing/);
assert.match(assistantModel, /Final result missing/);
assert.match(assistantPage, /Download selected media/);
assert.match(assistantPage, /Copy all selected/);
assert.match(assistantPage, /Regenerate draft/);
assert.match(assistantPage, /navigator\.clipboard/);
assert.match(assistantPage, /execCommand\('copy'\)/);
assert.match(jobDetailPanel, /downloadJobAttachment/);
assert.match(assistantPage, /downloadJobAttachments/);
assert.match(attachmentHelper, /export function attachmentUrl/);
assert.match(attachmentHelper, /export async function downloadJobAttachments/);

const urlSensitivePatterns = [
  /searchParams\.set\([^)]*(clientName|organization|phone|email|address|jobNumber)/,
  /location\.hash[^;]*(clientName|organization|phone|email|address|jobNumber)/,
  /setClientPage\('aiAssistant'[^)]*(clientName|organization|phone|email|address|jobNumber)/,
];

for (const pattern of urlSensitivePatterns) {
  assert.doesNotMatch(navigationHook + businessRenderer + jobDetailPanel, pattern);
}

const privateJob = {
  id: 'job-internal-72',
  companyId: 'company-72',
  jobNumber: 'JOB-PRIVATE-72',
  status: 'Completed',
  system: 'Walk-in cooler',
  issue: 'JOB-PRIVATE-72 compressor concern for Jane Customer at Sample Bistro, 123 Market Street. Call 555-0100 or jane@example.com.',
  notes: 'Private gate code 2468. Do not publish.',
  clientName: 'Jane Customer',
  organization: 'Sample Bistro',
  phone: '555-0100',
  email: 'jane@example.com',
  address: '123 Market Street',
  technician: 'No technician',
  assignee: 'No technician',
  serviceCallFee: '95',
  scfPayment: 'Paid cash',
  labor: '210',
  laborPayment: 'Paid card',
  attachments: [
    { id: 'photo-1', name: 'overview.jpg', mimeType: 'image/jpeg', sizeBytes: 100, kind: 'photo', uploadedAt: '2026-07-26T00:00:00Z', dataUrl: 'data:image/jpeg;base64,AA==' },
    { id: 'video-1', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 200, kind: 'file', uploadedAt: '2026-07-26T00:01:00Z', dataUrl: 'data:video/mp4;base64,AA==' },
  ],
  comments: [{ id: 'comment-1', authorName: 'Manager', authorRole: 'Manager', message: 'Internal comment says evaporator was iced.', createdAt: '2026-07-26T00:00:00Z' }],
  invoices: [{ id: 'invoice-1', companyId: 'company-72', jobId: 'job-internal-72', invoiceNumber: 'INV-SECRET-72', documentType: 'invoice', status: 'Paid', amount: 305, createdAt: '2026-07-26T00:00:00Z' }],
  createdAt: '2026-07-26T00:00:00Z',
};

const materials = [
  { id: 'mat-1', jobNumber: 'JOB-PRIVATE-72', name: 'Door gasket', quantity: 1, price: 42, supplier: 'Parts House', status: 'Installed' },
  { id: 'mat-2', jobNumber: 'JOB-PRIVATE-72', name: 'Uninstalled relay', quantity: 1, price: 12, supplier: 'Parts House', status: 'Ordered' },
];

const safeSummary = buildAssistantJobSummary(privateJob);
const safeDescription = generateDeterministicAssistantDescription(privateJob);
const combinedAssistantText = [safeSummary.system, safeSummary.description, safeDescription].join('\n');

assert.equal('jobNumber' in safeSummary, false);
for (const privateValue of ['JOB-PRIVATE-72', 'Jane Customer', 'Sample Bistro', '555-0100', 'jane@example.com', '123 Market Street']) {
  assert.doesNotMatch(combinedAssistantText, new RegExp(escapeRegExp(privateValue)));
}

const baseContext = buildAssistantJobContext(privateJob, materials);
assert.equal(baseContext.jobId, 'job-internal-72');
assert.equal(baseContext.publicSafe.systemEquipment.text, 'Walk-in cooler');
assert.match(baseContext.publicSafe.complaint.text, /\[private\]/);
assert.equal(baseContext.publicSafe.diagnosis, undefined);
assert.equal(baseContext.publicSafe.repairPerformed, undefined);
assert.equal(baseContext.publicSafe.finalResult, undefined);
assert.equal(baseContext.publicSafe.installedMaterials.length, 1);
assert.equal(baseContext.publicSafe.installedMaterials[0].text, 'Door gasket');
assert.equal(baseContext.publicSafe.media.length, 2);
assert.match(baseContext.missingInformation.join('|'), /Diagnosis missing/);
assert.match(baseContext.missingInformation.join('|'), /Repair performed missing/);
assert.match(baseContext.missingInformation.join('|'), /Final result missing/);
assert.doesNotMatch(JSON.stringify(baseContext.publicSafe), /Jane Customer|Sample Bistro|555-0100|jane@example\.com|123 Market Street|JOB-PRIVATE-72|INV-SECRET-72|305|Private gate code|Internal comment/);

const localContext = buildAssistantJobContext(
  privateJob,
  materials,
  {
    diagnosis: 'Technician confirmed low airflow after inspection at Sample Bistro.',
    repairPerformed: 'Replaced the confirmed door gasket.',
    finalResult: 'Temperature pull-down verified by technician.',
  },
  [
    { id: 'video-1', selected: true, order: 0, label: 'Result' },
    { id: 'photo-1', selected: true, order: 1, label: 'Overview' },
  ],
);
assert.equal(localContext.publicSafe.diagnosis.text, 'Technician confirmed low airflow after inspection at [private].');
assert.equal(localContext.publicSafe.repairPerformed.source, 'Technician-entered fact');
assert.equal(localContext.publicSafe.media[0].id, 'video-1');
assert.equal(localContext.publicSafe.media[0].label, 'Result');
assert.equal(localContext.missingInformation.length, 0);

const drafts = buildAssistantChannelDrafts(localContext);
const instagram = drafts.find((draft) => draft.channel === 'Instagram');
const facebook = drafts.find((draft) => draft.channel === 'Facebook');
const linkedIn = drafts.find((draft) => draft.channel === 'LinkedIn');
const google = drafts.find((draft) => draft.channel === 'Google Business');
const blog = drafts.find((draft) => draft.channel === 'Blog / Case Study');
const video = drafts.find((draft) => draft.channel === 'Short Video');

for (const draft of drafts) {
  assert.ok(draft.body.trim(), `${draft.channel} draft should have content`);
  assert.ok(draft.claims.length, `${draft.channel} draft should expose evidence`);
  assert.ok(draft.claims.every((claim) => ['Job issue', 'Technician-entered fact', 'Installed material', 'Attachment metadata'].includes(claim.source)));
  assert.doesNotMatch(draft.body, /Jane Customer|Sample Bistro|555-0100|jane@example\.com|123 Market Street|JOB-PRIVATE-72|INV-SECRET-72|305|Private gate code|Internal comment/);
}

assert.notEqual(instagram.body, facebook.body);
assert.notEqual(facebook.body, linkedIn.body);
assert.notEqual(linkedIn.body, google.body);
assert.match(instagram.body, /Hook:/);
assert.match(instagram.body, /Hashtags:/);
assert.match(facebook.body, /Service story:/);
assert.match(linkedIn.body, /Technical service update:/);
assert.doesNotMatch(google.body, /Market Street|Sample Bistro/);
assert.match(blog.body, /Problem\n/);
assert.match(blog.body, /Findings\n/);
assert.match(blog.body, /Work\n/);
assert.match(blog.body, /Result\n/);
assert.match(video.body, /Scene 1:/);
assert.match(video.body, /Scene 2:/);
assert.match(video.body, /Scene 3:/);

const noLocalDrafts = buildAssistantChannelDrafts(baseContext);
const noLocalText = noLocalDrafts.map((draft) => draft.body).join('\n');
assert.doesNotMatch(noLocalText, /Finding:|Findings\n|Repair performed|Verification\/result|Temperature pull-down|low airflow|Replaced/);
assert.doesNotMatch(noLocalText, /Uninstalled relay/);

const repeatContext = buildAssistantJobContext(
  privateJob,
  materials,
  {
    diagnosis: 'Technician confirmed low airflow after inspection at Sample Bistro.',
    repairPerformed: 'Replaced the confirmed door gasket.',
    finalResult: 'Temperature pull-down verified by technician.',
  },
  [
    { id: 'video-1', selected: true, order: 0, label: 'Result' },
    { id: 'photo-1', selected: true, order: 1, label: 'Overview' },
  ],
);
const repeatDrafts = buildAssistantChannelDrafts(repeatContext);
assert.equal(JSON.stringify(repeatDrafts), JSON.stringify(drafts), 'Generation should be deterministic for identical context');

const exportText = buildAssistantExportText(drafts, localContext);
assert.doesNotMatch(exportText, /Jane Customer|Sample Bistro|555-0100|jane@example\.com|123 Market Street|JOB-PRIVATE-72|INV-SECRET-72|305/);
assert.equal(scrubAssistantText('Call 555-0100 at Sample Bistro for INV-SECRET-72', localContext), 'Call [private] at [private] for [private]');
assert.equal(
  scrubAssistantText('JANE CUSTOMER used JANE@EXAMPLE.COM near 123 MARKET STREET', localContext),
  '[private] used [private] near [private]',
);
assert.equal(repeatContext.publicSafe.media[0].id, 'video-1');

const initialDraftTexts = hydrateAssistantDraftTexts(drafts, {});
assert.equal(initialDraftTexts.Instagram, instagram.body);
let editedDraftTexts = {
  ...initialDraftTexts,
  Instagram: 'Manual Instagram edit with Jane Customer and JANE@EXAMPLE.COM.',
  Facebook: 'Manual Facebook edit stays exactly here.',
};
const reorderedContext = buildAssistantJobContext(privateJob, materials, {
  diagnosis: 'Technician confirmed low airflow after inspection at Sample Bistro.',
  repairPerformed: 'Replaced the confirmed door gasket.',
  finalResult: 'Temperature pull-down verified by technician.',
}, [
  { id: 'photo-1', selected: true, order: 0, label: 'Overview' },
  { id: 'video-1', selected: true, order: 1, label: 'Result' },
]);
const reorderedDrafts = buildAssistantChannelDrafts(reorderedContext);
editedDraftTexts = hydrateAssistantDraftTexts(reorderedDrafts, editedDraftTexts);
assert.equal(editedDraftTexts.Instagram, 'Manual Instagram edit with Jane Customer and JANE@EXAMPLE.COM.', 'Edited Instagram draft should survive media reorder');

const relabeledContext = buildAssistantJobContext(privateJob, materials, {
  diagnosis: 'Technician confirmed low airflow after inspection at Sample Bistro.',
  repairPerformed: 'Replaced the confirmed door gasket.',
  finalResult: 'Temperature pull-down verified by technician.',
}, [
  { id: 'photo-1', selected: true, order: 0, label: 'Problem' },
  { id: 'video-1', selected: true, order: 1, label: 'Result' },
]);
const relabeledDrafts = buildAssistantChannelDrafts(relabeledContext);
editedDraftTexts = hydrateAssistantDraftTexts(relabeledDrafts, editedDraftTexts);
assert.equal(editedDraftTexts.Instagram, 'Manual Instagram edit with Jane Customer and JANE@EXAMPLE.COM.', 'Edited Instagram draft should survive media label change');

const regenResult = regenerateAssistantChannelDraft('Instagram', relabeledDrafts, editedDraftTexts, { Instagram: true, Facebook: true });
assert.equal(regenResult.regenerated, true);
assert.equal(regenResult.drafts.Instagram, relabeledDrafts.find((draft) => draft.channel === 'Instagram').body);
assert.equal(regenResult.drafts.Facebook, 'Manual Facebook edit stays exactly here.');
assert.equal(regenResult.dirty.Instagram, false);
assert.equal(regenResult.dirty.Facebook, true);

const secondJobContext = buildAssistantJobContext({ ...privateJob, id: 'job-two', system: 'Rooftop unit', issue: 'No cooling reported.' }, materials);
const secondJobDrafts = hydrateAssistantDraftTexts(buildAssistantChannelDrafts(secondJobContext), {});
assert.notEqual(secondJobDrafts.Instagram, 'Manual Instagram edit with Jane Customer and JANE@EXAMPLE.COM.', 'Switching selected job should reset drafts');

installDownloadStubs();
const dataUrlAttachment = { id: 'data-url', name: 'local.jpg', mimeType: 'image/jpeg', sizeBytes: 10, kind: 'photo', uploadedAt: '2026-07-26T00:00:00Z', dataUrl: 'data:image/jpeg;base64,AA==' };
const storageBackedAttachment = { id: 'storage-url', name: 'stored.mp4', mimeType: 'video/mp4', sizeBytes: 20, kind: 'file', uploadedAt: '2026-07-26T00:00:00Z', storageBucket: 'job-files', storagePath: 'company/job/stored.mp4', dataUrl: 'https://storage.example/stored.mp4' };
const missingAttachment = { id: 'missing-url', name: 'missing.mov', mimeType: 'video/quicktime', sizeBytes: 30, kind: 'file', uploadedAt: '2026-07-26T00:00:00Z', storageBucket: 'job-files', storagePath: 'company/job/missing.mov' };
assert.equal(attachmentUrl(dataUrlAttachment), 'data:image/jpeg;base64,AA==');
assert.equal(attachmentUrl(storageBackedAttachment), 'https://storage.example/stored.mp4');
const downloadResults = await downloadJobAttachments([dataUrlAttachment, missingAttachment, storageBackedAttachment]);
assert.equal(downloadResults[0].ok, true, 'dataUrl attachment should download');
assert.equal(downloadResults[1].ok, false, 'missing attachment should report a clear failure');
assert.match(downloadResults[1].error, /Save the job first/);
assert.equal(downloadResults[2].ok, true, 'storage-backed attachment should download through existing resolved URL');
assert.equal(globalThis.__assistantDownloadClicks.length, 2, 'download should continue after an unavailable selected file');

console.log('ai assistant regression checks passed');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function installDownloadStubs() {
  globalThis.__assistantDownloadClicks = [];
  globalThis.fetch = async (url) => ({
    async blob() {
      return new Blob([String(url)], { type: 'application/octet-stream' });
    },
  });
  globalThis.URL.createObjectURL = () => 'blob:test-download';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.window = {
    setTimeout(callback) {
      callback();
      return 1;
    },
  };
  globalThis.document = {
    body: {
      appendChild() {},
    },
    createElement(tag) {
      assert.equal(tag, 'a');
      return {
        href: '',
        download: '',
        target: '',
        click() {
          globalThis.__assistantDownloadClicks.push({ href: this.href, download: this.download, target: this.target });
        },
        remove() {},
      };
    },
  };
}
