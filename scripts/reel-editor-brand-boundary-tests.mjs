import assert from 'node:assert/strict';
import { newDraft, frameSvg, timeline } from '../src/features/reel-editor/presentation.js';
import { validateDraft } from '../server/reel-editor/service.js';

const asset = { attachmentId: 'synthetic', identity: 'a'.repeat(64), width: 1600, height: 1200, mimeType: 'image/png', privacy: 'passed', url: 'synthetic.png' };
const context = { jobId: '11111111-1111-4111-8111-111111111111', actorId: 'manager', canManage: true, media: [asset], privateValues: ['Private Person'], brand: { displayName: 'ServiceScope', logoAvailable: false, allowedCtas: [] } };
const draft = newDraft(context.jobId, [asset]);
draft.brief.problem = 'Synthetic inspection.';
draft.brief.work = 'Synthetic work.';
draft.scenes[0].text.enabled = false;
draft.brand.displayName = 'Private Person';
draft.brand.enabled = false;
draft.brand.cta = 'Disabled CTA';
const media = new Map([[asset.attachmentId, asset], ['brand-logo', { url: 'hidden-logo.png' }]]);
draft.brand.logo = true;
for (const kind of ['crossfade', 'fade_black', 'cut']) {
  draft.scenes[0].transition = { kind, frames: kind === 'cut' ? 0 : 15 };
  validateDraft(draft, context, true);
  for (let frame = 0; frame < timeline(draft).frames; frame++) {
    const svg = frameSvg(draft, media, frame);
    assert(!svg.includes('Private Person'));
    assert(!svg.includes('hidden-logo.png'));
    assert(!svg.includes('Disabled CTA'));
  }
}
draft.brand.enabled = true;
assert.throws(() => validateDraft(draft, context, true), /EDITOR_BRAND_NOT_AUTHORIZED/);
draft.brand.displayName = 'ServiceScope';
draft.brand.logo = false;
draft.brand.cta = '';
validateDraft(draft, context, true);
assert(frameSvg(draft, media, timeline(draft).frames - 1).includes('ServiceScope'));
console.log('PASS disabled brand never enters any transition/frame; enabled brand retains authorization and end card. No encoding.');
