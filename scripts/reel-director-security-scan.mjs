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

console.log(`AI Reel Director security scan passed (${checks}/${checks}).`);
