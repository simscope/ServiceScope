import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const browserFiles = [
  'src/components/portal/AiAssistantPage.tsx',
  'src/components/portal/ReelPreview.tsx',
  'src/features/reel-director/clientApi.ts',
  'src/features/reel-director/contracts.ts',
  'src/features/reel-director/reelState.ts',
];
const serverFiles = [
  'supabase/functions/_shared/reel-engine/contracts.js',
  'supabase/functions/_shared/reel-engine/director.js',
  'supabase/functions/_shared/reel-engine/prompts.js',
  'supabase/functions/_shared/reel-engine/schemas.js',
];
const browser = (await Promise.all(browserFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const reelContractSurface = (await Promise.all(browserFiles.slice(1).map((file) => readFile(file, 'utf8')))).join('\n');
const server = (await Promise.all(serverFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const aiPage = await readFile(browserFiles[0], 'utf8');
const preview = await readFile(browserFiles[1], 'utf8');
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

console.log(`AI Reel Director security scan passed (${checks}/${checks}).`);
