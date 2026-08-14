import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

execFileSync(process.execPath, [
  'node_modules/typescript/bin/tsc',
  'src/features/media-planning/planningState.ts',
  'src/features/ai-assistant/assistantModel.ts',
  '--target',
  'ES2020',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--outDir',
  '.tmp/media-planning-tests',
  '--skipLibCheck',
], { stdio: 'pipe' });

execFileSync(process.execPath, [
  'node_modules/typescript/bin/tsc',
  'src/features/reel-director/reelState.ts',
  '--target',
  'ES2020',
  '--module',
  'ESNext',
  '--moduleResolution',
  'Bundler',
  '--outDir',
  '.tmp/media-planning-reel-tests',
  '--skipLibCheck',
], { stdio: 'pipe' });

const planning = await import('../.tmp/media-planning-tests/features/media-planning/planningState.js');
const assistant = await import('../.tmp/media-planning-tests/features/ai-assistant/assistantModel.js');
const reel = await import('../.tmp/media-planning-reel-tests/features/reel-director/reelState.js');
const [planningSource, planningUiSource, aiPageSource] = await Promise.all([
  readFile('src/features/media-planning/planningState.ts', 'utf8'),
  readFile('src/components/portal/MediaPlanningWorkspace.tsx', 'utf8'),
  readFile('src/components/portal/AiAssistantPage.tsx', 'utf8'),
]);

const jobId = 'job-planning-1';
const originalIds = ['support', 'finish', 'detail', 'overview', 'repair', 'part'];
const overviewAttachmentId = '4954c86a-a66a-4575-bbcb-e175c537ab96';
const detailAttachmentId = '23ce123c-d0be-4259-86fb-dbf50a408ba6';

function finding(id, category, confidence = 0.8, patch = {}) {
  return {
    findingId: id,
    evidenceType: category.startsWith('possible_') && category !== 'possible_problem_detail'
      ? 'privacy_risk_suggestion'
      : 'visual_suggestion',
    category,
    confidence,
    explanation: `Safe ${category.replaceAll('_', ' ')} suggestion.`,
    riskLevel: 'low',
    requiresUserApproval: true,
    ...patch,
  };
}

function attachment(id, findings = []) {
  return {
    id,
    kind: 'photo',
    mimeType: 'image/png',
    sizeBytes: 1000,
    status: 'analyzed',
    visualAnalysisPerformed: true,
    manualReviewRequired: false,
    findings,
  };
}

function resultFor(id = jobId, attachments = [], patch = {}) {
  return {
    schemaVersion: 'media-analysis-result-v1',
    analysisVersion: 'phase-4b-test',
    analysisMode: 'media_review',
    jobId: id,
    provider: 'deterministic-test',
    requiresUserApproval: true,
    attachments,
    recommendations: ['Capture a wider context image.'],
    missingShots: ['Capture the finished result if available.'],
    warnings: [],
    safety: {
      ok: true,
      privacy: 'passed',
      grounding: 'passed',
      blockedReasons: [],
    },
    ...patch,
  };
}

function approvalsFor(ids, state = 'approved') {
  return Object.fromEntries(ids.map((id) => [id, state]));
}

function reconcile(result, approvals, ids = result.attachments.map((item) => item.id), current) {
  return planning.reconcileMediaPlanningState(
    current ?? planning.createMediaPlanningState(result.jobId),
    {
      jobId: result.jobId,
      originalAttachmentIds: ids,
      result,
      approvals,
    },
  );
}

function selectedPlanningSource(findings) {
  const ranked = resultFor(jobId, [attachment('ranked', findings)]);
  return reconcile(ranked, { ranked: 'approved' }, ['ranked']).eligibleMedia[0];
}

const basicResult = resultFor(jobId, [
  attachment('approved', [finding('overview-finding', 'equipment_overview')]),
  attachment('pending', [finding('detail-finding', 'possible_problem_detail')]),
  attachment('excluded', [finding('repair-finding', 'repair_process')]),
  attachment('false-positive', [finding('part-finding', 'replacement_part')]),
]);
const basicState = reconcile(basicResult, {
  approved: 'approved',
  pending: 'pending',
  excluded: 'excluded',
  'false-positive': 'false_positive',
});

// 1-4. Only Approved media enters planning output.
assert.deepEqual(basicState.orderedAttachmentIds, ['approved']);
assert.equal(basicState.orderedAttachmentIds.includes('pending'), false);
assert.equal(basicState.orderedAttachmentIds.includes('excluded'), false);
assert.equal(basicState.orderedAttachmentIds.includes('false-positive'), false);
assert.deepEqual(basicState.excludedAttachmentIds, ['excluded', 'false-positive']);

// 5. Approved media without privacy findings enters planning as passed.
assert.equal(basicState.carouselSlots[0].privacyStatus, 'passed');
assert.equal(basicState.shortVideoScenes[0].privacyStatus, 'passed');

// 6-11. Attachment privacy findings follow the existing attachment review decision.
const privacyResult = resultFor(jobId, [
  attachment('safe', [finding('safe-overview', 'equipment_overview')]),
  attachment('face', [
    finding('face-risk', 'possible_face', 0.95, { riskLevel: 'high' }),
  ]),
  attachment('serial', [
    finding('serial-risk', 'possible_serial_or_nameplate', 0.9, { riskLevel: 'medium' }),
  ]),
  attachment('excluded-private', [
    finding('excluded-face-risk', 'possible_face', 0.8, { riskLevel: 'high' }),
  ]),
  attachment('false-private', [
    finding('false-serial-risk', 'possible_serial_or_nameplate', 0.8, { riskLevel: 'medium' }),
  ]),
]);
const privacyIds = ['safe', 'face', 'serial', 'excluded-private', 'false-private'];
const pendingPrivacyState = reconcile(privacyResult, {
  safe: 'approved',
  face: 'pending',
  serial: 'pending',
  'excluded-private': 'excluded',
  'false-private': 'false_positive',
}, privacyIds);
assert.deepEqual(pendingPrivacyState.orderedAttachmentIds, ['safe']);
assert.deepEqual(pendingPrivacyState.blockedAttachmentIds, ['face', 'serial']);
assert.equal(
  planning.mediaPlanningPrivacyStatus(privacyResult.attachments[1], privacyResult, 'pending'),
  'blocked',
);

const approvedPrivacyState = reconcile(privacyResult, {
  safe: 'approved',
  face: 'approved',
  serial: 'approved',
  'excluded-private': 'excluded',
  'false-private': 'false_positive',
}, privacyIds, pendingPrivacyState);
assert.deepEqual(approvedPrivacyState.orderedAttachmentIds, ['safe', 'face', 'serial']);
assert.deepEqual(approvedPrivacyState.blockedAttachmentIds, []);
assert.equal(
  approvedPrivacyState.carouselSlots.find((slot) => slot.attachmentId === 'face').privacyStatus,
  'reviewed',
);
assert.equal(
  approvedPrivacyState.carouselSlots.find((slot) => slot.attachmentId === 'serial').privacyStatus,
  'reviewed',
);
assert.equal(
  approvedPrivacyState.shortVideoScenes.find((scene) => scene.attachmentId === 'face').privacyStatus,
  'reviewed',
);
assert.equal(
  approvedPrivacyState.shortVideoScenes.find((scene) => scene.attachmentId === 'serial').privacyStatus,
  'reviewed',
);

const revertedPrivacyState = reconcile(privacyResult, {
  safe: 'approved',
  face: 'pending',
  serial: 'approved',
  'excluded-private': 'excluded',
  'false-private': 'false_positive',
}, privacyIds, approvedPrivacyState);
assert.deepEqual(revertedPrivacyState.orderedAttachmentIds, ['safe', 'serial']);
assert.deepEqual(revertedPrivacyState.blockedAttachmentIds, ['face']);
assert.equal(revertedPrivacyState.shortVideoScenes.some((scene) => scene.attachmentId === 'face'), false);
assert.equal(revertedPrivacyState.blockedAttachmentIds.includes('excluded-private'), false);
assert.equal(revertedPrivacyState.blockedAttachmentIds.includes('false-private'), false);

// 12. Global privacy failure remains a hard block after attachment approval.
const globalPrivacyState = reconcile(
  resultFor(jobId, privacyResult.attachments, {
    safety: { ok: false, privacy: 'failed', grounding: 'passed', blockedReasons: ['privacy'] },
  }),
  approvalsFor(privacyIds),
  privacyIds,
);
assert.deepEqual(globalPrivacyState.orderedAttachmentIds, []);
assert.deepEqual(globalPrivacyState.carouselSlots, []);
assert.deepEqual(globalPrivacyState.shortVideoScenes, []);

// 13-14. Carousel and scene outputs preserve passed versus reviewed status.
assert.equal(
  approvedPrivacyState.carouselSlots.find((slot) => slot.attachmentId === 'safe').privacyStatus,
  'passed',
);
assert.equal(
  approvedPrivacyState.shortVideoScenes.find((scene) => scene.attachmentId === 'safe').privacyStatus,
  'passed',
);

// 15. UI renders both privacy labels from slot/scene status, never unconditionally.
assert.equal(
  (planningUiSource.match(/privacyStatusLabel\((?:slot|scene)\.privacyStatus\)/g) ?? []).length,
  2,
);
assert.match(planningUiSource, /Privacy reviewed and approved/);
assert.doesNotMatch(planningUiSource, /<ShieldCheck[^>]*\/>\s*Privacy passed/);

// 16. Suggested ordering follows the safe category priority.
const orderedResult = resultFor(jobId, [
  attachment('support', [finding('support-finding', 'low_information', 0.99)]),
  attachment('finish', [finding('finish-finding', 'finished_result', 0.8)]),
  attachment('detail', [finding('detail-finding', 'possible_problem_detail', 0.7)]),
  attachment('overview', [finding('overview-finding', 'equipment_overview', 0.6)]),
  attachment('repair', [finding('repair-finding', 'repair_process', 0.9)]),
  attachment('part', [finding('part-finding', 'replacement_part', 0.85)]),
]);
let orderedState = reconcile(orderedResult, approvalsFor(originalIds), originalIds);
assert.deepEqual(orderedState.orderedAttachmentIds, ['overview', 'detail', 'repair', 'part', 'finish', 'support']);

// 17. Original attachment order is the stable tie-breaker.
const tieResult = resultFor(jobId, [
  attachment('first', [finding('same-a', 'equipment_overview', 0.8)]),
  attachment('second', [finding('same-b', 'equipment_overview', 0.8)]),
]);
const tieState = reconcile(tieResult, approvalsFor(['first', 'second']), ['second', 'first']);
assert.deepEqual(tieState.orderedAttachmentIds, ['second', 'first']);

// 18. Manual reorder survives reconciliation and overrides the suggestion.
orderedState = planning.movePlanningAttachment(orderedState, 'support', 0);
assert.equal(orderedState.manualOrder, true);
orderedState = reconcile(orderedResult, approvalsFor(originalIds), originalIds, orderedState);
assert.equal(orderedState.orderedAttachmentIds[0], 'support');

// 19. Move up/down preserves every attachment exactly once.
const movedState = planning.movePlanningAttachmentByOffset(orderedState, 'finish', -1);
assert.equal(new Set(movedState.orderedAttachmentIds).size, originalIds.length);
assert.deepEqual([...movedState.orderedAttachmentIds].sort(), [...originalIds].sort());
assert.deepEqual(movedState.carouselSlots.map((slot) => slot.position), [1, 2, 3, 4, 5, 6]);

// 20. Removing and restoring media is deterministic and idempotent.
const removedState = planning.setMediaPlanningInclusion(movedState, 'detail', false);
assert.equal(removedState.orderedAttachmentIds.includes('detail'), false);
const restoredState = planning.setMediaPlanningInclusion(removedState, 'detail', true);
assert.equal(restoredState.orderedAttachmentIds.at(-1), 'detail');
assert.equal(restoredState.orderedAttachmentIds.filter((id) => id === 'detail').length, 1);
assert.equal(planning.setMediaPlanningInclusion(restoredState, 'detail', true), restoredState);

// 21. Missing-shot suggestions never create attachments or plan slots.
assert.equal(restoredState.missingShotSuggestions.length, 2);
assert.deepEqual(restoredState.orderedAttachmentIds, restoredState.carouselSlots.map((slot) => slot.attachmentId));
assert.equal(restoredState.missingShotSuggestions.some((item) => restoredState.orderedAttachmentIds.includes(item.id)), false);

// 22. Dismiss/restore is local-only and deterministic.
const suggestionId = restoredState.missingShotSuggestions[0].id;
const dismissedState = planning.updateMissingShotStatus(restoredState, suggestionId, 'dismissed');
assert.equal(dismissedState.missingShotSuggestions.find((item) => item.id === suggestionId).status, 'dismissed');
const restoredSuggestionState = planning.updateMissingShotStatus(dismissedState, suggestionId, 'suggested');
assert.equal(restoredSuggestionState.missingShotSuggestions.find((item) => item.id === suggestionId).status, 'suggested');

// 23. Storyboard scenes reference only current approved, selected attachments.
assert.deepEqual(
  restoredSuggestionState.shortVideoScenes.map((scene) => scene.attachmentId),
  restoredSuggestionState.orderedAttachmentIds,
);
assert.equal(
  restoredSuggestionState.shortVideoScenes.every((scene) => restoredSuggestionState.approvedAttachmentIds.includes(scene.attachmentId)),
  true,
);

// 24. Overlay privacy validation rejects known and patterned private values.
const privateOverlay = planning.updateSceneOverlayText(
  restoredSuggestionState,
  restoredSuggestionState.shortVideoScenes[0].attachmentId,
  'Call customer@example.test for details',
  ['customer@example.test'],
);
assert.equal(privateOverlay.accepted, false);
assert.equal(privateOverlay.state, restoredSuggestionState);
const safeOverlay = planning.updateSceneOverlayText(
  restoredSuggestionState,
  restoredSuggestionState.shortVideoScenes[0].attachmentId,
  'Review the approved equipment overview',
  ['customer@example.test'],
);
assert.equal(safeOverlay.accepted, true);
assert.equal(safeOverlay.state.shortVideoScenes[0].overlayText, 'Review the approved equipment overview');

// 25. Job changes reset every planning collection and local edit.
const switchedState = planning.reconcileMediaPlanningState(safeOverlay.state, {
  jobId: 'job-planning-2',
  originalAttachmentIds: [],
  result: undefined,
  approvals: {},
});
assert.equal(switchedState.jobId, 'job-planning-2');
assert.deepEqual(switchedState.orderedAttachmentIds, []);
assert.deepEqual(switchedState.shortVideoScenes, []);
assert.deepEqual(switchedState.missingShotSuggestions, []);

// 26. A new accepted result resets manual order and stale suggestion decisions.
const revisedResult = resultFor(jobId, orderedResult.attachments, {
  missingShots: ['Capture a new approved angle if available.'],
});
const revisedState = reconcile(revisedResult, approvalsFor(originalIds), originalIds, dismissedState);
assert.equal(revisedState.manualOrder, false);
assert.deepEqual(revisedState.orderedAttachmentIds, ['overview', 'detail', 'repair', 'part', 'finish', 'support']);
assert.deepEqual(revisedState.missingShotSuggestions.map((item) => item.status), ['suggested', 'suggested']);

// 27. Planning controls perform zero Edge/provider calls.
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error('Planning must not call fetch.');
};
planning.resetToSuggestedMediaOrder(restoredSuggestionState);
planning.movePlanningAttachmentByOffset(restoredSuggestionState, 'detail', -1);
planning.updateMissingShotStatus(restoredSuggestionState, suggestionId, 'planned');
planning.updateSceneOverlayText(restoredSuggestionState, 'detail', 'Safe local overlay', []);
assert.equal(networkCalls, 0);
globalThis.fetch = originalFetch;

// 28. Planning leaves facts, drafts, channels, jobs, attachments and analysis untouched.
const existingWorkspace = {
  facts: { diagnosis: 'Existing diagnosis' },
  drafts: { Instagram: 'Existing draft' },
  channels: ['Instagram'],
  job: { id: jobId, status: 'Completed', issue: 'Existing issue' },
  attachments: [{ id: 'overview', label: 'Existing label' }],
  analysis: orderedResult,
};
const beforePlanning = JSON.stringify(existingWorkspace);
planning.movePlanningAttachment(restoredSuggestionState, 'detail', 0);
assert.equal(JSON.stringify(existingWorkspace), beforePlanning);

// 29-30. Unsupported statuses are hidden; Completed and Warranty remain supported.
assert.equal(assistant.canOpenJobInAiAssistant('In progress'), false);
assert.equal(assistant.canOpenJobInAiAssistant('Completed'), true);
assert.equal(assistant.canOpenJobInAiAssistant('Warranty'), true);
assert.match(aiPageSource, /reelEditOpen && !unsupportedStatus/);
assert.match(aiPageSource, /mediaAnalysisWorkspace\.result\?\.jobId === selectedJob\?\.id[\s\S]*<MediaPlanningWorkspace/);
assert.match(aiPageSource, /Analyze media to edit the advanced media plan[\s\S]*onClick=\{analyzeMedia\}/);

// 31-37. Normal UI exposes safe identity and one authoritative Reel selection summary.
assert.match(aiPageSource, /data-attachment-id=\{item\.id\}/);
assert.match(aiPageSource, /<strong>\{item\.name \|\| 'Approved media'\}<\/strong>/);
assert.match(aiPageSource, /ID \{shortAttachmentId\(item\.id\)\}/);
assert.match(aiPageSource, /aria-label=\{`Select \$\{item\.name \|\| 'media'\} \(\$\{item\.id\}\) for AI`\}/);
assert.match(aiPageSource, /Reel media: \{currentReelMediaPlan\.length\} selected/);
assert.match(aiPageSource, /currentReelMediaPlan\.map\(\(media\) =>/);
assert.match(aiPageSource, /const mediaPlan = currentReelMediaPlan;/);
assert.doesNotMatch(aiPageSource, /useState[^;\n]*reelMediaSelection/i);

// 38. Exact UI selection state produces the intended two-photo request in order.
const exactReelMedia = [
  { id: 'other-before', kind: 'photo', mimeType: 'image/jpeg', name: 'Other before', selected: false, order: 0 },
  { id: overviewAttachmentId, kind: 'photo', mimeType: 'image/jpeg', name: 'Overview', selected: true, order: 1 },
  { id: 'other-between', kind: 'photo', mimeType: 'image/png', name: 'Other between', selected: false, order: 2 },
  { id: detailAttachmentId, kind: 'photo', mimeType: 'image/webp', name: 'Detail', selected: true, order: 3 },
];
assert.deepEqual(reel.reelMediaPlan(exactReelMedia, planning.createMediaPlanningState(jobId)), [
  { attachmentId: overviewAttachmentId, position: 1 },
  { attachmentId: detailAttachmentId, position: 2 },
]);

// 39-45. Frontend evidence selection mirrors the server comparator exactly.
let rankedSource = selectedPlanningSource([
  finding('detail-90', 'possible_problem_detail', 0.9),
  finding('overview-80', 'equipment_overview', 0.8),
]);
assert.equal(rankedSource.suggestedRole, 'detail');
assert.equal(rankedSource.confidence, 0.9);

rankedSource = selectedPlanningSource([
  finding('overview-85', 'equipment_overview', 0.85),
  finding('weak-60', 'low_information', 0.6),
]);
assert.equal(rankedSource.suggestedRole, 'overview');
assert.equal(rankedSource.confidence, 0.85);

rankedSource = selectedPlanningSource([
  finding('weak-99', 'low_information', 0.99),
  finding('overview-70', 'equipment_overview', 0.7),
]);
assert.equal(rankedSource.suggestedRole, 'overview');
assert.equal(rankedSource.confidence, 0.7);

rankedSource = selectedPlanningSource([
  finding('repair-80', 'repair_process', 0.8),
  finding('detail-90', 'possible_problem_detail', 0.9),
]);
assert.equal(rankedSource.suggestedRole, 'detail');

rankedSource = selectedPlanningSource([
  finding('detail-equal', 'possible_problem_detail', 0.8),
  finding('overview-equal', 'equipment_overview', 0.8),
]);
assert.equal(rankedSource.suggestedRole, 'overview');

rankedSource = selectedPlanningSource([
  finding('z-finding', 'equipment_overview', 0.8),
  finding('a-finding', 'equipment_overview', 0.8),
]);
assert.equal(rankedSource.evidenceFindingId, 'a-finding');

rankedSource = selectedPlanningSource([
  finding('unclear-80', 'unclear', 0.8),
  finding('weak-99', 'low_information', 0.99),
]);
assert.equal(rankedSource.suggestedRole, 'supporting_image');
assert.equal(rankedSource.confidence, 0.99);

// 46-47. Current Production-shaped fixtures resolve to overview then detail without hard-coded source behavior.
const currentAcceptance = resultFor(jobId, [
  attachment(overviewAttachmentId, [
    finding('overview-current', 'equipment_overview', 0.85),
    finding('overview-weak', 'low_information', 0.6),
  ]),
  attachment(detailAttachmentId, [
    finding('detail-current', 'possible_problem_detail', 0.9),
    finding('detail-overview', 'equipment_overview', 0.8),
  ]),
]);
const currentAcceptanceState = reconcile(
  currentAcceptance,
  approvalsFor([overviewAttachmentId, detailAttachmentId]),
  [overviewAttachmentId, detailAttachmentId],
);
assert.deepEqual(
  currentAcceptanceState.eligibleMedia.map((item) => [item.attachmentId, item.suggestedRole]),
  [[overviewAttachmentId, 'overview'], [detailAttachmentId, 'detail']],
);

// 48. Planning has no persistence, Edge or provider boundary.
const planningBrowserSource = `${planningSource}\n${planningUiSource}`;
assert.doesNotMatch(planningBrowserSource, /localStorage|sessionStorage|indexedDB|supabaseFunction|analyzeSelectedMedia|generateAiContent|api\.openai\.com|OPENAI_API_KEY|fetch\s*\(/i);
assert.doesNotMatch(
  planningSource,
  /companyId|storagePath|signedUrl|supabaseFunction|adminClient|callerClient|\.rpc\s*\(/i,
);

console.log('Media planning regression tests passed (48/48).');
