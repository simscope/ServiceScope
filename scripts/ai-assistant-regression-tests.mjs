import { readFile } from 'node:fs/promises';
import { buildAssistantJobSummary, generateDeterministicAssistantDescription } from '../.tmp/ai-assistant-tests/features/ai-assistant/assistantModel.js';

const assert = {
  equal(actual, expected, message = `Expected ${String(actual)} to equal ${String(expected)}`) {
    if (actual !== expected) throw new Error(message);
  },
  match(value, pattern, message = `Expected value to match ${pattern}`) {
    if (!pattern.test(value)) throw new Error(message);
  },
  doesNotMatch(value, pattern, message = `Expected value not to match ${pattern}`) {
    if (pattern.test(value)) throw new Error(message);
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

assert.match(appTypes, /'aiAssistant'/);
assert.match(navigationHook, /'aiAssistant'/);
assert.match(navigationHook, /\/ai-assistant/);
assert.match(clientNavigation, /label: 'AI Assistant'/);
assert.match(renderer, /'aiAssistant'/);
assert.match(businessRenderer, /renderedClientPage === 'aiAssistant'/);
assert.match(businessRenderer, /job\.id === aiAssistantJobId/);
assert.doesNotMatch(assistantPage, /summary\.jobNumber/);
assert.doesNotMatch(assistantPage, /<span>Job<\/span>/);

assert.match(jobDetailPanel, /Open in AI Assistant/);
assert.match(jobDetailPanel, /canOpenJobInAiAssistant\(draft\.status\)/);
assert.doesNotMatch(jobDetailPanel, /Create social post/);
assert.doesNotMatch(jobDetailPanel, /socialPost(Open|Draft|Status)/);
assert.doesNotMatch(styles, /social-post/);

assert.match(assistantModel, /AI_ASSISTANT_SUPPORTED_STATUSES[^]*'Completed'[^]*'Warranty'/);
assert.match(assistantModel, /export function scrubPrivateJobValues/);
assert.match(assistantModel, /export function assistantPhotoAttachments/);
assert.match(assistantModel, /export function generateDeterministicAssistantDescription/);
assert.match(assistantPage, /Instagram/);
assert.match(assistantPage, /Facebook/);
assert.match(assistantPage, /LinkedIn/);
assert.match(assistantPage, /Google Business/);
assert.match(assistantPage, /Blog \/ Case Study/);
assert.match(assistantPage, /Short Video/);
assert.match(assistantPage, /Client names, addresses, phone numbers, emails/);

const urlSensitivePatterns = [
  /searchParams\.set\([^)]*(clientName|organization|phone|email|address)/,
  /location\.hash[^;]*(clientName|organization|phone|email|address)/,
  /setClientPage\('aiAssistant'[^)]*(clientName|organization|phone|email|address)/,
];

for (const pattern of urlSensitivePatterns) {
  assert.doesNotMatch(navigationHook + businessRenderer + jobDetailPanel, pattern);
}

const privateJob = {
  id: 'job-internal-71',
  companyId: 'company-71',
  jobNumber: 'JOB-PRIVATE-71',
  status: 'Completed',
  system: 'Walk-in cooler',
  issue: 'JOB-PRIVATE-71 compressor repaired for Jane Customer at Sample Bistro, 123 Market Street. Call 555-0100 or jane@example.com.',
  notes: 'Private gate code not for assistant output.',
  clientName: 'Jane Customer',
  organization: 'Sample Bistro',
  phone: '555-0100',
  email: 'jane@example.com',
  address: '123 Market Street',
  technician: 'No technician',
  assignee: 'No technician',
  serviceCallFee: '0',
  scfPayment: '',
  labor: '0',
  laborPayment: '',
  attachments: [{ id: 'photo-1', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, kind: 'photo', uploadedAt: '2026-07-26T00:00:00Z' }],
  comments: [],
  invoices: [],
  createdAt: '2026-07-26T00:00:00Z',
};
const safeSummary = buildAssistantJobSummary(privateJob);
const safeDescription = generateDeterministicAssistantDescription(privateJob);
const combinedAssistantText = [safeSummary.system, safeSummary.description, safeDescription].join('\n');

assert.equal('jobNumber' in safeSummary, false);
for (const privateValue of ['JOB-PRIVATE-71', 'Jane Customer', 'Sample Bistro', '555-0100', 'jane@example.com', '123 Market Street']) {
  assert.doesNotMatch(combinedAssistantText, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('ai assistant regression checks passed');
