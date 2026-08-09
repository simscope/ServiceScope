import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browserFiles = [
  'src/components/portal/AiAssistantPage.tsx',
  'src/components/portal/ReelPreview.tsx',
  'src/features/reel-director/clientApi.ts',
  'src/features/reel-director/contracts.ts',
  'src/features/reel-director/reelState.ts',
  'src/features/reel-director/oneClickReel.ts',
];
const serverFiles = [
  'supabase/functions/_shared/reel-engine/contracts.js',
  'supabase/functions/_shared/reel-engine/director.js',
  'supabase/functions/_shared/reel-engine/prompts.js',
  'supabase/functions/_shared/reel-engine/schemas.js',
  'supabase/functions/_shared/reel-engine/mediaEvidence.js',
  'supabase/functions/_shared/reel-engine/evidenceCapabilities.js',
];
const browser = (await Promise.all(browserFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const reelContractSurface = (await Promise.all(browserFiles.slice(1).map((file) => readFile(file, 'utf8')))).join('\n');
const server = (await Promise.all(serverFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const aiPage = await readFile(browserFiles[0], 'utf8');
const preview = await readFile(browserFiles[1], 'utf8');
const reelContracts = await readFile('src/features/reel-director/contracts.ts', 'utf8');
const reelRequestMediaContract = reelContracts.match(/export type ReelMediaPlanItem = \{[\s\S]*?\n\};/)?.[0] ?? '';
const reelEdge = await readFile('supabase/functions/ai-content-generate/index.ts', 'utf8');
const mediaEdge = await readFile('supabase/functions/ai-media-analyze/index.ts', 'utf8');
const migration = await readFile('supabase/migrations/20260809013000_reel_authoritative_media_findings.sql', 'utf8');
const canonicalSchema = await readFile('supabase/schema.sql', 'utf8');
const oneClickSource = await readFile('src/features/reel-director/oneClickReel.ts', 'utf8');
const reelStateSource = await readFile('src/features/reel-director/reelState.ts', 'utf8');
const reelRegression = await readFile('scripts/reel-director-regression-tests.mjs', 'utf8');
let checks = 0;
function check(fn) { fn(); checks += 1; }

check(() => assert.doesNotMatch(browser, /OPENAI_API_KEY|AI_CONTENT_PROVIDER|AI_CONTENT_MODEL|api\.openai\.com/i));
check(() => assert.doesNotMatch(browser, /META_(?:APP_SECRET|TOKEN|GRAPH)|graph\.facebook\.com|service_role/i));
check(() => assert.doesNotMatch(reelContractSurface, /customerName|customerCompany|customerEmail|customerPhone|streetAddress|jobNumber|invoice|payment|serialNumber/i));
check(() => assert.doesNotMatch(browser, /Deno\.env|SUPABASE_SERVICE_ROLE_KEY|createClient\(/));
check(() => assert.match(server, /parseReelProviderResult/));
check(() => assert.match(server, /assertExactFields/));
check(() => assert.match(server, /REEL_MEDIA_UNAVAILABLE/));
check(() => assert.match(server, /listReelMediaCandidates/));
check(() => assert.match(server, /reconstructAuthoritativeReelMedia/));
check(() => assert.match(server, /attachmentResultId/));
check(() => assert.match(server, /analysisRunId/));
check(() => assert.match(server, /current_checksum_matches/));
check(() => assert.match(server, /privateValues/));
check(() => assert.match(server, /genericCreativePattern/));
check(() => assert.match(server, /low_information/));
check(() => assert.doesNotMatch(preview, /fetch\(|XMLHttpRequest|supabaseFunction|upload|POST/i));
check(() => assert.doesNotMatch(preview, /ffmpeg|remotion|shotstack|cloudinary|mux/i));
check(() => assert.doesNotMatch(aiPage.slice(aiPage.indexOf('Approve Reel') - 900, aiPage.indexOf('Approve Reel') + 450), /meta-social-publish|\/feed|\/photos|Publish Reel/i));
check(() => assert.doesNotMatch(browser, /facebook\.com\/|instagram\.com\/|unofficial|browser automation/i));
check(() => assert.match(aiPage, /approveCurrentReel\(current, currentReelInputRevision\)/));
check(() => assert.match(aiPage, /reconcileReelApproval/));
check(() => assert.match(server, /context\.safeMedia/));
check(() => assert.doesNotMatch(server, /generated image|image generation|text-to-image/i));
check(() => assert.doesNotMatch(server, /musicUrl|audioUrl|licensedMusic/i));
check(() => assert.match(reelRequestMediaContract, /attachmentId:\s*string/));
check(() => assert.match(reelRequestMediaContract, /position:\s*number/));
for (const forbidden of ['role', 'evidenceFindingId', 'evidenceCategory', 'evidenceText', 'confidence', 'privacyStatus']) {
  check(() => assert.doesNotMatch(reelRequestMediaContract, new RegExp(`\\b${forbidden}\\b`)));
}
check(() => assert.match(reelEdge, /list_company_reel_media_analysis_candidates/));
check(() => assert.doesNotMatch(reelEdge, /list_company_facebook_publication_photo_candidates/));
check(() => assert.match(reelEdge, /attachmentSha256/));
check(() => assert.match(mediaEdge, /contentFindingCategorySet\.has/));
check(() => assert.match(mediaEdge, /contentFindings:/));
check(() => assert.match(migration, /enable row level security/i));
check(() => assert.match(migration, /revoke all on public\.company_media_analysis_content_findings from public, anon, authenticated/i));
check(() => assert.match(migration, /revoke all on function public\.list_company_reel_media_analysis_candidates[^;]+from public, anon, authenticated/i));
check(() => assert.doesNotMatch(browser, /storage_bucket|storage_path|attachment_sha256|current_checksum_matches/i));
check(() => assert.doesNotMatch(aiPage, /rawJson|providerResponse|error\.stack|storage_path|attachment_sha256/i));
check(() => assert.doesNotMatch(`${aiPage}\n${preview}`, /meta-social-publish|graph\.facebook\.com|\/feed|\/photos|rendering provider|upload provider/i));
check(() => assert.match(server, /reelEvidenceCapabilityForId/));
check(() => assert.match(server, /media:[\s\S]*reelEvidenceCapabilities\.visual/));
check(() => assert.match(server, /diagnosisClaimPattern[\s\S]*factIds\.has\('diagnosis'\)/));
check(() => assert.match(server, /repairClaimPattern[\s\S]*factIds\.has\('repair-performed'\)/));
check(() => assert.match(server, /resultClaimPattern[\s\S]*factIds\.has\('final-result'\)/));
check(() => assert.match(server, /VISUAL SUGGESTIONS/));
check(() => assert.match(server, /not verified diagnosis, cause/));
check(() => assert.match(server, /keep complaint symptoms and visible components in separate statements/));
check(() => assert.match(server, /must be extractive from its visual evidence/));
check(() => assert.match(server, /authorize only wording entailed by their supplied text/));
check(() => assert.match(server, /Ground every caption and voiceover sentence independently/));
check(() => assert.match(server, /failure_explainer'[\s\S]*!has\('diagnosis'\)/));
check(() => assert.match(server, /assertStatementEvidenceCoverage/));
check(() => assert.match(server, /statementSentences/));
check(() => assert.match(server, /factEvidenceForStatement/));
check(() => assert.match(server, /selectedFactEvidence/));
check(() => assert.match(server, /meaningfulEvidenceTokens/));
check(() => assert.match(server, /usesVisualMeaning && usesSymptomMeaning/));
check(() => assert.match(server, /meaningfulEvidenceTokens\(text\)\.some\(\(token\) => \([\s\S]*!supportedTokens\.has\(token\)/));
check(() => assert.match(server, /explicitVisualDescriptionPattern[\s\S]*!requiresFactOnlyLexicalSupport/));
check(() => assert.match(server, /replacementClaimPattern\.test\(text\)[\s\S]*!factIds\.has\('repair-performed'\)/));
check(() => assert.doesNotMatch(server, /technicalTerms\s*=\s*\/[^\n]+(?:fuse|contactor|valve|loose connection|control module)/i));
check(() => assert.match(server, /plan\.cover\.title, evidenceIds: plan\.hook\.evidenceIds/));
check(() => assert.match(server, /brandCtaTokens/));
for (const unsafeVisualInference of [
  'BAD RELAY, NO HEAT',
  'FAULTY RELAY FOUND',
  'THE RELAY WAS THE CULPRIT',
  'THIS RELAY KILLED THE HEAT',
  'THE RELAY WAS RESPONSIBLE',
  'BROKEN RELAY, NO HEAT',
  'RELAY ISSUE FOUND',
  'DEAD COMPRESSOR',
  'THE PROBLEM IS THIS RELAY',
]) {
  check(() => assert.match(reelRegression, new RegExp(unsafeVisualInference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
}
check(() => assert.match(reelRegression, /BURNED RELAY VISIBLE/));
check(() => assert.match(reelRegression, /OVEN NOT HEATING\?/));
for (const unsupportedFact of [
  'FUSE CAUSED THE FAILURE',
  'CONTACTOR CAUSED THE FAILURE',
  'LOOSE CONNECTION CAUSED THE FAILURE',
  'VALVE CAUSED THE FAILURE',
  'FUSE WAS THE PROBLEM',
  'BAD FUSE CAUSED THIS',
  'FUSE REPLACED',
  'CONTACTOR REPLACED',
  'VALVE INSTALLED',
  'CONTROL MODULE INSTALLED',
  'NEW CONTROL MODULE INSTALLED',
  'COOLING RESTORED',
  'AIRFLOW RESTORED',
  'SYSTEM PRESSURE RESTORED',
]) {
  check(() => assert.match(reelRegression, new RegExp(unsupportedFact)));
}
check(() => assert.match(reelRegression, /Oven was not heating\. A burned relay caused the failure\./));
check(() => assert.match(reelRegression, /We found the problem\. The relay was replaced\./));
check(() => assert.doesNotMatch(oneClickSource, /if \(!hasCurrentReelAnalysis[\s\S]{0,180}input\.analyze/));
check(() => assert.match(oneClickSource, /value: T; analysis\?: MediaAnalysisResult/));
check(() => assert.match(oneClickSource, /isReelPrivacyReviewError\(error\)[\s\S]*privacy_review_required/));
check(() => assert.match(oneClickSource, /!isReelAnalysisRefreshError\(error\)[\s\S]*throw error/));
check(() => assert.match(reelStateSource, /hasExactReelErrorCode\(message, 'REEL_ANALYSIS_REQUIRED'\)[\s\S]*hasExactReelErrorCode\(message, 'REEL_ANALYSIS_STALE'\)/));
check(() => assert.match(aiPage, /Analyze media to edit the advanced media plan/));
check(() => assert.equal((migration.match(/-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_BEGIN/g) ?? []).length, 1));
check(() => assert.equal((canonicalSchema.match(/-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_BEGIN/g) ?? []).length, 1));
check(() => assert.match(canonicalSchema, /create table public\.company_media_analysis_content_findings/));
check(() => assert.match(canonicalSchema, /create or replace function public\.list_company_reel_media_analysis_candidates/));

console.log(`AI Reel Director security scan passed (${checks}/${checks}).`);
