import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryGuards } from '../supabase/functions/_shared/content-engine/rateLimit.js';
import {
  handleManualReelGeneration,
  validateManualReelRequest,
} from '../supabase/functions/_shared/reel-engine/manualPlan.js';
import {
  buildReelProviderOutputJsonSchema,
  parseReelPlanShape,
  parseReelProviderResult,
  validateReelPlan,
} from '../supabase/functions/_shared/reel-engine/schemas.js';
import { manualReelPlanIdempotencyKey } from '../src/features/reel-director/requestIdentity.js';

const jobId = '8edc53e7-3188-414b-acc3-44d205b238da';
const selected = [
  { attachmentId: '23ce123c-d0be-4259-86fb-dbf50a408ba6', position: 1, role: 'problem' },
  { attachmentId: '4954c86a-a66a-4575-bbcb-e175c537ab96', position: 2, role: 'process' },
  { attachmentId: '2a23b063-340e-4591-9c3c-48cf545f06d5', position: 3, role: 'result' },
];
const mediaPlan = selected.map(({ attachmentId, position }) => ({ attachmentId, position }));
const selectionRevision = revisionFor(selected);
const manualIdentity = {
  preview: await manualReelPlanIdempotencyKey('preview', selectionRevision),
  create: await manualReelPlanIdempotencyKey('create', selectionRevision),
};
let checks = 0;

function check(fn) {
  fn();
  checks += 1;
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.message === code);
  checks += 1;
}

const previewDependencies = makeDependencies();
const preview = await handleManualReelGeneration(previewDependencies);
check(() => assert.equal(preview.marketingAngle, 'manual_selection'));
check(() => assert.equal(preview.creativePlanId, undefined));
check(() => assert.equal(previewDependencies.counters.persisted, 0));
check(() => assert.equal(previewDependencies.counters.providerCalls, 0));
check(() => assert.deepEqual(preview.scenes.map((scene) => scene.attachmentId), mediaPlan.map((item) => item.attachmentId)));
check(() => assert.deepEqual(preview.scenes.map((scene) => scene.sceneRole), ['detail', 'repair_process', 'finished_result']));
check(() => assert.deepEqual(preview.scenes.map((scene) => scene.categoryLabel), ['PROBLEM', 'SERVICE', 'RESULT']));
check(() => assert.deepEqual(preview.scenes.map((scene) => scene.overlayText), [
  'Corroded valve and worn connections',
  'Valve replacement in progress',
  'Replacement valve installed',
]));
check(() => assert.equal(preview.brand.cta, 'Having a similar issue? Send us a message.'));
check(() => assert.equal(preview.safety.privacy, 'passed'));
check(() => assert.equal(preview.scenes.every((scene) => scene.secondaryText === null && scene.voiceoverLine === null), true));
check(() => assert.deepEqual(preview.scenes.map(({ motionPreset, cropStrategy, transitionOut, durationMs }) => ({
  motionPreset, cropStrategy, transitionOut, durationMs,
})), [
  { motionPreset: 'focus_detail', cropStrategy: 'detail_crop', transitionOut: 'quick_fade', durationMs: 4000 },
  { motionPreset: 'pan_right', cropStrategy: 'subject_center', transitionOut: 'crossfade', durationMs: 4000 },
  { motionPreset: 'slow_zoom_out', cropStrategy: 'subject_center', transitionOut: 'quick_fade', durationMs: 4000 },
]));
check(() => assert.equal(buildReelProviderOutputJsonSchema().properties.marketingAngle.enum.includes('manual_selection'), false));

const previewIdentity = manualIdentity.preview;
check(() => assert.equal(previewIdentity, 'manual-plan:preview:sha256-681af0c89a8ec64b3c7e9976f54b1cbe0d537abceac8e1f4f73028fbaef11ca7'));
check(() => assert.equal(previewIdentity, manualIdentity.preview));
check(() => assert.match(previewIdentity, /^[A-Za-z0-9:_-]+$/));
check(() => assert.ok(previewIdentity.length <= 180));
check(() => assert.doesNotMatch(previewIdentity, /[\[\]",]/));
const changedRoleIdentity = await manualReelPlanIdempotencyKey('preview', revisionFor([
  { ...selected[0], role: 'supporting' }, ...selected.slice(1),
]));
const changedOrderIdentity = await manualReelPlanIdempotencyKey('preview', revisionFor([
  { ...selected[1], position: 1 }, { ...selected[0], position: 2 }, selected[2],
]));
const changedMediaIdentity = await manualReelPlanIdempotencyKey('preview', revisionFor([
  { ...selected[0], attachmentId: '00000000-0000-4000-8000-000000002499' }, ...selected.slice(1),
]));
check(() => assert.notEqual(previewIdentity, changedRoleIdentity));
check(() => assert.notEqual(previewIdentity, changedOrderIdentity));
check(() => assert.notEqual(previewIdentity, changedMediaIdentity));
check(() => assert.notEqual(previewIdentity, manualIdentity.create));
const fnvCollisionLeft = revisionFor([
  { ...selected[0], attachmentId: '00000000-0000-4000-8000-4816ef1ff945' }, ...selected.slice(1),
]);
const fnvCollisionRight = revisionFor([
  { ...selected[0], attachmentId: '00000000-0000-4000-8000-10dfd77b8e03' }, ...selected.slice(1),
]);
check(() => assert.equal(stableFNVFingerprint(fnvCollisionLeft), stableFNVFingerprint(fnvCollisionRight)));
const collisionIdentityLeft = await manualReelPlanIdempotencyKey('preview', fnvCollisionLeft);
const collisionIdentityRight = await manualReelPlanIdempotencyKey('preview', fnvCollisionRight);
check(() => assert.notEqual(collisionIdentityLeft, collisionIdentityRight));

const genericPreview = await handleManualReelGeneration(makeDependencies({
  system: 'Appliance',
  issue: 'Service requested.',
  reelRows: genericMediaRows(),
}));
check(() => assert.deepEqual(genericPreview.scenes.map((scene) => scene.overlayText), [
  'A service problem detail is visible',
  'Service work is shown in progress',
  'The completed service result is shown',
]));

const editedScenes = preview.scenes.map((scene, index) => ({
  attachmentId: scene.attachmentId,
  position: scene.position,
  role: selected[index].role,
  categoryLabel: index === 0 ? 'DETAIL' : scene.categoryLabel,
  primaryText: scene.overlayText,
  supportingText: index === 1 ? 'Valve replacement in progress' : '',
}));
const createDependencies = makeDependencies({ operation: 'create', scenes: editedScenes });
const created = await handleManualReelGeneration(createDependencies);
check(() => assert.equal(created.creativePlanId, '00000000-0000-4000-8000-000000002480'));
check(() => assert.equal(createDependencies.counters.persisted, 1));
check(() => assert.equal(createDependencies.counters.providerCalls, 0));
check(() => assert.equal(created.scenes[0].categoryLabel, 'DETAIL'));
check(() => assert.equal(created.scenes[1].secondaryText, 'Valve replacement in progress'));
check(() => assert.equal(createDependencies.counters.rendered, 0));
check(() => assert.deepEqual(createDependencies.persistedPlan.mediaPlan, mediaPlan));
check(() => assert.equal(createDependencies.persistedPlan.plan.marketingAngle, 'manual_selection'));
const { revision: _revision, creativePlanId: _creativePlanId, ...persistedShape } = created;
check(() => assert.equal(parseReelPlanShape(persistedShape).scenes[0].categoryLabel, 'DETAIL'));

const retryDependencies = makeDependencies({ operation: 'create', scenes: editedScenes });
const firstRetry = await handleManualReelGeneration(retryDependencies);
const secondRetry = await handleManualReelGeneration(retryDependencies);
check(() => assert.equal(firstRetry.creativePlanId, secondRetry.creativePlanId));
check(() => assert.equal(retryDependencies.counters.persisted, 1));
check(() => assert.equal(retryDependencies.counters.providerCalls, 0));

check(() => assert.throws(() => validateManualReelRequest(payload('create', [
  { ...editedScenes[0], categoryLabel: 'SERVICE' },
  ...editedScenes.slice(1),
])), /INVALID_REQUEST/));
check(() => assert.throws(() => validateManualReelRequest(payload('create', [
  { ...editedScenes[0], primaryText: 'x'.repeat(46) },
  ...editedScenes.slice(1),
])), /INVALID_REQUEST/));
check(() => assert.throws(() => validateManualReelRequest(payload('create', [
  editedScenes[1],
  editedScenes[0],
  editedScenes[2],
])), /INVALID_REQUEST/));

await rejectsCode(handleManualReelGeneration(makeDependencies({
  operation: 'create',
  scenes: [{ ...editedScenes[0], primaryText: 'Jane Customer private valve detail' }, ...editedScenes.slice(1)],
})), 'REEL_PRIVACY_FAILED');
await rejectsCode(handleManualReelGeneration(makeDependencies({ selection: [] })), 'REEL_MEDIA_SELECTION_NOT_READY');
await rejectsCode(handleManualReelGeneration(makeDependencies({
  operation: 'create',
  scenes: [...editedScenes.slice(0, 2), { ...editedScenes[2], primaryText: 'Cooling system fully restored' }],
})), 'REEL_GROUNDING_FAILED');

const aiContext = aiValidationContext(preview);
const { revision: _previewRevision, ...previewPlan } = preview;
check(() => assert.throws(() => validateReelPlan(previewPlan, aiContext), /REEL_GROUNDING_FAILED/));
const aiPlan = {
  ...previewPlan,
  marketingAngle: 'repair_process',
  scenes: previewPlan.scenes.map(({ categoryLabel: _categoryLabel, ...scene }, index) => (
    index === 2 ? { ...scene, overlayText: 'Cooling system fully restored' } : scene
  )),
};
check(() => assert.throws(() => parseReelProviderResult(aiPlan, aiContext), /REEL_GROUNDING_FAILED/));
check(() => assert.throws(() => parseReelProviderResult({ ...aiPlan, qualityScore: 69 }, aiContext), /REEL_QUALITY_FAILED/));
const staleSelectionDependencies = makeDependencies({ selection: selected.slice().reverse() });
await rejectsCode(handleManualReelGeneration(staleSelectionDependencies), 'REEL_MEDIA_SELECTION_CONFLICT');
check(() => assert.equal(staleSelectionDependencies.counters.persisted, 0));
check(() => assert.equal(staleSelectionDependencies.counters.providerCalls, 0));
await rejectsCode(handleManualReelGeneration(makeDependencies({ access: 'readonly' })), 'FORBIDDEN');
await rejectsCode(handleManualReelGeneration(makeDependencies({ sessionCompanyId: 'company-2' })), 'FORBIDDEN');

const [edgeSource, manualSource, assistantSource] = await Promise.all([
  readFile('supabase/functions/ai-content-generate/index.ts', 'utf8'),
  readFile('supabase/functions/_shared/reel-engine/manualPlan.js', 'utf8'),
  readFile('src/components/portal/AiAssistantPage.tsx', 'utf8'),
]);
check(() => assert.match(edgeSource, /reel-manual-plan-request-v1[\s\S]*handleManualReelGeneration/));
check(() => assert.doesNotMatch(manualSource, /provider\.generate|beginReelRender|OpenAI|Vision/));
check(() => assert.match(assistantSource, /Create simple plan from selected media/));
check(() => assert.match(assistantSource, /AI plan could not be created from this evidence/));
check(() => assert.match(assistantSource, /manualReelPending === 'create'/));
check(() => assert.match(assistantSource, /await manualReelPlanIdempotencyKey\('preview', manualReelSelectionRevision\)/));
check(() => assert.match(assistantSource, /await manualReelPlanIdempotencyKey\('create', manualReelSelectionRevision\)/));
check(() => assert.doesNotMatch(assistantSource, /manual-reel:preview:\$\{manualReelSelectionRevision\}/));
check(() => assert.match(manualSource, /exactId\(body\.idempotencyKey, 180\)/));

console.log(`reel manual plan fallback tests: ${checks} passed`);

function payload(operation = 'preview', scenes = []) {
  return {
    schemaVersion: 'reel-manual-plan-request-v1',
    operation,
    jobId,
    locale: 'en-US',
    mediaPlan,
    scenes,
    planningRevision: 'job-248-manual-selection-v1',
    idempotencyKey: manualIdentity[operation],
  };
}

function stableFNVFingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function revisionFor(items) {
  return JSON.stringify(items.map((item, index) => [
    item.attachmentId,
    item.role,
    item.position,
    `run-${index + 1}`,
    `result-${index + 1}`,
    'passed',
    0,
  ]));
}

function makeDependencies(options = {}) {
  const counters = { persisted: 0, providerCalls: 0, rendered: 0 };
  const request = payload(options.operation, options.scenes);
  let persistedPlan;
  return {
    rawBody: JSON.stringify(request),
    authorization: 'Bearer fixture-token',
    auth: {
      async resolveSession() {
        return {
          kind: 'company',
          company_id: options.sessionCompanyId ?? 'company-1',
          user_id: 'user-1',
          auth_user_id: '00000000-0000-4000-8000-000000002481',
          email: options.access === 'readonly' ? 'manager@example.test' : 'owner@example.test',
        };
      },
    },
    repository: {
      async getJob() {
        return {
          id: jobId, company_id: 'company-1', job_number: '248', status: 'Completed',
          system: options.system ?? 'Valve assembly', issue: options.issue ?? 'Valve service requested.', notes: 'Private job note',
          service_call_fee_cents: 10000, labor_cents: 20000,
          customer_id: 'customer-1', customer_location_id: 'location-1',
        };
      },
      async getCompany() {
        return { id: 'company-1', owner_email: 'owner@example.test', access_rules: { aiAssistant: options.access ?? 'full' } };
      },
      async getCompanyUser() {
        return options.access === 'readonly' ? {
          id: 'user-1', company_id: 'company-1', role: 'manager', status: 'active',
          portal_access_rules: { aiAssistant: 'readonly' },
        } : null;
      },
      async getCompanyVoiceSettings() {
        return {
          ai_voice_enabled: true, ai_public_display_name: 'Northstar Service', ai_default_tone: 'Professional',
          ai_custom_voice_guidance: '', ai_service_areas: [], ai_public_location_wording: '',
          ai_cta_guidance: '', ai_hashtag_guidance: [], ai_channel_defaults: {},
        };
      },
      async getCustomer() {
        return { organization: '', primary_name: 'Jane Customer', primary_email: 'jane@example.test', primary_phone: '(212) 555-0199' };
      },
      async getLocation() { return { address: '123 Market Street' }; },
      async listMaterials() { return []; },
      async listAttachments() {
        return selected.map((item) => ({ id: item.attachmentId, company_id: 'company-1', job_id: jobId, kind: 'photo', mime_type: 'image/jpeg' }));
      },
      async listInvoices() { return []; },
      async listComments() { return []; },
      async listReelMediaSelection() {
        return (options.selection ?? selected).map((item) => ({
          attachment_id: item.attachmentId, role: item.role, selection_position: item.position,
        }));
      },
      async listReelMediaCandidates() { return options.reelRows ?? mediaRows(); },
      async persistReelCreativePlan(input) {
        counters.persisted += 1;
        persistedPlan = input;
        return '00000000-0000-4000-8000-000000002480';
      },
    },
    provider: { async generate() { counters.providerCalls += 1; throw new Error('PROVIDER_MUST_NOT_RUN'); } },
    guards: createMemoryGuards(),
    telemetry: { record() {} },
    counters,
    get persistedPlan() { return persistedPlan; },
  };
}

function mediaRows() {
  const findings = [
    ['possible_problem_detail', 'Corrosion and wear are visible around a valve and its connections.'],
    ['repair_process', 'A replacement valve is shown during service work.'],
    ['finished_result', 'The finished image shows a replacement valve after installation.'],
  ];
  return selected.map((item, index) => ({
    requested_position: item.position,
    attachment_id: item.attachmentId,
    attachment_result_id: `result-${index + 1}`,
    analysis_run_id: `run-${index + 1}`,
    attachment_sha256: `\\x${String(index + 1).repeat(64)}`,
    detected_mime_type: 'image/jpeg',
    analysis_status: 'analyzed',
    privacy_review_status: 'passed',
    unresolved_privacy_count: 0,
    excluded: false,
    current_checksum_matches: true,
    finding_id: `finding-${index + 1}`,
    finding_category: findings[index][0],
    evidence_type: 'visual_suggestion',
    confidence: 0.98,
    explanation: findings[index][1],
    risk_level: 'none',
    requires_user_approval: false,
  }));
}

function aiValidationContext(plan) {
  const rows = mediaRows();
  const safeMedia = plan.scenes.map((scene, index) => ({
    attachmentId: scene.attachmentId,
    role: scene.sceneRole,
    evidenceId: scene.evidenceIds.find((id) => id.startsWith(`media:${scene.attachmentId}:`)),
    evidenceText: rows[index].explanation,
  }));
  const evidence = [
    ...safeMedia.map((media) => ({ id: media.evidenceId, text: media.evidenceText })),
    { id: 'diagnosis', text: rows[0].explanation },
    { id: 'repair-performed', text: `${rows[1].explanation}. ${rows[2].explanation}` },
    { id: 'final-result', text: rows[2].explanation },
    { id: 'company-public-display-name', text: 'Northstar Service' },
  ];
  return {
    evidence,
    safeMedia,
    privateValuesForLeakDetection: [],
    companyVoice: { enabled: true, publicDisplayName: 'Northstar Service' },
  };
}

function genericMediaRows() {
  const findings = [
    ['possible_problem_detail', 'A service problem detail is visible.'],
    ['repair_process', 'Service work is shown in progress.'],
    ['finished_result', 'The completed service result is shown.'],
  ];
  return mediaRows().map((row, index) => ({
    ...row,
    finding_category: findings[index][0],
    explanation: findings[index][1],
  }));
}
