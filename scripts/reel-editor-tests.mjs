import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { newDraft, newScene, imageGeometry, motionAt, setMotion, frameSvg, timeline, textLayout } from '../src/features/reel-editor/presentation.js';
import { validateDraft, approvedSnapshot, assertSnapshotCurrent, sanitizeEditorAuthority, createEditorHandler, digest } from '../server/reel-editor/service.js';
import { authorizeReelForRender } from '../server/reel-renderer/authorization.js';
import { parseSandboxAssetManifestJson, parseSandboxResultJson, serializeSandboxAuthority } from '../server/reel-sandbox-runtime/contracts.js';
const media = [{ attachmentId: 'photo-a', identity: 'a'.repeat(64), width: 1600, height: 1200, mimeType: 'image/png', privacy: 'passed' }];
const context = { jobId: '11111111-1111-4111-8111-111111111111', companyId: 'company', actorId: 'manager', canManage: true, media, privateValues: ['Customer Secret'], brand: { displayName: 'ServiceScope', logoAvailable: false, allowedCtas: [] } };
const draft = newDraft(context.jobId, media); draft.brief.problem = 'Loose fitting found.'; draft.brief.work = 'The fitting was secured.';
draft.scenes[0].text.headline = draft.brief.work; draft.scenes[0].text.factRefs = ['work'];
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check('None holds every crop coordinate across all frames', () => {
  const first = imageGeometry(draft.scenes[0], media[0], 0);
  for (let n = 1; n < 120; n++) assert.deepEqual(imageGeometry(draft.scenes[0], media[0], n), first);
});
check('all pan directions are monotonic and clamped within image edges', () => {
  for (const kind of ['pan_left', 'pan_right', 'pan_up', 'pan_down']) {
    const scene = structuredClone(draft.scenes[0]); scene.motion = setMotion(scene, kind, .1);
    let previous = imageGeometry(scene, media[0], 0);
    for (let n = 1; n < 120; n++) { const g = imageGeometry(scene, media[0], n); assert(g.x <= 0 && g.y <= 0 && g.x + g.width >= 1080 && g.y + g.height >= 1920);
      const axis = kind.includes('left') || kind.includes('right') ? 'x' : 'y'; const delta = g[axis] - previous[axis]; assert(kind.includes('left') || kind.includes('up') ? delta <= 0 : delta >= 0); previous = g; }
  }
});
check('incoming transition advances motion without a reset at the scene boundary', () => {
  const scene = structuredClone(draft.scenes[0]); scene.motion = setMotion(scene, 'pan_left', .1);
  const previous = motionAt(scene, -1, 15), next = motionAt(scene, 0, 15);
  assert(next.x > previous.x); assert(next.x - previous.x < .005);
});
check('Fit retains the entire source photo', () => { const scene = structuredClone(draft.scenes[0]); scene.crop.mode = 'fit'; const g = imageGeometry(scene, media[0], 0); assert(g.width <= 1080 && g.height <= 1920); });
check('overflow stays visible as an error rather than hidden truncation', () => { assert(textLayout({ ...draft.scenes[0].text, headline: 'W'.repeat(150) }).overflow); });
check('draft permits incomplete text; approval rejects unsupported repair outcome', () => {
  const changed = structuredClone(draft); changed.scenes[0].text.headline = 'Cooling was restored.'; validateDraft(changed, context);
  assert.throws(() => validateDraft(changed, context, true), /EDITOR_UNCONFIRMED_CLAIM/);
});
check('privacy runs on brief and caption before persistence', () => { const changed = structuredClone(draft); changed.caption = 'Customer Secret'; assert.throws(() => validateDraft(changed, context), /REEL_PRIVACY_FAILED/); });
check('client-supplied confirmed marker and paths/expressions are rejected', () => { const changed = structuredClone(draft); changed.brief.confirmed = true; assert.throws(() => validateDraft(changed, context), /EDITOR_INVALID_DRAFT/); const x = structuredClone(draft); x.scenes[0].motion.start.x = 'iw/2'; assert.throws(() => validateDraft(x, context), /EDITOR_INVALID_DRAFT/); });
check('server context must grant manager access and current photo privacy', () => { assert.throws(() => validateDraft(draft, { ...context, canManage: false }), /FORBIDDEN/); assert.throws(() => validateDraft(draft, { ...context, media: [{ ...media[0], privacy: 'needs_review' }] }), /EDITOR_MEDIA_PRIVACY_REQUIRED/); });
const confirmation = { actorId: 'manager', revision: 1, confirmedAt: '2026-10-04T00:00:00Z', confirmedBrief: draft.brief };
const snapshot = approvedSnapshot(draft, { revision: 2, briefConfirmation: confirmation }, context);
check('exact approval carries all scene settings and separate brief authority', () => { assert.deepEqual(snapshot.draft, draft); assert.deepEqual(snapshot.briefAuthority, confirmation); assertSnapshotCurrent(snapshot, context); });
check('JSONB key order does not invalidate snapshot hash', () => { const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k, reverse(v)])) : value; assert.equal(digest(snapshot), digest(reverse(snapshot))); assertSnapshotCurrent(reverse(snapshot), context); });
check('changed content identity or modified snapshot cannot render', () => { assert.throws(() => assertSnapshotCurrent(snapshot, { ...context, media: [{ ...media[0], identity: 'b'.repeat(64) }] }), /EDITOR_MEDIA_STALE/); const changed = structuredClone(snapshot); changed.draft.scenes[0].crop.x = .9; assert.throws(() => assertSnapshotCurrent(changed, context), /EDITOR_SNAPSHOT_INVALID/); });
check('missing server brief confirmation prevents approval', () => { assert.throws(() => approvedSnapshot(draft, { revision: 1, briefConfirmation: null }, context), /EDITOR_BRIEF_CONFIRMATION_REQUIRED/); });
check('forbidden literal claims block approval even when present in confirmed facts', () => { const changed=structuredClone(draft);changed.brief.prohibited='fitting was secured';assert.throws(()=>validateDraft(changed,context,true),/EDITOR_PROHIBITED_CLAIM/); });
check('sandbox gets no privateValues, storage paths, caption or prohibited notes', () => { const safe = sanitizeEditorAuthority({ plan: snapshot, context }); assert.deepEqual(safe.context.privateValues, []); assert.equal(safe.plan.draft.caption, ''); assert.equal(safe.plan.draft.brief.prohibited, ''); assert.equal('companyId' in safe.context, false); authorizeReelForRender(safe); });
check('one-scene or eight-scene stories do not require a result scene', () => { validateDraft(draft, context, true); const eight = structuredClone(draft); eight.scenes = Array.from({length: 8}, (_, i) => ({ ...structuredClone(draft.scenes[0]), id: `scene-${i}` })); validateDraft(eight, context, true); assert.equal(timeline(eight).frames, 960); });
check('v1 transfer/output limits remain immutable; only v2 supports eight photos plus a logo and 60 seconds',()=>{
  const manifest={schemaVersion:'reel-sandbox-assets-v1',authoritySha256:'a'.repeat(64),assets:Array.from({length:9},(_,i)=>({attachmentId:`photo-${i}`,path:`input/asset-${i+1}.bin`,sha256:'b'.repeat(64),size:1}))};
  assert.throws(()=>parseSandboxAssetManifestJson(JSON.stringify(manifest)),/REEL_RENDER_MEDIA_INVALID/);manifest.schemaVersion='reel-sandbox-assets-v2';assert.equal(parseSandboxAssetManifestJson(JSON.stringify(manifest)).assets.length,9);
  const output={rendererVersion:'servicescope-reel-renderer-v2',durationMs:60000,width:1080,height:1920,fps:30,videoCodec:'h264',pixelFormat:'yuv420p',audioStreams:0,fileSize:20000,faststart:true,videoSha256:'c'.repeat(64),coverSha256:'d'.repeat(64)};
  assert.throws(()=>parseSandboxResultJson(JSON.stringify(output)),/REEL_RENDER_OUTPUT_INVALID/);output.presentationContract='reel-manager-presentation-v2';assert.equal(parseSandboxResultJson(JSON.stringify(output)).durationMs,60000);
  const payload=JSON.parse(serializeSandboxAuthority({plan:snapshot,context}));assert.equal(payload.plan.renderOnly,true);assert.deepEqual(payload.context.privateValues,[]);
});
let commits = 0;
const handler = createEditorHandler({ client: { authenticate: async () => ({ userId: 'manager', token: 'session' }), userRpc: async () => structuredClone(context), select: async () => [{ draft, revision: 3 }], downloadBounded: async () => { throw new Error('should not download stale input'); }, adminRpc: async () => { commits++; } } });
const conflict = await handler(new Request('http://localhost/api/reel-editor', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: JSON.stringify({ operation: 'save', jobId: context.jobId, expectedRevision: 2, draft }) }));
// Conflict should be checked before downloads or any mutation.
assert.equal(commits, 0);
assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'EDITOR_DRAFT_CONFLICT');
const ui = await readFile(new URL('../src/components/portal/ReelManagerEditor.tsx', import.meta.url), 'utf8');
check('editing/preview do not call AI, publication or render automatically', () => { assert(!/generateAi|publishEndpoint|meta-social-publish/.test(ui)); assert(ui.includes("action('render'")); });
console.log(`${count} targeted editor checks passed; no provider/render execution.`);
