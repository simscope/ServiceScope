import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateManualSelection } from '../supabase/functions/_shared/reel-engine/director.js';
import { reconstructAuthoritativeReelMedia } from '../supabase/functions/_shared/reel-engine/mediaEvidence.js';

const [selector, aiPage, oneClick, clientApi, migration] = await Promise.all([
  readFile(new URL('../src/components/ReelMediaSelector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/portal/AiAssistantPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/reel-director/oneClickReel.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/reel-media-selection/clientApi.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260926010000_reel_media_selection.sql', import.meta.url), 'utf8'),
]);

let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const mediaPlan = [
  { attachmentId: 'problem-photo', position: 1 },
  { attachmentId: 'process-photo', position: 2 },
  { attachmentId: 'result-photo', position: 3 },
];
const manualRows = [
  { attachment_id: 'problem-photo', position: 1, role: 'problem' },
  { attachment_id: 'process-photo', position: 2, role: 'process' },
  { attachment_id: 'result-photo', position: 3, role: 'result' },
];

const roleMap = validateManualSelection(mediaPlan, manualRows);
check(() => assert.equal(roleMap.get('problem-photo'), 'detail'));
check(() => assert.equal(roleMap.get('process-photo'), 'repair_process'));
check(() => assert.equal(roleMap.get('result-photo'), 'finished_result'));
check(() => assert.equal(validateManualSelection(mediaPlan, []).size, 0));
check(() => assert.throws(() => validateManualSelection(mediaPlan, manualRows.slice(0, 2)), /REEL_MEDIA_SELECTION_NOT_READY/));
check(() => assert.throws(() => validateManualSelection(mediaPlan, [...manualRows].reverse()), /REEL_MEDIA_SELECTION_CONFLICT/));
check(() => assert.throws(() => validateManualSelection(mediaPlan, manualRows.map((row) => ({ ...row, role: 'supporting' }))), /REEL_MEDIA_SELECTION_NOT_READY/));

const authoritativeRows = mediaPlan.map((item) => ({
  attachment_id: item.attachmentId,
  attachment_result_id: `result-${item.attachmentId}`,
  analysis_run_id: `run-${item.attachmentId}`,
  attachment_sha256: `\\x${'a'.repeat(64)}`,
  analysis_status: 'analyzed',
  privacy_review_status: 'passed',
  excluded: false,
  finding_id: `finding-${item.attachmentId}`,
  finding_category: 'equipment_overview',
  evidence_type: 'visual_suggestion',
  confidence: 0.9,
  explanation: 'Current service evidence.',
  risk_level: 'low',
  requires_user_approval: false,
  unresolved_privacy_count: 0,
  current_checksum_matches: true,
}));
const manualMedia = reconstructAuthoritativeReelMedia(mediaPlan, authoritativeRows, roleMap);
check(() => assert.deepEqual(manualMedia.map((item) => item.role), ['detail', 'repair_process', 'finished_result']));
const fallbackMedia = reconstructAuthoritativeReelMedia(mediaPlan, authoritativeRows);
check(() => assert.deepEqual(fallbackMedia.map((item) => item.role), ['overview', 'overview', 'overview']));
check(() => assert.throws(() => reconstructAuthoritativeReelMedia(mediaPlan, authoritativeRows.map((row, index) => index === 0 ? { ...row, unresolved_privacy_count: 1 } : row), roleMap), /REEL_PRIVACY_REVIEW_REQUIRED/));

check(() => assert.match(selector, /attachmentIds:\s*\[attachmentId\]/));
check(() => assert.doesNotMatch(selector, /useEffect\([\s\S]{0,500}analyzeSelectedMedia/));
check(() => assert.match(selector, /MAX_REEL_MEDIA_SELECTION/));
check(() => assert.match(selector, /Save selection/));
check(() => assert.match(aiPage, /allowAnalysisRefresh:\s*!hasManualReelSelection/));
check(() => assert.match(aiPage, /hasManualReelSelection\s*\?\s*savedManualReelMediaPlan\s*:\s*reelMediaPlan/));
check(() => assert.match(oneClick, /isReelAnalysisRefreshError\(error\) \|\| input\.allowAnalysisRefresh === false/));
check(() => assert.match(clientApi, /replace_company_reel_media_selection/));
check(() => assert.doesNotMatch(clientApi, /company_reel_creative_plans|company_reel_render_jobs|company_social_publications/));
check(() => assert.match(migration, /can_manage_company_ai_assistant\(target_company_id\)/));
check(() => assert.match(migration, /count\(\*\) between 3 and 4/));
check(() => assert.match(migration, /bool_or\(selection\.role = 'result'\)/));
check(() => assert.match(migration, /bool_or\(selection\.role = 'process'\)/));
check(() => assert.match(migration, /bool_or\(selection\.role in \('problem', 'supporting'\)\)/));
check(() => assert.doesNotMatch(migration, /company_reel_creative_plans|company_reel_render_jobs|company_social_publications/));

console.log(`Reel media selector regression checks passed: ${checks}`);
